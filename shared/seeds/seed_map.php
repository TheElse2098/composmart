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

$count = (int)mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM composts'))[0];
mysqli_close($c);

if ($count > 0) {
    echo "seed_map: db-map déjà peuplée ($count composteurs). Import ignoré.\n";
    exit(0);
}

echo "=== seed_map: import initial des composteurs ===\n";
$seeds = '/docker-seeds';

$villes = [
    ["$seeds/montpellier.json", 'Montpellier', 'Ville de Montpellier', 'https://www.montpellier.fr/vie-quotidienne/vivre-ici/gerer-ses-dechets'],
    ["$seeds/rennes.json",      'Rennes',       'Rennes Métropole',    ''],
    ["$seeds/marseille.json",   'Marseille',    'Ville de Marseille',  ''],
];
foreach ($villes as $v) {
    $args = implode(' ', array_map('escapeshellarg', $v));
    passthru("php $seeds/import_city.php $args");
}
passthru("php $seeds/import_osm.php");
echo "=== seed_map: terminé ===\n";
