<?php
/**
 * Charge un cours pour l'éditeur — brouillons compris, contrairement à
 * cours/get.php qui ne sert que le publié aux lecteurs.
 * GET ?slug=<slug>   ou   ?theme=<slug> pour la liste d'un thème.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();

$slug = preg_replace('/[^a-z0-9\-]/', '', strtolower($_GET['slug'] ?? ''));
if (!$slug) { http_response_code(400); echo json_encode(['error' => 'slug manquant']); exit; }

$stmt = mysqli_prepare($c,
    'SELECT c.id, c.slug, c.theme_id, c.titre, c.description, c.emoji, c.niveau,
            c.xp_reward, c.statut, c.ordre, t.slug AS theme_slug,
            k.texte, k.quiz, k.video, k.podcast, k.maj_at, k.maj_par
     FROM cours c
     JOIN themes t ON t.id = c.theme_id
     LEFT JOIN cours_contenu k ON k.cours_id = c.id
     WHERE c.slug = ?');
$stmt->bind_param('s', $slug);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();
if (!$row) { http_response_code(404); echo json_encode(['error' => 'cours introuvable']); exit; }

$quiz = $row['quiz'] ? json_decode($row['quiz'], true) : [];
$video   = $row['video']   ? json_decode($row['video'], true)   : null;
$podcast = $row['podcast'] ? json_decode($row['podcast'], true) : null;

// Nombre de personnes ayant déjà terminé ce cours : l'éditeur s'en sert pour
// prévenir avant un changement d'XP ou une suppression.
$res = mysqli_query($c, "SELECT COUNT(*) FROM user_progress WHERE cours_id = '" . mysqli_real_escape_string($c, $slug) . "'");
$termine_par = $res ? (int)(mysqli_fetch_row($res)[0] ?? 0) : 0;

echo json_encode([
    'id'          => (int)$row['id'],
    'slug'        => $row['slug'],
    'theme_id'    => (int)$row['theme_id'],
    'theme_slug'  => $row['theme_slug'],
    'titre'       => $row['titre'],
    'description' => $row['description'],
    'emoji'       => $row['emoji'],
    'niveau'      => $row['niveau'],
    'xp'          => (int)$row['xp_reward'],
    'statut'      => $row['statut'],
    'ordre'       => (int)$row['ordre'],
    'texte'       => $row['texte'] ?? '',
    'quiz'        => is_array($quiz) ? $quiz : [],
    'video'       => $video,
    'podcast'     => $podcast,
    'maj_at'      => $row['maj_at'],
    'maj_par'     => $row['maj_par'],
    'termine_par' => $termine_par,
], JSON_UNESCAPED_UNICODE);
