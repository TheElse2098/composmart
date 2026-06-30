<?php
// DEBUG TEMPORAIRE — diagnostic 500 launchpad. Marqueurs STEP flushés, pas de buffering.
error_reporting(E_ALL);
ini_set('display_errors', 1);
header('Content-Type: text/plain; charset=utf-8');
function step($n) { echo "STEP $n\n"; @ob_flush(); @flush(); }
step('A_start');
require_once __DIR__ . '/../_guard.php';
step('B_guard_loaded');
secure_session_start();
step('C_session_started');
csrf_check();
step('D_csrf_ok');

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

$username = trim($_POST['username'] ?? '');
$password = $_POST['password']  ?? '';

if (strlen($username) < 3 || strlen($username) > 30) {
    echo json_encode(['error' => 'Le nom doit faire entre 3 et 30 caractères.']); exit;
}
if (!preg_match('/^[a-zA-Z0-9_\-.]+$/', $username)) {
    echo json_encode(['error' => 'Caractères autorisés : lettres, chiffres, _ - .']); exit;
}
$pwd_err = password_policy_error($password);
if ($pwd_err) { echo json_encode(['error' => $pwd_err]); exit; }

// Verrou nommé : rend le « check admin existe ? » + INSERT atomique,
// empêche deux requêtes simultanées de créer deux admins.
mysqli_query($c, "SELECT GET_LOCK('composmart_launchpad', 5)");

$res = mysqli_query($c, 'SELECT id FROM users WHERE isAdmin = 1 LIMIT 1');
if (mysqli_num_rows($res) > 0) {
    mysqli_query($c, "SELECT RELEASE_LOCK('composmart_launchpad')");
    echo json_encode(['error' => 'Un compte admin existe déjà.']);
    exit;
}

$hash = password_hash($password, PASSWORD_BCRYPT);
$u    = mysqli_real_escape_string($c, $username);

$ok = mysqli_query($c, "INSERT INTO users (username, password_hash, isAdmin) VALUES ('$u', '$hash', 1)");
mysqli_query($c, "SELECT RELEASE_LOCK('composmart_launchpad')");
if (!$ok) {
    $errno = mysqli_errno($c);
    echo json_encode(['error' => $errno === 1062 ? 'Ce nom d\'utilisateur est déjà pris.' : 'Erreur base de données.']);
    exit;
}

step('E_user_inserted');
$admin_id = (int)mysqli_insert_id($c);
session_regenerate_id(true);
step('F_session_regenerated');
$_SESSION['user_id']  = $admin_id;
$_SESSION['username'] = $username;

$s = mysqli_prepare($c, 'INSERT INTO logins (user_id) VALUES (?)');
if ($s) { $s->bind_param('i', $admin_id); $s->execute(); }
step('G_login_logged');

// Récupérer tous les cours et leur XP
$total_xp  = 0;
$res_cours = mysqli_query($c, 'SELECT slug, xp_reward FROM cours');
step('H_cours_query res=' . ($res_cours === false ? 'FALSE err=' . mysqli_error($c) : 'OK'));
$values    = [];
while ($res_cours && ($row = mysqli_fetch_assoc($res_cours))) {
    $slug      = mysqli_real_escape_string($c, $row['slug']);
    $total_xp += (int)$row['xp_reward'];
    $values[]  = "($admin_id, '$slug')";
}
step('I_cours_loop_done xp=' . $total_xp);

// Marquer tous les cours comme complétés
if (!empty($values)) {
    mysqli_query($c, 'INSERT IGNORE INTO user_progress (user_id, cours_id) VALUES ' . implode(',', $values));
}
step('J_progress_inserted');

// Mettre à jour XP et niveau
$niveau = floor($total_xp / 100) + 1;
mysqli_query($c, "UPDATE users SET xp = $total_xp, niveau = $niveau WHERE id = $admin_id");
step('K_xp_updated niveau=' . $niveau);

mysqli_close($c);
step('Z_done');

echo json_encode(['ok' => true, 'username' => $username, 'xp' => $total_xp, 'niveau' => $niveau]);
