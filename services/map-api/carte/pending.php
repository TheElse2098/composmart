<?php
/**
 * Admin — demandes d'ajout de composteurs (composts.statut = 'en_attente').
 *
 *  GET  ?action=liste&page=N   → 20 demandes par page, plus récentes d'abord.
 *  POST action=valider  ids[]  → passe en 'valide' (visible sur la carte).
 *  POST action=refuser  ids[]  → passe en 'refuse' (conservé pour l'audit).
 *  POST action=modifier id ... → corrige les propriétés avant validation.
 *  POST action=annuler audit_id → annule depuis le journal une validation, un
 *                                 refus, une modification ou une suppression.
 *
 * valider/refuser acceptent 1..N ids : le traitement unitaire et le traitement
 * en masse passent par la même route.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
require_once __DIR__ . '/_compost.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();
mysqli_report(MYSQLI_REPORT_OFF);

const TYPES_VALIDES = ['Conteneur', 'Compost bois', 'Compost plastique'];
const ACCES_VALIDES = ['public', 'privé', 'institution'];
const PAR_PAGE      = 20;

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-map',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// map-api n'a pas accès à la table users (db-core) : admin lu depuis la session.
if (!is_admin_session()) {
    http_response_code(403);
    echo json_encode(['error' => 'Action réservée aux administrateurs.']);
    exit;
}

/** Invalide le cache Redis de la liste France (cf. sites.php). */
function flush_cache_france() {
    if (!getenv('REDIS_HOST') || !extension_loaded('redis')) return;
    try {
        $r = new Redis();
        if (@$r->connect(getenv('REDIS_HOST'), (int)(getenv('REDIS_PORT') ?: 6379), 0.5)) {
            $r->del('carte:france');
            $r->close();
        }
    } catch (\Throwable $e) { /* cache indispo : le TTL finira par expirer */ }
}

/** Ids valides envoyés en POST (ids[] ou ids="1,2,3"). */
function ids_postes() {
    $raw = $_POST['ids'] ?? [];
    if (is_string($raw)) $raw = explode(',', $raw);
    if (!is_array($raw)) return [];
    $ids = [];
    foreach ($raw as $v) {
        $n = (int)$v;
        if ($n > 0) $ids[] = $n;
    }
    return array_values(array_unique($ids));
}

$action = $_POST['action'] ?? $_GET['action'] ?? 'liste';

// ── VALIDER / REFUSER (unitaire ou en masse) ───────────────────────────────
if ($action === 'valider' || $action === 'refuser') {
    $ids = ids_postes();
    if (!$ids) { echo json_encode(['error' => 'Aucun composteur sélectionné.']); exit; }

    $statut = $action === 'valider' ? 'valide' : 'refuse';
    $in = implode(',', $ids);
    // Restreint aux demandes réellement en attente : évite qu'un id déjà traité
    // (ou un point validé de longue date) soit basculé par un envoi concurrent.
    mysqli_query($conn, "UPDATE composts SET statut = '$statut' WHERE id IN ($in) AND statut = 'en_attente'");
    $touches = mysqli_affected_rows($conn);

    if ($touches > 0) {
        if ($statut === 'valide') flush_cache_france();
        // Une seule entrée d'audit pour tout le lot : 20 appels HTTP vers
        // auth-api pour une action en masse seraient lents et illisibles.
        audit_log($conn, $statut === 'valide' ? 'compost_valide' : 'compost_refuse',
            $touches . ' composteur' . ($touches > 1 ? 's' : ''), [
                'target_type' => 'compost',
                'target_id'   => count($ids) === 1 ? $ids[0] : null,
                'snapshot'    => ['ids' => $ids, 'traites' => $touches,
                                  'changements' => ['statut' => ['en_attente', $statut]]],
            ]);
    }
    echo json_encode(['ok' => true, 'traites' => $touches]);
    exit;
}

