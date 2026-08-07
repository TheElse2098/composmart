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

// Monde entier : plus de filtre par zone. La seconde clause de l'ancienne requête
// (recycling_type=container) était de toute façon un sous-ensemble de la première,
// l'union ne ramenait rien de plus.
// « out skel » plutôt que « out body » : on n'exploite que lat/lon, inutile de
// rapatrier les tags de chaque nœud sur une requête mondiale.
$query = '[out:json][timeout:600];'
       . 'node["amenity"="recycling"]["recycling:food_waste"="yes"];'
       . 'out skel qt;';

// L'API Overpass publique est souvent surchargée (429/504/HTML). On essaie
// plusieurs miroirs, avec retries et pauses, avant d'abandonner.
$endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
$max_essais_par_endpoint = 2;

$data = null;
foreach ($endpoints as $url) {
    for ($essai = 1; $essai <= $max_essais_par_endpoint; $essai++) {
        echo "Requête Overpass ($url) essai $essai...\n";
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => 'data=' . urlencode($query),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 900,
            CURLOPT_USERAGENT      => 'CompoSmart/1.0',
            CURLOPT_HTTPHEADER     => ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'],
        ]);
        $response = curl_exec($ch);
        $http     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err      = curl_error($ch);
        curl_close($ch);

        if ($response === false) { echo "  cURL: $err\n"; sleep(5); continue; }
        if ($http !== 200)       { echo "  HTTP $http (API occupée)\n"; sleep(10); continue; }

        $parsed = json_decode($response, true);
        if (isset($parsed['elements'])) { $data = $parsed; break 2; }
        echo "  Réponse non-JSON ou sans 'elements' (HTTP $http)\n";
        sleep(5);
    }
}

if ($data === null) {
    die("Import OSM abandonné : tous les miroirs Overpass ont échoué. Réessaie plus tard.\n");
}

// LEAST(1, ...) indispensable : pour un point stricement identique à un point
// déjà en base, l'arrondi flottant peut porter l'argument d'ACOS très légèrement
// au-dessus de 1. ACOS renvoie alors NULL, « NULL < 0.02 » n'est jamais vrai,
// le doublon n'est pas détecté et le point est réinséré à CHAQUE passage du cron.
// Même garde que dans carte/sites.php, où elle était déjà présente.
// Pré-filtre par boîte englobante AVANT le calcul de distance : l'expression
// Haversine n'est pas indexable, donc seule elle imposait un balayage complet de
// la table pour CHAQUE point importé. Le BETWEEN sur (latitude, longitude) passe
// par l'index lat_lng et ne laisse qu'une poignée de candidats à mesurer.
$stmt_check = mysqli_prepare($connexion,
    'SELECT id FROM composts
     WHERE latitude  BETWEEN ? AND ?
       AND longitude BETWEEN ? AND ?
       AND (6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?))
       + sin(radians(?)) * sin(radians(latitude))))) < 0.02
     LIMIT 1');

$stmt_ins = mysqli_prepare($connexion,
    'INSERT INTO composts (longitude, latitude, type, publique) VALUES (?, ?, ?, ?)');

$inserted = 0;
$skipped  = 0;

foreach ($data['elements'] as $el) {
    $lat  = (float)$el['lat'];
    $lon  = (float)$el['lon'];
    $type = 'Conteneur';
    $pub  = 'public';

    // 20 m convertis en degrés. Un degré de longitude rétrécit avec la latitude :
    // le plancher sur le cosinus évite une boîte infinie au voisinage des pôles,
    // maintenant que l'import n'est plus limité à la France.
    $d_lat = 0.02 / 111.32;
    $d_lon = $d_lat / max(0.01, cos(deg2rad($lat)));
    $lat_min = $lat - $d_lat; $lat_max = $lat + $d_lat;
    $lon_min = $lon - $d_lon; $lon_max = $lon + $d_lon;

    $stmt_check->bind_param('ddddddd', $lat_min, $lat_max, $lon_min, $lon_max, $lat, $lon, $lat);
    $stmt_check->execute();
    $stmt_check->store_result();
    if ($stmt_check->num_rows > 0) { $skipped++; $stmt_check->free_result(); continue; }
    $stmt_check->free_result();

    $stmt_ins->bind_param('ddss', $lon, $lat, $type, $pub);
    if ($stmt_ins->execute()) $inserted++;
}

echo "Import OSM terminé : $inserted insérés, $skipped doublons ignorés (" . count($data['elements']) . " points reçus d'OSM).\n";
mysqli_close($connexion);

// Invalide le cache Redis de la carte si des points ont été ajoutés (l'import
// écrit en DB sans passer par sites.php, il faut donc flusher explicitement).
if ($inserted > 0 && getenv('REDIS_HOST') && extension_loaded('redis')) {
    try {
        $r = new Redis();
        if (@$r->connect(getenv('REDIS_HOST'), (int)(getenv('REDIS_PORT') ?: 6379), 0.5)) {
            $r->del('carte:france');
            echo "Cache carte invalidé.\n";
        }
    } catch (\Throwable $e) { /* pas de Redis → le TTL rattrapera */ }
}
