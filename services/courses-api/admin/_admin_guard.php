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

/**
 * Rattrapage des admins à la publication d'un cours. Les admins ont tous les
 * cours validés d'office (cf. launchpad.php et import_cours.php) : sans ça, un
 * cours publié depuis l'admin resterait « non terminé » pour eux, leur profil
 * afficherait 9/10 et le badge « Expert compost » se reverrouillerait.
 */
function cours_rattraper_admins($c, $slug, $titre, $xp) {
    $xp = (int)$xp;
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

/** Un thème tel que le journal le garde (avant/après, état supprimé). */
function theme_lire($c, $id) {
    $stmt = mysqli_prepare($c, 'SELECT slug, nom, emoji, couleur, description FROM themes WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    return $stmt->get_result()->fetch_assoc() ?: null;
}

/** Organisation du catalogue : thèmes dans l'ordre avec leurs cours (format
 *  du corps de cours_reorder.php), + titres et places pour le journal. */
function cours_organisation($c) {
    $themes = []; $noms_themes = []; $titres = []; $place = [];
    $res = mysqli_query($c, 'SELECT id, nom FROM themes ORDER BY ordre, id');
    while ($res && ($t = mysqli_fetch_assoc($res))) {
        $themes[(int)$t['id']] = ['id' => (int)$t['id'], 'cours' => []];
        $noms_themes[(int)$t['id']] = $t['nom'];
    }
    $res = mysqli_query($c, 'SELECT id, theme_id, titre FROM cours ORDER BY theme_id, ordre, id');
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $tid = (int)$r['theme_id'];
        if (!isset($themes[$tid])) continue;
        $themes[$tid]['cours'][] = (int)$r['id'];
        $titres[(int)$r['id']] = $r['titre'];
        $place[(int)$r['id']] = $noms_themes[$tid] . ' · n°' . count($themes[$tid]['cours']);
    }
    return ['themes' => array_values($themes), 'titres' => $titres, 'place' => $place,
            'noms_themes' => array_values($noms_themes)];
}

/**
 * Applique une organisation complète, dans une transaction : un rangement à
 * moitié appliqué laisserait le catalogue dans un ordre incohérent. Un thème
 * ou un cours disparu entre-temps est simplement ignoré (UPDATE sans effet).
 * Renvoie le nombre de cours replacés, ou false.
 */
function cours_appliquer_organisation($c, array $themes) {
    mysqli_begin_transaction($c);
    $stmt_cours = mysqli_prepare($c, 'UPDATE cours  SET theme_id = ?, ordre = ? WHERE id = ?');
    $stmt_theme = mysqli_prepare($c, 'UPDATE themes SET ordre = ? WHERE id = ?');
    if (!$stmt_cours || !$stmt_theme) { mysqli_rollback($c); return false; }
    $deplaces = 0;
    foreach (array_values($themes) as $rang_theme => $t) {
        $theme_id = (int)($t['id'] ?? 0);
        if ($theme_id <= 0) continue;
        $stmt_theme->bind_param('ii', $rang_theme, $theme_id);
        if (!$stmt_theme->execute()) { mysqli_rollback($c); return false; }
        foreach (array_values((array)($t['cours'] ?? [])) as $rang => $cours_id) {
            $cours_id = (int)$cours_id;
            if ($cours_id <= 0) continue;
            $stmt_cours->bind_param('iii', $theme_id, $rang, $cours_id);
            if (!$stmt_cours->execute()) { mysqli_rollback($c); return false; }
            $deplaces++;
        }
    }
    mysqli_commit($c);
    return $deplaces;
}

/** Ce qui a bougé entre deux organisations : seuls les cours déplacés, avec
 *  leur place avant/après (« Thème · n°2 »), et l'ordre des thèmes s'il change. */
function cours_changements_organisation($avant, $apres) {
    $changements = [];
    foreach ($apres['place'] as $cid => $place) {
        $ancienne = $avant['place'][$cid] ?? null;
        if ($ancienne !== $place) $changements[$apres['titres'][$cid]] = [$ancienne, $place];
    }
    if ($avant['noms_themes'] !== $apres['noms_themes']) {
        $changements['Ordre des thèmes'] = [$avant['noms_themes'], $apres['noms_themes']];
    }
    return $changements;
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
