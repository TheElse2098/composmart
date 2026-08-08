<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

if (empty($_SESSION['user_id'])) {
    echo json_encode(['logged_in' => false]);
    exit;
}

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['logged_in' => false]); exit; }

$stmt = mysqli_prepare($conn, 'SELECT id, username, email, xp, niveau, isAdmin, email_verifie FROM users WHERE id = ?');
$stmt->bind_param('i', $_SESSION['user_id']);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row) { session_destroy(); echo json_encode(['logged_in' => false]); exit; }

echo json_encode([
    'logged_in'     => true,
    'id'            => (int)$row['id'],
    'username'      => $row['username'],
    'email'         => $row['email'],
    'xp'            => (int)$row['xp'],
    'niveau'        => (int)$row['niveau'],
    'isAdmin'       => (bool)$row['isAdmin'],
    // Pilote le bandeau de rappel et l'accès aux cours (cf. cours/get.php).
    'email_verifie' => (bool)$row['email_verifie'],
]);
