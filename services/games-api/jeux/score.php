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
$JEUX_MAX = ['mot-mystere' => 80, 'compost-ou-pas' => 12, 'temps-decompo' => 30, 'tri-eclair' => 15];
$JEUX_VALIDES = array_keys($JEUX_MAX);

// Réserve d'XP de chaque jeu. L'XP acquise = réserve × (record ÷ score max),
// créditée par paliers : seule l'amélioration du record rapporte la différence
// (80 % du max = 80 % de la réserve ; passer à 90 % ne rapporte que les 10 %
// manquants). Bornée par la réserve : impossible de farmer à l'infini.
$JEUX_XP = ['mot-mystere' => 50, 'compost-ou-pas' => 50, 'temps-decompo' => 50, 'tri-eclair' => 50];

// XP cumulée pour un record donné (arrondi au plus proche).
function xp_pour_best($jeu_id, $best) {
    global $JEUX_XP, $JEUX_MAX;
    return (int)round($JEUX_XP[$jeu_id] * max(0, $best) / $JEUX_MAX[$jeu_id]);
}

// Crédite l'XP côté db-core via l'endpoint interne d'auth-api (même pattern
// que l'audit : secret partagé, best-effort). Renvoie la réponse ou null.
function crediter_xp($uid, $delta, $jeu_id) {
    $url = getenv('XP_REMOTE_URL') ?: '';
    if ($url === '' || $delta <= 0) return null;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['uid' => $uid, 'delta' => $delta, 'source' => 'jeu:' . $jeu_id]),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Audit-Secret: ' . (getenv('AUDIT_SECRET') ?: '')],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
    ]);
    $raw = curl_exec($ch);
    curl_close($ch);
    $rep = $raw !== false ? json_decode($raw, true) : null;
    return (is_array($rep) && !empty($rep['ok'])) ? $rep : null;
}

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
    // username/is_admin dénormalisés (users vit dans db-core, pas joignable depuis games-api)
    $uname    = $_SESSION['username'] ?? '';
    $is_admin = is_admin_session() ? 1 : 0;

    // Record AVANT ce score : sert de base au palier d'XP déjà acquis.
    $stmt = mysqli_prepare($conn, 'SELECT MAX(score) AS best FROM scores WHERE user_id = ? AND jeu_id = ?');
    $stmt->bind_param('is', $uid, $jeu_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $ancien_best = ($row && $row['best'] !== null) ? (int)$row['best'] : 0;

    $stmt = mysqli_prepare($conn, 'INSERT INTO scores (user_id, username, is_admin, jeu_id, score) VALUES (?, ?, ?, ?, ?)');
    $stmt->bind_param('isisi', $uid, $uname, $is_admin, $jeu_id, $score);
    $stmt->execute();

    $best = max($ancien_best, $score);

    // XP : seule l'amélioration du record rapporte la différence de palier.
    $xp_gagne = 0; $xp_total = null; $niveau = null;
    $delta = xp_pour_best($jeu_id, $best) - xp_pour_best($jeu_id, $ancien_best);
    if ($delta > 0) {
        $rep = crediter_xp($uid, $delta, $jeu_id);
        if ($rep) {
            $xp_gagne = $delta;
            $xp_total = (int)$rep['xp'];
            $niveau   = (int)$rep['niveau'];
        }
    }

    echo json_encode([
        'ok'       => true,
        'best'     => $best,
        'record'   => $best === $score && $score > $ancien_best,
        'xp_gagne' => $xp_gagne,
        'xp_total' => $xp_total,
        'niveau'   => $niveau,
    ]);
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
    // is_admin exclu du top public (HAVING : un seul score marqué admin suffit à exclure le joueur).
    $stmt = mysqli_prepare($conn,
        'SELECT s.username, MAX(s.score) AS best
         FROM scores s
         WHERE s.jeu_id = ?
         GROUP BY s.user_id, s.username
         HAVING MAX(s.is_admin) = 0
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
        'tri-eclair'     => ['nom' => 'Tri éclair',        'emoji' => '⚡', 'max' => 15],
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
