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

// "username" du formulaire accepte en réalité le pseudo OU l'adresse email :
// un pseudo ne peut jamais contenir de '@' (règle de validation à l'inscription,
// cf. register.php), donc pas de risque qu'un identifiant matche les deux
// colonnes à la fois — le OR est donc sans ambiguïté.
$identifiant = trim($_POST['username'] ?? '');
$password    = $_POST['password'] ?? '';

if (!$identifiant || !$password) { echo json_encode(['error' => 'Champs manquants']); exit; }

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

$stmt = mysqli_prepare($conn, 'SELECT id, username, password_hash, isAdmin FROM users WHERE username = ? OR email = ?');
$stmt->bind_param('ss', $identifiant, $identifiant);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

if (!$row || !password_verify($password, $row['password_hash'])) {
    echo json_encode(['error' => 'Identifiants incorrects']);
    exit;
}

session_regenerate_id(true);
$_SESSION['user_id'] = $row['id'];
$_SESSION['username'] = $row['username'];
// isAdmin mis en session : map-api/games-api (autres bases) n'ont pas accès à
// la table users. Rafraîchi à chaque login. Voir is_admin() dans _guard.php.
$_SESSION['isAdmin'] = (int)$row['isAdmin'] === 1;

$uid = (int)$row['id'];
$stmt2 = mysqli_prepare($conn, 'INSERT INTO logins (user_id) VALUES (?)');
if ($stmt2) { $stmt2->bind_param('i', $uid); $stmt2->execute(); }

// Inactivité (RGPD) : repousse l'échéance de suppression et annule une
// prévenance en cours. try : colonnes absentes tant que la migration
// 2026-10-rgpd n'est pas passée — la connexion ne doit pas en dépendre.
try {
    $stmt3 = mysqli_prepare($conn, 'UPDATE users SET derniere_connexion = NOW(), prevenu_inactivite_at = NULL WHERE id = ?');
    if ($stmt3) { $stmt3->bind_param('i', $uid); $stmt3->execute(); }
} catch (\Throwable $e) {}

echo json_encode(['ok' => true, 'username' => $row['username']]);
