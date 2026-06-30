<?php
// Readiness probe : 200 si la base de ce service répond, 503 sinon.
header('Content-Type: application/json');
$c = @mysqli_connect(
    getenv('DB_HOST') ?: 'db-games',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(503); echo '{"status":"db_down"}'; exit; }
mysqli_close($c);
echo '{"status":"ok"}';
