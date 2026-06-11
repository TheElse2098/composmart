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
function table_exists($c, $name) {
    $name = mysqli_real_escape_string($c, $name);
    $res = mysqli_query($c, "SHOW TABLES LIKE '$name'");
    return $res && mysqli_num_rows($res) > 0;
}

$stats = [
    'users'        => count_of($c, 'SELECT COUNT(*) FROM users'),
    'admins'       => count_of($c, 'SELECT COUNT(*) FROM users WHERE isAdmin = 1'),
    'composts'     => count_of($c, 'SELECT COUNT(*) FROM composts'),
    'cours'        => count_of($c, 'SELECT COUNT(*) FROM cours'),
    'completions'  => count_of($c, 'SELECT COUNT(*) FROM user_progress'),
    'parties'      => count_of($c, 'SELECT COUNT(*) FROM scores'),
    // La table signalements n'existe qu'après réinitialisation de la DB
    'signalements' => table_exists($c, 'signalements')
        ? count_of($c, "SELECT COUNT(*) FROM signalements WHERE statut = 'ouvert'")
        : null,
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

// Journal d'audit (30 dernières actions) — défensif si table absente
$audit = [];
if (table_exists($c, 'audit_log')) {
    $res = mysqli_query($c, 'SELECT username, action, details, target_type, target_id, snapshot, created_at FROM audit_log ORDER BY id DESC LIMIT 30');
    while ($row = mysqli_fetch_assoc($res)) {
        $audit[] = [
            'username'    => $row['username'] ?: 'inconnu',
            'action'      => $row['action'],
            'details'     => $row['details'],
            'target_type' => $row['target_type'],
            'target_id'   => $row['target_id'] !== null ? (int)$row['target_id'] : null,
            'snapshot'    => $row['snapshot'] ? json_decode($row['snapshot'], true) : null,
            'date'        => $row['created_at'],
        ];
    }
}

mysqli_close($c);
echo json_encode(['stats' => $stats, 'users' => $users, 'audit' => $audit], JSON_UNESCAPED_UNICODE);
