<?php
/**
 * Admin — évolution du parc de composteurs présents sur la carte.
 *
 *   ?periode=7d|30d|90d  → total cumulé, un point par jour
 *   ?periode=tout        → total cumulé, un point par mois depuis le 1er point
 *
 * Compte les composteurs réellement visibles (statut = 'valide'), imports OSM
 * inclus : c'est le parc affiché sur la carte, pas l'activité des utilisateurs.
 *
 * Le cumul part d'un socle (tout ce qui existait avant le début de la fenêtre)
 * auquel on ajoute les créations période par période : sans ce socle, une vue
 * « 7 jours » afficherait quelques unités au lieu des milliers réels.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-map',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

// map-api n'a pas accès à la table users (db-core) : admin lu depuis la session.
if (!is_admin_session()) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé aux administrateurs.']);
    exit;
}

$periode = $_GET['periode'] ?? '30d';
if (!in_array($periode, ['7d', '30d', '90d', 'tout'], true)) $periode = '30d';

$labels = [];   // libellés affichés
$totaux = [];   // total cumulé à la fin de chaque pas

// ── VUE MENSUELLE (tout l'historique) ──────────────────────────────────────
if ($periode === 'tout') {
    $row = mysqli_fetch_row(mysqli_query($c,
        "SELECT DATE_FORMAT(MIN(created_at), '%Y-%m') FROM composts WHERE statut = 'valide'"));
    $debut = $row[0] ?? null;
    if (!$debut) { echo json_encode(['labels' => [], 'totaux' => [], 'periode' => $periode]); exit; }

    $parMois = [];
    $res = mysqli_query($c,
        "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m, COUNT(*) AS n
         FROM composts WHERE statut = 'valide' GROUP BY m");
    while ($r = mysqli_fetch_assoc($res)) $parMois[$r['m']] = (int)$r['n'];

    $MOIS = ['01' => 'janv.', '02' => 'févr.', '03' => 'mars', '04' => 'avr.',
             '05' => 'mai', '06' => 'juin', '07' => 'juil.', '08' => 'août',
             '09' => 'sept.', '10' => 'oct.', '11' => 'nov.', '12' => 'déc.'];

    $cur = new DateTime($debut . '-01');
    $fin = new DateTime(date('Y-m') . '-01');
    $cumul = 0;
    while ($cur <= $fin) {
        $cle = $cur->format('Y-m');
        $cumul += $parMois[$cle] ?? 0;
        $labels[] = $MOIS[$cur->format('m')] . ' ' . $cur->format('y');
        $totaux[] = $cumul;
        $cur->modify('+1 month');
    }
}

// ── VUE JOURNALIÈRE (fenêtre glissante) ────────────────────────────────────
else {
    $jours = ['7d' => 7, '30d' => 30, '90d' => 90][$periode];

    $dates = [];
    for ($i = $jours - 1; $i >= 0; $i--) $dates[] = date('Y-m-d', strtotime("-{$i} days"));
    $from = $dates[0];

    // Socle : tout ce qui existait avant le premier jour affiché.
    $row = mysqli_fetch_row(mysqli_query($c,
        "SELECT COUNT(*) FROM composts WHERE statut = 'valide' AND created_at < '$from 00:00:00'"));
    $cumul = (int)($row[0] ?? 0);

    $parJour = [];
    $res = mysqli_query($c,
        "SELECT DATE(created_at) AS d, COUNT(*) AS n
         FROM composts WHERE statut = 'valide' AND created_at >= '$from 00:00:00'
         GROUP BY DATE(created_at)");
    while ($r = mysqli_fetch_assoc($res)) $parJour[$r['d']] = (int)$r['n'];

    foreach ($dates as $d) {
        $cumul += $parJour[$d] ?? 0;
        $labels[] = substr($d, 8, 2) . '/' . substr($d, 5, 2);
        $totaux[] = $cumul;
    }
}

mysqli_close($c);
echo json_encode([
    'labels'  => $labels,
    'totaux'  => $totaux,
    'periode' => $periode,
], JSON_UNESCAPED_UNICODE);
