<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

// Les helpers de ce fichier testent la valeur de retour des requêtes (tables
// optionnelles) : on désactive les exceptions mysqli (défaut depuis PHP 8.1).
mysqli_report(MYSQLI_REPORT_OFF);

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
/** Additionne deux comptages date => nombre. */
function fusion($a, $b) {
    foreach ($b as $k => $v) $a[$k] = ($a[$k] ?? 0) + $v;
    return $a;
}

$a_logins = table_exists($c, 'logins');
$a_anon   = table_exists($c, 'stats_anonymes');

// ── COMPTES SUPPRIMÉS ───────────────────────────────────────────────────────
// Leurs lignes ont disparu de users/logins, mais leur activité a été reversée
// dans stats_anonymes au moment de la suppression. Sans ces agrégats, les
// courbes reculeraient dans le passé à chaque suppression de compte.
function qs_anon($c, $type, $from) {
    $t = mysqli_real_escape_string($c, $type);
    $res = mysqli_query($c, "SELECT jour AS d, total AS n FROM stats_anonymes
                             WHERE type = '$t' AND jour >= '$from'");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['d']] = (int)$r['n'];
    return $map;
}
function qs_anon_mois($c, $type) {
    $t = mysqli_real_escape_string($c, $type);
    $res = mysqli_query($c, "SELECT DATE_FORMAT(jour, '%Y-%m') AS m, SUM(total) AS n
                             FROM stats_anonymes WHERE type = '$t' GROUP BY m");
    $map = [];
    if ($res) while ($r = mysqli_fetch_assoc($res)) $map[$r['m']] = (int)$r['n'];
    return $map;
}

// Les composteurs vivent en db-map : leur évolution est servie à part par
// /api/carte/evolution.php (comptage sur composts.created_at, pas sur l'audit).

// ── VUE MENSUELLE (tout l'historique) ──────────────────────────────────────
// Contrairement au parc de composteurs (un cumul), on reste ici sur un flux :
// « combien d'inscriptions/connexions ce mois-là », pas un total qui grimpe.
if ($periode === 'tout') {
    $row = mysqli_fetch_row(mysqli_query($c, "SELECT DATE_FORMAT(MIN(created_at), '%Y-%m') FROM users"));
    $debut = $row[0] ?? null;
    // Le plus ancien compte est peut-être un compte supprimé : l'historique
    // doit alors démarrer au premier mois connu des agrégats anonymes.
    if ($a_anon) {
        $row = mysqli_fetch_row(mysqli_query($c, "SELECT DATE_FORMAT(MIN(jour), '%Y-%m') FROM stats_anonymes"));
        $anc = $row[0] ?? null;
        if ($anc && (!$debut || $anc < $debut)) $debut = $anc;
    }
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

    $m_ins = qs_mois($c, 'users', 'created_at');
    $m_con = $a_logins ? qs_mois($c, 'logins', 'logged_at') : [];
    if ($a_anon) {
        $m_ins = fusion($m_ins, qs_anon_mois($c, 'inscription'));
        $m_con = fusion($m_con, qs_anon_mois($c, 'connexion'));
    }
    $inscrits   = fill($m_ins, $cles);
    $connexions = $a_logins ? fill($m_con, $cles) : null;
}

// ── VUE JOURNALIÈRE (fenêtre glissante) ────────────────────────────────────
else {
    $days = ['7d' => 7, '30d' => 30, '90d' => 90][$periode];

    $labels = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $labels[] = date('Y-m-d', strtotime("-{$i} days"));
    }
    $from = mysqli_real_escape_string($c, $labels[0]);

    $d_ins = qs($c, 'users', 'created_at', $from);
    $d_con = $a_logins ? qs($c, 'logins', 'logged_at', $from) : [];
    if ($a_anon) {
        $d_ins = fusion($d_ins, qs_anon($c, 'inscription', $from));
        $d_con = fusion($d_con, qs_anon($c, 'connexion', $from));
    }
    $inscrits   = fill($d_ins, $labels);
    $connexions = $a_logins ? fill($d_con, $labels) : null;

    // Formater les labels DD/MM
    $short = array_map(fn($d) => substr($d, 8, 2) . '/' . substr($d, 5, 2), $labels);
}

echo json_encode([
    'labels'     => $short,
    'inscrits'   => $inscrits,
    'connexions' => $connexions,
], JSON_UNESCAPED_UNICODE);
