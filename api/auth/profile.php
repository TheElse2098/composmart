<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

if (empty($_SESSION['user_id'])) { echo json_encode(['logged_in' => false]); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { echo json_encode(['logged_in' => false]); exit; }

$uid = (int)$_SESSION['user_id'];

// ── Utilisateur ────────────────────────────────────────────────────────────
$stmt = mysqli_prepare($c, 'SELECT username, xp, niveau, isAdmin, created_at FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();
if (!$u) { echo json_encode(['logged_in' => false]); exit; }

// ── Cours terminés ─────────────────────────────────────────────────────────
$completed = [];
$res = mysqli_query($c,
    "SELECT c.slug, c.titre, c.emoji
     FROM user_progress up JOIN cours c ON c.slug = up.cours_id
     WHERE up.user_id = $uid
     ORDER BY up.completed_at DESC");
if ($res) {
    while ($row = mysqli_fetch_assoc($res)) {
        $completed[] = ['slug' => $row['slug'], 'titre' => $row['titre'], 'emoji' => $row['emoji'] ?: '📘'];
    }
}
$total_cours = (int) (mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM cours'))[0] ?? 0);

// ── Records de jeux ────────────────────────────────────────────────────────
$JEUX = [
    'mot-mystere'    => ['nom' => 'Mot mystère',    'emoji' => '🔤', 'max' => 80],
    'compost-ou-pas' => ['nom' => 'Compost ou pas ?', 'emoji' => '♻️', 'max' => 12],
];
$records = [];
$parties_total = 0;
$res = mysqli_query($c, "SELECT jeu_id, MAX(score) AS best, COUNT(*) AS parties FROM scores WHERE user_id = $uid GROUP BY jeu_id");
$joues = [];
if ($res) {
    while ($row = mysqli_fetch_assoc($res)) {
        $joues[$row['jeu_id']] = ['best' => (int)$row['best'], 'parties' => (int)$row['parties']];
        $parties_total += (int)$row['parties'];
    }
}
foreach ($JEUX as $slug => $info) {
    $records[] = [
        'slug'    => $slug,
        'nom'     => $info['nom'],
        'emoji'   => $info['emoji'],
        'max'     => $info['max'],
        'best'    => isset($joues[$slug]) ? $joues[$slug]['best'] : null,
        'parties' => isset($joues[$slug]) ? $joues[$slug]['parties'] : 0,
    ];
}

// ── Badges (déduits des données) ───────────────────────────────────────────
$niveau     = (int)$u['niveau'];
$nb_done    = count($completed);
$nb_jeux    = count(array_filter($records, fn($r) => $r['best'] !== null));
$all_cours  = $total_cours > 0 && $nb_done >= $total_cours;
$all_jeux   = count($JEUX) > 0 && $nb_jeux >= count($JEUX);

$badges = [
    ['emoji' => '🌱', 'label' => 'Première pousse',  'desc' => 'Valider un premier cours',        'unlocked' => $nb_done >= 1],
    ['emoji' => '🎓', 'label' => 'Expert compost',   'desc' => 'Terminer tous les cours',          'unlocked' => $all_cours],
    ['emoji' => '🎮', 'label' => 'Joueur',           'desc' => 'Jouer à un mini-jeu',              'unlocked' => $parties_total >= 1],
    ['emoji' => '🏆', 'label' => 'Touche-à-tout',    'desc' => 'Essayer tous les jeux',            'unlocked' => $all_jeux],
    ['emoji' => '⭐', 'label' => 'Niveau 5',          'desc' => 'Atteindre le niveau 5',            'unlocked' => $niveau >= 5],
    ['emoji' => '🔥', 'label' => 'Niveau 10',         'desc' => 'Atteindre le niveau 10',           'unlocked' => $niveau >= 10],
];

$rank_row = mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM users WHERE xp > ' . (int)$u['xp']));
$rank = (int)($rank_row[0] ?? 0) + 1;

echo json_encode([
    'logged_in'   => true,
    'username'    => $u['username'],
    'xp'          => (int)$u['xp'],
    'niveau'      => $niveau,
    'isAdmin'     => (bool)$u['isAdmin'],
    'membre_depuis' => $u['created_at'],
    'rank'        => $rank,
    'cours'       => ['done' => $nb_done, 'total' => $total_cours, 'liste' => $completed],
    'records'     => $records,
    'parties'     => $parties_total,
    'badges'      => $badges,
], JSON_UNESCAPED_UNICODE);
