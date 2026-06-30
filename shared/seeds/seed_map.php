<?php
/**
 * Seed de db-map : composteurs (open data villes + OSM).
 * Idempotent : si la table composts est déjà peuplée, ne fait rien.
 * Le schéma est créé par db/map.sql (initdb), pas ici.
 */

$host = getenv('DB_HOST') ?: 'db-map';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

$c = null;
for ($i = 0; $i < 15; $i++) {
    $c = @mysqli_connect($host, $user, $pass, $name);
    if ($c) break;
    echo "seed_map: en attente de db-map... ($i/15)\n";
    sleep(2);
}
if (!$c) die("seed_map: impossible de se connecter à db-map.\n");

// Seuil "OSM présent" : villes open data ≈ 1340 points. En dessous de
// villes + 1000, on considère qu'OSM manque (échec d'un import précédent)
// et on (re)tente. Au-dessus, OSM est déjà là → on ne retente pas au boot.
const SEUIL_OSM = 2300;

$count = (int)mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM composts'))[0];
mysqli_close($c);

$seeds = '/docker-seeds';

// 1) Villes (idempotent : import_city déduplique par distance) — seulement si DB vide.
if ($count === 0) {
    echo "=== seed_map: import initial des villes ===\n";
    $villes = [
        ["$seeds/montpellier.json", 'Montpellier', 'Ville de Montpellier', 'https://www.montpellier.fr/vie-quotidienne/vivre-ici/gerer-ses-dechets'],
        ["$seeds/rennes.json",      'Rennes',       'Rennes Métropole',    ''],
        ["$seeds/marseille.json",   'Marseille',    'Ville de Marseille',  ''],
    ];
    foreach ($villes as $v) {
        $args = implode(' ', array_map('escapeshellarg', $v));
        passthru("php $seeds/import_city.php $args");
    }
} else {
    echo "seed_map: $count composteurs déjà en base, villes ignorées.\n";
}

// 2) OSM : tenté si manquant (sous le seuil). import_osm gère retries + miroirs
//    et abandonne proprement si Overpass est down — sans bloquer ni boucler.
if ($count < SEUIL_OSM) {
    echo "=== seed_map: import OSM (composts=$count < seuil " . SEUIL_OSM . ") ===\n";
    passthru("php $seeds/import_osm.php");
} else {
    echo "seed_map: OSM déjà présent ($count composteurs ≥ " . SEUIL_OSM . "), import OSM ignoré.\n";
}
echo "=== seed_map: terminé ===\n";
