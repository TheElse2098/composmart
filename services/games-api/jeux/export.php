<?php
/**
 * Export interne des données de jeu d'un compte (droit d'accès / portabilité,
 * art. 15 et 20 RGPD). Appelé par auth/export.php, qui assemble l'export.
 *
 * Endpoint INTERNE : protégé par le secret partagé (AUDIT_SECRET), comme
 * purge.php. Ne doit jamais être exposé sans ce secret.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$body = endpoint_interne();
$uid  = (int)($body['uid'] ?? 0);
if ($uid <= 0) { http_response_code(400); echo json_encode(['error' => 'bad_request']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-games',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }
mysqli_set_charset($c, 'utf8mb4');

$stmt = mysqli_prepare($c, 'SELECT jeu_id AS jeu, score, played_at AS date FROM scores WHERE user_id = ? ORDER BY played_at');
$stmt->bind_param('i', $uid);
$stmt->execute();

echo json_encode(['scores' => $stmt->get_result()->fetch_all(MYSQLI_ASSOC)], JSON_UNESCAPED_UNICODE);
