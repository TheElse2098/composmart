<?php
/**
 * Banque d'anecdotes — réservoir partagé par tous les parcours.
 * Réservé aux administrateurs.
 *
 * Une slide « anecdote » peut pointer une entrée d'ici, ou en tirer une au
 * hasard (résolution dans _slides.php : resoudre_anecdote()). Supprimer une
 * anecdote ne casse donc rien : une slide qui la visait retombe sur un texte
 * de repli plutôt que d'interrompre l'atelier.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin.php';

$conn = evt_admin_connexion_ou_403();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

/** Nombre maximum de mots-clés par anecdote. Rien de sacré : une borne pour
 *  qu'un copier-coller malheureux ne remplisse pas la table. */
const ANEC_MOTS_MAX = 12;

/**
 * Découpe la saisie libre (« Compost, tri ; Chiffre choc ») en mots-clés
 * normalisés. Minuscules et espaces resserrés : sans ça « Compost » et
 * « compost » deviendraient deux entrées distinctes dans les filtres, et la
 * liste des mots-clés se remplirait de doublons visuels.
 */
function anec_mots_parser($brut) {
    $parts = preg_split('/[,;\n]+/u', (string)$brut);
    $mots = [];
    foreach ($parts as $m) {
        $m = trim(preg_replace('/\s+/u', ' ', $m));
        if ($m === '') continue;
        $m = mb_strtolower(mb_substr($m, 0, 40));
        if (!in_array($m, $mots, true)) $mots[] = $m;
        if (count($mots) >= ANEC_MOTS_MAX) break;
    }
    return $mots;
}

/** Remplace d'un bloc les mots-clés d'une anecdote. */
function anec_mots_ecrire($conn, $anecdote_id, array $mots) {
    $stmt = mysqli_prepare($conn, 'DELETE FROM anecdote_mots WHERE anecdote_id = ?');
    $stmt->bind_param('i', $anecdote_id);
    $stmt->execute();
    if (!$mots) return;
    $stmt = mysqli_prepare($conn, 'INSERT INTO anecdote_mots (anecdote_id, mot) VALUES (?, ?)');
    foreach ($mots as $m) {
        $stmt->bind_param('is', $anecdote_id, $m);
        $stmt->execute();
    }
}

/**
 * Mots-clés de plusieurs anecdotes d'un coup : id => [mots].
 * Une requête pour toute la liste, et non une par anecdote — la banque est
 * affichée en entier à chaque chargement de page.
 */
function anec_mots_lire($conn, array $ids) {
    if (!$ids) return [];
    $ids = array_map('intval', $ids);
    $in  = implode(',', array_fill(0, count($ids), '?'));
    $stmt = mysqli_prepare($conn,
        'SELECT anecdote_id, mot FROM anecdote_mots WHERE anecdote_id IN (' . $in . ') ORDER BY mot');
    $stmt->bind_param(str_repeat('i', count($ids)), ...$ids);
    $stmt->execute();
    $res = $stmt->get_result();
    $par_id = [];
    while ($row = $res->fetch_assoc()) {
        $par_id[(int)$row['anecdote_id']][] = $row['mot'];
    }
    return $par_id;
}

