<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// GET : vérifie s'il existe déjà un admin
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $res = mysqli_query($c, 'SELECT id FROM users WHERE isAdmin = 1 LIMIT 1');
    echo json_encode(['has_admin' => (bool) mysqli_num_rows($res)]);
    exit;
}

// POST : créer le premier compte admin
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

// Vérification serveur : si un admin existe déjà, on refuse
$res = mysqli_query($c, 'SELECT id FROM users WHERE isAdmin = 1 LIMIT 1');
if (mysqli_num_rows($res) > 0) {
    echo json_encode(['error' => 'Un compte admin existe déjà.']);
    exit;
}

$username = trim($_POST['username'] ?? '');
$password = $_POST['password']  ?? '';

if (strlen($username) < 3 || strlen($username) > 30) {
    echo json_encode(['error' => 'Le nom doit faire entre 3 et 30 caractères.']); exit;
}
if (!preg_match('/^[a-zA-Z0-9_\-.]+$/', $username)) {
    echo json_encode(['error' => 'Caractères autorisés : lettres, chiffres, _ - .']); exit;
}
if (strlen($password) < 6) {
    echo json_encode(['error' => 'Mot de passe trop court (6 caractères minimum).']); exit;
}

$hash = password_hash($password, PASSWORD_BCRYPT);
$u    = mysqli_real_escape_string($c, $username);

$ok = mysqli_query($c, "INSERT INTO users (username, password_hash, isAdmin) VALUES ('$u', '$hash', 1)");
if (!$ok) {
    $errno = mysqli_errno($c);
    echo json_encode(['error' => $errno === 1062 ? 'Ce nom d\'utilisateur est déjà pris.' : 'Erreur base de données.']);
    exit;
}

$_SESSION['user_id']  = mysqli_insert_id($c);
$_SESSION['username'] = $username;
mysqli_close($c);

echo json_encode(['ok' => true, 'username' => $username]);
