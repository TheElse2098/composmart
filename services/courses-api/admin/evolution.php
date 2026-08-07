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

$is_admin = false;
if (!empty($_SESSION['user_id'])) {
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $is_admin = $row && (int)$row['isAdmin'] === 1;
}
if (!$is_admin) { http_response_code(403); echo json_encode(['error' => 'Accès réservé']); exit; }

$periode = $_GET['period'] ?? '30d';
if (!in_array($periode, ['7d', '30d', '90d', 'tout'], true)) $periode = '30d';

/** Comptage par jour depuis $from. */
function qs($c, $table, $col, $from) {
    $res = mysqli_query($c, "SELECT DATE(`$col`) AS d, COUNT(*) AS n FROM `$table` WHERE `$col` >= '$from' GROUP BY DATE(`$col`)");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['d']] = (int)$r['n'];
    return $map;
}
/** Comptage par mois sur tout l'historique. */
function qs_mois($c, $table, $col) {
    $res = mysqli_query($c, "SELECT DATE_FORMAT(`$col`, '%Y-%m') AS m, COUNT(*) AS n FROM `$table` GROUP BY m");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['m']] = (int)$r['n'];
    return $map;
}
function fill($map, $labels) {
    return array_map(fn($d) => $map[$d] ?? 0, $labels);
}
function table_exists($c, $name) {
    $n = mysqli_real_escape_string($c, $name);
    $r = mysqli_query($c, "SHOW TABLES LIKE '$n'");
    return $r && mysqli_num_rows($r) > 0;
}

$a_logins = table_exists($c, 'logins');

// Les composteurs vivent en db-map : leur évolution est servie à part par
// /api/carte/evolution.php (comptage sur composts.created_at, pas sur l'audit).

// ── VUE MENSUELLE (tout l'historique) ──────────────────────────────────────
// Contrairement au parc de composteurs (un cumul), on reste ici sur un flux :
// « combien d'inscriptions/connexions ce mois-là », pas un total qui grimpe.
if ($periode === 'tout') {
    $row = mysqli_fetch_row(mysqli_query($c, "SELECT DATE_FORMAT(MIN(created_at), '%Y-%m') FROM users"));
    $debut = $row[0] ?? null;
    if (!$debut) {
        echo json_encode(['labels' => [], 'inscrits' => [], 'connexions' => null], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $MOIS = ['01' => 'janv.', '02' => 'févr.', '03' => 'mars', '04' => 'avr.',
             '05' => 'mai', '06' => 'juin', '07' => 'juil.', '08' => 'août',
             '09' => 'sept.', '10' => 'oct.', '11' => 'nov.', '12' => 'déc.'];

    $cles = [];
    $short = [];
    $cur = new DateTime($debut . '-01');
    $fin = new DateTime(date('Y-m') . '-01');
    while ($cur <= $fin) {
        $cles[]  = $cur->format('Y-m');
        $short[] = $MOIS[$cur->format('m')] . ' ' . $cur->format('y');
        $cur->modify('+1 month');
    }

    $inscrits   = fill(qs_mois($c, 'users', 'created_at'), $cles);
    $connexions = $a_logins ? fill(qs_mois($c, 'logins', 'logged_at'), $cles) : null;
}

// ── VUE JOURNALIÈRE (fenêtre glissante) ────────────────────────────────────
else {
    $days = ['7d' => 7, '30d' => 30, '90d' => 90][$periode];

    $labels = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $labels[] = date('Y-m-d', strtotime("-{$i} days"));
    }
    $from = mysqli_real_escape_string($c, $labels[0]);

    $inscrits   = fill(qs($c, 'users', 'created_at', $from), $labels);
    $connexions = $a_logins ? fill(qs($c, 'logins', 'logged_at', $from), $labels) : null;

    // Formater les labels DD/MM
    $short = array_map(fn($d) => substr($d, 8, 2) . '/' . substr($d, 5, 2), $labels);
}

echo json_encode([
    'labels'     => $short,
    'inscrits'   => $inscrits,
    'connexions' => $connexions,
], JSON_UNESCAPED_UNICODE);