/** Une anecdote telle que le journal la garde (avant/après, supprimée). */
function anec_lire($conn, $id) {
    $stmt = mysqli_prepare($conn, 'SELECT texte, emoji, theme FROM anecdotes WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $a = $stmt->get_result()->fetch_assoc();
    if (!$a) return null;
    $a['mots'] = anec_mots_lire($conn, [$id])[$id] ?? [];
    return $a;
}

/** Début du texte, pour la ligne du journal. */
function anec_extrait($texte) {
    $t = trim(preg_replace('/\s+/u', ' ', (string)$texte));
    return mb_strlen($t) > 70 ? mb_substr($t, 0, 70) . '…' : $t;
}

// ── LISTE (avec les thèmes existants, pour les filtres) ────────────────────
if ($action === 'liste') {
    $theme = trim((string)($_GET['theme'] ?? ''));
    $mot   = mb_strtolower(trim((string)($_GET['mot'] ?? '')));

    // Les deux filtres se cumulent : un thème ET un mot-clé restreignent
    // ensemble. Le mot-clé passe par la table de liaison, donc par un EXISTS
    // plutôt qu'une jointure — sans quoi une anecdote portant deux fois le
    // critère remonterait en double.
    $sql = 'SELECT id, texte, emoji, theme FROM anecdotes WHERE 1=1';
    $types = '';
    $args  = [];
    if ($theme !== '') { $sql .= ' AND theme = ?'; $types .= 's'; $args[] = $theme; }
    if ($mot !== '')   {
        $sql .= ' AND EXISTS (SELECT 1 FROM anecdote_mots m WHERE m.anecdote_id = anecdotes.id AND m.mot = ?)';
        $types .= 's'; $args[] = $mot;
    }
    $sql .= ' ORDER BY id DESC';

    $stmt = mysqli_prepare($conn, $sql);
    if ($args) $stmt->bind_param($types, ...$args);
    $stmt->execute();
    $res = $stmt->get_result();
    $anecdotes = [];
    $ids = [];
    while ($row = $res->fetch_assoc()) {
        $row['id'] = (int)$row['id'];
        $ids[] = $row['id'];
        $anecdotes[] = $row;
    }

    $par_id = anec_mots_lire($conn, $ids);
    foreach ($anecdotes as &$a) { $a['mots'] = $par_id[$a['id']] ?? []; }
    unset($a);

    $res = mysqli_query($conn, "SELECT DISTINCT theme FROM anecdotes WHERE theme IS NOT NULL AND theme != '' ORDER BY theme");
    $themes = [];
    while ($row = $res->fetch_assoc()) $themes[] = $row['theme'];

    // Vocabulaire complet, indépendant du filtre courant : sinon filtrer sur un
    // mot ferait disparaître tous les autres de la barre, et on ne pourrait
    // plus en changer sans repasser par « Tous ».
    $res = mysqli_query($conn, 'SELECT mot, COUNT(*) AS n FROM anecdote_mots GROUP BY mot ORDER BY mot');
    $mots = [];
    while ($row = $res->fetch_assoc()) $mots[] = ['mot' => $row['mot'], 'n' => (int)$row['n']];

    echo json_encode(['anecdotes' => $anecdotes, 'themes' => $themes, 'mots' => $mots], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── CRÉER ───────────────────────────────────────────────────────────────────
if ($action === 'creer') {
    $texte = trim($_POST['texte'] ?? '');
    if ($texte === '' || mb_strlen($texte) > 1000) { echo json_encode(['error' => 'Texte vide ou trop long (1000 caractères max).']); exit; }
    $emoji  = mb_substr(trim($_POST['emoji'] ?? ''), 0, 8);
    $theme  = mb_substr(trim($_POST['theme'] ?? ''), 0, 60);
    $auteur = $_SESSION['username'] ?? '';

    $stmt = mysqli_prepare($conn, 'INSERT INTO anecdotes (texte, emoji, theme, cree_par) VALUES (?, ?, ?, ?)');
    $stmt->bind_param('ssss', $texte, $emoji, $theme, $auteur);
    $stmt->execute();
    $aid = $stmt->insert_id;

    anec_mots_ecrire($conn, $aid, anec_mots_parser($_POST['mots'] ?? ''));

    echo json_encode(['ok' => true, 'id' => $aid]);
    exit;
}

// ── MODIFIER ────────────────────────────────────────────────────────────────
if ($action === 'modifier') {
    $id    = (int)($_POST['id'] ?? 0);
    $texte = trim($_POST['texte'] ?? '');
    if ($id <= 0 || $texte === '' || mb_strlen($texte) > 1000) { echo json_encode(['error' => 'Données invalides.']); exit; }
    $emoji = mb_substr(trim($_POST['emoji'] ?? ''), 0, 8);
    $theme = mb_substr(trim($_POST['theme'] ?? ''), 0, 60);

    $avant = anec_lire($conn, $id);
    if (!$avant) { echo json_encode(['error' => 'Anecdote introuvable.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE anecdotes SET texte = ?, emoji = ?, theme = ? WHERE id = ?');
    $stmt->bind_param('sssi', $texte, $emoji, $theme, $id);
    $stmt->execute();

    // Remplacement en bloc : le formulaire renvoie toujours la liste complete,
    // un mot retire de la saisie doit donc disparaitre de la base.
    anec_mots_ecrire($conn, $id, anec_mots_parser($_POST['mots'] ?? ''));

    $changements = audit_changements($avant, anec_lire($conn, $id));
    if ($changements) {
        audit_log($conn, 'anecdote_modifiee', anec_extrait($texte), [
            'target_type' => 'anecdote', 'target_id' => $id, 'snapshot' => ['changements' => $changements],
        ]);
    }

    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER ───────────────────────────────────────────────────────────────
if ($action === 'supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Anecdote invalide.']); exit; }

    $etat = anec_lire($conn, $id);
    $stmt = mysqli_prepare($conn, 'DELETE FROM anecdotes WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Anecdote introuvable.']); exit; }

    audit_log($conn, 'anecdote_supprimee', anec_extrait($etat['texte'] ?? ''), [
        'target_type' => 'anecdote', 'target_id' => $id, 'snapshot' => ['etat' => $etat],
    ]);

    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
