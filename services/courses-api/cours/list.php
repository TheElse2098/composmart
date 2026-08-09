<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
mysqli_report(MYSQLI_REPORT_OFF);

$host = getenv('DB_HOST') ?: 'db';
$user = getenv('DB_USER') ?: 'composmart';
$pass = getenv('DB_PASSWORD') ?: '';
$name = getenv('DB_NAME') ?: 'Composmart';

$c = mysqli_connect($host, $user, $pass, $name);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

$user_id = isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : 0;

// Cours complétés par l'utilisateur
$completed = [];
$user_data = null;
if ($user_id > 0) {
    $res = mysqli_query($c, "SELECT cours_id FROM user_progress WHERE user_id = $user_id");
    while ($row = mysqli_fetch_assoc($res)) {
        $completed[$row['cours_id']] = true;
    }
    $res2 = mysqli_query($c, "SELECT xp, niveau, username FROM users WHERE id = $user_id");
    $u = mysqli_fetch_assoc($res2);
    if ($u) {
        $user_data = [
            'xp'        => (int)$u['xp'],
            'niveau'    => (int)$u['niveau'],
            'username'  => $u['username'],
            'completed' => count($completed),
        ];
    }
}

// Un admin voit ses brouillons dans le catalogue (signalés par `statut`), pour
// pouvoir relire un cours en cours d'écriture dans les conditions du lecteur.
$est_admin = false;
if ($user_id > 0) {
    $r = mysqli_query($c, "SELECT isAdmin FROM users WHERE id = $user_id");
    $row = $r ? mysqli_fetch_assoc($r) : null;
    $est_admin = $row && (int)$row['isAdmin'] === 1;
}
$filtre_statut = $est_admin ? '' : " WHERE statut = 'publie'";

// Thèmes
$themes = [];
$res = mysqli_query($c, 'SELECT * FROM themes ORDER BY ordre, id');
while ($row = mysqli_fetch_assoc($res)) {
    $themes[$row['id']] = array_merge($row, ['cours' => []]);
}

// Cours — pas de SELECT *, la table porte désormais des colonnes de contenu
// dans cours_contenu qu'il serait inutile de joindre ici.
$res = mysqli_query($c,
    'SELECT id, slug, theme_id, titre, description, emoji, niveau, xp_reward,
            has_text, has_video, has_podcast, nb_questions, statut, ordre
     FROM cours' . $filtre_statut . ' ORDER BY theme_id, ordre, id');
while ($row = mysqli_fetch_assoc($res)) {
    $tid = $row['theme_id'];
    if (isset($themes[$tid])) {
        $row['completed'] = isset($completed[$row['slug']]);
        $themes[$tid]['cours'][] = $row;
    }
}

mysqli_close($c);
echo json_encode([
    'themes' => array_values($themes),
    'user'   => $user_data,
], JSON_UNESCAPED_UNICODE);
