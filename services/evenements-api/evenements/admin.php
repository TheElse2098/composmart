<?php
// Back-office événements : créer, piloter le cycle de vie, lister, suivre les
// inscrits, affecter un parcours. Garde admin dans _admin.php (partagée avec
// parcours.php et animation.php).
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin.php';
require_once __DIR__ . '/_slides.php';

$conn = evt_admin_connexion_ou_403();

// Alphabet sans caractères ambigus (pas de 0/O/1/I) : le code est projeté en
// salle et lu à voix haute, il doit rester sans ambiguïté visuelle ou orale.
const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generer_code_evenement($conn) {
    for ($tentative = 0; $tentative < 10; $tentative++) {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= ALPHABET_CODE[random_int(0, strlen(ALPHABET_CODE) - 1)];
        }
        $stmt = mysqli_prepare($conn, 'SELECT id FROM evenements WHERE code = ?');
        $stmt->bind_param('s', $code);
        $stmt->execute();
        if (!$stmt->get_result()->fetch_assoc()) return $code;
    }
    return null; // improbable : 33^6 combinaisons
}

/**
 * Le déroulé d'un événement n'est modifiable que tant que l'atelier n'a pas
 * démarré. Deux raisons, l'une évidente et l'autre moins :
 *
 *  1. changer les slides sous les pieds d'une salle en train de jouer produit
 *     des écrans désynchronisés, l'animateur pointant une question que plus
 *     personne n'a ;
 *  2. supprimer une slide fait tomber les `reponses` qui la référencent
 *     (ON DELETE CASCADE) : les points déjà gagnés disparaîtraient du
 *     classement sans laisser de trace.
 *
 * Renvoie null si l'événement est modifiable, sinon le motif du refus.
 */
