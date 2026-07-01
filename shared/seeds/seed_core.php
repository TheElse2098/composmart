<?php
/**
 * Seed de db-core : cours et thèmes (depuis content/cours/).
 * Idempotent : import_cours.php est lui-même idempotent (upsert par slug).
 * Le schéma est créé par db/core.sql (initdb), pas ici.
 */

// PHP 8.3 : mysqli lève des exceptions par défaut → le mysqli_connect fatale
// malgré le @. On désactive pour laisser la boucle de retry gérer l'attente.
mysqli_report(MYSQLI_REPORT_OFF);

$host = getenv('DB_HOST') ?: 'db-core';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

$c = null;
for ($i = 0; $i < 30; $i++) {
    $c = @mysqli_connect($host, $user, $pass, $name);
    if ($c) break;
    echo "seed_core: en attente de db-core... ($i/30)\n";
    sleep(2);
}
if (!$c) die("seed_core: impossible de se connecter à db-core.\n");
mysqli_close($c);

echo "=== seed_core: import des cours ===\n";
passthru("php /docker-seeds/import_cours.php");
echo "=== seed_core: terminé ===\n";
