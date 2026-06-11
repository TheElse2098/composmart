<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Credentials: true");

ob_start();
error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: application/json');

$URL      = getenv('DB_HOST')     ?: 'db';
$user     = getenv('DB_USER')     ?: 'composmart';
$password = getenv('DB_PASSWORD') ?: '';
$db_name  = getenv('DB_NAME')     ?: 'Composmart';

$response = [];

$connexion = mysqli_connect($URL, $user, $password, $db_name);

if (mysqli_connect_errno()) {
    echo json_encode(["error" => "Failed to connect to MySQL: " . mysqli_connect_error()]);
    exit();
}

// ── IMPORT DEPUIS OSM ──────────────────────────────────────────────────────
if (isset($_POST['osm'])) {
    $osm  = json_decode($_POST['osm'], true);
    $lon  = (double)$osm['longitude'];
    $lat  = (double)$osm['latitude'];
    $type = "Conteneur";
    $pub  = "public";

    $sql_check = "SELECT id, (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) AS distance FROM composts HAVING distance < 0.02 LIMIT 1";
    $stmt = mysqli_prepare($connexion, $sql_check);
    $stmt->bind_param("ddd", $lat, $lon, $lat);
    $stmt->execute();
    $result = $stmt->get_result();

    if ($result->num_rows == 0) {
        $stmt = mysqli_prepare($connexion, "INSERT INTO composts (longitude, latitude, type, publique) VALUES (?, ?, ?, ?)");
        $stmt->bind_param("ddss", $lon, $lat, $type, $pub);
        if ($stmt->execute()) {
            echo json_encode("Insertion réussie.");
        } else {
            echo json_encode("Erreur d'insertion : " . $stmt->error);
        }
    } else {
        echo json_encode("Point trop proche (moins de 20m). Insertion annulée.");
    }
}

// ── IMPORT DEPUIS JSON ─────────────────────────────────────────────────────
elseif (isset($_POST['donnees_json'])) {
    $d           = json_decode($_POST['donnees_json'], true);
    $lon         = (double)$d['longitude'];
    $lat         = (double)$d['latitude'];
    $type        = $d['type'];
    $pub         = $d['public'];
    $gestion     = $d['gestion'];
    $info_gest   = $d['info_gestion'];
    $mettre      = $d['mettre'];
    $pas_mettre  = $d['pas_mettre'];

    $sql_check = "SELECT id, (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + sin(radians(?)) * sin(radians(latitude)))) AS distance FROM composts HAVING distance < 0.02 LIMIT 1";
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

// ── LISTE TOUS LES COMPOSTS ────────────────────────────────────────────────
elseif (isset($_POST['france'])) {
    $result = mysqli_query($connexion, "SELECT id, longitude, latitude, type FROM composts");
    $liste  = [];
    while ($row = $result->fetch_array(MYSQLI_ASSOC)) {
        $liste[] = ["id" => $row["id"], "lon" => $row["longitude"], "lat" => $row["latitude"], "type" => $row["type"]];
    }
    $response = $liste;
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

// ── MODIFIER UN COMPOST ────────────────────────────────────────────────────
elseif (isset($_POST['type'])) {
    $id         = intval($_POST['id']);
    $type       = $_POST['type']      ?? '';
    $acces      = $_POST['acces']     ?? '';
    $mettre     = $_POST['mettre']    ?? [];
    $pas_mettre = $_POST['pas_mettre'] ?? [];

    foreach ($mettre as $m) {
        foreach ($pas_mettre as $p) {
            if ($m === $p) {
                die("\"$m\" ne peut pas être à la fois autorisé et interdit");
            }
        }
    }

    $stmt = mysqli_prepare($connexion, "UPDATE composts SET type=?, publique=? WHERE id=$id");
    $stmt->bind_param("ss", $type, $acces);
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

    $response = "Modification enregistrée.";
}

// ── AJOUTER UN COMPOST VIA CLIC CARTE ─────────────────────────────────────
if (isset($_POST['lat_click']) && isset($_POST['lon_click'])) {
    $lat = (double)$_POST['lat_click'];
    $lon = (double)$_POST['lon_click'];

    $stmt = mysqli_prepare($connexion, "INSERT INTO composts (longitude, latitude) VALUES (?, ?)");
    $stmt->bind_param("dd", $lon, $lat);
    if ($stmt->execute()) {
        $res = mysqli_query($connexion, "SELECT id FROM composts WHERE latitude=$lat AND longitude=$lon ORDER BY id DESC LIMIT 1");
        $row = $res->fetch_array(MYSQLI_ASSOC);
        $response = (int)$row["id"];
    } else {
        $response = ["error" => $stmt->error];
    }
}

// ── SUPPRIMER UN COMPOST ───────────────────────────────────────────────────
if (isset($_POST['supprimer'])) {
    $id = intval($_POST['supprimer']);
    mysqli_query($connexion, "DELETE FROM regles WHERE id_compost=$id");
    mysqli_query($connexion, "DELETE FROM composts WHERE id=$id");
    $response = "Compost supprimé.";
}

mysqli_close($connexion);
echo json_encode($response, JSON_UNESCAPED_UNICODE);
?>
