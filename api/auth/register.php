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
$password = $_POST['password'] ?? '';

if (!$username || !$password) { echo json_encode(['error' => 'Champs manquants']); exit; }
if (strlen($username) < 3 || strlen($username) > 30) { echo json_encode(['error' => "Nom d'utilisateur : 3 à 30 caractères"]); exit; }
if (!preg_match('/^[a-zA-Z0-9_\-\.]+$/', $username)) { echo json_encode(['error' => "Nom d'utilisateur : lettres, chiffres, _ - . uniquement"]); exit; }
if (strlen($password) < 6) { echo json_encode(['error' => 'Mot de passe : 6 caractères minimum']); exit; }

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

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = mysqli_prepare($conn, 'INSERT INTO users (username, password_hash) VALUES (?, ?)');
$stmt->bind_param('ss', $username, $hash);
if (!$stmt->execute()) { echo json_encode(['error' => "Erreur lors de l'inscription"]); exit; }

session_regenerate_id(true);
$_SESSION['user_id'] = $conn->insert_id;
$_SESSION['username'] = $username;

echo json_encode(['ok' => true, 'username' => $username]);
