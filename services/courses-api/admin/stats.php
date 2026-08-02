<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// ── Garde admin (côté serveur) ─────────────────────────────────────────────
// courses-api a accès à users (db-core) : on revérifie en base (source de vérité),
// au-delà du flag de session, car c'est une page sensible.
$is_admin = false;
if (!empty($_SESSION['user_id'])) {
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $is_admin = $row && (int)$row['isAdmin'] === 1;
}
if (!$is_admin) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé aux administrateurs.']);
    exit;
}

function count_of($c, $sql) {
    $res = mysqli_query($c, $sql);
    if (!$res) return 0;
    return (int) (mysqli_fetch_row($res)[0] ?? 0);
}

// composts/parties/signalements vivent dans db-map et db-games : le front admin
// les complète via /api/carte/count.php et /api/jeux/count.php. On expose null ici.
$stats = [
    'users'        => count_of($c, 'SELECT COUNT(*) FROM users'),
    'admins'       => count_of($c, 'SELECT COUNT(*) FROM users WHERE isAdmin = 1'),
    'composts'     => null,  // db-map (front)
    'cours'        => count_of($c, 'SELECT COUNT(*) FROM cours'),
    'completions'  => count_of($c, 'SELECT COUNT(*) FROM user_progress'),
    'parties'      => null,  // db-games (front)
    'signalements' => null,  // db-map (front)
];

// Liste des utilisateurs (lecture seule)
$users = [];
$res = mysqli_query($c, 'SELECT id, username, xp, niveau, isAdmin, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 100');
while ($row = mysqli_fetch_assoc($res)) {
    $users[] = [
        'id'       => (int)$row['id'],
        'username' => $row['username'],
        'xp'       => (int)$row['xp'],
        'niveau'   => (int)$row['niveau'],
        'isAdmin'  => (bool)$row['isAdmin'],
        'date'     => $row['created_at'],
    ];
}

// Journal d'audit : servi séparément par admin/audit.php (filtre + pagination).

mysqli_close($c);
echo json_encode([
    'me'    => (int)$_SESSION['user_id'],
    'stats' => $stats,
    'users' => $users,
], JSON_UNESCAPED_UNICODE);
