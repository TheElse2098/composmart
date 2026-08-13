<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
require_once __DIR__ . '/_notif.php';
secure_session_start();
header('Content-Type: application/json');
ob_clean();
csrf_check();

// Valeurs autorisées pour les champs libres des composteurs
const TYPES_VALIDES = ['Conteneur', 'Compost bois', 'Compost plastique'];
const ACCES_VALIDES = ['public', 'privé', 'institution'];

// map-api n'a pas accès à la table users (db-core) : l'admin est lu depuis la
// session (renseignée au login). $connexion est ignoré, gardé pour compat.
function is_admin($connexion = null) {
    return is_admin_session();
}

$URL      = getenv('DB_HOST')     ?: 'db';
$user     = getenv('DB_USER')     ?: 'composmart';
$password = getenv('DB_PASSWORD') ?: '';
$db_name  = getenv('DB_NAME')     ?: 'Composmart';

$response = [];

$connexion = mysqli_connect($URL, $user, $password, $db_name);

if (mysqli_connect_errno()) {
    http_response_code(500);
    echo json_encode(["error" => "Service indisponible."]);
    exit();
}

// ── Cache Redis de la liste France (lecture la plus lourde, identique pour tous) ──
const CACHE_FRANCE_KEY = 'carte:france';
const CACHE_FRANCE_TTL = 3600; // filet de sécurité ; l'invalidation explicite prime

function carte_redis() {
    static $r = false;
    if ($r !== false) return $r;            // déjà résolu (objet ou null)
    $r = null;
    if (getenv('REDIS_HOST') && extension_loaded('redis')) {
        try {
            $cx = new Redis();
            if (@$cx->connect(getenv('REDIS_HOST'), (int)(getenv('REDIS_PORT') ?: 6379), 0.5)) {
                $r = $cx;
            }
        } catch (\Throwable $e) { $r = null; }
    }
    return $r;
}

// Invalide le cache France après toute écriture sur composts/regles.
function carte_cache_flush() {
    if ($r = carte_redis()) { try { $r->del(CACHE_FRANCE_KEY); } catch (\Throwable $e) {} }
}

// ── IMPORT DEPUIS OSM ──────────────────────────────────────────────────────
if (isset($_POST['osm'])) {
    if (!rate_limit('add_compost', 15, 3600)) {
        echo json_encode(["error" => "Trop d'ajouts récents. Réessaie plus tard."]);
        exit();
    }
    $osm  = json_decode($_POST['osm'], true);
    $lon  = (double)$osm['longitude'];
    $lat  = (double)$osm['latitude'];
    $type = "Conteneur";
    $pub  = "public";

    $sql_check = "SELECT id, (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))) AS distance FROM composts HAVING distance < 0.005 LIMIT 1";
    $stmt = mysqli_prepare($connexion, $sql_check);
    $stmt->bind_param("ddd", $lat, $lon, $lat);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows == 0) {
        $stmt = mysqli_prepare($connexion, "INSERT INTO composts (longitude, latitude, type, publique) VALUES (?, ?, ?, ?)");
        $stmt->bind_param("ddss", $lon, $lat, $type, $pub);
        if ($stmt->execute()) {
            // Import : le point est directement 'valide' (DEFAULT), pas de mail —
            // la notification ne concerne que les demandes à valider.
            carte_cache_flush();
            echo json_encode("Insertion réussie.");
        } else {
            echo json_encode("Erreur d'insertion : " . $stmt->error);
        }
    } else {
        echo json_encode("Point trop proche (moins de 5m). Insertion annulée.");
    }
}

