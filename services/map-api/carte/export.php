<?php
/**
 * Export interne des données de carte d'un compte (droit d'accès / portabilité,
 * art. 15 et 20 RGPD) : signalements envoyés, composteurs proposés.
 * Appelé par auth/export.php, qui assemble l'export.
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

$body   = endpoint_interne();
$uid    = (int)($body['uid'] ?? 0);
$pseudo = (string)($body['username'] ?? '');
if ($uid <= 0) { http_response_code(400); echo json_encode(['error' => 'bad_request']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-map',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }
mysqli_set_charset($c, 'utf8mb4');

$stmt = mysqli_prepare($c,
    'SELECT s.compost_id, c.latitude, c.longitude, s.motif, s.commentaire, s.statut, s.created_at AS date
       FROM signalements s LEFT JOIN composts c ON c.id = s.compost_id
      WHERE s.user_id = ? ORDER BY s.created_at');
$stmt->bind_param('i', $uid);
$stmt->execute();
$signalements = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// composts.propose_par est un pseudo dénormalisé sans user_id (cf. purge.php).
$composts = [];
if ($pseudo !== '') {
    $stmt = mysqli_prepare($c,
        'SELECT id, latitude, longitude, type, publique AS acces, gestion, info_gestion, statut, created_at AS date
           FROM composts WHERE propose_par = ? ORDER BY created_at');
    $stmt->bind_param('s', $pseudo);
    $stmt->execute();
    $composts = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

echo json_encode(['signalements' => $signalements, 'composteurs_proposes' => $composts], JSON_UNESCAPED_UNICODE);
