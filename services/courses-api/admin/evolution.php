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

$days = match($_GET['period'] ?? '30d') {
    '7d'  => 7,
    '90d' => 90,
    default => 30,
};

// Plage de dates
$labels = [];
for ($i = $days - 1; $i >= 0; $i--) {
    $labels[] = date('Y-m-d', strtotime("-{$i} days"));
}
$from = mysqli_real_escape_string($c, $labels[0]);

function qs($c, $table, $col, $from) {
    $res = mysqli_query($c, "SELECT DATE(`$col`) AS d, COUNT(*) AS n FROM `$table` WHERE `$col` >= '$from' GROUP BY DATE(`$col`)");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['d']] = (int)$r['n'];
    return $map;
}
function qs_audit($c, $actions, $from) {
    $in = implode(',', array_map(
        fn($a) => "'" . mysqli_real_escape_string($c, $a) . "'",
        (array)$actions));
    $res = mysqli_query($c, "SELECT DATE(created_at) AS d, COUNT(*) AS n FROM audit_log WHERE action IN ($in) AND created_at >= '$from' GROUP BY DATE(created_at)");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['d']] = (int)$r['n'];
    return $map;
}
/**
 * Composteurs validés par jour. Une validation en masse n'écrit qu'UNE ligne
 * d'audit pour N composteurs (cf. carte/pending.php) : on somme snapshot.traites
 * au lieu de compter les lignes, sinon un lot de 20 compterait pour 1.
 */
function qs_valides($c, $from) {
    $res = mysqli_query($c,
        "SELECT DATE(created_at) AS d, SUM(COALESCE(JSON_VALUE(snapshot, '\$.traites'), 1)) AS n
         FROM audit_log WHERE action = 'compost_valide' AND created_at >= '$from'
         GROUP BY DATE(created_at)");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['d']] = (int)$r['n'];
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

$inscrits = fill(qs($c, 'users', 'created_at', $from), $labels);
$a_audit  = table_exists($c, 'audit_log');
// 'compost_cree' = ancienne action (avant la validation admin), 'compost_demande'
// = la nouvelle. On additionne les deux pour que la série ne se coupe pas au
// changement de flux et garde l'historique d'avant.
$composteurs = $a_audit
    ? fill(qs_audit($c, ['compost_demande', 'compost_cree'], $from), $labels)
    : null;
$valides = $a_audit ? fill(qs_valides($c, $from), $labels) : null;
$connexions  = table_exists($c, 'logins')
    ? fill(qs($c, 'logins', 'logged_at', $from), $labels)
    : null;

// Formater les labels DD/MM
$short = array_map(fn($d) => substr($d, 8, 2) . '/' . substr($d, 5, 2), $labels);

echo json_encode([
    'labels'      => $short,
    'inscrits'    => $inscrits,
    'composteurs' => $composteurs,
    'valides'     => $valides,
    'connexions'  => $connexions,
], JSON_UNESCAPED_UNICODE);
