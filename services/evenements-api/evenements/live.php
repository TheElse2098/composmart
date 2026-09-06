<?php
/**
 * Runtime participant : suivre le parcours et répondre aux slides.
 * Endpoint PUBLIC — aucun compte Composmart requis. L'appelant s'identifie
 * avec le jeton reçu à l'inscription (cf. rejoindre.php), conservé dans le
 * localStorage de son navigateur.
 *
 * Deux garanties tenues ici, et nulle part ailleurs :
 *   1. la clé de correction n'est jamais envoyée avant que le participant ait
 *      répondu (slide_publique dans _slides.php) — sinon la bonne réponse est
 *      lisible dans l'onglet Réseau du navigateur ;
 *   2. les points sont calculés à partir du contenu relu en base, jamais à
 *      partir de ce que le client annonce.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
require_once __DIR__ . '/_slides.php';
// Une erreur SQL ne doit pas se transformer en 500 devant une salle entière :
// on repasse mysqli en mode « retour false » plutôt qu'en exceptions.
mysqli_report(MYSQLI_REPORT_OFF);
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-evenements',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

/** Identifie le participant par son jeton, ou termine la requête. */
function participant_ou_403($conn) {
    $token = $_POST['token'] ?? $_GET['token'] ?? '';
    if (!is_string($token) || $token === '') {
        http_response_code(403);
        echo json_encode(['error' => 'session_perdue']);
        exit;
    }
    $hash = hash_token($token);
    $stmt = mysqli_prepare($conn,
        'SELECT id, evenement_id, nom_affiche, equipe_id, slide_index FROM participants WHERE token_hash = ?');
    $stmt->bind_param('s', $hash);
    $stmt->execute();
    $p = $stmt->get_result()->fetch_assoc();
    if (!$p) {
        http_response_code(403);
        echo json_encode(['error' => 'session_perdue']);
        exit;
    }
    return $p;
}