// ── IMPORT DEPUIS JSON ─────────────────────────────────────────────────────
elseif (isset($_POST['donnees_json'])) {
    if (!rate_limit('add_compost', 15, 3600)) {
        echo json_encode(["error" => "Trop d'ajouts récents. Réessaie plus tard."]);
        exit();
    }
    $d           = json_decode($_POST['donnees_json'], true);
    $lon         = (double)$d['longitude'];
    $lat         = (double)$d['latitude'];
    $type        = $d['type'] ?? '';
    $pub         = $d['public'] ?? '';
    $gestion     = mb_substr(strip_tags((string)($d['gestion'] ?? '')), 0, 300);
    $info_gest   = mb_substr(strip_tags((string)($d['info_gestion'] ?? '')), 0, 300);
    $mettre      = is_array($d['mettre'] ?? null) ? $d['mettre'] : [];
    $pas_mettre  = is_array($d['pas_mettre'] ?? null) ? $d['pas_mettre'] : [];

    if (!in_array($type, TYPES_VALIDES, true) || !in_array($pub, ACCES_VALIDES, true)) {
        echo json_encode(["error" => "Type ou accès invalide."]);
        exit();
    }

    $sql_check = "SELECT id, (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))) AS distance FROM composts HAVING distance < 0.005 LIMIT 1";
    $stmt = mysqli_prepare($connexion, $sql_check);
    $stmt->bind_param("ddd", $lat, $lon, $lat);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows == 0) {
        $stmt = mysqli_prepare($connexion, "INSERT INTO composts (longitude, latitude, type, publique, gestion, info_gestion) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->bind_param("ddssss", $lon, $lat, $type, $pub, $gestion, $info_gest);
        $stmt->execute();

        $row = mysqli_query($connexion, "SELECT max(id) FROM composts")->fetch_array(MYSQLI_ASSOC);
        $id_actuel = (int)$row["max(id)"];
        // Import direct : point déjà 'valide', pas de mail de validation à envoyer.
        carte_cache_flush();
        echo $id_actuel;

        $ins = mysqli_prepare($connexion, "INSERT INTO regles (id_compost,id_element,autorise) VALUES (?,(SELECT id FROM elements WHERE nom=?),?)");
        foreach ($mettre as $elt) {
            $ok = 1;
            $ins->bind_param("isi", $id_actuel, $elt, $ok);
            $ins->execute();
        }
        foreach ($pas_mettre as $elt) {
            $ok = 0;
            $ins->bind_param("isi", $id_actuel, $elt, $ok);
            $ins->execute();
        }
    } else {
        echo json_encode("Point trop proche (moins de 20m). Insertion annulée.");
    }
}

