<?php
/**
 * Récepteur d'audit interne : écrit dans audit_log (db-core) les événements
 * envoyés par les services qui n'ont pas la table (map-api, cf. _guard.php).
 * Endpoint INTERNE uniquement : protégé par un secret partagé (AUDIT_SECRET).
 * Ne doit pas être exposé publiquement sans ce secret.
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
if (!is_array($body) || empty($body['action'])) {
    http_response_code(400); echo json_encode(['error' => 'bad_request']); exit;
}

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

audit_log_write(
    $c,
    (int)($body['uid'] ?? 0),
    (string)($body['uname'] ?? ''),
    (string)$body['action'],
    (string)($body['details'] ?? ''),
    $body['ttype'] ?? null,
    isset($body['tid']) ? (int)$body['tid'] : null,
    $body['snap'] ?? null
);
echo json_encode(['ok' => true]);
