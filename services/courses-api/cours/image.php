<?php
/**
 * Sert une image de cours stockée en base.
 *
 * Public : une image illustre un cours, elle n'a pas à être plus protégée que
 * le texte. Le contenu est immuable pour un identifiant donné (un remplacement
 * crée une nouvelle ligne), d'où le cache « immutable » d'un an : sans lui,
 * chaque affichage de cours rechargerait plusieurs centaines de kilooctets
 * depuis MariaDB.
 */
error_reporting(0);
ini_set('display_errors', 0);
mysqli_report(MYSQLI_REPORT_OFF);

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) { http_response_code(400); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); exit; }

$stmt = mysqli_prepare($c, 'SELECT mime, taille, donnees FROM cours_images WHERE id = ?');
if (!$stmt) { http_response_code(500); exit; }
$stmt->bind_param('i', $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
if (!$row) { http_response_code(404); exit; }

// Revalidation bon marché : le navigateur qui revient avec If-None-Match
// repart avec un 304 sans qu'on renvoie l'image.
$etag = '"img' . $id . '-' . $row['taille'] . '"';
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }

header('Content-Type: ' . $row['mime']);
header('Content-Length: ' . $row['taille']);
header('Cache-Control: public, max-age=31536000, immutable');
header('ETag: ' . $etag);
// Une image téléversée reste une donnée fournie par un tiers : ce garde-fou
// empêche un navigateur de la réinterpréter comme du HTML si le type déduit
// s'avérait faux.
header('X-Content-Type-Options: nosniff');
echo $row['donnees'];
