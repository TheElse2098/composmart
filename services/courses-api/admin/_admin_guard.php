<?php
/**
 * Garde commune aux endpoints d'édition des cours.
 * Ouvre la session, vérifie le statut admin EN BASE (et non d'après la session,
 * pour qu'une rétrogradation prenne effet immédiatement), et renvoie la
 * connexion db-core à l'appelant.
 */
require_once __DIR__ . '/../_guard.php';

function admin_connexion_ou_403() {
    secure_session_start();
    header('Content-Type: application/json; charset=utf-8');
    mysqli_report(MYSQLI_REPORT_OFF);

    $c = mysqli_connect(
        getenv('DB_HOST') ?: 'db-core',
        getenv('DB_USER') ?: 'composmart',
        getenv('DB_PASSWORD') ?: '',
        getenv('DB_NAME') ?: 'Composmart'
    );
    if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

    if (empty($_SESSION['user_id'])) {
        http_response_code(403); echo json_encode(['error' => 'Accès réservé']); exit;
    }
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $_SESSION['user_id']);
    $stmt->execute();
    $u = $stmt->get_result()->fetch_assoc();
    if (!$u || (int)$u['isAdmin'] !== 1) {
        http_response_code(403); echo json_encode(['error' => 'Accès réservé']); exit;
    }
    return $c;
}

/** Normalise un slug proposé : minuscules, tirets, sans accents. */
function slugifier($texte) {
    $t = trim((string)$texte);
    $translit = @iconv('UTF-8', 'ASCII//TRANSLIT', $t);
    if ($translit !== false) $t = $translit;
    $t = strtolower($t);
    $t = preg_replace('/[^a-z0-9]+/', '-', $t);
    return trim($t, '-');
}

/** Corps JSON de la requête, tableau vide si absent ou invalide. */
function corps_json() {
    $brut = file_get_contents('php://input');
    $d = json_decode($brut, true);
    return is_array($d) ? $d : [];
}

/**
 * Recalcule has_text / nb_questions à partir du contenu réellement enregistré,
 * plutôt que de faire confiance à ce que le client annonce.
 */
function metriques_contenu($texte, $quiz_tableau) {
    return [
        'has_text'     => (trim((string)$texte) !== '') ? 1 : 0,
        'nb_questions' => is_array($quiz_tableau) ? count($quiz_tableau) : 0,
    ];
}

/**
 * Archive l'état actuel d'un cours dans cours_versions (contenu + métadonnées)
 * et renvoie l'id de la version, ou null si le cours n'a pas de contenu.
 * $meta : la ligne `cours` telle que lue juste avant (slug, theme_id, titre…).
 * Appelée avant toute écriture qui écrase (sauvegarde) ou efface (suppression) :
 * le détail du journal et l'annulation relisent cette version.
 */
function cours_archiver($c, $cours_id, array $meta) {
    $json   = json_encode($meta, JSON_UNESCAPED_UNICODE);
    $auteur = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($c,
        'INSERT INTO cours_versions (cours_id, meta, texte, quiz, video, podcast, auteur)
         SELECT cours_id, ?, texte, quiz, video, podcast, ? FROM cours_contenu WHERE cours_id = ?');
    if (!$stmt) return null;
    $stmt->bind_param('ssi', $json, $auteur, $cours_id);
    return ($stmt->execute() && $stmt->affected_rows === 1) ? (int)$stmt->insert_id : null;
}

/** Métadonnées d'un cours telles qu'affichées dans le journal (thème par son nom). */
function cours_meta_lisible($c, array $m) {
    $theme = '#' . (int)$m['theme_id'];
    $stmt = mysqli_prepare($c, 'SELECT nom FROM themes WHERE id = ?');
    $tid = (int)$m['theme_id'];
    $stmt->bind_param('i', $tid);
    $stmt->execute();
    if ($t = $stmt->get_result()->fetch_assoc()) $theme = $t['nom'];
    return [
        'titre'       => $m['titre'],
        'theme'       => $theme,
        'emoji'       => $m['emoji'],
        'description' => $m['description'],
        'niveau'      => $m['niveau'],
        'xp'          => (int)$m['xp_reward'],
        'statut'      => $m['statut'],
    ];
}
