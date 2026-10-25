<?php
/**
 * Changement d'adresse email du compte connecté (droit de rectification,
 * art. 16 RGPD).
 *
 * Exige le mot de passe actuel : une session laissée ouverte ne suffit pas à
 * détourner le compte. La nouvelle adresse repasse en « non confirmée » et
 * reçoit un lien de vérification (même circuit que l'inscription : verify.php).
 * L'ancienne adresse est prévenue, pour qu'un changement non voulu se remarque.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();
mysqli_report(MYSQLI_REPORT_OFF);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}
if (empty($_SESSION['user_id'])) {
    http_response_code(401); echo json_encode(['error' => 'Connexion requise']); exit;
}
// Chaque tentative peut déclencher deux mails, et le mot de passe est vérifié :
// limite basse, contre l'envoi en rafale comme contre le devinage.
if (!rate_limit('change_email', 5, 3600)) {
    http_response_code(429);
    echo json_encode(['error' => 'Trop de tentatives. Réessaie dans une heure.']);
    exit;
}

$nouvel  = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';
if (!filter_var($nouvel, FILTER_VALIDATE_EMAIL) || strlen($nouvel) > 255) {
    echo json_encode(['error' => 'Adresse email invalide.']); exit;
}

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

$uid = (int)$_SESSION['user_id'];
$stmt = mysqli_prepare($conn, 'SELECT username, email, password_hash FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();
if (!$u) { http_response_code(404); echo json_encode(['error' => 'Compte introuvable']); exit; }

if (!password_verify($password, $u['password_hash'])) {
    echo json_encode(['error' => 'Mot de passe incorrect.']); exit;
}
if (strcasecmp($nouvel, $u['email']) === 0) {
    echo json_encode(['error' => "C'est déjà ton adresse actuelle."]); exit;
}

$stmt = mysqli_prepare($conn, 'SELECT 1 FROM users WHERE email = ? AND id <> ?');
$stmt->bind_param('si', $nouvel, $uid);
$stmt->execute();
if ($stmt->get_result()->fetch_row()) {
    echo json_encode(['error' => 'Un compte existe déjà avec cette adresse email.']); exit;
}

$stmt = mysqli_prepare($conn, 'UPDATE users SET email = ?, email_verifie = 0 WHERE id = ?');
$stmt->bind_param('si', $nouvel, $uid);
if (!$stmt->execute()) {
    echo json_encode(['error' => 'La modification a échoué.']); exit;
}

audit_log($conn, 'email_modifie', 'adresse email changée par son propriétaire', [
    'target_type' => 'user',
    'target_id'   => $uid,
]);

// Lien de confirmation vers la nouvelle adresse (annule tout lien précédent).
$mail_ok = false;
$token = creer_token($conn, $uid, 'verification', 24 * 60);
if ($token) {
    $lien = site_url() . '/verifier?token=' . urlencode($token);
    $mail_ok = send_mail($nouvel, 'Confirme ta nouvelle adresse Composmart',
        "Bonjour {$u['username']},\n\n"
      . "Tu as indiqué cette adresse pour ton compte Composmart. Confirme-la en ouvrant ce lien :\n$lien\n\n"
      . "Ce lien est valable 24 heures. Tant que l'adresse n'est pas confirmée,\n"
      . "l'accès aux cours reste bloqué.\n");
    audit_log($conn, 'mail_envoye', ($mail_ok ? 'Envoyé' : 'Échec') . ' — vérification nouvelle adresse', [
        'target_type' => 'mail',
        'snapshot' => [
            'to' => $nouvel, 'sujet' => 'Confirme ta nouvelle adresse', 'ok' => $mail_ok,
            'erreur' => $mail_ok ? null : mb_substr(send_mail_last_error(), 0, 300),
        ],
    ]);
}

// Prévenance de l'ancienne adresse (échec sans conséquence sur le changement).
send_mail($u['email'], 'Ton adresse email Composmart a été modifiée',
    "Bonjour {$u['username']},\n\n"
  . "L'adresse email de ton compte Composmart vient d'être remplacée.\n\n"
  . "Si c'est toi, tu n'as rien à faire.\n"
  . "Sinon, écris-nous tout de suite à contact@composmart.fr.\n");

echo json_encode(['ok' => true, 'mail_envoye' => $mail_ok]);
