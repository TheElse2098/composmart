<?php
/**
 * Sert un média de cours stocké en base (illustration ou audio de podcast).
 *
 * Public : un média illustre un cours, il n'a pas à être plus protégé que le
 * texte — MAIS seulement pour un cours déjà publié. Les identifiants sont
 * auto-incrémentés donc énumérables : sans le contrôle de statut ci-dessous,
 * l'image d'un cours encore en brouillon serait devinable et consultable par
 * n'importe qui avant même sa publication. Un média pas encore rattaché à un
 * cours (cours_id NULL, le temps de la création dans l'éditeur) reste servi
 * tel quel — il n'y a pas encore de statut à consulter.
 *
 * Le contenu est immuable pour un identifiant donné (un remplacement crée une
 * nouvelle ligne), d'où le cache « immutable » d'un an : sans lui, chaque
 * affichage rechargerait plusieurs centaines de kilooctets depuis MariaDB —
 * et plusieurs mégaoctets pour un podcast.
 *
 * Les requêtes Range sont honorées : sans elles, la barre de progression d'un
 * <audio> ne permet pas de se déplacer dans la piste, le navigateur devant
 * retélécharger le fichier entier à chaque saut.
 */
require_once __DIR__ . '/../_guard.php';
error_reporting(0);
ini_set('display_errors', 0);
mysqli_report(MYSQLI_REPORT_OFF);
secure_session_start();

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) { http_response_code(400); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); exit; }

$stmt = mysqli_prepare($c,
    'SELECT m.mime, m.taille, m.donnees, c.statut
     FROM cours_medias m
     LEFT JOIN cours c ON c.id = m.cours_id
     WHERE m.id = ?');
if (!$stmt) { http_response_code(500); exit; }
$stmt->bind_param('i', $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
if (!$row) { http_response_code(404); exit; }

// cours_id NULL (média pas encore rattaché) ou statut 'publie' : accès public.
// Tout autre statut (brouillon, archive) exige une session admin — c'est
// l'éditeur qui prévisualise, un visiteur normal reçoit un 404, comme pour
// un cours en brouillon demandé directement.
if ($row['statut'] !== null && $row['statut'] !== 'publie') {
    $est_admin = false;
    if (!empty($_SESSION['user_id'])) {
        $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
        $stmt->bind_param('i', $_SESSION['user_id']);
        $stmt->execute();
        $u = $stmt->get_result()->fetch_assoc();
        $est_admin = $u && (int)$u['isAdmin'] === 1;
    }
    if (!$est_admin) { http_response_code(404); exit; }
}

$taille = (int)$row['taille'];
$etag   = '"m' . $id . '-' . $taille . '"';

// Revalidation bon marché : le navigateur qui revient avec If-None-Match
// repart avec un 304 sans qu'on renvoie le fichier.
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }

header('Content-Type: ' . $row['mime']);
header('Cache-Control: public, max-age=31536000, immutable');
header('ETag: ' . $etag);
header('Accept-Ranges: bytes');
// Un média téléversé reste une donnée fournie par un tiers : ce garde-fou
// empêche un navigateur de le réinterpréter comme du HTML si le type déclaré
// s'avérait faux.
header('X-Content-Type-Options: nosniff');

$plage = $_SERVER['HTTP_RANGE'] ?? '';
if ($plage !== '' && preg_match('/bytes=(\d*)-(\d*)/', $plage, $m)) {
    $debut = $m[1] === '' ? 0 : (int)$m[1];
    $fin   = $m[2] === '' ? $taille - 1 : (int)$m[2];
    if ($fin >= $taille) $fin = $taille - 1;
    if ($debut > $fin || $debut >= $taille) {
        http_response_code(416);
        header("Content-Range: bytes */$taille");
        exit;
    }
    http_response_code(206);
    header("Content-Range: bytes $debut-$fin/$taille");
    header('Content-Length: ' . ($fin - $debut + 1));
    echo substr($row['donnees'], $debut, $fin - $debut + 1);
    exit;
}

header('Content-Length: ' . $taille);
echo $row['donnees'];
