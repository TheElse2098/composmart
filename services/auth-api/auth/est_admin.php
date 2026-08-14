<?php
/**
 * Vérification isAdmin interne : pour le compte des services sans accès à la
 * table users (evenements-api, contrôleur des pages /evenements-admin).
 * Endpoint INTERNE uniquement : même secret partagé que xp.php/audit.php.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
header('Content-Type: application/json');
ob_clean();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'method']); exit;
}

$expected = getenv('AUDIT_SECRET') ?: '';
$got = $_SERVER['HTTP_X_AUDIT_SECRET'] ?? '';
if ($expected === '' || !hash_equals($expected, $got)) {
    http_response_code(403); echo json_encode(['error' => 'forbidden']); exit;
}

$body = json_decode(file_get_contents('php://input'), true);
$uid  = (int)($body['uid'] ?? 0);
if ($uid <= 0) { http_response_code(400); echo json_encode(['error' => 'bad_request']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$stmt = mysqli_prepare($c, 'SELECT isAdmin, username FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
if (!$row) { http_response_code(404); echo json_encode(['error' => 'user_not_found']); exit; }

echo json_encode(['ok' => true, 'isAdmin' => (int)$row['isAdmin'] === 1, 'username' => $row['username']]);
