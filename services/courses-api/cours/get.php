<?php
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');

// Contenu réservé aux comptes dont l'adresse email est confirmée. Le contrôle est
// ici et pas seulement dans la page : sinon le texte des cours resterait
// récupérable en appelant l'API directement.
// Un visiteur non connecté garde le régime existant (le 1er cours reste ouvert,
// arbitré côté page) : c'est bien le compte NON VÉRIFIÉ qui est visé.
if (!empty($_SESSION['user_id'])) {
    $cv = mysqli_connect(
        getenv('DB_HOST') ?: 'db-core',
        getenv('DB_USER') ?: 'composmart',
        getenv('DB_PASSWORD') ?: '',
        getenv('DB_NAME') ?: 'Composmart'
    );
    if ($cv) {
        $stmt = mysqli_prepare($cv, 'SELECT email_verifie FROM users WHERE id = ?');
        $stmt->bind_param('i', $_SESSION['user_id']);
        $stmt->execute();
        $u = $stmt->get_result()->fetch_assoc();
        mysqli_close($cv);
        if ($u && (int)$u['email_verifie'] !== 1) {
            http_response_code(403);
            echo json_encode(['error' => 'email_non_verifie']);
            exit;
        }
    }
}

$slug = preg_replace('/[^a-z0-9\-]/', '', strtolower($_GET['slug'] ?? ''));
if (!$slug) { http_response_code(400); echo json_encode(['error' => 'slug manquant']); exit; }

$base = "/var/www/html/content/cours/$slug";
if (!is_dir($base)) { http_response_code(404); echo json_encode(['error' => 'cours introuvable']); exit; }

$data = ['slug' => $slug];

// meta
if (file_exists("$base/meta.json")) {
    $data['meta'] = json_decode(file_get_contents("$base/meta.json"), true);
}

// texte
if (file_exists("$base/texte.md")) {
    $data['texte'] = file_get_contents("$base/texte.md");
}

// vidéo
if (file_exists("$base/video.json")) {
    $data['video'] = json_decode(file_get_contents("$base/video.json"), true);
}

// podcast
if (file_exists("$base/podcast.json")) {
    $data['podcast'] = json_decode(file_get_contents("$base/podcast.json"), true);
    // Raccourci : "fichier" (nom du fichier audio dans le dossier du cours) plutôt
    // qu'une "url" complète à retaper — évite de casser le lien si le slug change.
    if (empty($data['podcast']['url']) && !empty($data['podcast']['fichier'])) {
        $data['podcast']['url'] = "/content/cours/$slug/" . rawurlencode($data['podcast']['fichier']);
    }
} else {
    // Pas de podcast.json : on cherche un fichier audio/vidéo déposé tel quel
    // dans le dossier du cours (mp3/mp4/m4a/wav/ogg) et on le sert directement,
    // sans métadonnées (titre/auteur/description).
    $EXT_MEDIA = ['mp3', 'mp4', 'm4a', 'wav', 'ogg'];
    $fichier = null;
    foreach (glob("$base/*") as $f) {
        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (in_array($ext, $EXT_MEDIA, true)) { $fichier = basename($f); break; }
    }
    if ($fichier) {
        $data['podcast'] = ['url' => "/content/cours/$slug/" . rawurlencode($fichier), 'auteur' => 'Composmart'];
    }
}

// quiz
if (file_exists("$base/quiz.json")) {
    $data['quiz'] = json_decode(file_get_contents("$base/quiz.json"), true);
}

echo json_encode($data, JSON_UNESCAPED_UNICODE);
