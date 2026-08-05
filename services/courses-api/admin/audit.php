<?php
/**
 * Admin — journal d'audit filtré + paginé.
 *  GET ?type=...&page=... → liste des entrées audit_log, plus récentes d'abord.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
mysqli_report(MYSQLI_REPORT_OFF);

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// ── Garde admin (vérif en base = source de vérité) ─────────────────────────
$me = (int)($_SESSION['user_id'] ?? 0);
$is_admin = false;
if ($me > 0) {
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $me);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $is_admin = $row && (int)$row['isAdmin'] === 1;
}
if (!$is_admin) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé aux administrateurs.']);
    exit;
}

function table_exists($c, $name) {
    $name = mysqli_real_escape_string($c, $name);
    $res = mysqli_query($c, "SHOW TABLES LIKE '$name'");
    return $res && mysqli_num_rows($res) > 0;
}

if (!table_exists($c, 'audit_log')) {
    echo json_encode(['entries' => [], 'types' => [], 'page' => 1, 'pages' => 1, 'total' => 0], JSON_UNESCAPED_UNICODE);
    exit;
}

// Types d'action réellement présents en base : alimente le sélecteur de filtre
// côté front sans avoir à maintenir une liste statique en double.
$types = [];
$res = mysqli_query($c, 'SELECT DISTINCT action FROM audit_log ORDER BY action');
while ($row = mysqli_fetch_assoc($res)) { $types[] = $row['action']; }

// Filtre : 'tous', ou une action précise (ex. 'signalement_cree').
$type = $_GET['type'] ?? 'tous';
if ($type !== 'tous' && !in_array($type, $types, true)) { $type = 'tous'; }
$where = $type === 'tous' ? '' : 'WHERE action = \'' . mysqli_real_escape_string($c, $type) . '\'';

// Plage de dates optionnelle (YYYY-MM-DD), chaque borne indépendante et incluse.
$depuis = $_GET['depuis'] ?? '';
$jusqu  = $_GET['jusqu']  ?? '';
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $depuis)) {
    $where .= ($where ? ' AND ' : 'WHERE ') . "created_at >= '" . mysqli_real_escape_string($c, $depuis) . " 00:00:00'";
}
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $jusqu)) {
    // 23:59:59 : sans l'heure, la borne haute exclurait toute la journée choisie.
    $where .= ($where ? ' AND ' : 'WHERE ') . "created_at <= '" . mysqli_real_escape_string($c, $jusqu) . " 23:59:59'";
}

const PAR_PAGE = 30;
$page  = max(1, (int)($_GET['page'] ?? 1));
$total = (int)(mysqli_fetch_row(mysqli_query($c, "SELECT COUNT(*) FROM audit_log $where"))[0] ?? 0);
$pages = max(1, (int)ceil($total / PAR_PAGE));
$page  = min($page, $pages);
$offset = ($page - 1) * PAR_PAGE;

$res = mysqli_query($c,
    "SELECT username, action, details, target_type, target_id, snapshot, created_at
     FROM audit_log $where ORDER BY id DESC LIMIT " . PAR_PAGE . " OFFSET $offset");
$entries = [];
while ($row = mysqli_fetch_assoc($res)) {
    $entries[] = [
        'username'    => $row['username'] ?: 'inconnu',
        'action'      => $row['action'],
        'details'     => $row['details'],
        'target_type' => $row['target_type'],
        'target_id'   => $row['target_id'] !== null ? (int)$row['target_id'] : null,
        'snapshot'    => $row['snapshot'] ? json_decode($row['snapshot'], true) : null,
        'date'        => $row['created_at'],
    ];
}
mysqli_close($c);

echo json_encode([
    'entries' => $entries,
    'types'   => $types,
    'type'    => $type,
    'page'    => $page,
    'pages'   => $pages,
    'total'   => $total,
], JSON_UNESCAPED_UNICODE);
