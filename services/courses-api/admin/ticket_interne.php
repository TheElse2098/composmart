<?php
/**
 * Ouverture d'un ticket depuis un AUTRE service (endpoint interne, jamais
 * appelé par un navigateur).
 *
 * Les tickets vivent en db-core (contact_messages / ticket_messages), mais un
 * signalement peut naître ailleurs — ici, une proposition d'ajout de
 * composteur en db-map. Plutôt que de dupliquer le schéma de tickets dans
 * chaque base, le service d'origine appelle cet endpoint en interne, exactement
 * comme la purge de compte appelle carte/purge.php ou jeux/purge.php.
 *
 * Protégé par le même secret partagé que l'audit (X-Audit-Secret) : aucun
 * navigateur ne connaît ce secret, un appel direct depuis l'extérieur échoue
 * donc systématiquement, comme purge.php dans map-api/games-api.
 *
 * Corps JSON attendu :
 *   { uid, username, categorie, sujet, message }
 * uid peut être 0/absent (rare, mais on n'exclut pas un futur appelant sans
 * session) — le ticket est alors créé sans user_id, comme un ticket dont
 * l'auteur a depuis supprimé son compte.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
header('Content-Type: application/json');
ob_clean();
mysqli_report(MYSQLI_REPORT_OFF);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'method']); exit;
}

$expected = getenv('AUDIT_SECRET') ?: '';
$got = $_SERVER['HTTP_X_AUDIT_SECRET'] ?? '';
if ($expected === '' || !hash_equals($expected, $got)) {
    http_response_code(403); echo json_encode(['error' => 'forbidden']); exit;
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body)) { http_response_code(400); echo json_encode(['error' => 'bad_request']); exit; }

$uid      = (int)($body['uid'] ?? 0);
$username = mb_substr((string)($body['username'] ?? ''), 0, 100);
$CATS     = ['bug', 'suggestion', 'question', 'autre'];
$cat      = in_array($body['categorie'] ?? '', $CATS, true) ? $body['categorie'] : 'autre';
$sujet    = mb_substr(trim((string)($body['sujet'] ?? '')), 0, 150);
$message  = mb_substr(trim((string)($body['message'] ?? '')), 0, 3000);

if ($sujet === '' || $message === '') {
    http_response_code(400); echo json_encode(['error' => 'sujet et message requis']); exit;
}

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$uid_param = $uid > 0 ? $uid : null;
$uname_param = $username !== '' ? $username : null;

$stmt = mysqli_prepare($c,
    'INSERT INTO contact_messages (user_id, username, categorie, sujet, message, derniere_activite, lu_par_user_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())');
$stmt->bind_param('issss', $uid_param, $uname_param, $cat, $sujet, $message);
if (!$stmt->execute()) {
    http_response_code(500); echo json_encode(['error' => "La création du ticket a échoué."]); exit;
}

$ticket_id = (int)mysqli_insert_id($c);
echo json_encode(['ok' => true, 'ticket_id' => $ticket_id], JSON_UNESCAPED_UNICODE);
