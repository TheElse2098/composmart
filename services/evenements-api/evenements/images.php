<?php
/**
 * Banque d'images — réservoir partagé, illustrant les slides du thème simpliste.
 * Réservé aux administrateurs. La LECTURE d'un fichier, elle, passe par
 * image.php, qui est public : un participant doit pouvoir afficher l'image de
 * sa slide sans être admin.
 *
 * Les fichiers vivent en blob dans db-evenements plutôt que sur un volume :
 * même raison que cours_medias dans db-core — le stockage k3s par défaut est
 * ReadWriteOnce et le service peut monter à plusieurs réplicas, qui
 * divergeraient chacun sur son disque local.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin.php';

$conn = evt_admin_connexion_ou_403();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

const IMG_TAGS_MAX  = 12;
// 8 Mo : de quoi accepter une photo sortie d'appareil sans la retoucher. Le
// Dockerfile monte les plafonds PHP au-dessus (12 Mo), sans quoi le fichier
// serait refusé avant même que ce script ne s'exécute — c'est le défaut de
// 2 Mo de php:8.3-apache qui bloquait tout, pas la limite ci-dessous.
const IMG_TAILLE_MAX = 8 * 1024 * 1024;

/** Formats acceptés → extension. Liste blanche : on ne se fie jamais au nom du
 *  fichier ni au Content-Type annoncé par le navigateur, tous deux falsifiables. */
function img_formats() {
    return [
        IMAGETYPE_PNG  => ['image/png',  'png'],
        IMAGETYPE_JPEG => ['image/jpeg', 'jpg'],
        IMAGETYPE_GIF  => ['image/gif',  'gif'],
        IMAGETYPE_WEBP => ['image/webp', 'webp'],
    ];
}

/** Découpe la saisie libre en tags normalisés. Même règle que les mots-clés
 *  d'anecdote : minuscules et espaces resserrés, sinon « Nature » et « nature »
 *  deviennent deux entrées distinctes dans les filtres. */
function img_tags_parser($brut) {
    $tags = [];
    foreach (preg_split('/[,;\n]+/u', (string)$brut) as $t) {
        $t = trim(preg_replace('/\s+/u', ' ', $t));
        if ($t === '') continue;
        $t = mb_strtolower(mb_substr($t, 0, 40));
        if (!in_array($t, $tags, true)) $tags[] = $t;
        if (count($tags) >= IMG_TAGS_MAX) break;
    }
    return $tags;
}

function img_tags_ecrire($conn, $image_id, array $tags) {
    $stmt = mysqli_prepare($conn, 'DELETE FROM image_tags WHERE image_id = ?');
    $stmt->bind_param('i', $image_id);
    $stmt->execute();
    if (!$tags) return;
    $stmt = mysqli_prepare($conn, 'INSERT INTO image_tags (image_id, tag) VALUES (?, ?)');
    foreach ($tags as $t) {
        $stmt->bind_param('is', $image_id, $t);
        $stmt->execute();
    }
}

/** Tags de plusieurs images d'un coup : une requête pour toute la liste. */
function img_tags_lire($conn, array $ids) {
    if (!$ids) return [];
    $ids = array_map('intval', $ids);
    $in = implode(',', array_fill(0, count($ids), '?'));
    $stmt = mysqli_prepare($conn, 'SELECT image_id, tag FROM image_tags WHERE image_id IN (' . $in . ') ORDER BY tag');
    $stmt->bind_param(str_repeat('i', count($ids)), ...$ids);
    $stmt->execute();
    $res = $stmt->get_result();
    $par_id = [];
    while ($row = $res->fetch_assoc()) $par_id[(int)$row['image_id']][] = $row['tag'];
    return $par_id;
}

