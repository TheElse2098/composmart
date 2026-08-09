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
$quiz = [];
foreach ((array)($d['quiz'] ?? []) as $q) {
    $question = trim((string)($q['question'] ?? ''));
    $options  = array_values(array_filter(array_map(
        fn($o) => trim((string)$o), (array)($q['options'] ?? [])
    ), fn($o) => $o !== ''));
    if ($question === '' || count($options) < 2) continue;
    $correct = (int)($q['correct'] ?? 0);
    if ($correct < 0 || $correct >= count($options)) $correct = 0;
    $quiz[] = ['question' => $question, 'options' => $options, 'correct' => $correct];
}

$m = metriques_contenu($texte, $quiz);
$has_text     = $m['has_text'];
$nb_questions = $m['nb_questions'];
$quiz_json = $quiz ? json_encode($quiz, JSON_UNESCAPED_UNICODE) : null;

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)');
    //          slug theme titre desc emoji niveau xp has_text nb_q statut ordre
    $stmt->bind_param('sissssiiisi', $slug, $theme_id, $titre, $description, $emoji, $niveau,
                      $xp, $has_text, $nb_questions, $statut, $ordre);
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
    $stmt = mysqli_prepare($c, 'SELECT slug FROM cours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $ex = $stmt->get_result()->fetch_assoc();
    if (!$ex) { http_response_code(404); echo json_encode(['error' => 'Cours introuvable.']); exit; }
    $slug = $ex['slug'];

    // Version précédente archivée AVANT écrasement : c'est le seul filet en cas
    // de mauvaise manipulation dans l'éditeur.
    $stmt = mysqli_prepare($c,
        'INSERT INTO cours_versions (cours_id, texte, quiz, auteur)
         SELECT cours_id, texte, quiz, ? FROM cours_contenu WHERE cours_id = ?');
    $auteur = $_SESSION['username'] ?? '';
    $stmt->bind_param('si', $auteur, $id);
    @$stmt->execute();

    $stmt = mysqli_prepare($c,
        'UPDATE cours SET theme_id = ?, titre = ?, description = ?, emoji = ?,
                          niveau = ?, xp_reward = ?, has_text = ?, nb_questions = ?, statut = ?
         WHERE id = ?');
    //          theme titre desc emoji niveau xp has_text nb_q statut id
    $stmt->bind_param('issssiiisi', $theme_id, $titre, $description, $emoji, $niveau,
                      $xp, $has_text, $nb_questions, $statut, $id);
    if (!$stmt->execute()) {
        echo json_encode(['error' => "L'enregistrement a échoué."]); exit;
    }
    $action = 'cours_modifie';
}

// ── Contenu ────────────────────────────────────────────────────────────────
$auteur = $_SESSION['username'] ?? '';
$stmt = mysqli_prepare($c,
    'INSERT INTO cours_contenu (cours_id, texte, quiz, maj_par) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE texte = VALUES(texte), quiz = VALUES(quiz), maj_par = VALUES(maj_par)');
$stmt->bind_param('isss', $id, $texte, $quiz_json, $auteur);
$stmt->execute();

// Les images téléversées avant la première sauvegarde sont rattachées au cours.
mysqli_query($c, "UPDATE cours_images SET cours_id = $id
                  WHERE cours_id IS NULL AND created_at > (NOW() - INTERVAL 1 DAY)");

// ── Rattrapage des admins ──────────────────────────────────────────────────
// Les admins ont tous les cours validés d'office (cf. launchpad.php et
// import_cours.php). Sans ce bloc, un cours créé ici resterait « non terminé »
// pour eux : leur profil afficherait 9/10 et le badge « Expert compost » se
// reverrouillerait. Uniquement à la publication : un brouillon n'existe pas.
if ($statut === 'publie') {
    $res_admins = mysqli_query($c, 'SELECT id FROM users WHERE isAdmin = 1');
    $slug_esc = mysqli_real_escape_string($c, $slug);
    $titre_esc = mysqli_real_escape_string($c, $titre);
    while ($res_admins && ($a = mysqli_fetch_assoc($res_admins))) {
        $uid = (int)$a['id'];
        $deja = mysqli_query($c, "SELECT id FROM user_progress WHERE user_id = $uid AND cours_id = '$slug_esc'");
        if ($deja && mysqli_num_rows($deja) > 0) continue;
        mysqli_query($c, "INSERT IGNORE INTO user_progress (user_id, cours_id) VALUES ($uid, '$slug_esc')");
        mysqli_query($c, "UPDATE users SET xp = xp + $xp WHERE id = $uid");
        mysqli_query($c, "UPDATE users SET niveau = FLOOR(xp / 100) + 1 WHERE id = $uid");
        mysqli_query($c, "INSERT INTO xp_log (user_id, delta, source, label) VALUES ($uid, $xp, 'cours', '$titre_esc')");
    }
}

audit_log($c, $action, mb_substr($titre, 0, 120) . ' (' . $statut . ')', [
    'target_type' => 'cours', 'target_id' => $id,
]);

echo json_encode(['ok' => true, 'id' => $id, 'slug' => $slug, 'statut' => $statut], JSON_UNESCAPED_UNICODE);
