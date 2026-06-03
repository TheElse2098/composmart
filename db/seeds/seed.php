<?php
/**
 * Lancé au démarrage du container.
 * Si la table composts est vide, importe les données des villes + OSM.
 */

$host = getenv('DB_HOST') ?: 'db';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

// Attendre que la DB soit prête (max 30s)
$c = null;
for ($i = 0; $i < 15; $i++) {
    $c = @mysqli_connect($host, $user, $pass, $name);
    if ($c) break;
    echo "En attente de la base de données... ($i/15)\n";
    sleep(2);
}
if (!$c) die("Impossible de se connecter à la DB.\n");

$count = (int)mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM composts'))[0];
mysqli_close($c);

if ($count > 0) {
    echo "DB déjà peuplée ($count composteurs). Import ignoré.\n";
    exit(0);
}

echo "=== DB vide — import initial ===\n";
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
echo "=== Import terminé ===\n";
