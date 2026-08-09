<?php
/**
 * Suppression d'un cours.
 *
 * La progression des lecteurs (user_progress) référence le slug en clair, sans
 * clé étrangère : elle ne serait donc PAS nettoyée par la cascade. On la
 * supprime explicitement, sinon un cours recréé plus tard avec le même slug
 * hériterait des complétions de l'ancien.
 * L'XP déjà gagnée n'est pas reprise : elle a été méritée, et la retirer
 * ferait baisser le niveau de comptes qui n'y sont pour rien.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}

$d  = corps_json();
$id = (int)($d['id'] ?? 0);

$stmt = mysqli_prepare($c, 'SELECT slug, titre FROM cours WHERE id = ?');
$stmt->bind_param('i', $id);
$stmt->execute();
$cours = $stmt->get_result()->fetch_assoc();
if (!$cours) { http_response_code(404); echo json_encode(['error' => 'Cours introuvable.']); exit; }

// Confirmation par le slug, comme la suppression de compte : une action
// irréversible ne doit pas tenir à un seul clic.
if (trim((string)($d['confirmation'] ?? '')) !== $cours['slug']) {
    echo json_encode(['error' => "Saisis l'adresse « " . $cours['slug'] . " » pour confirmer."]);
    exit;
}

$stmt = mysqli_prepare($c, 'DELETE FROM user_progress WHERE cours_id = ?');
$stmt->bind_param('s', $cours['slug']);
$stmt->execute();
$progressions = mysqli_stmt_affected_rows($stmt);

// cours_contenu et cours_images partent en cascade ; cours_versions est
// volontairement conservée (historique consultable après coup).
$stmt = mysqli_prepare($c, 'DELETE FROM cours WHERE id = ?');
$stmt->bind_param('i', $id);
if (!$stmt->execute()) { echo json_encode(['error' => 'La suppression a échoué.']); exit; }

audit_log($c, 'cours_supprime', $cours['titre'], [
    'target_type' => 'cours', 'target_id' => $id,
    'snapshot'    => ['slug' => $cours['slug'], 'progressions_effacees' => $progressions],
]);

echo json_encode(['ok' => true, 'progressions_effacees' => $progressions]);
