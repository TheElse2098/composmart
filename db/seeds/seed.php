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

// ── Migrations schema ──────────────────────────────────────────────────────
mysqli_query($c, "ALTER TABLE users MODIFY COLUMN email varchar(255) DEFAULT NULL");
mysqli_query($c, "ALTER TABLE users MODIFY COLUMN isAdmin tinyint(1) NOT NULL DEFAULT 0");
mysqli_query($c, "ALTER TABLE users ADD UNIQUE IF NOT EXISTS username_uniq (username)");
mysqli_query($c, "CREATE TABLE IF NOT EXISTS audit_log (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT DEFAULT NULL,
  username VARCHAR(100) DEFAULT NULL,
  action VARCHAR(60) NOT NULL,
  details VARCHAR(255) DEFAULT NULL,
  target_type VARCHAR(30) DEFAULT NULL,
  target_id INT DEFAULT NULL,
  snapshot TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id), KEY created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
// Migration des colonnes pour les tables audit_log déjà créées
mysqli_query($c, "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_type VARCHAR(30) DEFAULT NULL");
mysqli_query($c, "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS target_id INT DEFAULT NULL");
mysqli_query($c, "ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS snapshot TEXT DEFAULT NULL");
echo "Migrations schema appliquées.\n";

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
passthru("php $seeds/import_cours.php");
echo "=== Import terminé ===\n";
