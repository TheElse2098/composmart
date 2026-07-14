<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

// Registre des jeux : slug => score maximum atteignable.
// Ajouter une entrée ici quand on crée un nouveau jeu.
$JEUX_MAX = ['mot-mystere' => 80, 'compost-ou-pas' => 12, 'temps-decompo' => 30];
$JEUX_VALIDES = array_keys($JEUX_MAX);

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── ENREGISTRER UN SCORE (connecté uniquement) ─────────────────────────────
if ($action === 'save') {
    if (empty($_SESSION['user_id'])) { echo json_encode(['error' => 'not_logged_in']); exit; }
    $jeu_id = trim($_POST['jeu_id'] ?? '');
    $score  = intval($_POST['score'] ?? -1);
    if (!in_array($jeu_id, $JEUX_VALIDES, true) || $score < 0 || $score > $JEUX_MAX[$jeu_id]) {
        echo json_encode(['error' => 'Données invalides']);
        exit;
    }
    $uid = (int)$_SESSION['user_id'];
    // username dénormalisé (users vit dans db-core, pas joignable depuis games-api)
    $uname = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($conn, 'INSERT INTO scores (user_id, username, jeu_id, score) VALUES (?, ?, ?, ?)');
    $stmt->bind_param('issi', $uid, $uname, $jeu_id, $score);
    $stmt->execute();

    $stmt = mysqli_prepare($conn, 'SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND jeu_id = ?');
    $stmt->bind_param('is', $uid, $jeu_id);
    $stmt->execute();
    $best = (int)($stmt->get_result()->fetch_assoc()['best'] ?? 0);

    echo json_encode(['ok' => true, 'best' => $best, 'record' => $best === $score]);
    exit;
}

// ── INFOS D'UN JEU : record perso + top 5 global ───────────────────────────
if ($action === 'infos') {
    $jeu_id = trim($_GET['jeu_id'] ?? $_POST['jeu_id'] ?? '');
    if (!in_array($jeu_id, $JEUX_VALIDES, true)) { echo json_encode(['error' => 'Jeu inconnu']); exit; }

    $best = null;
    if (!empty($_SESSION['user_id'])) {
        $uid = (int)$_SESSION['user_id'];
        $stmt = mysqli_prepare($conn, 'SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND jeu_id = ?');
        $stmt->bind_param('is', $uid, $jeu_id);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        if ($row && $row['best'] !== null) $best = (int)$row['best'];
    }

    // username dénormalisé : plus de JOIN users (table dans db-core).
    $stmt = mysqli_prepare($conn,
        'SELECT s.username, MAX(s.score) AS best
         FROM scores s
         WHERE s.jeu_id = ?
         GROUP BY s.user_id, s.username
         ORDER BY best DESC, MIN(s.played_at) ASC
         LIMIT 5');
    $stmt->bind_param('s', $jeu_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $top = [];
    while ($row = $res->fetch_assoc()) {
        $top[] = ['username' => $row['username'], 'score' => (int)$row['best']];
    }

    echo json_encode([
        'logged_in' => !empty($_SESSION['user_id']),
        'best'      => $best,
        'top'       => $top,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── RECORDS PERSO POUR TOUS LES JEUX (page hub) ────────────────────────────
if ($action === 'bests') {
    if (empty($_SESSION['user_id'])) { echo json_encode(['logged_in' => false, 'bests' => new stdClass()]); exit; }
    $uid = (int)$_SESSION['user_id'];
    $stmt = mysqli_prepare($conn, 'SELECT jeu_id, MAX(score) AS best FROM scores WHERE user_id = ? GROUP BY jeu_id');
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $res = $stmt->get_result();
    $bests = [];
    while ($row = $res->fetch_assoc()) {
        $bests[$row['jeu_id']] = (int)$row['best'];
    }
    echo json_encode(['logged_in' => true, 'bests' => (object)$bests]);
    exit;
}

// ── PROFIL JEUX : records + parties par jeu (page compte) ──────────────────
// Sert à profile.php (auth-api) qui ne peut plus lire la table scores (db-games).
// Renvoie aussi la méta (nom/emoji/max) pour que le front affiche sans dépendre d'auth.
if ($action === 'profile') {
    $meta = [
        'mot-mystere'    => ['nom' => 'Mot mystère',       'emoji' => '🔤', 'max' => 80],
        'compost-ou-pas' => ['nom' => 'Compost ou pas ?',  'emoji' => '♻️', 'max' => 12],
        'temps-decompo'  => ['nom' => 'Combien de temps ?', 'emoji' => '⏳', 'max' => 30],
    ];
    $joues = [];
    $parties_total = 0;
    if (!empty($_SESSION['user_id'])) {
        $uid = (int)$_SESSION['user_id'];
        $stmt = mysqli_prepare($conn, 'SELECT jeu_id, MAX(score) AS best, COUNT(*) AS parties FROM scores WHERE user_id = ? GROUP BY jeu_id');
        $stmt->bind_param('i', $uid);
        $stmt->execute();
        $res = $stmt->get_result();
        while ($row = $res->fetch_assoc()) {
            $joues[$row['jeu_id']] = ['best' => (int)$row['best'], 'parties' => (int)$row['parties']];
            $parties_total += (int)$row['parties'];
        }
    }
    $records = [];
    foreach ($meta as $slug => $info) {
        $records[] = [
            'slug'    => $slug,
            'nom'     => $info['nom'],
            'emoji'   => $info['emoji'],
            'max'     => $info['max'],
            'best'    => isset($joues[$slug]) ? $joues[$slug]['best'] : null,
            'parties' => isset($joues[$slug]) ? $joues[$slug]['parties'] : 0,
        ];
    }
    echo json_encode(['records' => $records, 'parties' => $parties_total], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
