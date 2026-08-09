<?php
/**
 * Téléversement d'un média depuis l'éditeur de cours : illustration insérée
 * dans le texte, ou fichier audio d'un podcast.
 *
 * Stockage en base (cours_medias.donnees) et non sur un volume : courses-api
 * monte jusqu'à 3 réplicas et le stockage par défaut de k3s est ReadWriteOnce,
 * donc trois pods écrivant chacun sur son disque local divergeraient. Bénéfice
 * annexe : les médias sont inclus dans le mysqldump de sauvegarde.
 *
 * Réponse : { ok, id, url, type } — l'éditeur insère « ![alt](url) » pour une
 * image, ou range l'URL dans la fiche du podcast pour un audio.
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

// Un audio pèse bien plus qu'une illustration : les deux plafonds diffèrent.
$type = ($_POST['type'] ?? 'image') === 'audio' ? 'audio' : 'image';
$MAX  = $type === 'audio' ? 20 * 1024 * 1024 : 2 * 1024 * 1024;
$max_lisible = $type === 'audio' ? '20 Mo' : '2 Mo';

if (empty($_FILES['media']) || $_FILES['media']['error'] !== UPLOAD_ERR_OK) {
    // UPLOAD_ERR_INI_SIZE arrive quand le fichier dépasse upload_max_filesize
    // de PHP : le message générique serait incompréhensible.
    $code = $_FILES['media']['error'] ?? -1;
    echo json_encode(['error' => in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
        ? "Fichier trop lourd (maximum $max_lisible)."
        : 'Aucun fichier reçu.']);
    exit;
}

$f = $_FILES['media'];
if ($f['size'] > $MAX) {
    echo json_encode(['error' => "Fichier trop lourd (maximum $max_lisible)."]); exit;
}

if ($type === 'image') {
    // Le type est déduit du contenu réel, jamais de $_FILES['type'] qui est
    // envoyé par le navigateur et donc contrôlé par le client. Le SVG est
    // écarté volontairement : il peut porter du script.
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
} else {
    // Pas d'équivalent de getimagesize pour l'audio : on se fie à l'extension,
    // mais le fichier est servi avec X-Content-Type-Options: nosniff et n'est
    // jamais interprété — le risque se limite à un fichier illisible.
    $EXT = ['mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'mp4' => 'audio/mp4',
            'wav' => 'audio/wav',  'ogg' => 'audio/ogg', 'oga' => 'audio/ogg'];
    $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
    if (!isset($EXT[$ext])) {
        echo json_encode(['error' => 'Format non accepté (MP3, M4A, MP4, WAV ou OGG).']); exit;
    }
    $mime = $EXT[$ext];
}

$donnees = file_get_contents($f['tmp_name']);
if ($donnees === false) { echo json_encode(['error' => 'Lecture du fichier impossible.']); exit; }

$nom = mb_substr(preg_replace('/[^\w\-. ]/u', '', (string)$f['name']), 0, 200);
if ($nom === '') $nom = 'media';
$taille = strlen($donnees);
// cours_id peut être NULL : on téléverse souvent avant la première sauvegarde
// d'un nouveau cours, qui n'a donc pas encore d'identifiant. cours_save.php
// rattache ensuite les médias orphelins récents.
$cours_id = (int)($_POST['cours_id'] ?? 0);
$cours_id = $cours_id > 0 ? $cours_id : null;

$stmt = mysqli_prepare($c,
    'INSERT INTO cours_medias (cours_id, type, nom, mime, taille, donnees) VALUES (?, ?, ?, ?, ?, ?)');
if (!$stmt) { echo json_encode(['error' => "L'enregistrement a échoué."]); exit; }
$null = null;
$stmt->bind_param('isssib', $cours_id, $type, $nom, $mime, $taille, $null);
// send_long_data : un audio de plusieurs mégaoctets dépasse max_allowed_packet
// s'il est passé d'un bloc.
$stmt->send_long_data(5, $donnees);
if (!$stmt->execute()) {
    echo json_encode(['error' => "L'enregistrement du fichier a échoué (peut-être trop volumineux pour la base)."]);
    exit;
}

$id = (int)mysqli_insert_id($c);
audit_log($c, 'media_televerse', "$nom ($mime, " . round($taille / 1024) . " Ko)", [
    'target_type' => 'media', 'target_id' => $id,
]);

echo json_encode([
    'ok'   => true,
    'id'   => $id,
    'type' => $type,
    'url'  => '/api/cours/media.php?id=' . $id,
    'nom'  => $nom,
], JSON_UNESCAPED_UNICODE);
