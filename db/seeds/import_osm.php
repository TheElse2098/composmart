<?php
/**
 * Import des points de biodéchets depuis OpenStreetMap (API Overpass).
 * Usage : php import_osm.php
 */

$connexion = mysqli_connect(
    getenv('DB_HOST')     ?: 'db',
    getenv('DB_USER')     ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME')     ?: 'Composmart'
);
if (mysqli_connect_errno()) {
    die("Connexion DB impossible : " . mysqli_connect_error() . "\n");
}

$query = '[out:json][timeout:120];'
       . 'area["name"="France"]["admin_level"="2"]->.fr;'
       . '('
       . '  node["amenity"="recycling"]["recycling:food_waste"="yes"](area.fr);'
       . '  node["amenity"="recycling"]["recycling_type"="container"]["recycling:food_waste"="yes"](area.fr);'
       . ');'
       . 'out body;';

echo "Requête Overpass en cours (jusqu'à 2 min)...\n";

$ch = curl_init('https://overpass-api.de/api/interpreter');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => 'data=' . urlencode($query),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 180,
]);
$response = curl_exec($ch);
$err      = curl_error($ch);
curl_close($ch);

if (!$response) die("Erreur cURL : $err\n");

$data = json_decode($response, true);
if (!isset($data['elements'])) die("Réponse Overpass invalide.\n");

$stmt_check = mysqli_prepare($connexion,
    'SELECT id FROM composts WHERE
     (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?))
     + sin(radians(?)) * sin(radians(latitude)))) < 0.02 LIMIT 1');

$stmt_ins = mysqli_prepare($connexion,
    'INSERT INTO composts (longitude, latitude, type, publique) VALUES (?, ?, ?, ?)');

$inserted = 0;
$skipped  = 0;

foreach ($data['elements'] as $el) {
    $lat  = (float)$el['lat'];
    $lon  = (float)$el['lon'];
    $type = 'Conteneur';
    $pub  = 'public';

    $stmt_check->bind_param('ddd', $lat, $lon, $lat);
    $stmt_check->execute();
    $stmt_check->store_result();
    if ($stmt_check->num_rows > 0) { $skipped++; $stmt_check->free_result(); continue; }
    $stmt_check->free_result();

    $stmt_ins->bind_param('ddss', $lon, $lat, $type, $pub);
    if ($stmt_ins->execute()) $inserted++;
}

echo "Import OSM terminé : $inserted insérés, $skipped doublons ignorés.\n";
mysqli_close($connexion);
