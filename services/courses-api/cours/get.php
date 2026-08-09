<?php
/**
 * Contenu d'un cours. La source de vérité est la base (table cours_contenu),
 * plus les fichiers content/cours/ : c'est ce qui permet à l'éditeur d'admin
 * d'écrire un cours sans reconstruction d'image, et aux réplicas de
 * courses-api de servir tous la même version.
 *
 * Le podcast fait exception partielle : sa fiche vit en base comme le reste,
 * mais si aucune n'est renseignée on retombe sur le fichier déposé dans
 * content/cours/<slug>/ — c'est ainsi que le podcast antérieur à l'éditeur
 * continue d'être servi sans reprise manuelle.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
mysqli_report(MYSQLI_REPORT_OFF);

$slug = preg_replace('/[^a-z0-9\-]/', '', strtolower($_GET['slug'] ?? ''));
if (!$slug) { http_response_code(400); echo json_encode(['error' => 'slug manquant']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// ── Qui demande ? ──────────────────────────────────────────────────────────
$est_admin = false;
if (!empty($_SESSION['user_id'])) {
    $stmt = mysqli_prepare($c, 'SELECT email_verifie, isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    // Contenu réservé aux comptes dont l'adresse est confirmée. Le contrôle est
    // ici et pas seulement dans la page : sinon le texte resterait récupérable
    // en appelant l'API directement. Un visiteur non connecté garde le régime
    // existant (1er cours ouvert, arbitré côté page) : c'est le compte NON
    // VÉRIFIÉ qui est visé.
    if ($u && (int)$u['email_verifie'] !== 1 && (int)$u['isAdmin'] !== 1) {
        http_response_code(403);
        echo json_encode(['error' => 'email_non_verifie']);
        exit;
    }
    $est_admin = $u && (int)$u['isAdmin'] === 1;
}

// ── Cours + contenu ────────────────────────────────────────────────────────
$stmt = mysqli_prepare($c,
    'SELECT c.id, c.slug, c.titre, c.description, c.emoji, c.niveau, c.xp_reward,
            c.statut, t.slug AS theme_slug,
            k.texte, k.quiz, k.video, k.podcast
     FROM cours c
     JOIN themes t ON t.id = c.theme_id
     LEFT JOIN cours_contenu k ON k.cours_id = c.id
     WHERE c.slug = ?');
$stmt->bind_param('s', $slug);
$stmt->execute();
$row = $stmt->get_result()->fetch_assoc();

// Un brouillon n'existe que pour les admins : même réponse qu'un slug inconnu.
if (!$row || ($row['statut'] !== 'publie' && !$est_admin)) {
    http_response_code(404);
    echo json_encode(['error' => 'cours introuvable']);
    exit;
}

$data = [
    'slug' => $row['slug'],
    'meta' => [
        'titre'       => $row['titre'],
        'description' => $row['description'],
        'emoji'       => $row['emoji'],
        'niveau'      => $row['niveau'],
        'xp'          => (int)$row['xp_reward'],
        'theme_slug'  => $row['theme_slug'],
    ],
];
if ($row['statut'] !== 'publie') $data['statut'] = $row['statut'];

if ($row['texte'] !== null && $row['texte'] !== '') $data['texte'] = $row['texte'];
if ($row['quiz']  !== null && $row['quiz']  !== '') {
    $quiz = json_decode($row['quiz'], true);
    if (is_array($quiz)) $data['quiz'] = $quiz;
}
if ($row['video'] !== null && $row['video'] !== '') {
    $video = json_decode($row['video'], true);
    if (is_array($video)) $data['video'] = $video;
}

// ── Podcast ────────────────────────────────────────────────────────────────
// La fiche saisie dans l'éditeur fait foi. À défaut, on retombe sur le fichier
// déposé dans content/cours/<slug>/ : c'est ainsi que le podcast historique,
// antérieur à l'éditeur, continue d'être servi.
if ($row['podcast'] !== null && $row['podcast'] !== '') {
    $p = json_decode($row['podcast'], true);
    if (is_array($p) && !empty($p['url'])) $data['podcast'] = $p;
}
$base = "/var/www/html/content/cours/$slug";
if (!isset($data['podcast']) && is_dir($base)) {
    if (file_exists("$base/podcast.json")) {
        $data['podcast'] = json_decode(file_get_contents("$base/podcast.json"), true);
        // Raccourci : "fichier" (nom du fichier audio dans le dossier du cours)
        // plutôt qu'une "url" complète à retaper.
        if (empty($data['podcast']['url']) && !empty($data['podcast']['fichier'])) {
            $data['podcast']['url'] = "/content/cours/$slug/" . rawurlencode($data['podcast']['fichier']);
        }
    } else {
        // Pas de podcast.json : on cherche un fichier audio/vidéo déposé tel quel
        // dans le dossier du cours et on le sert sans métadonnées.
        $EXT_MEDIA = ['mp3', 'mp4', 'm4a', 'wav', 'ogg'];
        foreach (glob("$base/*") as $f) {
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (in_array($ext, $EXT_MEDIA, true)) {
                $data['podcast'] = ['url' => "/content/cours/$slug/" . rawurlencode(basename($f)), 'auteur' => 'Composmart'];
                break;
            }
        }
    }
}

echo json_encode($data, JSON_UNESCAPED_UNICODE);
