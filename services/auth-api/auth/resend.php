<?php
/**
 * Renvoie l'email de confirmation à l'utilisateur connecté (bouton du bandeau
 * « vérifie ton email »). Réservé aux comptes pas encore vérifiés.
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
if (empty($_SESSION['user_id'])) {
    http_response_code(401); echo json_encode(['error' => 'Connexion requise']); exit;
}
// 3 par heure : un renvoi est une action rare, et chaque appel déclenche un mail.
if (!rate_limit('resend_verif', 3, 3600)) {
    http_response_code(429);
    echo json_encode(['error' => 'Trop de demandes. Réessaie dans une heure.']);
    exit;
}

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

$uid = (int)$_SESSION['user_id'];
$stmt = mysqli_prepare($conn, 'SELECT username, email, email_verifie FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();

if (!$u) { http_response_code(404); echo json_encode(['error' => 'Compte introuvable']); exit; }
if ((int)$u['email_verifie'] === 1) { echo json_encode(['ok' => true, 'deja_verifie' => true]); exit; }

$token = creer_token($conn, $uid, 'verification', 24 * 60);
if (!$token) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

$lien = site_url() . '/verifier?token=' . urlencode($token);
$ok = send_mail($u['email'], 'Confirme ton inscription sur Composmart',
    "Bonjour {$u['username']},\n\n"
  . "Voici un nouveau lien pour confirmer ton adresse email :\n$lien\n\n"
  . "Ce lien est valable 24 heures et annule le précédent.\n");

audit_log($conn, 'mail_envoye', ($ok ? 'Envoyé' : 'Échec') . ' — renvoi vérification email', [
    'target_type' => 'mail',
    'snapshot' => [
        'to' => $u['email'], 'sujet' => 'Confirme ton inscription', 'ok' => $ok,
        'erreur' => $ok ? null : mb_substr(send_mail_last_error(), 0, 300),
    ],
]);

if (!$ok) { echo json_encode(['error' => "L'email n'a pas pu être envoyé. Réessaie plus tard."]); exit; }
echo json_encode(['ok' => true]);
