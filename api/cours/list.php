<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$host = getenv('DB_HOST') ?: 'db';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

$c = mysqli_connect($host, $user, $pass, $name);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// Récupérer les thèmes
$themes = [];
$res = mysqli_query($c, 'SELECT * FROM themes ORDER BY ordre, id');
while ($row = mysqli_fetch_assoc($res)) {
    $themes[$row['id']] = array_merge($row, ['cours' => []]);
}

// Récupérer les cours
$res = mysqli_query($c, 'SELECT * FROM cours ORDER BY theme_id, ordre, id');
while ($row = mysqli_fetch_assoc($res)) {
    $tid = $row['theme_id'];
    if (isset($themes[$tid])) {
        $themes[$tid]['cours'][] = $row;
    }
}

mysqli_close($c);
echo json_encode(array_values($themes), JSON_UNESCAPED_UNICODE);
