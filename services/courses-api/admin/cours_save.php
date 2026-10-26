<?php
/**
 * Création et mise à jour d'un cours depuis l'éditeur.
 *
 * Le texte arrive en markdown déjà assemblé par l'éditeur (panneaux « ## » et
 * blocs « ### Sources ») : le format de stockage reste celui que lit la page de
 * lecture, ce qui évite une couche de conversion à chaque affichage et garde
 * les 9 cours historiques lisibles sans reprise.
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

$d = corps_json();
$id = (int)($d['id'] ?? 0);          // 0 = création

$titre = trim((string)($d['titre'] ?? ''));
if ($titre === '' || mb_strlen($titre) > 200) {
    echo json_encode(['error' => 'Le titre est obligatoire (200 caractères maximum).']); exit;
}

$theme_id = (int)($d['theme_id'] ?? 0);
$res = mysqli_query($c, "SELECT id FROM themes WHERE id = $theme_id");
if (!$res || mysqli_num_rows($res) === 0) {
    echo json_encode(['error' => 'Thème inconnu.']); exit;
}

$niveau = in_array($d['niveau'] ?? '', ['debutant', 'intermediaire', 'expert'], true)
        ? $d['niveau'] : 'debutant';
$xp          = max(0, min(1000, (int)($d['xp'] ?? 50)));
$emoji       = mb_substr(trim((string)($d['emoji'] ?? '📖')), 0, 8);
$description = mb_substr(trim((string)($d['description'] ?? '')), 0, 500);
$statut      = in_array($d['statut'] ?? '', ['brouillon', 'publie', 'archive'], true)
             ? $d['statut'] : 'brouillon';

$texte = (string)($d['texte'] ?? '');
if (strlen($texte) > 400000) {
    echo json_encode(['error' => 'Le texte dépasse la taille maximale (400 Ko).']); exit;
}

// ── Quiz : validé question par question ────────────────────────────────────
// Un index `correct` hors bornes passerait inaperçu à l'enregistrement et
// rendrait la question impossible à réussir côté lecteur.
//
// « multiple » est un choix PAR QUESTION, pas un mode global du quiz : une
// question à choix multiples stocke `correct` comme un TABLEAU d'index
// (au lieu d'un entier) plus `multiple: true`. Absent partout ailleurs — les
// questions à réponse unique gardent exactement le format d'avant, byte pour
// byte, donc aucune des questions déjà écrites n'est modifiée en se
// resauvegardant.
$quiz = [];
foreach ((array)($d['quiz'] ?? []) as $q) {
    $question = trim((string)($q['question'] ?? ''));
    $options  = array_values(array_filter(array_map(
        fn($o) => trim((string)$o), (array)($q['options'] ?? [])
    ), fn($o) => $o !== ''));
    if ($question === '' || count($options) < 2) continue;

    $multiple = !empty($q['multiple']);
    if ($multiple) {
        $bruts = is_array($q['correct'] ?? null) ? $q['correct'] : [];
        $correct = array_values(array_unique(array_filter(
            array_map('intval', $bruts),
            fn($n) => $n >= 0 && $n < count($options)
        )));
        // Une question « multiple » sans aucune bonne réponse cochée n'a pas
        // de sens (impossible à réussir même en partie) : elle repart en
        // question simple plutôt que d'être enregistrée cassée.
        if (!$correct) { $multiple = false; $correct = 0; }
    } else {
        $correct = (int)($q['correct'] ?? 0);
        if ($correct < 0 || $correct >= count($options)) $correct = 0;
    }

    $item = ['question' => $question, 'options' => $options, 'correct' => $correct];
    if ($multiple) $item['multiple'] = true;
    $quiz[] = $item;
}

$m = metriques_contenu($texte, $quiz);
$has_text     = $m['has_text'];
$nb_questions = $m['nb_questions'];
$quiz_json = $quiz ? json_encode($quiz, JSON_UNESCAPED_UNICODE) : null;

// ── Vidéo et podcast ───────────────────────────────────────────────────────
// Ce sont des fiches (titre, auteur, durée, description) accompagnées d'une
// URL : celle d'un hébergeur pour la vidéo, celle de /api/cours/media.php pour
// un podcast téléversé. Sans URL, la fiche n'a rien à jouer et vaut absence.
function fiche_media($brut) {
    if (!is_array($brut)) return null;
    $url = trim((string)($brut['url'] ?? ''));
    if ($url === '') return null;
    return [
        'url'         => mb_substr($url, 0, 500),
        'titre'       => mb_substr(trim((string)($brut['titre'] ?? '')), 0, 200),
        'auteur'      => mb_substr(trim((string)($brut['auteur'] ?? '')), 0, 120),
        'duree'       => mb_substr(trim((string)($brut['duree'] ?? '')), 0, 20),
        'description' => mb_substr(trim((string)($brut['description'] ?? '')), 0, 600),
    ];
}
$video   = fiche_media($d['video'] ?? null);
$podcast = fiche_media($d['podcast'] ?? null);
$video_json   = $video   ? json_encode($video,   JSON_UNESCAPED_UNICODE) : null;
$podcast_json = $podcast ? json_encode($podcast, JSON_UNESCAPED_UNICODE) : null;
$has_video   = $video   ? 1 : 0;
$has_podcast = $podcast ? 1 : 0;

// ── Slug ───────────────────────────────────────────────────────────────────
// Il est figé après création : user_progress.cours_id stocke le slug en clair,
// sans clé étrangère (cf. db/core.sql). Le renommer orphelinerait la
// progression de tous ceux qui ont terminé le cours — ils le reverraient « à
// faire » et l'XP serait recréditée. C'est aussi l'URL publique du cours.
if ($id === 0) {
    $slug = slugifier($d['slug'] ?? $titre);
    if ($slug === '') { echo json_encode(['error' => 'Impossible de déduire une adresse depuis ce titre.']); exit; }
    $slug = mb_substr($slug, 0, 80);

    $stmt = mysqli_prepare($c, 'SELECT id FROM cours WHERE slug = ?');
    $stmt->bind_param('s', $slug);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        echo json_encode(['error' => "L'adresse « $slug » est déjà prise par un autre cours."]); exit;
    }

    // Placé en fin de thème.
    $r = mysqli_query($c, "SELECT COALESCE(MAX(ordre), -1) + 1 FROM cours WHERE theme_id = $theme_id");
    $ordre = $r ? (int)(mysqli_fetch_row($r)[0] ?? 0) : 0;

    $stmt = mysqli_prepare($c,
        'INSERT INTO cours (slug, theme_id, titre, description, emoji, niveau, xp_reward,
                            has_text, has_video, has_podcast, nb_questions, statut, ordre)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    //          slug theme titre desc emoji niveau xp has_text has_video has_pod nb_q statut ordre
    $stmt->bind_param('sissssiiiiisi', $slug, $theme_id, $titre, $description, $emoji, $niveau,
                      $xp, $has_text, $has_video, $has_podcast, $nb_questions, $statut, $ordre);
    if (!$stmt->execute()) {
        echo json_encode(['error' => 'La création a échoué.']); exit;
    }
    $id = (int)mysqli_insert_id($c);
    $action = 'cours_cree';

    // Le slug est de nouveau porté par un vrai cours : la pierre tombale n'a
    // plus lieu d'être, et la garder ferait taire le seed pour rien.
    $stmt = mysqli_prepare($c, 'DELETE FROM cours_supprimes WHERE slug = ?');
    if ($stmt) { $stmt->bind_param('s', $slug); @$stmt->execute(); }
} else {
    $stmt = mysqli_prepare($c,
        'SELECT slug, theme_id, titre, description, emoji, niveau, xp_reward, statut, ordre FROM cours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $ex = $stmt->get_result()->fetch_assoc();
    if (!$ex) { http_response_code(404); echo json_encode(['error' => 'Cours introuvable.']); exit; }
    $slug = $ex['slug'];

    $stmt = mysqli_prepare($c, 'SELECT texte, quiz, video, podcast FROM cours_contenu WHERE cours_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $contenu_avant = $stmt->get_result()->fetch_assoc();

    // Version précédente archivée AVANT écrasement, contenu ET métadonnées :
    // c'est le seul filet en cas de mauvaise manipulation dans l'éditeur, et
    // ce que relit le détail du journal pour montrer le texte d'avant.
    $version_id = cours_archiver($c, $id, $ex);

    $stmt = mysqli_prepare($c,
        'UPDATE cours SET theme_id = ?, titre = ?, description = ?, emoji = ?,
                          niveau = ?, xp_reward = ?, has_text = ?, has_video = ?,
                          has_podcast = ?, nb_questions = ?, statut = ?
         WHERE id = ?');
    //          theme titre desc emoji niveau xp has_text has_video has_pod nb_q statut id
    $stmt->bind_param('issssiiiiisi', $theme_id, $titre, $description, $emoji, $niveau,
                      $xp, $has_text, $has_video, $has_podcast, $nb_questions, $statut, $id);
    if (!$stmt->execute()) {
        echo json_encode(['error' => "L'enregistrement a échoué."]); exit;
    }
    $action = 'cours_modifie';
}

// ── Contenu ────────────────────────────────────────────────────────────────
$auteur = $_SESSION['username'] ?? '';
$stmt = mysqli_prepare($c,
    'INSERT INTO cours_contenu (cours_id, texte, quiz, video, podcast, maj_par) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE texte = VALUES(texte), quiz = VALUES(quiz),
                             video = VALUES(video), podcast = VALUES(podcast),
                             maj_par = VALUES(maj_par)');
$stmt->bind_param('isssss', $id, $texte, $quiz_json, $video_json, $podcast_json, $auteur);
$stmt->execute();

// Les médias téléversés avant la première sauvegarde sont rattachés au cours.
mysqli_query($c, "UPDATE cours_medias SET cours_id = $id
                  WHERE cours_id IS NULL AND created_at > (NOW() - INTERVAL 1 DAY)");

if ($statut === 'publie') cours_rattraper_admins($c, $slug, $titre, $xp);

// ── Journal ────────────────────────────────────────────────────────────────
// Métadonnées en clair (nom du thème plutôt que son id) ; le texte et le quiz,
// trop lourds pour le journal, se relisent dans cours_versions via version_id.
$apres_lisible = cours_meta_lisible($c, [
    'theme_id' => $theme_id, 'titre' => $titre, 'description' => $description, 'emoji' => $emoji,
    'niveau' => $niveau, 'xp_reward' => $xp, 'statut' => $statut,
]);
if ($action === 'cours_cree') {
    $snapshot = ['slug' => $slug, 'etat' => $apres_lisible];
} else {
    $contenu_modifie = [];
    $neuf = ['texte' => $texte, 'quiz' => $quiz_json, 'video' => $video_json, 'podcast' => $podcast_json];
    foreach ($neuf as $k => $v) {
        if ((string)($contenu_avant[$k] ?? '') !== (string)$v) $contenu_modifie[] = $k;
    }
    $snapshot = [
        'slug'            => $slug,
        'version_id'      => $version_id,
        'changements'     => audit_changements(cours_meta_lisible($c, $ex), $apres_lisible),
        'contenu_modifie' => $contenu_modifie,
    ];
}
audit_log($c, $action, mb_substr($titre, 0, 120) . ' (' . $statut . ')', [
    'target_type' => 'cours', 'target_id' => $id, 'snapshot' => $snapshot,
]);

echo json_encode(['ok' => true, 'id' => $id, 'slug' => $slug, 'statut' => $statut], JSON_UNESCAPED_UNICODE);
