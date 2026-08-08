<?php
/**
 * Confirmation d'une adresse email : consomme un jeton de type « verification »
 * et marque le compte comme vérifié.
 *
 *   POST token=...  → { ok: true } ou { error: ... }
 *
 * Volontairement en POST : un lien ouvert en GET peut être préchargé par un
 * antivirus ou un client mail, ce qui consommerait le jeton avant que
 * l'utilisateur n'ait cliqué. La page /verifier lit le jeton dans l'URL et
 * appelle cet endpoint en POST.
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
if (!rate_limit('verify', 20, 3600)) {
    http_response_code(429); echo json_encode(['error' => 'Trop de tentatives. Réessaie plus tard.']); exit;
}

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

$uid = consommer_token($conn, $_POST['token'] ?? '', 'verification');
if (!$uid) {
    echo json_encode(['error' => 'Ce lien est invalide ou a expiré. Demande un nouvel email de confirmation.']);
    exit;
}

mysqli_query($conn, "UPDATE users SET email_verifie = 1 WHERE id = $uid");

// Si c'est la session courante, on évite de la laisser croire qu'elle est
// encore non vérifiée jusqu'à la prochaine connexion.
$stmt = mysqli_prepare($conn, 'SELECT username FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();

echo json_encode(['ok' => true, 'username' => $u['username'] ?? null]);
