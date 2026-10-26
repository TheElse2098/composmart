<?php
/**
 * Contenu d'un cours avant / après une sauvegarde, pour le détail du journal.
 *
 *   GET ?id=<version_id>  → {avant, apres, source_apres}
 *
 * Une version est l'état archivé JUSTE AVANT une sauvegarde (cf. cours_archiver()).
 * L'état d'après n'est pas stocké en double : c'est la version suivante du même
 * cours (archivée juste avant la sauvegarde d'après), ou à défaut le contenu
 * actuel. Rien d'autre n'écrit dans cours_contenu, la reconstitution est exacte.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}

/** Contenu décodé tel que l'affiche le diff (quiz, vidéo et podcast en JSON). */
function contenu_lisible($r) {
    if (!$r) return null;
    return [
        'texte'   => (string)($r['texte'] ?? ''),
        'quiz'    => json_decode($r['quiz'] ?? '', true) ?: [],
        'video'   => json_decode($r['video'] ?? '', true),
        'podcast' => json_decode($r['podcast'] ?? '', true),
    ];
}

$vid = (int)($_GET['id'] ?? 0);
$stmt = mysqli_prepare($c, 'SELECT id, cours_id, texte, quiz, video, podcast FROM cours_versions WHERE id = ?');
$stmt->bind_param('i', $vid);
$stmt->execute();
$v = $stmt->get_result()->fetch_assoc();
if (!$v) { http_response_code(404); echo json_encode(['error' => 'Version introuvable.']); exit; }

$cours_id = (int)$v['cours_id'];
$stmt = mysqli_prepare($c,
    'SELECT texte, quiz, video, podcast FROM cours_versions WHERE cours_id = ? AND id > ? ORDER BY id LIMIT 1');
$stmt->bind_param('ii', $cours_id, $vid);
$stmt->execute();
$apres = $stmt->get_result()->fetch_assoc();
$source = 'version';
if (!$apres) {
    $stmt = mysqli_prepare($c, 'SELECT texte, quiz, video, podcast FROM cours_contenu WHERE cours_id = ?');
    $stmt->bind_param('i', $cours_id);
    $stmt->execute();
    $apres = $stmt->get_result()->fetch_assoc();
    $source = $apres ? 'actuel' : null;
}

echo json_encode([
    'avant'        => contenu_lisible($v),
    'apres'        => contenu_lisible($apres),
    'source_apres' => $source,
], JSON_UNESCAPED_UNICODE);
