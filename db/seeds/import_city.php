<?php
/**
 * Import des données open data des villes (formats hétérogènes).
 * Usage : php import_city.php <fichier.json> <ville> [gestion] [info_gestion]
 *
 * Formats supportés :
 *   - GeoJSON FeatureCollection  (Montpellier)
 *   - Tableau JSON avec geo_point_2d: {lon, lat}  (Rennes, Marseille)
 */

if ($argc < 3) {
    die("Usage : php import_city.php <fichier.json> <ville> [gestion] [info_gestion]\n");
}

[$_, $file, $ville] = $argv;
$gestion = $argv[3] ?? $ville;
$info    = $argv[4] ?? '';

if (!file_exists($file)) die("Fichier introuvable : $file\n");

$connexion = mysqli_connect(
    getenv('DB_HOST')     ?: 'db',
    getenv('DB_USER')     ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME')     ?: 'Composmart'
);
if (mysqli_connect_errno()) die("Connexion DB : " . mysqli_connect_error() . "\n");

$data   = json_decode(file_get_contents($file), true);
$points = [];

// GeoJSON FeatureCollection (Montpellier)
if (isset($data['type']) && $data['type'] === 'FeatureCollection') {
    foreach ($data['features'] as $f) {
        $coords   = $f['geometry']['coordinates'];
        $points[] = ['lon' => (float)$coords[0], 'lat' => (float)$coords[1]];
    }
// Tableau avec geo_point_2d (Rennes, Marseille)
} elseif (is_array($data) && isset($data[0]['geo_point_2d'])) {
    foreach ($data as $item) {
        $points[] = ['lon' => (float)$item['geo_point_2d']['lon'], 'lat' => (float)$item['geo_point_2d']['lat']];
    }
} else {
    die("Format JSON non reconnu pour $file\n");
}

$stmt_check = mysqli_prepare($connexion,
    'SELECT id FROM composts WHERE
     (6371 * acos(cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?))
     + sin(radians(?)) * sin(radians(latitude)))) < 0.02 LIMIT 1');

$stmt_ins = mysqli_prepare($connexion,
    'INSERT INTO composts (longitude, latitude, type, publique, gestion, info_gestion) VALUES (?, ?, ?, ?, ?, ?)');

$inserted = 0;
$skipped  = 0;

foreach ($points as $p) {
    $lat  = $p['lat'];
    $lon  = $p['lon'];
    $type = 'Conteneur';
    $pub  = 'public';

    $stmt_check->bind_param('ddd', $lat, $lon, $lat);
    $stmt_check->execute();
    $stmt_check->store_result();
    if ($stmt_check->num_rows > 0) { $skipped++; $stmt_check->free_result(); continue; }
    $stmt_check->free_result();

    $stmt_ins->bind_param('ddssss', $lon, $lat, $type, $pub, $gestion, $info);
    if ($stmt_ins->execute()) $inserted++;
}

echo "Import $ville : $inserted insérés, $skipped doublons ignorés.\n";
mysqli_close($connexion);
