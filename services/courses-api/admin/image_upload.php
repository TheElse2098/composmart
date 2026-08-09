<?php
/**
 * Téléversement d'une image depuis l'éditeur de cours.
 *
 * Stockage en base (cours_images.donnees) et non sur un volume : courses-api
 * monte jusqu'à 3 réplicas et le stockage par défaut de k3s est ReadWriteOnce,
 * donc trois pods écrivant chacun sur son disque local divergeraient. Bénéfice
 * annexe : les images sont incluses dans le mysqldump de sauvegarde.
 *
 * Réponse : { ok, id, url } — l'éditeur insère « ![alt](url) » dans le markdown.
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
if (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    // UPLOAD_ERR_INI_SIZE arrive quand le fichier dépasse upload_max_filesize
    // de PHP (2 Mo par défaut) : le message générique serait incompréhensible.
    $code = $_FILES['image']['error'] ?? -1;
    $msg = in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
        ? 'Image trop lourde (2 Mo maximum).'
        : 'Aucun fichier reçu.';
    echo json_encode(['error' => $msg]); exit;
}

$f = $_FILES['image'];
if ($f['size'] > 2 * 1024 * 1024) {
    echo json_encode(['error' => 'Image trop lourde (2 Mo maximum).']); exit;
}

// Le type est déduit du contenu réel, jamais de $_FILES['type'] qui est envoyé
// par le navigateur et donc contrôlé par le client. Liste blanche stricte :
// un SVG serait accepté par getimagesize sur certains montages et peut porter
// du script — il est écarté volontairement.
$info = @getimagesize($f['tmp_name']);
$MIMES = [
    IMAGETYPE_JPEG => 'image/jpeg',
    IMAGETYPE_PNG  => 'image/png',
    IMAGETYPE_GIF  => 'image/gif',
    IMAGETYPE_WEBP => 'image/webp',
];
if (!$info || !isset($MIMES[$info[2]])) {
    echo json_encode(['error' => 'Format non accepté (JPEG, PNG, GIF ou WebP).']); exit;
}
$mime = $MIMES[$info[2]];

$donnees = file_get_contents($f['tmp_name']);
if ($donnees === false) { echo json_encode(['error' => 'Lecture du fichier impossible.']); exit; }

$nom = mb_substr(preg_replace('/[^\w\-. ]/u', '', (string)$f['name']), 0, 200);
if ($nom === '') $nom = 'image';
$taille   = strlen($donnees);
// cours_id peut être NULL : on téléverse souvent avant la première sauvegarde
// d'un nouveau cours, qui n'a donc pas encore d'identifiant. cours_save.php
// rattache ensuite les images orphelines récentes.
$cours_id = (int)($_POST['cours_id'] ?? 0);
$cours_id = $cours_id > 0 ? $cours_id : null;

$stmt = mysqli_prepare($c,
    'INSERT INTO cours_images (cours_id, nom, mime, taille, donnees) VALUES (?, ?, ?, ?, ?)');
$null = null;
$stmt->bind_param('issib', $cours_id, $nom, $mime, $taille, $null);
$stmt->send_long_data(4, $donnees);
if (!$stmt->execute()) {
    echo json_encode(['error' => "L'enregistrement de l'image a échoué."]); exit;
}

$id = (int)mysqli_insert_id($c);
audit_log($c, 'image_televersee', "$nom ($mime, " . round($taille / 1024) . " Ko)", [
    'target_type' => 'image', 'target_id' => $id,
]);

echo json_encode([
    'ok'  => true,
    'id'  => $id,
    'url' => '/api/cours/image.php?id=' . $id,
    'nom' => $nom,
], JSON_UNESCAPED_UNICODE);