function evt_deroule_verrou($conn, $evenement_id) {
    $stmt = mysqli_prepare($conn, 'SELECT statut, supprime FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $e = $stmt->get_result()->fetch_assoc();
    if (!$e) return 'Événement introuvable.';
    if ((int)$e['supprime'] === 1) return 'Cet événement est supprimé : son déroulé est en lecture seule.';

    $motifs = [
        'en_cours' => "L'atelier est en cours : son déroulé ne peut plus être modifié.",
        'termine'  => "Cet atelier est terminé : son déroulé est en lecture seule.",
        'annule'   => "Cet événement est annulé : son déroulé est en lecture seule.",
    ];
    if (isset($motifs[$e['statut']])) return $motifs[$e['statut']];

    // Ceinture et bretelles : un statut « prévu » ne devrait jamais coexister
    // avec des réponses, mais si cela arrivait, les points priment.
    $stmt = mysqli_prepare($conn, 'SELECT COUNT(*) AS n FROM reponses WHERE evenement_id = ?');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    if ((int)$stmt->get_result()->fetch_assoc()['n'] > 0) {
        return 'Des participants ont déjà répondu : le déroulé ne peut plus être modifié.';
    }
    return null;
}

/** Événement propriétaire d'une slide, ou 0. Sert à refuser toute opération
 *  sur une slide qui n'appartient pas à l'événement annoncé. */
function evt_slide_proprietaire($conn, $slide_id) {
    $stmt = mysqli_prepare($conn, 'SELECT evenement_id FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $slide_id);
    $stmt->execute();
    $r = $stmt->get_result()->fetch_assoc();
    return $r ? (int)$r['evenement_id'] : 0;
}

/** Titre d'un événement pour le journal d'audit : sans lui, une ligne
 *  « Événement annulé » ne dit pas lequel. */
function evt_titre($conn, $id) {
    $stmt = mysqli_prepare($conn, 'SELECT titre FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $r = $stmt->get_result()->fetch_assoc();
    return $r ? $r['titre'] : "événement #$id";
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── CRÉER UN ÉVÉNEMENT ──────────────────────────────────────────────────────
if ($action === 'creer') {
    $titre      = trim($_POST['titre'] ?? '');
    $lieu       = trim($_POST['lieu'] ?? '');
    $date_debut = trim($_POST['date_debut'] ?? '');

    if ($titre === '' || mb_strlen($titre) > 150) { echo json_encode(['error' => 'Titre invalide (150 caractères max).']); exit; }
    $ts = strtotime($date_debut);
    if ($date_debut === '' || $ts === false) { echo json_encode(['error' => 'Date de début invalide.']); exit; }

    $code = generer_code_evenement($conn);
    if ($code === null) { echo json_encode(['error' => 'Impossible de générer un code, réessaie.']); exit; }

    $lieu_val   = $lieu !== '' ? $lieu : null;
    $date_sql   = date('Y-m-d H:i:s', $ts);
    $cree_par   = $_SESSION['username'] ?? '';

    $stmt = mysqli_prepare($conn,
        'INSERT INTO evenements (titre, lieu, date_debut, code, cree_par) VALUES (?, ?, ?, ?, ?)');
    $stmt->bind_param('sssss', $titre, $lieu_val, $date_sql, $code, $cree_par);
    $stmt->execute();

    audit_log($conn, 'evenement_cree', $titre, ['target_type' => 'evenement', 'target_id' => $stmt->insert_id]);

    echo json_encode(['ok' => true, 'id' => $stmt->insert_id, 'code' => $code], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── TRANSITIONS DE STATUT ────────────────────────────────────────────────────
// 5 statuts mutuellement exclusifs. 'en_cours'/'termine' sont des bascules
// manuelles le jour de l'atelier (pas de calcul automatique par horloge).
// 'ouvert' peut revenir à 'prevu' (couper les inscriptions sans annuler).
$STATUTS_ACTION = [
    'ouvrir'    => 'ouvert',
    'reprevoir' => 'prevu',
    'demarrer'  => 'en_cours',
    'terminer'  => 'termine',
    'annuler'   => 'annule',
];
if (isset($STATUTS_ACTION[$action])) {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $nouveau_statut = $STATUTS_ACTION[$action];
    $stmt = mysqli_prepare($conn, 'UPDATE evenements SET statut = ? WHERE id = ? AND supprime = 0');
    $stmt->bind_param('si', $nouveau_statut, $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Événement introuvable ou supprimé.']); exit; }

    audit_log($conn, 'evenement_' . $nouveau_statut, evt_titre($conn, $id), ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER (doux : flag indépendant du statut, aucune donnée effacée) ───
if ($action === 'supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE evenements SET supprime = 1 WHERE id = ? AND supprime = 0');
    $stmt->bind_param('i', $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Événement introuvable ou déjà supprimé.']); exit; }

    audit_log($conn, 'evenement_supprime', evt_titre($conn, $id), ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── RESTAURER (retire le flag de suppression, statut de cycle de vie inchangé) ──
if ($action === 'restaurer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE evenements SET supprime = 0 WHERE id = ? AND supprime = 1');
    $stmt->bind_param('i', $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => "Événement introuvable ou pas dans les supprimés."]); exit; }

    audit_log($conn, 'evenement_restaure', evt_titre($conn, $id), ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── LISTE DES ÉVÉNEMENTS ─────────────────────────────────────────────────────
// ?supprimes=1 → uniquement les supprimés ; par défaut → tout sauf les supprimés.
// ?statut=<prevu|ouvert|en_cours|annule|termine> → filtre en plus par statut.
if ($action === 'liste') {
    $supprimes = ($_GET['supprimes'] ?? '') === '1' ? 1 : 0;
    $statuts_valides = ['prevu', 'ouvert', 'en_cours', 'annule', 'termine'];
    $statut_filtre = in_array($_GET['statut'] ?? '', $statuts_valides, true) ? $_GET['statut'] : null;

    $sql = 'SELECT e.id, e.titre, e.lieu, e.date_debut, e.code, e.statut, e.supprime, e.created_at,
                (SELECT COUNT(*) FROM participants p WHERE p.evenement_id = e.id) AS nb_participants
         FROM evenements e
         WHERE e.supprime = ?';
    $types = 'i';
    $params = [$supprimes];
    if ($statut_filtre !== null) {
        $sql .= ' AND e.statut = ?';
        $types .= 's';
        $params[] = $statut_filtre;
    }
    $sql .= ' ORDER BY e.date_debut DESC';

    $stmt = mysqli_prepare($conn, $sql);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result();
    $evenements = [];
    while ($row = $res->fetch_assoc()) {
        $row['id'] = (int)$row['id'];
        $row['supprime'] = (int)$row['supprime'] === 1;
        $row['nb_participants'] = (int)$row['nb_participants'];
        $evenements[] = $row;
    }
    echo json_encode(['evenements' => $evenements], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── AFFECTER UN PARCOURS (copie ses slides dans l'événement) ───────────────
// La copie est le mécanisme qui rend un parcours réutilisable sans figer les
// ateliers déjà joués (cf. db/evenements.sql, table evenement_slides).
/**
 * Recopie les slides d'un parcours À LA SUITE du déroulé d'un événement et
 * enregistre la provenance. Les slides copiées sont ensuite indépendantes du
 * modèle : c'est ce qui permet d'adapter un déroulé pour un client sans
 * toucher au parcours de la bibliothèque, et de ne pas réécrire l'historique
 * d'un atelier déjà joué.
 *
 * Renvoie [nb_copiees, nom_du_parcours] ou [0, null] si le parcours n'existe pas.
 */
function evt_chainer_parcours($conn, $evenement_id, $parcours_id) {
    $stmt = mysqli_prepare($conn, 'SELECT nom FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $parcours_id);
    $stmt->execute();
    $p = $stmt->get_result()->fetch_assoc();
    if (!$p) return [0, null];

    // On repart du dernier rang occupé : sans ce décalage, les slides ajoutées
    // se mélangeraient aux précédentes puisque l'ordre du modèle recommence à 0.
    $stmt = mysqli_prepare($conn, 'SELECT COALESCE(MAX(ordre), -1) AS m FROM evenement_slides WHERE evenement_id = ?');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $decalage = (int)$stmt->get_result()->fetch_assoc()['m'] + 1;

    $stmt = mysqli_prepare($conn,
        'INSERT INTO evenement_slides (evenement_id, ordre, type, titre, contenu, points)
         SELECT ?, ordre + ?, type, titre, contenu, points FROM parcours_slides WHERE parcours_id = ? ORDER BY ordre, id');
    $stmt->bind_param('iii', $evenement_id, $decalage, $parcours_id);
    $stmt->execute();
    $copiees = mysqli_affected_rows($conn);

    $stmt = mysqli_prepare($conn, 'SELECT COALESCE(MAX(ordre), -1) AS m FROM evenement_parcours WHERE evenement_id = ?');
    $stmt->bind_param('i', $evenement_id);
    $stmt->execute();
    $rang = (int)$stmt->get_result()->fetch_assoc()['m'] + 1;

    $stmt = mysqli_prepare($conn,
        'INSERT INTO evenement_parcours (evenement_id, parcours_id, nom, ordre, nb_slides) VALUES (?, ?, ?, ?, ?)');
    $stmt->bind_param('iisii', $evenement_id, $parcours_id, $p['nom'], $rang, $copiees);
    $stmt->execute();

    return [$copiees, $p['nom']];
}

// ── AFFECTER UN PARCOURS (remplace tout le déroulé) ────────────────────────
if ($action === 'affecter_parcours') {
    $id          = (int)($_POST['id'] ?? 0);
    $parcours_id = (int)($_POST['parcours_id'] ?? 0);
    if ($id <= 0 || $parcours_id <= 0) { echo json_encode(['error' => 'Données invalides.']); exit; }

    $verrou = evt_deroule_verrou($conn, $id);
    if ($verrou) { echo json_encode(['error' => $verrou], JSON_UNESCAPED_UNICODE); exit; }

    $stmt = mysqli_prepare($conn, 'DELETE FROM evenement_slides WHERE evenement_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $stmt = mysqli_prepare($conn, 'DELETE FROM evenement_parcours WHERE evenement_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();

    [$copiees, $nom] = evt_chainer_parcours($conn, $id, $parcours_id);
    if ($nom === null) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE evenements SET parcours_id = ?, slide_courante_id = NULL WHERE id = ?');
    $stmt->bind_param('ii', $parcours_id, $id);
    $stmt->execute();

    audit_log($conn, 'evenement_parcours_affecte', evt_titre($conn, $id) . ' ← ' . $nom . ' (' . $copiees . ' slides)',
              ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'slides' => $copiees]);
    exit;
}

// ── ENCHAÎNER UN PARCOURS DE PLUS (ajoute à la suite) ──────────────────────
if ($action === 'ajouter_parcours') {
    $id          = (int)($_POST['id'] ?? 0);
    $parcours_id = (int)($_POST['parcours_id'] ?? 0);
    if ($id <= 0 || $parcours_id <= 0) { echo json_encode(['error' => 'Données invalides.']); exit; }

    $verrou = evt_deroule_verrou($conn, $id);
    if ($verrou) { echo json_encode(['error' => $verrou], JSON_UNESCAPED_UNICODE); exit; }

    [$copiees, $nom] = evt_chainer_parcours($conn, $id, $parcours_id);
    if ($nom === null) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }
    if ($copiees === 0) { echo json_encode(['error' => 'Ce parcours ne contient aucune slide.']); exit; }

    audit_log($conn, 'evenement_parcours_ajoute', evt_titre($conn, $id) . ' ← ' . $nom . ' (' . $copiees . ' slides)',
              ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'slides' => $copiees, 'nom' => $nom], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── RÉGLAGES D'ANIMATION ────────────────────────────────────────────────────
if ($action === 'reglages') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $mp = in_array($_POST['mode_parcours'] ?? '', ['commun', 'individuel'], true) ? $_POST['mode_parcours'] : 'commun';
    $me = in_array($_POST['mode_equipes'] ?? '', ['aucun', 'manuel', 'auto', 'libre', 'autonome'], true) ? $_POST['mode_equipes'] : 'aucun';
    // Plafonds du mode autonome. 0 = illimite ; bornes hautes pour qu'une
    // saisie fantaisiste ne cree pas un plafond absurde.
    $emax = max(0, min(200, (int)($_POST['equipes_max'] ?? 0)));
    $tmax = max(0, min(200, (int)($_POST['equipe_taille_max'] ?? 0)));
    $th = in_array($_POST['theme_slides'] ?? '', ['foret', 'papier', 'simpliste'], true) ? $_POST['theme_slides'] : 'foret';

    // Tags d'images retenus. Normalisés comme dans la banque (minuscules,
    // espaces resserrés) : un tag mal cadré ne trouverait jamais son image.
    $tags = [];
    foreach (preg_split('/[,;]+/u', (string)($_POST['image_tags'] ?? '')) as $t) {
        $t = mb_strtolower(trim(preg_replace('/\s+/u', ' ', $t)));
        if ($t !== '' && !in_array($t, $tags, true)) $tags[] = mb_substr($t, 0, 40);
        if (count($tags) >= 12) break;
    }
    $it = mb_substr(implode(',', $tags), 0, 400);

    $stmt = mysqli_prepare($conn, 'UPDATE evenements SET mode_parcours = ?, mode_equipes = ?, equipes_max = ?, equipe_taille_max = ?, theme_slides = ?, image_tags = ? WHERE id = ? AND supprime = 0');
    $stmt->bind_param('ssiissi', $mp, $me, $emax, $tmax, $th, $it, $id);
    if (!$stmt->execute()) {
        echo json_encode(['error' => 'La base a refusé ces réglages : ' . $stmt->error]);
        exit;
    }

    // On RELIT la valeur stockée au lieu de faire confiance à l'UPDATE. Quand la
    // colonne theme_slides ne connaît pas encore une valeur (migration pas
    // appliquée), MariaDB la refuse en mode strict, mais la TRONQUE en silence
    // sinon : execute() renvoie true, la ligne contient '', et l'écran annonçait
    // « Enregistré » alors que le thème revenait au précédent au rechargement.
    $stmt = mysqli_prepare($conn, 'SELECT theme_slides FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $apres = $stmt->get_result()->fetch_assoc();
    if (!$apres || $apres['theme_slides'] !== $th) {
        echo json_encode(['error' =>
            "Le thème « $th » n'a pas pu être enregistré : la colonne theme_slides ne connaît pas "
            . "encore cette valeur : le schéma de db-evenements n'est pas à jour (cf. db/evenements.sql)."],
            JSON_UNESCAPED_UNICODE);
        exit;
    }

    echo json_encode(['ok' => true]);
    exit;
}

// ── SLIDES DE L'ÉVÉNEMENT (la copie, éditable indépendamment du parcours) ──
if ($action === 'slides') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn,
        'SELECT id, ordre, type, titre, contenu, points FROM evenement_slides WHERE evenement_id = ? ORDER BY ordre, id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $slides = [];
    while ($row = $res->fetch_assoc()) {
        $c = json_decode($row['contenu'] ?? '', true);
        $slides[] = [
            'id'      => (int)$row['id'],
            'ordre'   => (int)$row['ordre'],
            'type'    => $row['type'],
            'titre'   => $row['titre'],
            'points'  => (int)$row['points'],
            'contenu' => is_array($c) ? $c : [],
        ];
    }
    echo json_encode(['slides' => $slides, 'types' => slides_registre()], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── DÉROULÉ COMPLET (slides + provenance + droit de modifier) ──────────────
// Sert la vue d'édition : mêmes champs que parcours.php?action=detail, plus
// `modifiable` et `verrou`, pour que l'éditeur sache s'il doit passer en
// lecture seule et pourquoi.
if ($action === 'deroule') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id, titre, code, statut, supprime FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();
    if (!$evt) { echo json_encode(['error' => 'Événement introuvable.']); exit; }

    $stmt = mysqli_prepare($conn,
        'SELECT id, ordre, type, titre, contenu, points FROM evenement_slides WHERE evenement_id = ? ORDER BY ordre, id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $slides = [];
    while ($row = $res->fetch_assoc()) {
        $c = json_decode($row['contenu'] ?? '', true);
        $slides[] = [
            'id' => (int)$row['id'], 'ordre' => (int)$row['ordre'], 'type' => $row['type'],
            'titre' => $row['titre'], 'points' => (int)$row['points'],
            'contenu' => is_array($c) ? $c : [],
        ];
    }

    $stmt = mysqli_prepare($conn,
        'SELECT parcours_id, nom, nb_slides FROM evenement_parcours WHERE evenement_id = ? ORDER BY ordre, id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $sources = [];
    while ($row = $res->fetch_assoc()) {
        $sources[] = ['parcours_id' => $row['parcours_id'] === null ? null : (int)$row['parcours_id'],
                      'nom' => $row['nom'], 'nb_slides' => (int)$row['nb_slides']];
    }

    $verrou = evt_deroule_verrou($conn, $id);
    echo json_encode([
        'evenement'  => ['id' => (int)$evt['id'], 'titre' => $evt['titre'],
                         'code' => $evt['code'], 'statut' => $evt['statut']],
        'slides'     => $slides,
        'sources'    => $sources,
        'modifiable' => $verrou === null,
        'verrou'     => $verrou,
        'types'      => slides_registre(),
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── AJOUTER UNE SLIDE AU DÉROULÉ ───────────────────────────────────────────
if ($action === 'slide_ajouter') {
    $d   = evt_corps_json();
    $id  = (int)($d['evenement_id'] ?? 0);
    $type = (string)($d['type'] ?? '');
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $verrou = evt_deroule_verrou($conn, $id);
    if ($verrou) { echo json_encode(['error' => $verrou], JSON_UNESCAPED_UNICODE); exit; }

    $reg = slides_registre();
    if (!isset($reg[$type])) { echo json_encode(['error' => 'Type de slide inconnu.']); exit; }

    $v = valider_contenu($type, $d['contenu'] ?? []);
    if (!$v['ok']) { echo json_encode(['error' => $v['erreur']], JSON_UNESCAPED_UNICODE); exit; }

    $titre  = mb_substr(trim((string)($d['titre'] ?? '')), 0, 200);
    $points = max(0, min(1000, (int)($d['points'] ?? 0)));
    if ($reg[$type]['note'] === false) $points = 0;
    $json = json_encode($v['contenu'], JSON_UNESCAPED_UNICODE);

    $stmt = mysqli_prepare($conn, 'SELECT COALESCE(MAX(ordre), -1) AS m FROM evenement_slides WHERE evenement_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $ordre = (int)$stmt->get_result()->fetch_assoc()['m'] + 1;

    $stmt = mysqli_prepare($conn,
        'INSERT INTO evenement_slides (evenement_id, ordre, type, titre, contenu, points) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('iisssi', $id, $ordre, $type, $titre, $json, $points);
    $stmt->execute();
    echo json_encode(['ok' => true, 'id' => $stmt->insert_id]);
    exit;
}

// ── MODIFIER UNE SLIDE DE L'ÉVÉNEMENT (adaptation pour ce client) ─────────
if ($action === 'slide_modifier') {
    $d  = evt_corps_json();
    $sid = (int)($d['id'] ?? 0);
    if ($sid <= 0) { echo json_encode(['error' => 'Slide invalide.']); exit; }

    // La slide porte son propriétaire : c'est lui qui décide du verrou. La
    // version précédente acceptait n'importe quel identifiant sans regarder à
    // quel événement il appartenait, ni si celui-ci était en cours.
    $proprio = evt_slide_proprietaire($conn, $sid);
    if ($proprio === 0) { echo json_encode(['error' => 'Slide introuvable.']); exit; }
    $verrou = evt_deroule_verrou($conn, $proprio);
    if ($verrou) { echo json_encode(['error' => $verrou], JSON_UNESCAPED_UNICODE); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT type FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $s = $stmt->get_result()->fetch_assoc();

    $v = valider_contenu($s['type'], $d['contenu'] ?? []);
    if (!$v['ok']) { echo json_encode(['error' => $v['erreur']], JSON_UNESCAPED_UNICODE); exit; }

    $titre  = mb_substr(trim((string)($d['titre'] ?? '')), 0, 200);
    $points = max(0, min(1000, (int)($d['points'] ?? 0)));
    $reg = slides_registre();
    if ($reg[$s['type']]['note'] === false) $points = 0;
    $json = json_encode($v['contenu'], JSON_UNESCAPED_UNICODE);

    $stmt = mysqli_prepare($conn, 'UPDATE evenement_slides SET titre = ?, contenu = ?, points = ? WHERE id = ?');
    $stmt->bind_param('ssii', $titre, $json, $points, $sid);
    $stmt->execute();
    echo json_encode(['ok' => true]);
    exit;
}

// ── RÉORDONNER LE DÉROULÉ ──────────────────────────────────────────────────
if ($action === 'slide_reordonner') {
    $d     = evt_corps_json();
    $id    = (int)($d['evenement_id'] ?? 0);
    $ordre = $d['ordre'] ?? null;
    if ($id <= 0 || !is_array($ordre)) { echo json_encode(['error' => 'Données invalides.']); exit; }

    $verrou = evt_deroule_verrou($conn, $id);
    if ($verrou) { echo json_encode(['error' => $verrou], JSON_UNESCAPED_UNICODE); exit; }

    // Le WHERE porte aussi sur evenement_id : un identifiant glissé dans la
    // liste ne peut pas déplacer la slide d'un autre événement.
    $stmt = mysqli_prepare($conn, 'UPDATE evenement_slides SET ordre = ? WHERE id = ? AND evenement_id = ?');
    $rang = 0;
    foreach ($ordre as $sid) {
        $sid = (int)$sid;
        if ($sid <= 0) continue;
        $stmt->bind_param('iii', $rang, $sid, $id);
        $stmt->execute();
        $rang++;
    }
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER UNE SLIDE DE L'ÉVÉNEMENT ─────────────────────────────────────
if ($action === 'slide_supprimer') {
    $sid = (int)($_POST['id'] ?? 0);
    if ($sid <= 0) { echo json_encode(['error' => 'Slide invalide.']); exit; }

    $proprio = evt_slide_proprietaire($conn, $sid);
    if ($proprio === 0) { echo json_encode(['error' => 'Slide introuvable.']); exit; }
    $verrou = evt_deroule_verrou($conn, $proprio);
    if ($verrou) { echo json_encode(['error' => $verrou], JSON_UNESCAPED_UNICODE); exit; }

    $stmt = mysqli_prepare($conn, 'DELETE FROM evenement_slides WHERE id = ?');
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Slide introuvable.']); exit; }
    echo json_encode(['ok' => true]);
    exit;
}

// ── ÉQUIPES : définition (nombre et noms fixés par l'animateur) ────────────
// Redéfinir remplace les équipes existantes ; les participants qui y étaient
// rattachés repassent sans équipe (FK ON DELETE SET NULL). Les points, eux,
// vivent dans `reponses` et ne sont donc jamais perdus par cette opération.
if ($action === 'equipes_definir') {
    $d   = evt_corps_json();
    $id  = (int)($d['id'] ?? 0);
    $noms = array_values(array_filter(array_map(function ($n) {
        return mb_substr(trim((string)$n), 0, 80);
    }, (array)($d['noms'] ?? [])), function ($n) { return $n !== ''; }));

    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }
    if (count($noms) < 2) { echo json_encode(['error' => 'Il faut au moins deux équipes.']); exit; }
    if (count($noms) > 12) { echo json_encode(['error' => '12 équipes au maximum.']); exit; }

    // En mode autonome, les équipes appartiennent aux participants : redéfinir
    // la liste ferait un DELETE qui emporterait leur travail d'organisation et
    // renverrait tout le monde à l'écran de choix, en pleine séance. On refuse
    // plutôt que d'effacer — l'animateur garde la réaffectation individuelle
    // depuis l'onglet Participants.
    $stmt = mysqli_prepare($conn, 'SELECT mode_equipes FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $m = $stmt->get_result()->fetch_assoc();
    if ($m && $m['mode_equipes'] === 'autonome') {
        echo json_encode(['error' =>
            "En mode autonome, ce sont les participants qui créent les équipes : les redéfinir ici "
            . "effacerait les leurs. Change de mode d'équipes si tu veux reprendre la main."],
            JSON_UNESCAPED_UNICODE);
        exit;
    }

    $stmt = mysqli_prepare($conn, 'DELETE FROM equipes WHERE evenement_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();

    // Palette fixe : chaque équipe garde une couleur lisible en projection.
    $palette = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1',
                '#fdd835', '#6d4c41', '#ec407a', '#7cb342', '#5e35b1', '#00897b'];
    $stmt = mysqli_prepare($conn, 'INSERT INTO equipes (evenement_id, nom, couleur, ordre) VALUES (?, ?, ?, ?)');
    foreach ($noms as $i => $nom) {
        $couleur = $palette[$i % count($palette)];
        $stmt->bind_param('issi', $id, $nom, $couleur, $i);
        $stmt->execute();
    }

    audit_log($conn, 'evenement_equipes', evt_titre($conn, $id) . ' : ' . count($noms) . ' équipes', ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'equipes' => count($noms)]);
    exit;
}

// ── ÉQUIPES : liste avec effectifs ─────────────────────────────────────────
if ($action === 'equipes') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn,
        'SELECT e.id, e.nom, e.couleur, e.ordre,
                (SELECT COUNT(*) FROM participants p WHERE p.equipe_id = e.id) AS membres
         FROM equipes e WHERE e.evenement_id = ? ORDER BY e.ordre, e.id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $equipes = [];
    while ($row = $res->fetch_assoc()) {
        $equipes[] = ['id' => (int)$row['id'], 'nom' => $row['nom'], 'couleur' => $row['couleur'], 'membres' => (int)$row['membres']];
    }
    echo json_encode(['equipes' => $equipes], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── ÉQUIPES : rattacher un participant (répartition manuelle) ──────────────
if ($action === 'assigner_equipe') {
    $participant_id = (int)($_POST['participant_id'] ?? 0);
    $equipe_id      = (int)($_POST['equipe_id'] ?? 0);   // 0 = retirer de son équipe
    if ($participant_id <= 0) { echo json_encode(['error' => 'Participant invalide.']); exit; }

    if ($equipe_id > 0) {
        $stmt = mysqli_prepare($conn,
            'UPDATE participants p JOIN equipes e ON e.id = ?
             SET p.equipe_id = e.id WHERE p.id = ? AND e.evenement_id = p.evenement_id');
        $stmt->bind_param('ii', $equipe_id, $participant_id);
    } else {
        $stmt = mysqli_prepare($conn, 'UPDATE participants SET equipe_id = NULL WHERE id = ?');
        $stmt->bind_param('i', $participant_id);
    }
    $stmt->execute();
    echo json_encode(['ok' => true]);
    exit;
}

// ── ÉQUIPES : répartition aléatoire équilibrée ─────────────────────────────
// Tout le monde est rebrassé, y compris ceux déjà placés (comportement
// demandé). La distribution en tourniquet après mélange garantit des effectifs
// équilibrés, là où un tirage indépendant par personne créerait des écarts.
if ($action === 'repartir_auto') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id FROM equipes WHERE evenement_id = ? ORDER BY ordre, id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $equipes = [];
    while ($row = $res->fetch_assoc()) $equipes[] = (int)$row['id'];
    if (!$equipes) { echo json_encode(['error' => "Définis d'abord les équipes."]); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id FROM participants WHERE evenement_id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $ids = [];
    while ($row = $res->fetch_assoc()) $ids[] = (int)$row['id'];
    if (!$ids) { echo json_encode(['ok' => true, 'repartis' => 0]); exit; }

    shuffle($ids);
    $stmt = mysqli_prepare($conn, 'UPDATE participants SET equipe_id = ? WHERE id = ?');
    foreach ($ids as $i => $pid) {
        $eid = $equipes[$i % count($equipes)];
        $stmt->bind_param('ii', $eid, $pid);
        $stmt->execute();
    }

    audit_log($conn, 'evenement_repartition', evt_titre($conn, $id) . ' : ' . count($ids) . ' participants', ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'repartis' => count($ids)]);
    exit;
}

// ── SUIVI LIVE : détail + liste des participants ────────────────────────────
if ($action === 'suivi') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn,
        'SELECT e.id, e.titre, e.lieu, e.date_debut, e.code, e.statut, e.supprime,
                e.parcours_id, e.mode_equipes, e.equipes_max, e.equipe_taille_max,
                e.mode_parcours, e.theme_slides, e.image_tags,
                (SELECT COUNT(*) FROM evenement_slides s WHERE s.evenement_id = e.id) AS nb_slides,
                (SELECT p.nom FROM parcours p WHERE p.id = e.parcours_id) AS parcours_nom
         FROM evenements e WHERE e.id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();
    if (!$evt) { echo json_encode(['error' => 'Événement introuvable.']); exit; }
    $evt['id'] = (int)$evt['id'];
    $evt['supprime'] = (int)$evt['supprime'] === 1;
    $evt['nb_slides'] = (int)$evt['nb_slides'];

    $stmt = mysqli_prepare($conn,
        'SELECT p.id, p.nom_affiche, p.equipe_id, p.rejoint_at,
                COALESCE((SELECT SUM(r.points) FROM reponses r WHERE r.participant_id = p.id), 0) AS points
         FROM participants p WHERE p.evenement_id = ? ORDER BY p.rejoint_at DESC');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $participants = [];
    while ($row = $res->fetch_assoc()) {
        $row['id'] = (int)$row['id'];
        $row['equipe_id'] = $row['equipe_id'] !== null ? (int)$row['equipe_id'] : null;
        $row['points'] = (int)$row['points'];
        $participants[] = $row;
    }

    echo json_encode(['evenement' => $evt, 'participants' => $participants], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
