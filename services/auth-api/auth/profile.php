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
    "SELECT c.slug, c.titre, c.emoji, up.completed_at
     FROM user_progress up JOIN cours c ON c.slug = up.cours_id
     WHERE up.user_id = $uid
     ORDER BY up.completed_at DESC");
if ($res) {
    while ($row = mysqli_fetch_assoc($res)) {
        $completed[] = ['slug' => $row['slug'], 'titre' => $row['titre'], 'emoji' => $row['emoji'] ?: '📘', 'completed_at' => $row['completed_at']];
    }
}
$total_cours = (int) (mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM cours'))[0] ?? 0);

// ── Historique XP (cours + jeux, pour l'histogramme sur la page profil) ─────
// Ordre chronologique ASC : le front construit le cumul directement dans cet ordre.
$xp_history = [];
$stmt = mysqli_prepare($c, 'SELECT delta, source, label, created_at FROM xp_log WHERE user_id = ? ORDER BY created_at ASC LIMIT 200');
$stmt->bind_param('i', $uid);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $xp_history[] = [
        'delta'      => (int)$row['delta'],
        'source'     => $row['source'],
        'label'      => $row['label'],
        'created_at' => $row['created_at'],
    ];
}

// Les records/parties de jeux vivent dans db-games (games-api) : le front les
// récupère via /api/jeux/score.php?action=profile et complète l'affichage +
// les 2 badges jeux. profile.php ne lit donc plus la table scores.

// ── Badges côté serveur (cours + niveau uniquement) ────────────────────────
$niveau    = (int)$u['niveau'];
$nb_done   = count($completed);
$all_cours = $total_cours > 0 && $nb_done >= $total_cours;

$badges = [
    ['emoji' => '🌱', 'label' => 'Première pousse', 'desc' => 'Valider un premier cours', 'unlocked' => $nb_done >= 1],
    ['emoji' => '🎓', 'label' => 'Expert compost',  'desc' => 'Terminer tous les cours',   'unlocked' => $all_cours],
    // Les 2 badges jeux (Joueur, Touche-à-tout) sont injectés par le front (données db-games).
    ['emoji' => '⭐', 'label' => 'Niveau 5',         'desc' => 'Atteindre le niveau 5',     'unlocked' => $niveau >= 5],
    ['emoji' => '🔥', 'label' => 'Niveau 10',        'desc' => 'Atteindre le niveau 10',    'unlocked' => $niveau >= 10],
];

$rank_row = mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM users WHERE isAdmin = 0 AND xp > ' . (int)$u['xp']));
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
    'badges'      => $badges,
    'xp_history'  => $xp_history,
], JSON_UNESCAPED_UNICODE);
