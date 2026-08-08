<?php
/**
 * Purge interne des données de carte d'un compte supprimé.
 *
 * Les signalements sont CONSERVÉS (ils restent utiles au traitement) mais
 * détachés de leur auteur : user_id et pseudo dénormalisé sont vidés.
 * Les composteurs proposés ne portent que propose_par, également anonymisé.
 *
 * Endpoint INTERNE : protégé par le secret partagé (AUDIT_SECRET).
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

$body  = json_decode(file_get_contents('php://input'), true);
$uid   = (int)($body['uid'] ?? 0);
$pseudo = (string)($body['username'] ?? '');
if ($uid <= 0) { http_response_code(400); echo json_encode(['error' => 'bad_request']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-map',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$stmt = mysqli_prepare($c,
    'UPDATE signalements SET user_id = NULL, reporter_username = NULL WHERE user_id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$signalements = mysqli_stmt_affected_rows($stmt);

// composts.propose_par est un pseudo dénormalisé sans user_id : c'est donc par
// le pseudo qu'on retrouve les propositions de cette personne.
$composts = 0;
if ($pseudo !== '') {
    $stmt = mysqli_prepare($c, 'UPDATE composts SET propose_par = NULL WHERE propose_par = ?');
    $stmt->bind_param('s', $pseudo);
    $stmt->execute();
    $composts = mysqli_stmt_affected_rows($stmt);
}

echo json_encode(['ok' => true, 'signalements' => $signalements, 'composts' => $composts]);
