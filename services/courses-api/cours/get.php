<?php
header('Content-Type: application/json; charset=utf-8');

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
