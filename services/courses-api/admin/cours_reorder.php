<?php
/**
 * Persiste le résultat d'un glisser-déposer sur /admin/themes.
 *
 * Le client envoie l'organisation complète, thème par thème, plutôt qu'un
 * « déplace X après Y » : c'est ce qui rend l'opération idempotente et immunise
 * contre les états intermédiaires (deux cours au même rang, trous dans la
 * numérotation) qu'une suite de déplacements relatifs finit toujours par créer.
 *
 * Corps : { "themes": [ {"id": 3, "cours": [12, 7, 9]}, ... ] }
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

$d = corps_json();
$themes = $d['themes'] ?? null;
if (!is_array($themes)) { echo json_encode(['error' => 'Organisation manquante.']); exit; }

// Toutes les écritures dans une transaction : un rangement à moitié appliqué
// laisserait le catalogue dans un ordre incohérent.
mysqli_begin_transaction($c);

$stmt_cours  = mysqli_prepare($c, 'UPDATE cours  SET theme_id = ?, ordre = ? WHERE id = ?');
$stmt_theme  = mysqli_prepare($c, 'UPDATE themes SET ordre = ? WHERE id = ?');
if (!$stmt_cours || !$stmt_theme) {
    mysqli_rollback($c);
    http_response_code(500); echo json_encode(['error' => 'Requête impossible.']); exit;
}

$deplaces = 0;
foreach (array_values($themes) as $rang_theme => $t) {
    $theme_id = (int)($t['id'] ?? 0);
    if ($theme_id <= 0) continue;

    $stmt_theme->bind_param('ii', $rang_theme, $theme_id);
    if (!$stmt_theme->execute()) { mysqli_rollback($c); http_response_code(500); echo json_encode(['error' => 'Échec.']); exit; }

    foreach (array_values((array)($t['cours'] ?? [])) as $rang => $cours_id) {
        $cours_id = (int)$cours_id;
        if ($cours_id <= 0) continue;
        $stmt_cours->bind_param('iii', $theme_id, $rang, $cours_id);
        if (!$stmt_cours->execute()) { mysqli_rollback($c); http_response_code(500); echo json_encode(['error' => 'Échec.']); exit; }
        $deplaces++;
    }
}

mysqli_commit($c);
audit_log($c, 'cours_reorganises', "$deplaces cours replacés", ['target_type' => 'cours']);
echo json_encode(['ok' => true, 'cours' => $deplaces]);
