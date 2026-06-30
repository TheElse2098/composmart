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
if (!$c) { echo json_encode(['error' => 'db']); exit; }

// Top 10 par XP
$res = mysqli_query($c, 'SELECT id, username, xp, niveau FROM users ORDER BY xp DESC, created_at ASC LIMIT 10');
$top = [];
while ($row = mysqli_fetch_assoc($res)) {
    $top[] = ['id' => (int)$row['id'], 'username' => $row['username'], 'xp' => (int)$row['xp'], 'niveau' => (int)$row['niveau']];
}

// Rang du joueur connecté (si hors top 10)
$me = null;
if (!empty($_SESSION['user_id'])) {
    $uid = (int)$_SESSION['user_id'];
    $stmt = mysqli_prepare($c, 'SELECT username, xp, niveau FROM users WHERE id = ?');
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    if ($u) {
        $rank_row = mysqli_fetch_row(mysqli_query($c, "SELECT COUNT(*) FROM users WHERE xp > " . (int)$u['xp']));
        $rank = (int)($rank_row[0] ?? 0) + 1;
        $me = ['username' => $u['username'], 'xp' => (int)$u['xp'], 'niveau' => (int)$u['niveau'], 'rank' => $rank, 'id' => $uid];
    }
}

echo json_encode(['top' => $top, 'me' => $me], JSON_UNESCAPED_UNICODE);
