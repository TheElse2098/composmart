<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit; }

if (!rate_limit('register', 5, 3600)) {
    http_response_code(429);
    echo json_encode(['error' => 'Trop de comptes créés récemment. Réessaie plus tard.']);
    exit;
}

$username = trim($_POST['username'] ?? '');
$email    = trim($_POST['email'] ?? '');
$password = $_POST['password'] ?? '';

if (!$username || !$password || !$email) { echo json_encode(['error' => 'Champs manquants']); exit; }
// Acceptation des CGU (case obligatoire de signin.html) : vérifiée ici aussi,
// la case seule se contourne en appelant l'API directement.
if (($_POST['cgu'] ?? '') !== '1') { echo json_encode(['error' => "Merci d'accepter les conditions d'utilisation."]); exit; }
if (strlen($username) < 3 || strlen($username) > 30) { echo json_encode(['error' => "Nom d'utilisateur : 3 à 30 caractères"]); exit; }
if (!preg_match('/^[a-zA-Z0-9_\-\.]+$/', $username)) { echo json_encode(['error' => "Nom d'utilisateur : lettres, chiffres, _ - . uniquement"]); exit; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
    echo json_encode(['error' => 'Adresse email invalide']); exit;
}
$pwd_err = password_policy_error($password);
if ($pwd_err) { echo json_encode(['error' => $pwd_err]); exit; }

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

$stmt = mysqli_prepare($conn, 'SELECT id FROM users WHERE username = ?');
$stmt->bind_param('s', $username);
$stmt->execute();
$stmt->store_result();
if ($stmt->num_rows > 0) { echo json_encode(['error' => "Nom d'utilisateur déjà utilisé"]); exit; }

$stmt = mysqli_prepare($conn, 'SELECT id FROM users WHERE email = ?');
$stmt->bind_param('s', $email);
$stmt->execute();
$stmt->store_result();
if ($stmt->num_rows > 0) { echo json_encode(['error' => 'Un compte existe déjà avec cette adresse email']); exit; }

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = mysqli_prepare($conn, 'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)');
$stmt->bind_param('sss', $username, $email, $hash);
if (!$stmt->execute()) { echo json_encode(['error' => "Erreur lors de l'inscription"]); exit; }

$new_id = (int)$conn->insert_id;
session_regenerate_id(true);
$_SESSION['user_id'] = $new_id;
$_SESSION['username'] = $username;

$s = mysqli_prepare($conn, 'INSERT INTO logins (user_id) VALUES (?)');
if ($s) { $s->bind_param('i', $new_id); $s->execute(); }

// Lien de confirmation, valable 24 h. L'échec d'envoi ne bloque pas la création
// du compte : l'utilisateur pourra demander un renvoi depuis le bandeau.
$mail_ok = false;
$token = creer_token($conn, $new_id, 'verification', 24 * 60);
if ($token) {
    $lien = site_url() . '/verifier?token=' . urlencode($token);
    $mail_ok = send_mail($email, 'Confirme ton inscription sur Composmart',
        "Bienvenue sur Composmart, $username !\n\n"
      . "Confirme ton adresse email en ouvrant ce lien :\n$lien\n\n"
      . "Ce lien est valable 24 heures. Tant que ton adresse n'est pas confirmée,\n"
      . "l'accès aux cours reste bloqué.\n\n"
      . "Si tu n'es pas à l'origine de cette inscription, ignore ce message.\n");
    audit_log($conn, 'mail_envoye', ($mail_ok ? 'Envoyé' : 'Échec') . ' — vérification email', [
        'target_type' => 'mail',
        'snapshot' => [
            'to' => $email, 'sujet' => 'Confirme ton inscription', 'ok' => $mail_ok,
            'erreur' => $mail_ok ? null : mb_substr(send_mail_last_error(), 0, 300),
        ],
    ]);
}

echo json_encode(['ok' => true, 'username' => $username, 'mail_envoye' => $mail_ok]);
