<?php
// Rejoindre un événement par code/QR — endpoint public, aucune session requise.
// Si l'appelant a une session Composmart active (cookie partagé via Redis avec
// auth-api), user_id est lié à titre informatif seulement : ce service ne doit
// jamais bloquer un participant B2B sans compte.
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-evenements',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

/** Normalise un code saisi : majuscules, espaces retirés. */
function normaliser_code($code) {
    return strtoupper(preg_replace('/\s+/', '', (string)$code));
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── VÉRIFIER UN CODE (avant inscription, pour afficher titre/lieu) ─────────
if ($action === 'verifier_code') {
    if (!rate_limit('evt_verifier', 30, 60)) { echo json_encode(['error' => 'Trop de tentatives, réessaie dans une minute.']); exit; }

    $code = normaliser_code($_GET['code'] ?? $_POST['code'] ?? '');
    if ($code === '') { echo json_encode(['error' => 'Code manquant.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id, titre, lieu, date_debut, statut FROM evenements WHERE code = ?');
    $stmt->bind_param('s', $code);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();

    if (!$evt || $evt['statut'] === 'brouillon' || $evt['statut'] === 'archive') {
        echo json_encode(['error' => 'Code invalide.']);
        exit;
    }

    echo json_encode([
        'ok'      => true,
        'titre'   => $evt['titre'],
        'lieu'    => $evt['lieu'],
        'date'    => $evt['date_debut'],
        'ouvert'  => $evt['statut'] === 'ouvert',
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── REJOINDRE (inscription effective) ───────────────────────────────────────
if ($action === 'rejoindre') {
    if (!rate_limit('evt_rejoindre', 10, 60)) { echo json_encode(['error' => 'Trop de tentatives, réessaie dans une minute.']); exit; }

    $code       = normaliser_code($_POST['code'] ?? '');
    $nom_affiche = trim($_POST['nom_affiche'] ?? '');

    if ($code === '') { echo json_encode(['error' => 'Code manquant.']); exit; }
    if ($nom_affiche === '' || mb_strlen($nom_affiche) > 100) {
        echo json_encode(['error' => 'Merci de renseigner ton nom (100 caractères max).']);
        exit;
    }

    $stmt = mysqli_prepare($conn, 'SELECT id, titre, statut FROM evenements WHERE code = ?');
    $stmt->bind_param('s', $code);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();

    if (!$evt || $evt['statut'] !== 'ouvert') {
        echo json_encode(['error' => "Cet événement n'accepte pas d'inscription pour le moment."]);
        exit;
    }

    $user_id = !empty($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;

    $stmt = mysqli_prepare($conn, 'INSERT INTO participants (evenement_id, nom_affiche, user_id) VALUES (?, ?, ?)');
    $stmt->bind_param('isi', $evt['id'], $nom_affiche, $user_id);
    $stmt->execute();

    echo json_encode(['ok' => true, 'titre' => $evt['titre']], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
