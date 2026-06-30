<?php
/**
 * Compteur public de db-games pour la page admin (nombre total de parties jouées).
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json');
ob_clean();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-games',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$res = mysqli_query($c, 'SELECT COUNT(*) FROM scores');
echo json_encode(['parties' => $res ? (int)(mysqli_fetch_row($res)[0] ?? 0) : 0]);
