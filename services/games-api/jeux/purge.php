<?php
/**
 * Purge interne des données de jeu d'un compte supprimé.
 * Les scores sont effacés : la personne disparaît des classements.
 *
 * Endpoint INTERNE : protégé par le secret partagé (AUDIT_SECRET), comme
 * auth/xp.php et auth/audit.php. Ne doit jamais être exposé sans ce secret.
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
    getenv('DB_HOST') ?: 'db-games',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$stmt = mysqli_prepare($c, 'DELETE FROM scores WHERE user_id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$supprimes = mysqli_stmt_affected_rows($stmt);

echo json_encode(['ok' => true, 'scores_supprimes' => $supprimes]);
