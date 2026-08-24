<?php
/**
 * Sert une image de la banque, stockée en base.
 *
 * Public, et il doit l'être : cette image illustre la slide qu'un participant
 * a sous les yeux sur son téléphone, sans compte ni session. La rendre
 * admin-only afficherait un cadre vide à toute la salle.
 *
 * Il n'y a rien à protéger ici : la banque ne contient que des illustrations
 * choisies pour être projetées en atelier. Contrairement aux médias de cours,
 * pas de statut à consulter — une image existe ou n'existe pas.
 *
 * Le contenu est immuable pour un identifiant donné (images.modifier ne touche
 * que le nom et les tags, jamais le blob), d'où le cache d'un an : sans lui,
 * chaque changement de slide rechargerait plusieurs centaines de kilooctets
 * depuis MariaDB, pour chaque téléphone de la salle.
 */
error_reporting(0);
ini_set('display_errors', 0);
mysqli_report(MYSQLI_REPORT_OFF);

$id = (int)($_GET['id'] ?? 0);
if ($id <= 0) { http_response_code(400); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-evenements',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); exit; }

$stmt = mysqli_prepare($c, 'SELECT mime, taille FROM images WHERE id = ?');
if (!$stmt) { http_response_code(500); exit; }
$stmt->bind_param('i', $id);
$stmt->execute();
$meta = $stmt->get_result()->fetch_assoc();
if (!$meta) { http_response_code(404); exit; }

$taille = (int)$meta['taille'];
$etag   = '"i' . $id . '-' . $taille . '"';

// Revalidation bon marché : un navigateur qui revient avec If-None-Match
// repart avec un 304 sans qu'on relise le blob.
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    header('ETag: ' . $etag);
    header('Cache-Control: public, max-age=31536000, immutable');
    exit;
}

// Le blob n'est lu qu'ici, une fois le 304 écarté.
$stmt = mysqli_prepare($c, 'SELECT donnees FROM images WHERE id = ?');
$stmt->bind_param('i', $id);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
if (!$row) { http_response_code(404); exit; }

header('Content-Type: ' . $meta['mime']);
header('Content-Length: ' . strlen($row['donnees']));
header('ETag: ' . $etag);
header('Cache-Control: public, max-age=31536000, immutable');
// Le MIME vient d'une liste blanche vérifiée au téléversement par
// getimagesize() ; nosniff empêche malgré tout le navigateur de réinterpréter
// le contenu comme autre chose si cette garantie venait à sauter.
header('X-Content-Type-Options: nosniff');
header('Content-Disposition: inline');

echo $row['donnees'];
