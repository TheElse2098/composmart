<?php
/**
 * Banque d'anecdotes — réservoir partagé par tous les parcours.
 * Réservé aux administrateurs.
 *
 * Une slide « anecdote » peut pointer une entrée d'ici, ou en tirer une au
 * hasard (résolution dans _slides.php : resoudre_anecdote()). Supprimer une
 * anecdote ne casse donc rien : une slide qui la visait retombe sur un texte
 * de repli plutôt que d'interrompre l'atelier.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin.php';

$conn = evt_admin_connexion_ou_403();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── LISTE (avec les thèmes existants, pour les filtres) ────────────────────
if ($action === 'liste') {
    $theme = trim((string)($_GET['theme'] ?? ''));
    if ($theme !== '') {
        $stmt = mysqli_prepare($conn, 'SELECT id, texte, emoji, theme FROM anecdotes WHERE theme = ? ORDER BY id DESC');
        $stmt->bind_param('s', $theme);
    } else {
        $stmt = mysqli_prepare($conn, 'SELECT id, texte, emoji, theme FROM anecdotes ORDER BY id DESC');
    }
    $stmt->execute();
    $res = $stmt->get_result();
    $anecdotes = [];
    while ($row = $res->fetch_assoc()) {
        $row['id'] = (int)$row['id'];
        $anecdotes[] = $row;
    }

    $res = mysqli_query($conn, "SELECT DISTINCT theme FROM anecdotes WHERE theme IS NOT NULL AND theme != '' ORDER BY theme");
    $themes = [];
    while ($row = $res->fetch_assoc()) $themes[] = $row['theme'];

    echo json_encode(['anecdotes' => $anecdotes, 'themes' => $themes], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── CRÉER ───────────────────────────────────────────────────────────────────
if ($action === 'creer') {
    $texte = trim($_POST['texte'] ?? '');
    if ($texte === '' || mb_strlen($texte) > 1000) { echo json_encode(['error' => 'Texte vide ou trop long (1000 caractères max).']); exit; }
    $emoji  = mb_substr(trim($_POST['emoji'] ?? ''), 0, 8);
    $theme  = mb_substr(trim($_POST['theme'] ?? ''), 0, 60);
    $auteur = $_SESSION['username'] ?? '';

    $stmt = mysqli_prepare($conn, 'INSERT INTO anecdotes (texte, emoji, theme, cree_par) VALUES (?, ?, ?, ?)');
    $stmt->bind_param('ssss', $texte, $emoji, $theme, $auteur);
    $stmt->execute();

    echo json_encode(['ok' => true, 'id' => $stmt->insert_id]);
    exit;
}

// ── MODIFIER ────────────────────────────────────────────────────────────────
if ($action === 'modifier') {
    $id    = (int)($_POST['id'] ?? 0);
    $texte = trim($_POST['texte'] ?? '');
    if ($id <= 0 || $texte === '' || mb_strlen($texte) > 1000) { echo json_encode(['error' => 'Données invalides.']); exit; }
    $emoji = mb_substr(trim($_POST['emoji'] ?? ''), 0, 8);
    $theme = mb_substr(trim($_POST['theme'] ?? ''), 0, 60);

    $stmt = mysqli_prepare($conn, 'UPDATE anecdotes SET texte = ?, emoji = ?, theme = ? WHERE id = ?');
    $stmt->bind_param('sssi', $texte, $emoji, $theme, $id);
    $stmt->execute();

    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER ───────────────────────────────────────────────────────────────
if ($action === 'supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Anecdote invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'DELETE FROM anecdotes WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Anecdote introuvable.']); exit; }

    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
