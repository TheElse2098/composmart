<?php
/**
 * Classement des joueurs. Trois périodes :
 *   total   → cumul de users.xp (source de vérité du total)
 *   semaine → XP gagnée sur 7 jours glissants, depuis le journal xp_log
 *   jour    → idem sur 24 h glissantes
 *
 * Les comptes admin sont exclus de tous les classements (ce ne sont pas des
 * joueurs, ils fausseraient le podium).
 */
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

// Classement réservé aux membres. Le contrôle est ici et pas seulement côté
// page : sans lui, les pseudos et l'XP resteraient lisibles en appelant
// directement l'endpoint.
if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Connexion requise.']);
    exit;
}

function table_exists($c, $name) {
    $n = mysqli_real_escape_string($c, $name);
    $r = mysqli_query($c, "SHOW TABLES LIKE '$n'");
    return $r && mysqli_num_rows($r) > 0;
}

const TOP_N = 10;

$periode = $_GET['periode'] ?? 'total';
if (!in_array($periode, ['total', 'semaine', 'jour'], true)) $periode = 'total';

$uid = !empty($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 0;
$top = [];
$me  = null;

// ── CUMUL TOTAL ────────────────────────────────────────────────────────────
if ($periode === 'total') {
    $res = mysqli_query($c, 'SELECT id, username, xp, niveau FROM users WHERE isAdmin = 0 ORDER BY xp DESC, created_at ASC LIMIT ' . TOP_N);
    while ($row = mysqli_fetch_assoc($res)) {
        $top[] = [
            'id' => (int)$row['id'], 'username' => $row['username'],
            'xp' => (int)$row['xp'], 'niveau' => (int)$row['niveau'],
        ];
    }

    if ($uid) {
        $stmt = mysqli_prepare($c, 'SELECT username, xp, niveau FROM users WHERE id = ?');
        $stmt->bind_param('i', $uid);
        $stmt->execute();
        if ($u = $stmt->get_result()->fetch_assoc()) {
            $rank_row = mysqli_fetch_row(mysqli_query($c,
                'SELECT COUNT(*) FROM users WHERE isAdmin = 0 AND xp > ' . (int)$u['xp']));
            $me = [
                'id' => $uid, 'username' => $u['username'],
                'xp' => (int)$u['xp'], 'niveau' => (int)$u['niveau'],
                'rank' => (int)($rank_row[0] ?? 0) + 1,
            ];
        }
    }
}

// ── PÉRIODE GLISSANTE (7 jours / 24 h) ─────────────────────────────────────
else {
    // xp_log alimente ces classements : sans la table (migration non jouée),
    // on renvoie un drapeau plutôt qu'un classement vide silencieux.
    if (!table_exists($c, 'xp_log')) {
        echo json_encode(['top' => [], 'me' => null, 'periode' => $periode, 'indisponible' => true]);
        exit;
    }

    $jours = $periode === 'jour' ? 1 : 7;

    // MIN(l.created_at) départage à égalité : celui qui a atteint ce total en
    // premier passe devant, comme created_at ASC pour le cumul total.
    $res = mysqli_query($c,
        "SELECT u.id, u.username, u.niveau, SUM(l.delta) AS gagne
         FROM xp_log l JOIN users u ON u.id = l.user_id
         WHERE u.isAdmin = 0 AND l.created_at >= (NOW() - INTERVAL $jours DAY)
         GROUP BY u.id, u.username, u.niveau
         ORDER BY gagne DESC, MIN(l.created_at) ASC
         LIMIT " . TOP_N);
    while ($row = mysqli_fetch_assoc($res)) {
        $top[] = [
            'id' => (int)$row['id'], 'username' => $row['username'],
            'xp' => (int)$row['gagne'], 'niveau' => (int)$row['niveau'],
        ];
    }

    if ($uid) {
        $stmt = mysqli_prepare($c, 'SELECT username, niveau FROM users WHERE id = ?');
        $stmt->bind_param('i', $uid);
        $stmt->execute();
        if ($u = $stmt->get_result()->fetch_assoc()) {
            $g = mysqli_fetch_row(mysqli_query($c,
                "SELECT COALESCE(SUM(delta), 0) FROM xp_log
                 WHERE user_id = $uid AND created_at >= (NOW() - INTERVAL $jours DAY)"));
            $mon_gain = (int)($g[0] ?? 0);

            // Rang = nombre de joueurs ayant strictement mieux fait sur la fenêtre.
            $r = mysqli_fetch_row(mysqli_query($c,
                "SELECT COUNT(*) FROM (
                    SELECT l.user_id, SUM(l.delta) AS s
                    FROM xp_log l JOIN users u ON u.id = l.user_id
                    WHERE u.isAdmin = 0 AND l.created_at >= (NOW() - INTERVAL $jours DAY)
                    GROUP BY l.user_id
                    HAVING s > $mon_gain
                 ) t"));
            $me = [
                'id' => $uid, 'username' => $u['username'],
                'xp' => $mon_gain, 'niveau' => (int)$u['niveau'],
                'rank' => (int)($r[0] ?? 0) + 1,
            ];
        }
    }
}

echo json_encode(['top' => $top, 'me' => $me, 'periode' => $periode], JSON_UNESCAPED_UNICODE);
