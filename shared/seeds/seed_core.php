<?php
/**
 * Seed de db-core : cours et thèmes (depuis content/cours/).
 * Idempotent : import_cours.php est lui-même idempotent (upsert par slug).
 * Le schéma est créé par db/core.sql (initdb), pas ici.
 */

$host = getenv('DB_HOST') ?: 'db-core';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

$c = null;
for ($i = 0; $i < 15; $i++) {
    $c = @mysqli_connect($host, $user, $pass, $name);
    if ($c) break;
    echo "seed_core: en attente de db-core... ($i/15)\n";
    sleep(2);
}
if (!$c) die("seed_core: impossible de se connecter à db-core.\n");
mysqli_close($c);

echo "=== seed_core: import des cours ===\n";
passthru("php /docker-seeds/import_cours.php");
echo "=== seed_core: terminé ===\n";
