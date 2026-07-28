<?php
/**
 * Crédit d'XP interne : ajoute de l'XP à un utilisateur (db-core) pour le
 * compte des services qui n'ont pas accès à la table users (games-api).
 * Endpoint INTERNE uniquement : protégé par le secret partagé (AUDIT_SECRET,
 * même secret que audit.php — même domaine de confiance service→service).
 * Recalcule le niveau (100 XP par niveau), comme complete.php côté cours.
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

$body   = json_decode(file_get_contents('php://input'), true);
$uid    = (int)($body['uid'] ?? 0);
$delta  = (int)($body['delta'] ?? 0);
// source envoyée par games-api : 'jeu:<jeu_id>' (cf. score.php crediter_xp) — on
// n'en garde que le nom du jeu pour le label du journal.
$source = trim((string)($body['source'] ?? ''));
$label  = strpos($source, 'jeu:') === 0 ? substr($source, 4) : null;
if ($uid <= 0 || $delta <= 0 || $delta > 1000) {
    http_response_code(400); echo json_encode(['error' => 'bad_request']); exit;
}

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

mysqli_query($c, "UPDATE users SET xp = xp + $delta WHERE id = $uid");
if (mysqli_affected_rows($c) <= 0) {
    http_response_code(404); echo json_encode(['error' => 'user_not_found']); exit;
}

$stmt = mysqli_prepare($c, "INSERT INTO xp_log (user_id, delta, source, label) VALUES (?, ?, 'jeu', ?)");
$stmt->bind_param('iis', $uid, $delta, $label);
$stmt->execute();
$row = mysqli_fetch_assoc(mysqli_query($c, "SELECT xp FROM users WHERE id = $uid"));
$new_xp     = (int)$row['xp'];
$new_niveau = floor($new_xp / 100) + 1;
mysqli_query($c, "UPDATE users SET niveau = $new_niveau WHERE id = $uid");

echo json_encode(['ok' => true, 'xp' => $new_xp, 'niveau' => $new_niveau]);
