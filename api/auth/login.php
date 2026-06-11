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

if (!rate_limit('login', 10, 600)) {
    http_response_code(429);
    echo json_encode(['error' => 'Trop de tentatives. Réessaie dans quelques minutes.']);
    exit;
}

$username = trim($_POST['username'] ?? '');
$password = $_POST['password'] ?? '';

if (!$username || !$password) { echo json_encode(['error' => 'Champs manquants']); exit; }

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

$stmt = mysqli_prepare($conn, 'SELECT id, username, password_hash FROM users WHERE username = ?');
$stmt->bind_param('s', $username);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row || !password_verify($password, $row['password_hash'])) {
    echo json_encode(['error' => 'Identifiants incorrects']);
    exit;
}

session_regenerate_id(true);
$_SESSION['user_id'] = $row['id'];
$_SESSION['username'] = $row['username'];

echo json_encode(['ok' => true, 'username' => $row['username']]);