// ── MODIFIER une demande avant validation ──────────────────────────────────
if ($action === 'modifier') {
    $id = (int)($_POST['id'] ?? 0);
    if (!$id) { echo json_encode(['error' => 'Données invalides']); exit; }

    $type      = $_POST['type']  ?? '';
    $acces     = $_POST['acces'] ?? '';
    $gestion   = mb_substr(strip_tags((string)($_POST['gestion'] ?? '')), 0, 300);
    $info_gest = mb_substr(strip_tags((string)($_POST['info_gestion'] ?? '')), 0, 300);
    $mettre     = is_array($_POST['mettre'] ?? null)     ? $_POST['mettre']     : [];
    $pas_mettre = is_array($_POST['pas_mettre'] ?? null) ? $_POST['pas_mettre'] : [];

    if (!in_array($type, TYPES_VALIDES, true) || !in_array($acces, ACCES_VALIDES, true)) {
        echo json_encode(['error' => 'Type ou accès invalide.']); exit;
    }
    foreach ($mettre as $m) {
        if (in_array($m, $pas_mettre, true)) {
            echo json_encode(['error' => "« $m » ne peut pas être à la fois autorisé et interdit."]); exit;
        }
    }

    $avant = compost_champs_modifiables(compost_etat($conn, $id));
    if (!$avant) { echo json_encode(['error' => 'Composteur introuvable.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE composts SET type=?, publique=?, gestion=?, info_gestion=? WHERE id=?');
    $stmt->bind_param('ssssi', $type, $acces, $gestion, $info_gest, $id);
    $stmt->execute();

    mysqli_query($conn, "DELETE FROM regles WHERE id_compost = $id");
    $ins = mysqli_prepare($conn, 'INSERT INTO regles (id_compost,id_element,autorise) VALUES (?,(SELECT id FROM elements WHERE nom=?),?)');
    foreach ($mettre as $elt)     { $ok = 1; $ins->bind_param('isi', $id, $elt, $ok); $ins->execute(); }
    foreach ($pas_mettre as $elt) { $ok = 0; $ins->bind_param('isi', $id, $elt, $ok); $ins->execute(); }

    audit_log($conn, 'compost_modifie', "id=$id", [
        'target_type' => 'compost',
        'target_id'   => $id,
        'snapshot'    => ['changements' => audit_changements(
            $avant, compost_champs_modifiables(compost_etat($conn, $id)))],
    ]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── ANNULER depuis le journal ──────────────────────────────────────────────
// L'état d'avant est relu dans le journal (db-core, via auth-api) ; refus si
// le composteur a bougé depuis, plutôt que d'écraser une retouche plus récente.
if ($action === 'annuler') {
    $aid = audit_id_demande();
    $e = audit_annulation_debut($conn, $aid, ['compost_valide', 'compost_refuse', 'compost_modifie', 'compost_supprime']);
    $s = $e['snapshot'];
    $echec = function ($m) use ($conn, $aid) { audit_annulation_echec($conn, $aid, $m); };

    if ($e['action'] === 'compost_valide' || $e['action'] === 'compost_refuse') {
        $ids = array_values(array_filter(array_map('intval', (array)($s['ids'] ?? []))));
        if (!$ids || empty($s['changements'])) $echec("Les demandes concernées n'ont pas été conservées.");
        $de = $e['action'] === 'compost_valide' ? 'valide' : 'refuse';
        // Seules repartent en attente celles qui sont restées dans l'état où l'action les a mises.
        mysqli_query($conn, "UPDATE composts SET statut = 'en_attente' WHERE id IN (" . implode(',', $ids) . ") AND statut = '$de'");
        $n = mysqli_affected_rows($conn);
        if ($n < 1) $echec('Ces demandes ont changé de statut ou ont été supprimées depuis.');
        flush_cache_france();
        audit_log($conn, 'compost_remis_en_attente', $n . ' composteur' . ($n > 1 ? 's' : ''), [
            'target_type' => 'compost', 'target_id' => count($ids) === 1 ? $ids[0] : null,
            'snapshot'    => ['ids' => $ids, 'traites' => $n, 'annule' => $aid,
                              'changements' => ['statut' => [$de, 'en_attente']]],
        ]);
        echo json_encode(['ok' => true, 'traites' => $n]);
        exit;
    }

    if ($e['action'] === 'compost_modifie') {
        $id = (int)$e['target_id'];
        $actuel = compost_champs_modifiables(compost_etat($conn, $id));
        if (!$actuel) $echec('Ce composteur a été supprimé depuis.');
        [$t, $err] = audit_revenir($actuel, $s['changements'] ?? []);
        if ($err) $echec($err);
        if (!compost_ecrire($conn, $id, $t)) $echec("L'enregistrement a échoué.");
        flush_cache_france();
        audit_log($conn, 'compost_modifie', "id=$id", [
            'target_type' => 'compost', 'target_id' => $id, 'snapshot' => [
                'annule' => $aid,
                'changements' => audit_changements($actuel, compost_champs_modifiables(compost_etat($conn, $id))),
            ],
        ]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // compost_supprime : recréé avec son numéro, sa position et ses règles.
    $t = $s['etat'] ?? null;
    $id = (int)$e['target_id'];
    if (!$t || $id <= 0) $echec("Le composteur supprimé n'a pas été conservé.");
    if (compost_etat($conn, $id)) $echec('Un composteur porte déjà ce numéro.');
    // L'import OSM nocturne a pu remettre le même point sous un autre numéro.
    $stmt = mysqli_prepare($conn,
        "SELECT id, (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?))
                 + sin(radians(?)) * sin(radians(latitude))))) AS distance
         FROM composts WHERE statut <> 'refuse' HAVING distance < 0.005 LIMIT 1");
    $stmt->bind_param('ddd', $t['lat'], $t['lon'], $t['lat']);
    $stmt->execute();
    if ($proche = $stmt->get_result()->fetch_assoc()) {
        $echec('Un composteur existe déjà à cet endroit (#' . (int)$proche['id'] . ').');
    }
    $stmt = mysqli_prepare($conn,
        'INSERT INTO composts (id, latitude, longitude, type, publique, gestion, info_gestion, statut, propose_par, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('iddsssssss', $id, $t['lat'], $t['lon'], $t['type'], $t['acces'], $t['gestion'],
                      $t['info_gestion'], $t['statut'], $t['propose_par'], $t['created_at']);
    if (!$stmt->execute()) $echec('La recréation a échoué.');
    compost_ecrire($conn, $id, $t);
    flush_cache_france();
    audit_log($conn, 'compost_retabli', "id=$id", [
        'target_type' => 'compost', 'target_id' => $id,
        'snapshot'    => ['etat' => compost_etat($conn, $id), 'annule' => $aid],
    ]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── LISTE PAGINÉE DES DEMANDES ─────────────────────────────────────────────
$page  = max(1, (int)($_GET['page'] ?? 1));
$total = (int)(mysqli_fetch_row(mysqli_query($conn,
    "SELECT COUNT(*) FROM composts WHERE statut = 'en_attente'"))[0] ?? 0);
$pages = max(1, (int)ceil($total / PAR_PAGE));
$page  = min($page, $pages);
$offset = ($page - 1) * PAR_PAGE;

$res = mysqli_query($conn,
    "SELECT id, latitude, longitude, type, publique, gestion, info_gestion, propose_par, created_at
     FROM composts WHERE statut = 'en_attente'
     ORDER BY created_at DESC, id DESC
     LIMIT " . PAR_PAGE . " OFFSET $offset");

$demandes = [];
$ids = [];
while ($row = mysqli_fetch_assoc($res)) {
    $ids[] = (int)$row['id'];
    $demandes[(int)$row['id']] = [
        'id'           => (int)$row['id'],
        'lat'          => (float)$row['latitude'],
        'lon'          => (float)$row['longitude'],
        'type'         => $row['type'],
        'acces'        => $row['publique'],
        'gestion'      => $row['gestion'],
        'info_gestion' => $row['info_gestion'],
        'propose_par'  => $row['propose_par'] ?: 'Anonyme',
        'date'         => $row['created_at'],
        'mettre'       => [],
        'pas_mettre'   => [],
    ];
}

// Règles de toute la page en une requête (pas de N+1 sur 20 lignes).
if ($ids) {
    $in = implode(',', $ids);
    $res = mysqli_query($conn,
        "SELECT r.id_compost, e.nom, r.autorise
         FROM regles r JOIN elements e ON e.id = r.id_element
         WHERE r.id_compost IN ($in)");
    while ($row = mysqli_fetch_assoc($res)) {
        $cid = (int)$row['id_compost'];
        if (!isset($demandes[$cid])) continue;
        $demandes[$cid][(int)$row['autorise'] === 1 ? 'mettre' : 'pas_mettre'][] = $row['nom'];
    }
}

// Référentiel des éléments : alimente les cases à cocher de la modale admin.
$elements = [];
$res = mysqli_query($conn, 'SELECT nom FROM elements ORDER BY nom');
while ($row = mysqli_fetch_assoc($res)) { $elements[] = $row['nom']; }

mysqli_close($conn);
echo json_encode([
    'demandes' => array_values($demandes),
    'elements' => $elements,
    'page'     => $page,
    'pages'    => $pages,
    'total'    => $total,
], JSON_UNESCAPED_UNICODE);