// ── LISTE DES COMPOSTS (France entière, ou filtrée par zone visible) ──────
// Payload allégé, quel que soit le mode :
// - nombres (pas de strings) : évite 2 octets de guillemets par valeur
// - coordonnées arrondies à 5 décimales (~1 m de précision, largement suffisant pour situer
//   un composteur) au lieu des 9-10 décimales stockées en base
// - type réduit à 1 lettre ('C'onteneur / 'X' autre), décodé côté front (cf. TYPE_MAP JS)
elseif (isset($_POST['france'])) {
    // Bornes optionnelles de la zone visible (bounding-box). Absentes = France entière
    // (comportement d'origine, mis en cache Redis). Présentes = requête filtrée, non
    // cachée (une clé par zone exploserait le cache ; l'index lat/lng suffit en direct).
    $hasBounds = isset($_POST['north'], $_POST['south'], $_POST['east'], $_POST['west']);

    if (!$hasBounds) {
        $r = carte_redis();
        // Service direct depuis le cache : on renvoie le JSON tel quel, sans re-sérialiser.
        if ($r) {
            try {
                $cached = $r->get(CACHE_FRANCE_KEY);
                if ($cached !== false && $cached !== null) {
                    mysqli_close($connexion);
                    echo $cached;
                    exit();
                }
            } catch (\Throwable $e) { /* cache indispo → on requête la DB */ }
        }
    }

    // statut='valide' : les demandes en attente (et les refus) ne sont jamais
    // servies à la carte publique, seulement à l'admin via pending.php.
    if ($hasBounds) {
        $north = (float)$_POST['north']; $south = (float)$_POST['south'];
        $east  = (float)$_POST['east'];  $west  = (float)$_POST['west'];
        // 20 000 : ce plafond était à 3 000, hérité de l'époque où la base ne
        // couvrait que la France. Dézoomé sur le monde, la boîte englobe tout et
        // le plafond se voyait — la carte n'affichait que 3 000 points sur 11 000.
        // Le clustering (chunkedLoading) encaisse cet ordre de grandeur ; c'est
        // le garde-fou qui empêche une réponse démesurée, pas une pagination.
        $stmt = mysqli_prepare($connexion,
            "SELECT id, longitude, latitude, type FROM composts
             WHERE statut = 'valide'
               AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
             LIMIT 20000");
        $stmt->bind_param('dddd', $south, $north, $west, $east);
        $stmt->execute();
        $result = $stmt->get_result();
    } else {
        // Garde-fou : la carte ne demande plus la liste sans bornes (elle charge
        // par zone visible), mais l'endpoint reste appelable. Depuis que l'import
        // couvre le monde, une réponse non bornée pèserait des dizaines de Mo —
        // et serait mise en cache telle quelle dans Redis.
        $result = mysqli_query($connexion, "SELECT id, longitude, latitude, type FROM composts WHERE statut = 'valide' LIMIT 20000");
    }

    $liste = [];
    while ($row = $result->fetch_array(MYSQLI_ASSOC)) {
        $liste[] = [
            "id"  => (int)$row["id"],
            "lon" => round((float)$row["longitude"], 5),
            "lat" => round((float)$row["latitude"], 5),
            "t"   => $row["type"] === 'Conteneur' ? 'C' : 'X',
        ];
    }
    $json = json_encode($liste, JSON_UNESCAPED_UNICODE);
    if (!$hasBounds && ($r = carte_redis())) {
        try { $r->setex(CACHE_FRANCE_KEY, CACHE_FRANCE_TTL, $json); } catch (\Throwable $e) {}
    }
    mysqli_close($connexion);
    echo $json;
    exit();
}

// ── COMPOST LE PLUS PROCHE D'UN POINT ──────────────────────────────────────
// Utilisé par le bouton « Trouver le plus proche d'ici » quand on clique sur
// la carte : évite de rejouer trouverPlusProche() qui télécharge la France
// entière côté client rien que pour comparer des distances.
//
// Stratégie « boîte qui grandit » : un vrai calcul de distance sur toute la
// table serait un scan complet malgré l'index (lat/lng), puisqu'il n'existe
// pas d'index géospatial ici. On restreint donc d'abord par une bounding box
// (l'index (latitude, longitude) s'applique), on trie par Haversine ce
// sous-ensemble réduit, et si la boîte est vide on double son rayon — jusqu'à
// une limite de 200 km, au-delà de laquelle « le plus proche » n'a plus grand
// sens pour un usage carte.
elseif (isset($_POST['plus_proche'])) {
    $lat = (float)($_POST['lat'] ?? '');
    $lon = (float)($_POST['lon'] ?? '');
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
        echo json_encode(["error" => "Coordonnées invalides."]); exit();
    }

    $trouve = null;
    // 0.05° ≈ 5,5 km à l'équateur : suffisant en zone urbaine dense, où la
    // plupart des recherches ont lieu. Les paliers suivants élargissent vite
    // (×4 à chaque fois) pour ne pas multiplier les allers-retours en zone rurale.
    foreach ([0.05, 0.2, 0.8, 2.0] as $rayon_deg) {
        $north = $lat + $rayon_deg; $south = $lat - $rayon_deg;
        // Correction de méridien : 1° de longitude vaut de moins en moins de
        // distance réelle en s'éloignant de l'équateur. Sans elle, la boîte
        // serait trop étroite en longitude près des pôles et trop large près
        // de l'équateur.
        $rayon_lon = $rayon_deg / max(0.1, cos(deg2rad($lat)));
        $east = $lon + $rayon_lon; $west = $lon - $rayon_lon;

        $stmt = mysqli_prepare($connexion,
            "SELECT id, longitude, latitude, type,
                    (6371000 * 2 * ASIN(SQRT(
                        POWER(SIN(RADIANS(latitude - ?) / 2), 2) +
                        COS(RADIANS(?)) * COS(RADIANS(latitude)) *
                        POWER(SIN(RADIANS(longitude - ?) / 2), 2)
                    ))) AS distance_m
             FROM composts
             WHERE statut = 'valide'
               AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
             ORDER BY distance_m ASC
             LIMIT 1");
        $stmt->bind_param('dddddddd', $lat, $lat, $lon, $south, $north, $west, $east);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_array(MYSQLI_ASSOC);
        if ($row) { $trouve = $row; break; }
    }

    if (!$trouve) {
        echo json_encode(["error" => "Aucun composteur recensé à proximité."]); exit();
    }

    echo json_encode([
        "id"        => (int)$trouve["id"],
        "lat"       => (float)$trouve["latitude"],
        "lon"       => (float)$trouve["longitude"],
        "t"         => $trouve["type"] === 'Conteneur' ? 'C' : 'X',
        "distance_m"=> (int)round((float)$trouve["distance_m"]),
    ], JSON_UNESCAPED_UNICODE);
    mysqli_close($connexion);
    exit();
}

// ── DÉTAIL D'UN COMPOST (autorisé/interdit) ────────────────────────────────
elseif (isset($_POST['autorinter'])) {
    $id = intval($_POST['autorinter']);

    $res = mysqli_query($connexion, "SELECT nom FROM regles,elements WHERE id_compost=$id AND id_element=elements.id AND autorise=1");
    $liste_autor = [];
    while ($row = $res->fetch_array(MYSQLI_ASSOC)) { $liste_autor[] = $row["nom"]; }
    if (!$liste_autor) $liste_autor = "";

    $res = mysqli_query($connexion, "SELECT nom FROM regles,elements WHERE id_compost=$id AND id_element=elements.id AND autorise=0");
    $liste_inter = [];
    while ($row = $res->fetch_array(MYSQLI_ASSOC)) { $liste_inter[] = $row["nom"]; }
    if (!$liste_inter) $liste_inter = "";

    $res = mysqli_query($connexion, "SELECT type,publique,gestion,info_gestion FROM composts WHERE id=$id");
    $row = $res->fetch_array(MYSQLI_ASSOC);
    if (!$row) { echo json_encode([]); exit(); }
    $donnees = ["type" => $row["type"], "acces" => $row["publique"], "gestion" => $row["gestion"], "info_gestion" => $row["info_gestion"]];

    $response[] = ["autor" => $liste_autor, "inter" => $liste_inter, "donnees" => $donnees];
}

// ── MODIFIER UN COMPOST (admin, ou créateur du point dans cette session) ───
elseif (isset($_POST['type'])) {
    $id = intval($_POST['id']);
    $cree_par_session = in_array($id, $_SESSION['created_composts'] ?? [], true);
    if (!is_admin($connexion) && !$cree_par_session) {
        http_response_code(403);
        echo json_encode(["error" => "Action réservée aux administrateurs."]);
        exit();
    }
    $type       = $_POST['type']      ?? '';
    $acces      = $_POST['acces']     ?? '';
    $mettre     = $_POST['mettre']    ?? [];
    $pas_mettre = $_POST['pas_mettre'] ?? [];
    // Champs libres : même assainissement que la branche d'import JSON.
    $gestion    = mb_substr(strip_tags((string)($_POST['gestion'] ?? '')), 0, 300);
    $info_gest  = mb_substr(strip_tags((string)($_POST['info_gestion'] ?? '')), 0, 300);

    if (!in_array($type, TYPES_VALIDES, true) || !in_array($acces, ACCES_VALIDES, true)) {
        echo json_encode(["error" => "Type ou accès invalide."]);
        exit();
    }

    foreach ($mettre as $m) {
        foreach ($pas_mettre as $p) {
            if ($m === $p) {
                die("Un élément ne peut pas être à la fois autorisé et interdit");
            }
        }
    }

    $stmt = mysqli_prepare($connexion, "UPDATE composts SET type=?, publique=?, gestion=?, info_gestion=? WHERE id=$id");
    $stmt->bind_param("ssss", $type, $acces, $gestion, $info_gest);
    $stmt->execute();

    mysqli_query($connexion, "DELETE FROM regles WHERE id_compost=$id");

    $ins = mysqli_prepare($connexion, "INSERT INTO regles (id_compost,id_element,autorise) VALUES (?,(SELECT id FROM elements WHERE nom=?),?)");
    foreach ($mettre as $elt) {
        $ok = 1;
        $ins->bind_param("isi", $id, $elt, $ok);
        $ins->execute();
    }
    foreach ($pas_mettre as $elt) {
        $ok = 0;
        $ins->bind_param("isi", $id, $elt, $ok);
        $ins->execute();
    }

    $created_ids = $_SESSION['created_composts'] ?? [];
    $is_new = in_array($id, $created_ids, true);
    if ($is_new) {
        $_SESSION['created_composts'] = array_values(array_filter($created_ids, fn($v) => $v !== $id));
    }

    $snapshot = [
        'type'       => $type,
        'acces'      => $acces,
        'gestion'    => $gestion,
        'mettre'     => array_values($mettre),
        'pas_mettre' => array_values($pas_mettre),
    ];

    if ($is_new) {
        // Fin du parcours d'ajout : la demande part en validation (le point reste
        // 'en_attente', donc toujours absent de la carte publique). C'est ici — et
        // pas à la création du brouillon — que l'audit et le mail se déclenchent.
        audit_log($connexion, 'compost_demande', "id=$id", [
            'target_type' => 'compost',
            'target_id'   => $id,
            'snapshot'    => $snapshot + ['propose_par' => $_SESSION['username'] ?? 'Anonyme'],
        ]);
        notif_compost_ajoute($connexion, $id);
        // Coordonnées relues en base plutôt que reprises du formulaire : ce sont
        // celles réellement enregistrées au clic sur la carte, pas une valeur que
        // le client pourrait avoir altérée entre-temps.
        $resPos = mysqli_query($connexion, "SELECT latitude, longitude FROM composts WHERE id=$id");
        $pos = $resPos ? mysqli_fetch_assoc($resPos) : null;
        if ($pos) {
            ouvrir_ticket_compost($id, (float)$pos['latitude'], (float)$pos['longitude'], $snapshot);
        }
        $response = "Demande envoyée.";
    } else {
        audit_log($connexion, 'compost_modifie', "id=$id", [
            'target_type' => 'compost',
            'target_id'   => $id,
            'snapshot'    => $snapshot,
        ]);
        // Le type est servi dans la liste France mise en cache : un changement
        // doit l'invalider, sinon la carte garde l'ancienne icône jusqu'au TTL.
        carte_cache_flush();
        $response = "Modification enregistrée.";
    }
}

// ── AJOUTER UN COMPOST VIA CLIC CARTE ─────────────────────────────────────
if (isset($_POST['lat_click']) && isset($_POST['lon_click'])) {
    // Connexion obligatoire : l'ajout ouvre maintenant un ticket de suivi avec
    // les admins, et un ticket doit avoir un auteur identifiable pour que la
    // conversation ait un destinataire (cf. contact_messages.user_id).
    if (empty($_SESSION['user_id'])) {
        http_response_code(401);
        echo json_encode(["error" => "Connecte-toi pour proposer un composteur."]);
        exit();
    }

    $lat = (double)$_POST['lat_click'];
    $lon = (double)$_POST['lon_click'];

    if (!rate_limit('add_compost', 15, 3600)) {
        echo json_encode(["error" => "Trop d'ajouts récents. Réessaie plus tard."]);
        exit();
    }

    // Doublon : on compare aux points validés ET aux demandes déjà en attente
    // (un point refusé ne bloque pas une nouvelle proposition au même endroit).
    $sql_check = "SELECT id, (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude))))) AS distance FROM composts WHERE statut <> 'refuse' HAVING distance < 0.005 LIMIT 1";
    $stmt = mysqli_prepare($connexion, $sql_check);
    $stmt->bind_param("ddd", $lat, $lon, $lat);
    $stmt->execute();
    if ($stmt->get_result()->num_rows > 0) {
        echo json_encode(["error" => "Un point identique existe déjà à moins de 5 m."]);
        exit();
    }

    // Brouillon de demande : 'en_attente' tant que le formulaire n'est pas envoyé,
    // donc invisible sur la carte publique. La notification mail et l'audit ne
    // partent qu'à l'envoi effectif de la demande (cf. bloc « modifier »).
    $propose_par = $_SESSION['username'] ?? null;
    $stmt = mysqli_prepare($connexion, "INSERT INTO composts (longitude, latitude, statut, propose_par) VALUES (?, ?, 'en_attente', ?)");
    $stmt->bind_param("dds", $lon, $lat, $propose_par);
    if ($stmt->execute()) {
        $new_id = (int)$connexion->insert_id;
        if (!isset($_SESSION['created_composts'])) $_SESSION['created_composts'] = [];
        $_SESSION['created_composts'][] = $new_id;
        $response = $new_id;
    } else {
        $response = ["error" => $stmt->error];
    }
}

// ── SUPPRIMER UN COMPOST (admin uniquement) ────────────────────────────────
if (isset($_POST['supprimer'])) {
    if (!is_admin($connexion)) {
        http_response_code(403);
        echo json_encode(["error" => "Action réservée aux administrateurs."]);
        exit();
    }
    $id = intval($_POST['supprimer']);

    // Instantané du composteur avant suppression
    $snap = ['id' => $id];
    $resSnap = mysqli_query($connexion, "SELECT type, publique, latitude, longitude FROM composts WHERE id=$id");
    if ($rowSnap = mysqli_fetch_assoc($resSnap)) {
        $snap['type']  = $rowSnap['type'];
        $snap['acces'] = $rowSnap['publique'];
        $snap['lat']   = (double)$rowSnap['latitude'];
        $snap['lon']   = (double)$rowSnap['longitude'];
    }

    mysqli_query($connexion, "DELETE FROM regles WHERE id_compost=$id");
    mysqli_query($connexion, "DELETE FROM composts WHERE id=$id");
    audit_log($connexion, 'compost_supprime', "id=$id", [
        'target_type' => 'compost',
        'target_id'   => $id,
        'snapshot'    => $snap,
    ]);
    $response = "Compost supprimé.";
}

mysqli_close($connexion);

// Toute branche atteignant ce point, hormis la lecture de détail 'autorinter',
// est une écriture (ajout/modif/suppression) → on invalide le cache France.
if (!isset($_POST['autorinter'])) {
    carte_cache_flush();
}

echo json_encode($response, JSON_UNESCAPED_UNICODE);
?>
