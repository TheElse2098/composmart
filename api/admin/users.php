<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// ── Garde admin ────────────────────────────────────────────────────────────
$me = (int)($_SESSION['user_id'] ?? 0);
$is_admin = false;
if ($me > 0) {
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $me);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $is_admin = $row && (int)$row['isAdmin'] === 1;
}
if (!$is_admin) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé aux administrateurs.']);
    exit;
}

$action  = $_POST['action']  ?? '';
$user_id = (int)($_POST['user_id'] ?? 0);

if ($user_id <= 0) { echo json_encode(['error' => 'Utilisateur invalide.']); exit; }

// Cible
$stmt = mysqli_prepare($c, 'SELECT id, username, isAdmin FROM users WHERE id = ?');
$stmt->bind_param('i', $user_id);
$stmt->execute();
$target = $stmt->get_result()->fetch_assoc();
if (!$target) { echo json_encode(['error' => 'Utilisateur introuvable.']); exit; }

$target_is_admin = (int)$target['isAdmin'] === 1;
$nb_admins = (int) (mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM users WHERE isAdmin = 1'))[0] ?? 0);

// ── PROMOUVOIR / RÉTROGRADER ───────────────────────────────────────────────
if ($action === 'set_admin') {
    $value = (int)($_POST['value'] ?? -1);
    if ($value !== 0 && $value !== 1) { echo json_encode(['error' => 'Valeur invalide.']); exit; }

    // Garde-fous : ne pas se rétrograder soi-même, ne pas retirer le dernier admin
    if ($value === 0) {
        if ($user_id === $me) { echo json_encode(['error' => 'Tu ne peux pas te retirer toi-même les droits admin.']); exit; }
        if ($target_is_admin && $nb_admins <= 1) { echo json_encode(['error' => 'Impossible : il doit rester au moins un administrateur.']); exit; }
    }

    $stmt = mysqli_prepare($c, 'UPDATE users SET isAdmin = ? WHERE id = ?');
    $stmt->bind_param('ii', $value, $user_id);
    $stmt->execute();

    audit_log($c, $value === 1 ? 'user_promu' : 'user_retrograde', 'id=' . $user_id, [
        'target_type' => 'user',
        'target_id'   => $user_id,
        'snapshot'    => ['username' => $target['username'], 'admin' => (bool)$value],
    ]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER ──────────────────────────────────────────────────────────────
if ($action === 'delete') {
    if ($user_id === $me) { echo json_encode(['error' => 'Tu ne peux pas supprimer ton propre compte ici.']); exit; }
    if ($target_is_admin && $nb_admins <= 1) { echo json_encode(['error' => 'Impossible : il doit rester au moins un administrateur.']); exit; }

    // user_progress / scores ont ON DELETE CASCADE ; signalements.user_id → SET NULL
    $stmt = mysqli_prepare($c, 'DELETE FROM users WHERE id = ?');
    $stmt->bind_param('i', $user_id);
    $stmt->execute();

    audit_log($c, 'user_supprime', 'id=' . $user_id, [
        'target_type' => 'user',
        'target_id'   => $user_id,
        'snapshot'    => ['username' => $target['username'], 'etait_admin' => $target_is_admin],
    ]);
    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
