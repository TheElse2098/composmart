<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

function is_admin($conn) {
    if (empty($_SESSION['user_id'])) return false;
    $stmt = mysqli_prepare($conn, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    return $row && (int)$row['isAdmin'] === 1;
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── CRÉER UN SIGNALEMENT (tout le monde) ───────────────────────────────────
if ($action === 'creer') {
    $compost_id  = intval($_POST['compost_id'] ?? 0);
    $motif       = $_POST['motif'] ?? '';
    $commentaire = trim($_POST['commentaire'] ?? '');

    $motifs_valides = ['position', 'type_acces', 'regles', 'inexistant', 'autre'];
    if (!$compost_id || !in_array($motif, $motifs_valides, true)) {
        echo json_encode(['error' => 'Données invalides']);
        exit;
    }
    if (mb_strlen($commentaire) > 500) {
        echo json_encode(['error' => 'Commentaire trop long (500 caractères max)']);
        exit;
    }

    // Le compost doit exister
    $stmt = mysqli_prepare($conn, 'SELECT id FROM composts WHERE id = ?');
    $stmt->bind_param('i', $compost_id);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) {
        echo json_encode(['error' => 'Compost introuvable']);
        exit;
    }

    // Anti-spam : un seul signalement par compost et par session
    if (in_array($compost_id, $_SESSION['signalements_envoyes'] ?? [], true)) {
        echo json_encode(['error' => 'Tu as déjà signalé ce compost, merci !']);
        exit;
    }

    $user_id = empty($_SESSION['user_id']) ? null : (int)$_SESSION['user_id'];
    $stmt = mysqli_prepare($conn, 'INSERT INTO signalements (compost_id, user_id, motif, commentaire) VALUES (?, ?, ?, ?)');
    $stmt->bind_param('iiss', $compost_id, $user_id, $motif, $commentaire);
    if (!$stmt->execute()) {
        echo json_encode(['error' => 'Erreur lors de l\'enregistrement']);
        exit;
    }

    if (!isset($_SESSION['signalements_envoyes'])) $_SESSION['signalements_envoyes'] = [];
    $_SESSION['signalements_envoyes'][] = $compost_id;

    echo json_encode(['ok' => true]);
    exit;
}

// ── LISTER LES SIGNALEMENTS OUVERTS (admin uniquement) ─────────────────────
if ($action === 'liste') {
    if (!is_admin($conn)) {
        http_response_code(403);
        echo json_encode(['error' => 'Action réservée aux administrateurs.']);
        exit;
    }
    $sql = 'SELECT s.id, s.compost_id, s.motif, s.commentaire, s.created_at,
                   c.latitude, c.longitude, c.type,
                   u.username
            FROM signalements s
            JOIN composts c ON c.id = s.compost_id
            LEFT JOIN users u ON u.id = s.user_id
            WHERE s.statut = \'ouvert\'
            ORDER BY s.created_at DESC';
    $res = mysqli_query($conn, $sql);
    $liste = [];
    while ($row = $res->fetch_assoc()) {
        $liste[] = [
            'id'          => (int)$row['id'],
            'compost_id'  => (int)$row['compost_id'],
            'motif'       => $row['motif'],
            'commentaire' => $row['commentaire'],
            'date'        => $row['created_at'],
            'lat'         => (double)$row['latitude'],
            'lon'         => (double)$row['longitude'],
            'type'        => $row['type'],
            'par'         => $row['username'] ?: 'Anonyme',
        ];
    }
    echo json_encode(['signalements' => $liste], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── TRAITER UN SIGNALEMENT (admin uniquement) ──────────────────────────────
if ($action === 'traiter') {
    if (!is_admin($conn)) {
        http_response_code(403);
        echo json_encode(['error' => 'Action réservée aux administrateurs.']);
        exit;
    }
    $id     = intval($_POST['id'] ?? 0);
    $statut = $_POST['statut'] ?? '';
    if (!$id || !in_array($statut, ['resolu', 'rejete'], true)) {
        echo json_encode(['error' => 'Données invalides']);
        exit;
    }
    $stmt = mysqli_prepare($conn, 'UPDATE signalements SET statut = ? WHERE id = ?');
    $stmt->bind_param('si', $statut, $id);
    $stmt->execute();
    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
