<?php
/**
 * Pilotage live d'un atelier, côté animateur. Réservé aux administrateurs.
 *
 * Contrairement à live.php (participant), cet endpoint renvoie le contenu
 * COMPLET des slides — clé de correction comprise : c'est l'écran de
 * l'animateur, qui doit voir la bonne réponse pour animer.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin.php';
require_once __DIR__ . '/_slides.php';

$conn = evt_admin_connexion_ou_403();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

/** Charge un événement ou termine la requête. */
function charger_evenement($conn, $id) {
    $stmt = mysqli_prepare($conn,
        'SELECT id, titre, code, statut, mode_parcours, mode_equipes, slide_courante_id FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $e = $stmt->get_result()->fetch_assoc();
    if (!$e) { echo json_encode(['error' => 'Événement introuvable.']); exit; }
    return $e;
}

/** Slides d'un événement, dans l'ordre. */
function slides_evenement($conn, $evenement_id) {
    $stmt = mysqli_prepare($conn,
        'SELECT id, ordre, type, titre, contenu, points FROM evenement_slides WHERE evenement_id = ? ORDER BY ordre, id');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $out = [];
    while ($row = $res->fetch_assoc()) $out[] = $row;
    return $out;
}

/** Classement individuel + par équipe, toujours recalculé depuis `reponses`. */
function calculer_classement($conn, $evenement_id) {
    $stmt = mysqli_prepare($conn,
        'SELECT p.id, p.nom_affiche, p.equipe_id,
                COALESCE(SUM(r.points), 0) AS points
         FROM participants p
         LEFT JOIN reponses r ON r.participant_id = p.id
         WHERE p.evenement_id = ?
         GROUP BY p.id, p.nom_affiche, p.equipe_id
         ORDER BY points DESC, p.rejoint_at ASC');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $joueurs = [];
    while ($row = $res->fetch_assoc()) {
        $joueurs[] = [
            'id'        => (int)$row['id'],
            'nom'       => $row['nom_affiche'],
            'equipe_id' => $row['equipe_id'] !== null ? (int)$row['equipe_id'] : null,
            'points'    => (int)$row['points'],
        ];
    }

    // Score d'équipe = somme des points de ses membres (décision actée).
    $stmt = mysqli_prepare($conn,
        'SELECT e.id, e.nom, e.couleur,
                COUNT(DISTINCT p.id) AS membres,
                COALESCE(SUM(r.points), 0) AS points
         FROM equipes e
         LEFT JOIN participants p ON p.equipe_id = e.id
         LEFT JOIN reponses r ON r.participant_id = p.id
         WHERE e.evenement_id = ?
         GROUP BY e.id, e.nom, e.couleur
         ORDER BY points DESC, e.ordre ASC');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $res = $stmt->get_result();
    $equipes = [];
    while ($row = $res->fetch_assoc()) {
        $equipes[] = [
            'id'      => (int)$row['id'],
            'nom'     => $row['nom'],
            'couleur' => $row['couleur'],
            'membres' => (int)$row['membres'],
            'points'  => (int)$row['points'],
        ];
    }

    return ['joueurs' => $joueurs, 'equipes' => $equipes];
}

// ── ÉTAT DE L'ANIMATION ─────────────────────────────────────────────────────
if ($action === 'etat') {
    $id  = (int)($_GET['id'] ?? 0);
    $evt = charger_evenement($conn, $id);
    $slides = slides_evenement($conn, $id);

    $courante = null; $index = -1;
    foreach ($slides as $i => $s) {
        if ((int)$s['id'] === (int)$evt['slide_courante_id']) { $courante = $s; $index = $i; break; }
    }

    // Contenu complet : l'animateur doit voir la bonne réponse.
    $slide = null;
    if ($courante) {
        // Une anecdote « aléatoire » est propre à chaque participant : l'écran
        // de l'animateur en montre un exemplaire, et le signale.
        $aleatoire = false;
        if ($courante['type'] === 'anecdote') {
            $brut = json_decode($courante['contenu'] ?? '', true);
            $aleatoire = is_array($brut) && ($brut['source'] ?? '') === 'aleatoire';
            $courante = resoudre_anecdote($conn, $courante);
        }
        $c = json_decode($courante['contenu'] ?? '', true);
        $slide = [
            'id'      => (int)$courante['id'],
            'type'    => $courante['type'],
            'titre'   => $courante['titre'],
            'points'  => (int)$courante['points'],
            'contenu' => is_array($c) ? $c : [],
            'aleatoire' => $aleatoire,
        ];
    }

    // Combien ont répondu à la slide en cours, sur combien de participants.
    $nb_reponses = 0;
    if ($courante) {
        $stmt = mysqli_prepare($conn, 'SELECT COUNT(*) AS n FROM reponses WHERE slide_id = ?');
        $stmt->bind_param('i', $courante['id']);
        $stmt->execute();
        $nb_reponses = (int)$stmt->get_result()->fetch_assoc()['n'];
    }
    $stmt = mysqli_prepare($conn, 'SELECT COUNT(*) AS n FROM participants WHERE evenement_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $nb_participants = (int)$stmt->get_result()->fetch_assoc()['n'];

    echo json_encode([
        'evenement'       => [
            'id'            => (int)$evt['id'],
            'titre'         => $evt['titre'],
            'code'          => $evt['code'],
            'statut'        => $evt['statut'],
            'mode_parcours' => $evt['mode_parcours'],
            'mode_equipes'  => $evt['mode_equipes'],
        ],
        'slide'           => $slide,
        'index'           => $index,
        'total'           => count($slides),
        'nb_reponses'     => $nb_reponses,
        'nb_participants' => $nb_participants,
        'sommaire'        => array_map(function ($s) {
            return ['id' => (int)$s['id'], 'type' => $s['type'], 'titre' => $s['titre']];
        }, $slides),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── NAVIGATION (mode commun : l'animateur donne le rythme) ─────────────────
if ($action === 'aller_a' || $action === 'suivant' || $action === 'precedent') {
    $id  = (int)($_POST['id'] ?? 0);
    $evt = charger_evenement($conn, $id);
    $slides = slides_evenement($conn, $id);
    if (!$slides) { echo json_encode(['error' => "Cet événement n'a aucune slide. Affecte-lui un parcours."]); exit; }

    $index = -1;
    foreach ($slides as $i => $s) {
        if ((int)$s['id'] === (int)$evt['slide_courante_id']) { $index = $i; break; }
    }

    if ($action === 'aller_a') {
        $cible = (int)($_POST['slide_id'] ?? 0);
        $nouvel = -1;
        foreach ($slides as $i => $s) { if ((int)$s['id'] === $cible) { $nouvel = $i; break; } }
        if ($nouvel < 0) { echo json_encode(['error' => 'Slide inconnue.']); exit; }
    } elseif ($action === 'suivant') {
        $nouvel = min($index + 1, count($slides) - 1);   // -1 + 1 = 0 : démarre sur la première
    } else {
        $nouvel = max($index - 1, 0);
    }

    $slide_id = (int)$slides[$nouvel]['id'];
    $stmt = mysqli_prepare($conn, 'UPDATE evenements SET slide_courante_id = ? WHERE id = ?');
    $stmt->bind_param('ii', $slide_id, $id);
    $stmt->execute();

    echo json_encode(['ok' => true, 'slide_id' => $slide_id, 'index' => $nouvel, 'total' => count($slides)]);
    exit;
}

// ── RÉSULTATS D'UNE SLIDE (pour projeter après la réponse) ─────────────────
if ($action === 'resultats') {
    $slide_id = (int)($_GET['slide_id'] ?? 0);
    if ($slide_id <= 0) { echo json_encode(['error' => 'Slide invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id, evenement_id, type, contenu, points FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $slide_id);
    $stmt->execute();
    $s = $stmt->get_result()->fetch_assoc();
    if (!$s) { echo json_encode(['error' => 'Slide introuvable.']); exit; }
    $contenu = json_decode($s['contenu'] ?? '', true) ?: [];

    // Un défi ne se répond pas depuis le téléphone (repond = false) : la table
    // `reponses` est donc vide tant que l'animateur n'a rien noté. On part ici
    // de TOUS les participants, sinon il n'aurait personne à qui attribuer des
    // points. Pour les autres types, on ne liste que ceux qui ont répondu.
    if ($s['type'] === 'defi') {
        $stmt = mysqli_prepare($conn,
            'SELECT p.id AS participant_id, r.reponse, COALESCE(r.points, 0) AS points, r.correct,
                    p.nom_affiche, p.equipe_id
             FROM participants p
             LEFT JOIN reponses r ON r.participant_id = p.id AND r.slide_id = ?
             WHERE p.evenement_id = ?
             ORDER BY p.nom_affiche ASC');
        $stmt->bind_param('ii', $slide_id, $s['evenement_id']);
    } else {
        $stmt = mysqli_prepare($conn,
            'SELECT r.participant_id, r.reponse, r.points, r.correct, p.nom_affiche, p.equipe_id
             FROM reponses r JOIN participants p ON p.id = r.participant_id
             WHERE r.slide_id = ? ORDER BY r.repondu_at ASC');
        $stmt->bind_param('i', $slide_id);
    }
    $stmt->execute();
    $res = $stmt->get_result();

    $reponses = [];
    $repartition = [];   // pour quiz/sondage/vrai_faux : nombre par option
    while ($row = $res->fetch_assoc()) {
        $val = json_decode($row['reponse'], true);
        if ($val === null && $row['reponse'] !== null) $val = $row['reponse'];
        $reponses[] = [
            'participant_id' => (int)$row['participant_id'],
            'nom'            => $row['nom_affiche'],
            'equipe_id'      => $row['equipe_id'] !== null ? (int)$row['equipe_id'] : null,
            'reponse'        => $val,
            'points'         => (int)$row['points'],
            'correct'        => $row['correct'] === null ? null : (bool)$row['correct'],
        ];
        if (in_array($s['type'], ['quiz', 'sondage', 'vrai_faux'], true)) {
            // Normalisation en '0'/'1' : (string)false vaut '' en PHP, ce qui
            // ne correspondrait à aucune clé côté front.
            if (is_bool($val))        $cle = $val ? '1' : '0';
            elseif (is_scalar($val))  $cle = (string)$val;
            else                      $cle = '?';
            $repartition[$cle] = ($repartition[$cle] ?? 0) + 1;
        }
    }

    echo json_encode([
        'type'        => $s['type'],
        'contenu'     => $contenu,          // clé de correction incluse : écran animateur
        'points'      => (int)$s['points'],
        'reponses'    => $reponses,
        'repartition' => $repartition,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── CLASSEMENT ──────────────────────────────────────────────────────────────
if ($action === 'classement') {
    $id = (int)($_GET['id'] ?? 0);
    charger_evenement($conn, $id);
    echo json_encode(calculer_classement($conn, $id), JSON_UNESCAPED_UNICODE);
    exit;
}

// ── NOTER À LA MAIN (question ouverte, défi) ───────────────────────────────
// Écrit une réponse si elle n'existe pas encore (cas du défi, où le participant
// n'a rien saisi), sinon met à jour ses points.
if ($action === 'noter') {
    $slide_id       = (int)($_POST['slide_id'] ?? 0);
    $participant_id = (int)($_POST['participant_id'] ?? 0);
    $points         = max(0, min(1000, (int)($_POST['points'] ?? 0)));
    if ($slide_id <= 0 || $participant_id <= 0) { echo json_encode(['error' => 'Données invalides.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT evenement_id FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $slide_id);
    $stmt->execute();
    $s = $stmt->get_result()->fetch_assoc();
    if (!$s) { echo json_encode(['error' => 'Slide introuvable.']); exit; }
    $evenement_id = (int)$s['evenement_id'];

    $stmt = mysqli_prepare($conn,
        'INSERT INTO reponses (evenement_id, slide_id, participant_id, reponse, points, correct)
         VALUES (?, ?, ?, NULL, ?, NULL)
         ON DUPLICATE KEY UPDATE points = VALUES(points)');
    $stmt->bind_param('iiii', $evenement_id, $slide_id, $participant_id, $points);
    $stmt->execute();

    echo json_encode(['ok' => true]);
    exit;
}

// ── NOTER TOUTE UNE ÉQUIPE (défi collectif) ────────────────────────────────
if ($action === 'noter_equipe') {
    $slide_id  = (int)($_POST['slide_id'] ?? 0);
    $equipe_id = (int)($_POST['equipe_id'] ?? 0);
    $points    = max(0, min(1000, (int)($_POST['points'] ?? 0)));
    if ($slide_id <= 0 || $equipe_id <= 0) { echo json_encode(['error' => 'Données invalides.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT evenement_id FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $slide_id);
    $stmt->execute();
    $s = $stmt->get_result()->fetch_assoc();
    if (!$s) { echo json_encode(['error' => 'Slide introuvable.']); exit; }
    $evenement_id = (int)$s['evenement_id'];

    // Les points d'équipe étant la somme de ceux des membres, noter une équipe
    // revient à poser la même note à chacun de ses membres.
    $stmt = mysqli_prepare($conn,
        'INSERT INTO reponses (evenement_id, slide_id, participant_id, reponse, points, correct)
         SELECT ?, ?, p.id, NULL, ?, NULL FROM participants p WHERE p.equipe_id = ?
         ON DUPLICATE KEY UPDATE points = VALUES(points)');
    $stmt->bind_param('iiii', $evenement_id, $slide_id, $points, $equipe_id);
    $stmt->execute();

    echo json_encode(['ok' => true, 'notes' => mysqli_affected_rows($conn)]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
