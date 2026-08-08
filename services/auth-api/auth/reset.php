<?php
/**
 * Mot de passe oublié — étape 2 : consomme un jeton « reset » et enregistre le
 * nouveau mot de passe.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}
if (!rate_limit('reset', 10, 3600)) {
    http_response_code(429); echo json_encode(['error' => 'Trop de tentatives. Réessaie plus tard.']); exit;
}

$token    = $_POST['token'] ?? '';
$password = $_POST['password'] ?? '';

$pwd_err = password_policy_error($password);
if ($pwd_err) { echo json_encode(['error' => $pwd_err]); exit; }

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

// Le mot de passe est validé AVANT de consommer le jeton : un mot de passe
// refusé ne doit pas brûler le lien et obliger à tout recommencer.
$uid = consommer_token($conn, $token, 'reset');
if (!$uid) {
    echo json_encode(['error' => 'Ce lien est invalide ou a expiré. Refais une demande.']);
    exit;
}

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = mysqli_prepare($conn, 'UPDATE users SET password_hash = ? WHERE id = ?');
$stmt->bind_param('si', $hash, $uid);
if (!$stmt->execute()) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

// Recevoir le mail prouve la maîtrise de l'adresse : si le compte n'était pas
// encore confirmé, cette étape le confirme.
mysqli_query($conn, "UPDATE users SET email_verifie = 1 WHERE id = $uid");

// La session courante est repartie de zéro : si quelqu'un d'autre était
// connecté sur ce compte, il ne le reste pas après un changement de mot de passe.
session_regenerate_id(true);
unset($_SESSION['user_id'], $_SESSION['username'], $_SESSION['isAdmin']);

audit_log($conn, 'mdp_reinitialise', "id=$uid", ['target_type' => 'user', 'target_id' => $uid]);

echo json_encode(['ok' => true]);