// ── LISTE (métadonnées seules : jamais les blobs) ──────────────────────────
if ($action === 'liste') {
    $tag = mb_strtolower(trim((string)($_GET['tag'] ?? '')));

    $sql = 'SELECT id, nom, mime, taille, largeur, hauteur, created_at FROM images';
    if ($tag !== '') {
        $sql .= ' WHERE EXISTS (SELECT 1 FROM image_tags t WHERE t.image_id = images.id AND t.tag = ?)';
    }
    $sql .= ' ORDER BY id DESC';
    $stmt = mysqli_prepare($conn, $sql);
    if ($tag !== '') $stmt->bind_param('s', $tag);
    $stmt->execute();
    $res = $stmt->get_result();

    $images = [];
    $ids = [];
    while ($row = $res->fetch_assoc()) {
        $row['id']      = (int)$row['id'];
        $row['taille']  = (int)$row['taille'];
        $row['largeur'] = $row['largeur'] === null ? null : (int)$row['largeur'];
        $row['hauteur'] = $row['hauteur'] === null ? null : (int)$row['hauteur'];
        $row['url']     = '/api/evenements/image.php?id=' . $row['id'];
        $ids[] = $row['id'];
        $images[] = $row;
    }
    $par_id = img_tags_lire($conn, $ids);
    foreach ($images as &$i) { $i['tags'] = $par_id[$i['id']] ?? []; }
    unset($i);

    // Vocabulaire complet, indépendant du filtre courant : sinon filtrer sur un
    // tag ferait disparaître tous les autres de la barre.
    $res = mysqli_query($conn, 'SELECT tag, COUNT(*) AS n FROM image_tags GROUP BY tag ORDER BY tag');
    $tags = [];
    while ($row = $res->fetch_assoc()) $tags[] = ['tag' => $row['tag'], 'n' => (int)$row['n']];

    echo json_encode(['images' => $images, 'tags' => $tags], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── TAGS SEULS (pour le sélecteur des réglages d'un événement) ─────────────
if ($action === 'tags') {
    $res = mysqli_query($conn, 'SELECT tag, COUNT(*) AS n FROM image_tags GROUP BY tag ORDER BY tag');
    $tags = [];
    while ($row = $res->fetch_assoc()) $tags[] = ['tag' => $row['tag'], 'n' => (int)$row['n']];
    echo json_encode(['tags' => $tags], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── TÉLÉVERSER ─────────────────────────────────────────────────────────────
if ($action === 'televerser') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée.']); exit;
    }
    // Défense en profondeur : la session admin est déjà exigée, mais une session
    // compromise ne doit pas pouvoir gonfler la base en boucle.
    if (!rate_limit('evt_image_upload', 40, 3600)) {
        http_response_code(429);
        echo json_encode(['error' => 'Trop de téléversements récents. Réessaie plus tard.']); exit;
    }

    $f = $_FILES['fichier'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        // UPLOAD_ERR_INI_SIZE survient AVANT ce script : annoncer notre propre
        // plafond sans regarder celui de PHP produirait un message faux.
        $motif = ($f['error'] ?? null) === UPLOAD_ERR_INI_SIZE
            ? 'Fichier refusé par le serveur (limite PHP : ' . ini_get('upload_max_filesize') . ').'
            : "Aucun fichier reçu. Si l'image est très lourde, elle a pu être "
              . 'rejetée en bloc par le serveur : au-dessus de post_max_size ('
              . ini_get('post_max_size') . "), PHP vide à la fois le fichier et les champs du formulaire.";
        echo json_encode(['error' => $motif]);
        exit;
    }
    if ($f['size'] > IMG_TAILLE_MAX) {
        echo json_encode(['error' => 'Image trop lourde (8 Mo maximum).']); exit;
    }

    // getimagesize lit les octets réels : c'est ce qui distingue une vraie image
    // d'un script renommé en .png. Le nom du fichier n'est jamais consulté.
    $info = @getimagesize($f['tmp_name']);
    $formats = img_formats();
    if (!$info || !isset($formats[$info[2]])) {
        echo json_encode(['error' => 'Format non reconnu. Formats acceptés : PNG, JPEG, GIF, WebP.']); exit;
    }
    [$mime, $ext] = $formats[$info[2]];

    $donnees = file_get_contents($f['tmp_name']);
    if ($donnees === false) { echo json_encode(['error' => 'Lecture du fichier impossible.']); exit; }

    // Le nom n'est qu'une étiquette pour s'y retrouver dans la banque. Celui
    // saisi au téléversement prime ; à défaut on retombe sur le nom du fichier,
    // nettoyé, auquel on recolle l'extension déduite du CONTENU (jamais celle
    // annoncée). Un nom donné à la main n'a pas d'extension : il est là pour
    // être lu, le format est affiché à part.
    $nom = trim((string)($_POST['nom'] ?? ''));
    if ($nom !== '') {
        $nom = mb_substr($nom, 0, 200);
    } else {
        $nom = pathinfo((string)($f['name'] ?? 'image'), PATHINFO_FILENAME);
        $nom = trim(preg_replace('/[^\p{L}\p{N} _-]+/u', '', $nom));
        if ($nom === '') $nom = 'image';
        $nom = mb_substr($nom, 0, 180) . '.' . $ext;
    }

    $taille  = (int)$f['size'];
    $largeur = (int)$info[0];
    $hauteur = (int)$info[1];
    $auteur  = $_SESSION['username'] ?? '';

    $stmt = mysqli_prepare($conn,
        'INSERT INTO images (nom, mime, taille, largeur, hauteur, donnees, cree_par) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $null = null;
    $stmt->bind_param('ssiiibs', $nom, $mime, $taille, $largeur, $hauteur, $null, $auteur);
    $stmt->send_long_data(5, $donnees);
    if (!$stmt->execute()) {
        echo json_encode(['error' => 'Enregistrement refusé par la base : ' . $stmt->error]); exit;
    }
    $id = $stmt->insert_id;

    img_tags_ecrire($conn, $id, img_tags_parser($_POST['tags'] ?? ''));

    audit_log($conn, 'evenement_image_ajoutee', $nom, ['target_type' => 'image', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'id' => $id, 'url' => '/api/evenements/image.php?id=' . $id], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── MODIFIER (nom et tags ; le fichier lui-même ne se remplace pas) ────────
if ($action === 'modifier') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Image invalide.']); exit; }

    $nom = trim((string)($_POST['nom'] ?? ''));
    if ($nom !== '') {
        $nom = mb_substr($nom, 0, 200);
        $stmt = mysqli_prepare($conn, 'UPDATE images SET nom = ? WHERE id = ?');
        $stmt->bind_param('si', $nom, $id);
        $stmt->execute();
    }
    img_tags_ecrire($conn, $id, img_tags_parser($_POST['tags'] ?? ''));
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER ──────────────────────────────────────────────────────────────
if ($action === 'supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Image invalide.']); exit; }

    // Fiche lue avant suppression : le journal afficherait sinon un simple
    // numéro. Le fichier, lui, n'est pas gardé : une image supprimée est perdue.
    $stmt = mysqli_prepare($conn, 'SELECT nom, mime, taille, largeur, hauteur, cree_par, created_at FROM images WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $img = $stmt->get_result()->fetch_assoc();

    $stmt = mysqli_prepare($conn, 'DELETE FROM images WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Image introuvable.']); exit; }

    audit_log($conn, 'evenement_image_supprimee', $img['nom'] ?? "image #$id", [
        'target_type' => 'image', 'target_id' => $id, 'snapshot' => ['etat' => $img],
    ]);
    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