function charger_evenement($conn, $id) {
    $stmt = mysqli_prepare($conn,
        'SELECT id, titre, statut, supprime, mode_parcours, mode_equipes, equipes_max, equipe_taille_max,
                theme_slides, image_tags, slide_courante_id FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    return $stmt->get_result()->fetch_assoc();
}

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

/** Total de points du participant, toujours recalculé depuis `reponses`. */
function score_participant($conn, $participant_id) {
    $stmt = mysqli_prepare($conn, 'SELECT COALESCE(SUM(points), 0) AS n FROM reponses WHERE participant_id = ?');
    $stmt->bind_param('i', $participant_id);
    $stmt->execute();
    return (int)$stmt->get_result()->fetch_assoc()['n'];
}

/** Réponse déjà donnée par ce participant sur cette slide, ou null. */
function reponse_existante($conn, $slide_id, $participant_id) {
    $stmt = mysqli_prepare($conn,
        'SELECT reponse, points, correct FROM reponses WHERE slide_id = ? AND participant_id = ?');
    $stmt->bind_param('ii', $slide_id, $participant_id);
    $stmt->execute();
    $r = $stmt->get_result()->fetch_assoc();
    if (!$r) return null;
    $val = json_decode($r['reponse'], true);
    if ($val === null && $r['reponse'] !== null) $val = $r['reponse'];
    return [
        'reponse' => $val,
        'points'  => (int)$r['points'],
        'correct' => $r['correct'] === null ? null : (bool)$r['correct'],
    ];
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── ÉTAT COURANT POUR CE PARTICIPANT ───────────────────────────────────────
if ($action === 'etat') {
    $p   = participant_ou_403($conn);
    $evt = charger_evenement($conn, $p['evenement_id']);
    if (!$evt || (int)$evt['supprime'] === 1) { echo json_encode(['error' => 'Événement indisponible.']); exit; }

    $base = [
        'participant'  => ['nom' => $p['nom_affiche'], 'points' => score_participant($conn, $p['id'])],
        'evenement'    => ['titre' => $evt['titre'], 'statut' => $evt['statut'], 'mode' => $evt['mode_parcours'],
                            'theme' => ($evt['theme_slides'] ?? '') ?: 'foret'],
        'mode_equipes' => $evt['mode_equipes'],
    ];

    // Équipe du participant (nom affiché sur son écran).
    if ($p['equipe_id']) {
        $stmt = mysqli_prepare($conn, 'SELECT nom, couleur FROM equipes WHERE id = ?');
        $stmt->bind_param('i', $p['equipe_id']);
        $stmt->execute();
        $eq = $stmt->get_result()->fetch_assoc();
        if ($eq) $base['equipe'] = ['id' => (int)$p['equipe_id'], 'nom' => $eq['nom'], 'couleur' => $eq['couleur']];
    }

    // Annulé ou terminé : la salle se vide. Le drapeau `sortir` demande au
    // navigateur d'oublier le jeton et de revenir à la saisie du code — sinon
    // les téléphones resteraient bloqués sur la dernière slide affichée.
    // Les données du participant, elles, sont conservées en base.
    if ($evt['statut'] === 'annule' || $evt['statut'] === 'termine') {
        $fin = $evt['statut'] === 'annule'
            ? "Cet événement a été annulé."
            : "L'atelier est terminé. Merci de votre participation !";
        echo json_encode($base + ['ecran' => $evt['statut'], 'sortir' => true, 'motif' => $fin], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $slides = slides_evenement($conn, $p['evenement_id']);

    // Choix de la slide à afficher : imposée par l'animateur en mode commun,
    // propre au participant en mode individuel.
    $courante = null;
    if ($evt['mode_parcours'] === 'individuel') {
        $i = max(0, min((int)$p['slide_index'], count($slides) - 1));
        $courante = $slides[$i] ?? null;
        $base['index'] = $i;
        $base['total'] = count($slides);
    } else {
        foreach ($slides as $s) {
            if ((int)$s['id'] === (int)$evt['slide_courante_id']) { $courante = $s; break; }
        }
    }

    if (!$courante) { echo json_encode($base + ['ecran' => 'attente'], JSON_UNESCAPED_UNICODE); exit; }

    $deja = reponse_existante($conn, $courante['id'], $p['id']);
    $reg  = slides_registre();

    // Anecdote de la banque ou tirée au sort : résolue en texte réel, avec le
    // participant comme graine pour que chacun ait la sienne (et toujours la
    // même pendant toute la slide). Le sommaire, lui, est reconstruit depuis
    // les parties du parcours.
    $courante = resoudre_anecdote($conn, $courante, (int)$p['id']);
    $courante = resoudre_sommaire($conn, $courante, (int)$p['evenement_id']);
    // Illustration de la banque d'images : même image pour toute la salle,
    // et seulement sur le thème simpliste (cf. resoudre_illustration).
    $courante = resoudre_illustration($conn, $courante, $evt);

    echo json_encode($base + [
        'ecran'       => 'slide',
        'slide'       => slide_publique($courante, $deja !== null),
        'repond'      => (bool)($reg[$courante['type']]['repond'] ?? false),
        'ma_reponse'  => $deja,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── RÉPONDRE ────────────────────────────────────────────────────────────────
if ($action === 'repondre') {
    // Limite haute pour la même raison que dans rejoindre.php : toute la salle
    // répond depuis l'IP publique unique de l'entreprise.
    if (!rate_limit('evt_repondre', 600, 60)) { echo json_encode(['error' => 'Trop de requêtes, patiente un instant.']); exit; }

    $p   = participant_ou_403($conn);
    $evt = charger_evenement($conn, $p['evenement_id']);
    if (!$evt || (int)$evt['supprime'] === 1) { echo json_encode(['error' => 'Événement indisponible.']); exit; }

    $slide_id = (int)($_POST['slide_id'] ?? 0);
    $stmt = mysqli_prepare($conn,
        'SELECT id, evenement_id, ordre, type, titre, contenu, points FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $slide_id);
    $stmt->execute();
    $slide = $stmt->get_result()->fetch_assoc();
    if (!$slide || (int)$slide['evenement_id'] !== (int)$p['evenement_id']) {
        echo json_encode(['error' => 'Slide inconnue.']);
        exit;
    }

    // En mode commun, on ne répond qu'à la slide projetée : sinon un
    // participant pourrait répondre en avance à tout le parcours.
    if ($evt['mode_parcours'] === 'commun' && (int)$slide['id'] !== (int)$evt['slide_courante_id']) {
        echo json_encode(['error' => "Cette question n'est plus à l'écran."]);
        exit;
    }

    $reg = slides_registre();
    if (empty($reg[$slide['type']]['repond'])) { echo json_encode(['error' => 'Cette slide n\'attend pas de réponse.']); exit; }

    // Déjà répondu : on renvoie la réponse existante sans rejouer le scoring.
    $deja = reponse_existante($conn, $slide['id'], $p['id']);
    if ($deja !== null) {
        echo json_encode([
            'ok'         => true,
            'deja'       => true,
            'ma_reponse' => $deja,
            'slide'      => slide_publique($slide, true),
            'points_total' => score_participant($conn, $p['id']),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // La réponse brute peut être un scalaire (index d'option, nombre, texte)
    // ou un tableau (slide de type jeu) : on accepte du JSON.
    $brut = $_POST['reponse'] ?? '';
    $val  = json_decode($brut, true);
    if ($val === null && $brut !== 'null') $val = $brut;

    $contenu = json_decode($slide['contenu'] ?? '', true) ?: [];
    // Calcul côté serveur uniquement, à partir du contenu relu en base.
    $note = corriger($slide['type'], $contenu, $val, (int)$slide['points']);

    $json_rep = json_encode($val, JSON_UNESCAPED_UNICODE);
    $correct  = $note['correct'] === null ? null : ($note['correct'] ? 1 : 0);
    $evt_id   = (int)$p['evenement_id'];
    $pid      = (int)$p['id'];
    $sid      = (int)$slide['id'];
    $pts      = (int)$note['points'];

    // INSERT IGNORE : si deux requêtes arrivent en même temps (double tap),
    // la seconde est écartée par la clé unique sans erreur ni double score.
    $stmt = mysqli_prepare($conn,
        'INSERT IGNORE INTO reponses (evenement_id, slide_id, participant_id, reponse, points, correct)
         VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('iiisii', $evt_id, $sid, $pid, $json_rep, $pts, $correct);
    $stmt->execute();

    echo json_encode([
        'ok'           => true,
        'ma_reponse'   => reponse_existante($conn, $sid, $pid),
        'slide'        => slide_publique($slide, true),   // correction visible désormais
        'points_total' => score_participant($conn, $pid),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── AVANCER (mode individuel uniquement) ───────────────────────────────────
if ($action === 'suivant') {
    $p   = participant_ou_403($conn);
    $evt = charger_evenement($conn, $p['evenement_id']);
    if (!$evt || $evt['mode_parcours'] !== 'individuel') { echo json_encode(['error' => 'Progression pilotée par l\'animateur.']); exit; }

    $slides = slides_evenement($conn, $p['evenement_id']);
    $i = min((int)$p['slide_index'] + 1, max(0, count($slides) - 1));
    $stmt = mysqli_prepare($conn, 'UPDATE participants SET slide_index = ? WHERE id = ?');
    $stmt->bind_param('ii', $i, $p['id']);
    $stmt->execute();

    echo json_encode(['ok' => true, 'index' => $i]);
    exit;
}

// ── CHOISIR SON ÉQUIPE (mode libre) ────────────────────────────────────────
if ($action === 'choisir_equipe') {
    $p   = participant_ou_403($conn);
    $evt = charger_evenement($conn, $p['evenement_id']);
    // « libre » et « autonome » laissent tous deux le participant se placer ;
    // seule la provenance de la liste diffère.
    if (!$evt || !in_array($evt['mode_equipes'], ['libre', 'autonome'], true)) {
        echo json_encode(['error' => "Les équipes sont définies par l'animateur."], JSON_UNESCAPED_UNICODE); exit;
    }

    $equipe_id = (int)($_POST['equipe_id'] ?? 0);
    $stmt = mysqli_prepare($conn, 'SELECT id FROM equipes WHERE id = ? AND evenement_id = ?');
    $stmt->bind_param('ii', $equipe_id, $p['evenement_id']);
    $stmt->execute();
    if (!$stmt->get_result()->fetch_assoc()) { echo json_encode(['error' => 'Équipe inconnue.']); exit; }

    // Plafond de membres. On ne le vérifie que si l'on CHANGE d'équipe :
    // renvoyer « complète » à quelqu'un qui y est déjà n'aurait aucun sens.
    $taille_max = (int)($evt['equipe_taille_max'] ?? 0);
    if ($taille_max > 0 && (int)$p['equipe_id'] !== $equipe_id) {
        $stmt = mysqli_prepare($conn, 'SELECT COUNT(*) AS n FROM participants WHERE equipe_id = ?');
        $stmt->bind_param('i', $equipe_id);
        $stmt->execute();
        if ((int)$stmt->get_result()->fetch_assoc()['n'] >= $taille_max) {
            echo json_encode(['error' => 'Cette équipe est complète (' . $taille_max . ' membres).'], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    $stmt = mysqli_prepare($conn, 'UPDATE participants SET equipe_id = ? WHERE id = ?');
    $stmt->bind_param('ii', $equipe_id, $p['id']);
    $stmt->execute();

    echo json_encode(['ok' => true]);
    exit;
}

// ── CRÉER SON ÉQUIPE (mode autonome) ───────────────────────────────────────
// Le créateur y est placé dans la foulée : créer une équipe pour ne pas y
// entrer n'aurait pas de sens, et ça évite un aller-retour de plus.
if ($action === 'creer_equipe') {
    $p   = participant_ou_403($conn);
    $evt = charger_evenement($conn, $p['evenement_id']);
    if (!$evt || $evt['mode_equipes'] !== 'autonome') {
        echo json_encode(['error' => "Les équipes sont définies par l'animateur."], JSON_UNESCAPED_UNICODE); exit;
    }
    if (!rate_limit('evt_creer_equipe', 120, 60)) {
        echo json_encode(['error' => 'Trop de tentatives, patiente un instant.']); exit;
    }

    $nom = trim(preg_replace('/\s+/u', ' ', (string)($_POST['nom'] ?? '')));
    if ($nom === '' || mb_strlen($nom) > 80) {
        echo json_encode(['error' => "Donne un nom à ton équipe (80 caractères maximum)."], JSON_UNESCAPED_UNICODE); exit;
    }

    // Doublon de nom refusé : dans une liste où l'on se cherche mutuellement,
    // deux « Les Composteurs » rendent la recherche inutilisable.
    $stmt = mysqli_prepare($conn, 'SELECT id FROM equipes WHERE evenement_id = ? AND LOWER(nom) = LOWER(?)');
    $stmt->bind_param('is', $p['evenement_id'], $nom);
    $stmt->execute();
    if ($stmt->get_result()->fetch_assoc()) {
        echo json_encode(['error' => 'Une équipe porte déjà ce nom. Rejoins-la, ou trouves-en un autre.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $stmt = mysqli_prepare($conn, 'SELECT COUNT(*) AS n, COALESCE(MAX(ordre), -1) AS m FROM equipes WHERE evenement_id = ?');
    $stmt->bind_param('i', $p['evenement_id']);
    $stmt->execute();
    $agg = $stmt->get_result()->fetch_assoc();

    $equipes_max = (int)($evt['equipes_max'] ?? 0);
    if ($equipes_max > 0 && (int)$agg['n'] >= $equipes_max) {
        echo json_encode(['error' => "Le nombre d'équipes est atteint (" . $equipes_max . '). Rejoins une équipe existante.'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Couleur dérivée du nom : stable, distincte d'une équipe à l'autre, et
    // sans demander un choix de plus au participant.
    $palette = ['#1e6e3e', '#c04f2e', '#2d9959', '#b26a00', '#5b7596', '#7a6ba8', '#3f7a75', '#a3651f'];
    $couleur = $palette[crc32(mb_strtolower($nom)) % count($palette)];
    $ordre   = (int)$agg['m'] + 1;

    $stmt = mysqli_prepare($conn,
        'INSERT INTO equipes (evenement_id, nom, couleur, ordre, creee_par) VALUES (?, ?, ?, ?, ?)');
    $stmt->bind_param('issii', $p['evenement_id'], $nom, $couleur, $ordre, $p['id']);
    if (!$stmt->execute()) {
        echo json_encode(['error' => "L'équipe n'a pas pu être créée."], JSON_UNESCAPED_UNICODE); exit;
    }
    $equipe_id = $stmt->insert_id;

    $stmt = mysqli_prepare($conn, 'UPDATE participants SET equipe_id = ? WHERE id = ?');
    $stmt->bind_param('ii', $equipe_id, $p['id']);
    $stmt->execute();

    echo json_encode(['ok' => true, 'equipe_id' => $equipe_id, 'nom' => $nom], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── ÉQUIPES DISPONIBLES (écran de choix, mode libre) ───────────────────────
if ($action === 'equipes') {
    $p   = participant_ou_403($conn);
    $evt = charger_evenement($conn, $p['evenement_id']);

    $stmt = mysqli_prepare($conn,
        'SELECT e.id, e.nom, e.couleur, (SELECT COUNT(*) FROM participants x WHERE x.equipe_id = e.id) AS membres
         FROM equipes e WHERE e.evenement_id = ? ORDER BY e.ordre, e.id');
    $stmt->bind_param('i', $p['evenement_id']);
    $stmt->execute();
    $res = $stmt->get_result();

    $taille_max = (int)($evt['equipe_taille_max'] ?? 0);
    $equipes = [];
    while ($row = $res->fetch_assoc()) {
        $n = (int)$row['membres'];
        $equipes[] = [
            'id' => (int)$row['id'], 'nom' => $row['nom'], 'couleur' => $row['couleur'],
            'membres' => $n,
            // Calcule ici et non dans le navigateur : c'est le serveur qui
            // tranchera de toute facon au moment de rejoindre, autant que
            // l'ecran dise la meme chose que lui.
            'complete' => $taille_max > 0 && $n >= $taille_max,
            'mienne'   => (int)$p['equipe_id'] === (int)$row['id'],
        ];
    }

    $equipes_max = (int)($evt['equipes_max'] ?? 0);
    echo json_encode([
        'equipes'           => $equipes,
        'mode'              => $evt['mode_equipes'] ?? 'aucun',
        // Le bouton de creation disparait quand le plafond est atteint, plutot
        // que d'echouer apres la saisie d'un nom.
        'peut_creer'        => ($evt['mode_equipes'] ?? '') === 'autonome'
                               && ($equipes_max === 0 || count($equipes) < $equipes_max),
        'equipes_max'       => $equipes_max,
        'equipe_taille_max' => $taille_max,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── CLASSEMENT (vu par un participant) ─────────────────────────────────────
if ($action === 'classement') {
    $p = participant_ou_403($conn);

    $stmt = mysqli_prepare($conn,
        'SELECT p.nom_affiche, COALESCE(SUM(r.points), 0) AS points
         FROM participants p LEFT JOIN reponses r ON r.participant_id = p.id
         WHERE p.evenement_id = ?
         GROUP BY p.id, p.nom_affiche ORDER BY points DESC, p.rejoint_at ASC LIMIT 20');
    $stmt->bind_param('i', $p['evenement_id']);
    $stmt->execute();
    $res = $stmt->get_result();
    $joueurs = [];
    while ($row = $res->fetch_assoc()) $joueurs[] = ['nom' => $row['nom_affiche'], 'points' => (int)$row['points']];

    $stmt = mysqli_prepare($conn,
        'SELECT e.nom, e.couleur, COALESCE(SUM(r.points), 0) AS points
         FROM equipes e
         LEFT JOIN participants p ON p.equipe_id = e.id
         LEFT JOIN reponses r ON r.participant_id = p.id
         WHERE e.evenement_id = ?
         GROUP BY e.id, e.nom, e.couleur ORDER BY points DESC, e.ordre ASC');
    $stmt->bind_param('i', $p['evenement_id']);
    $stmt->execute();
    $res = $stmt->get_result();
    $equipes = [];
    while ($row = $res->fetch_assoc()) $equipes[] = ['nom' => $row['nom'], 'couleur' => $row['couleur'], 'points' => (int)$row['points']];

    echo json_encode(['joueurs' => $joueurs, 'equipes' => $equipes], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
