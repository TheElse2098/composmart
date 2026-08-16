<?php
/**
 * Bibliothèque de parcours (modèles d'animation réutilisables) et édition de
 * leurs slides. Réservé aux administrateurs.
 *
 * Un parcours est un MODÈLE : l'affecter à un événement en copie les slides
 * (cf. admin.php action=affecter_parcours). Supprimer un parcours ne casse
 * donc aucun atelier déjà joué — c'est ce qui permet une vraie suppression ici,
 * là où les événements, eux, ne connaissent que la suppression douce.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin.php';
require_once __DIR__ . '/_slides.php';

$conn = evt_admin_connexion_ou_403();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

/** Renvoie les slides d'un parcours, contenu décodé. */
function lire_slides($conn, $parcours_id) {
    $stmt = mysqli_prepare($conn,
        'SELECT id, ordre, type, titre, contenu, points FROM parcours_slides WHERE parcours_id = ? ORDER BY ordre, id');
    $stmt->bind_param('i', $parcours_id);
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
    return $slides;
}

/** Prochain `ordre` disponible dans un parcours. */
function ordre_suivant($conn, $parcours_id) {
    $stmt = mysqli_prepare($conn, 'SELECT COALESCE(MAX(ordre), -1) + 1 AS n FROM parcours_slides WHERE parcours_id = ?');
    $stmt->bind_param('i', $parcours_id);
    $stmt->execute();
    return (int)$stmt->get_result()->fetch_assoc()['n'];
}

// ── REGISTRE DES TYPES (alimente l'éditeur) ─────────────────────────────────
if ($action === 'types') {
    echo json_encode(['types' => slides_registre(), 'jeux' => slides_jeux_valides()], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── POOLS DES JEUX (pour peupler une slide de type « jeu ») ────────────────
// Les éléments sont recopiés dans la slide au moment de l'import : un parcours
// déjà écrit ne bouge donc pas si le jeu d'origine évolue.
if ($action === 'pools') {
    $chemin = '/var/www/evenements-data/jeux-pools.json';
    $brut = @file_get_contents($chemin);
    $pools = $brut !== false ? json_decode($brut, true) : null;
    if (!is_array($pools)) { echo json_encode(['error' => 'Pools indisponibles.']); exit; }
    echo json_encode(['pools' => $pools], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── LISTE DES PARCOURS ──────────────────────────────────────────────────────
if ($action === 'liste') {
    $res = mysqli_query($conn,
        'SELECT p.id, p.nom, p.description, p.cree_par, p.maj_at,
                (SELECT COUNT(*) FROM parcours_slides s WHERE s.parcours_id = p.id) AS nb_slides,
                (SELECT COALESCE(SUM(s.points), 0) FROM parcours_slides s WHERE s.parcours_id = p.id) AS total_points
         FROM parcours p ORDER BY p.maj_at DESC');
    $parcours = [];
    while ($row = $res->fetch_assoc()) {
        $row['id'] = (int)$row['id'];
        $row['nb_slides'] = (int)$row['nb_slides'];
        $row['total_points'] = (int)$row['total_points'];
        $parcours[] = $row;
    }
    echo json_encode(['parcours' => $parcours], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── DÉTAIL D'UN PARCOURS (avec ses slides) ──────────────────────────────────
if ($action === 'detail') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Parcours invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id, nom, description FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $p = $stmt->get_result()->fetch_assoc();
    if (!$p) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }
    $p['id'] = (int)$p['id'];

    echo json_encode(['parcours' => $p, 'slides' => lire_slides($conn, $id)], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── CRÉER ───────────────────────────────────────────────────────────────────
if ($action === 'creer') {
    $nom = trim($_POST['nom'] ?? '');
    if ($nom === '' || mb_strlen($nom) > 150) { echo json_encode(['error' => 'Nom invalide (150 caractères max).']); exit; }
    $desc = mb_substr(trim($_POST['description'] ?? ''), 0, 300);
    $auteur = $_SESSION['username'] ?? '';

    $stmt = mysqli_prepare($conn, 'INSERT INTO parcours (nom, description, cree_par) VALUES (?, ?, ?)');
    $stmt->bind_param('sss', $nom, $desc, $auteur);
    $stmt->execute();
    $id = $stmt->insert_id;

    audit_log($conn, 'parcours_cree', $nom, ['target_type' => 'parcours', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'id' => $id], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── RENOMMER / DÉCRIRE ──────────────────────────────────────────────────────
if ($action === 'modifier') {
    $id  = (int)($_POST['id'] ?? 0);
    $nom = trim($_POST['nom'] ?? '');
    if ($id <= 0 || $nom === '' || mb_strlen($nom) > 150) { echo json_encode(['error' => 'Données invalides.']); exit; }
    $desc = mb_substr(trim($_POST['description'] ?? ''), 0, 300);

    $stmt = mysqli_prepare($conn, 'UPDATE parcours SET nom = ?, description = ? WHERE id = ?');
    $stmt->bind_param('ssi', $nom, $desc, $id);
    $stmt->execute();

    audit_log($conn, 'parcours_modifie', $nom, ['target_type' => 'parcours', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── DUPLIQUER (repartir d'un parcours existant sans le modifier) ────────────
if ($action === 'dupliquer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Parcours invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT nom, description FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $src = $stmt->get_result()->fetch_assoc();
    if (!$src) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }

    $nom = mb_substr($src['nom'] . ' (copie)', 0, 150);
    $auteur = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($conn, 'INSERT INTO parcours (nom, description, cree_par) VALUES (?, ?, ?)');
    $stmt->bind_param('sss', $nom, $src['description'], $auteur);
    $stmt->execute();
    $neuf = $stmt->insert_id;

    $stmt = mysqli_prepare($conn,
        'INSERT INTO parcours_slides (parcours_id, ordre, type, titre, contenu, points)
         SELECT ?, ordre, type, titre, contenu, points FROM parcours_slides WHERE parcours_id = ?');
    $stmt->bind_param('ii', $neuf, $id);
    $stmt->execute();

    audit_log($conn, 'parcours_duplique', $nom, ['target_type' => 'parcours', 'target_id' => $neuf]);
    echo json_encode(['ok' => true, 'id' => $neuf], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── SUPPRIMER ───────────────────────────────────────────────────────────────
// Suppression réelle (contrairement aux événements) : les slides des ateliers
// déjà joués en sont des copies indépendantes, rien ne casse en aval.
if ($action === 'supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Parcours invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'DELETE FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }

    audit_log($conn, 'parcours_supprime', '', ['target_type' => 'parcours', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── AJOUTER UNE SLIDE ───────────────────────────────────────────────────────
if ($action === 'slide_ajouter') {
    $d = evt_corps_json();
    $parcours_id = (int)($d['parcours_id'] ?? 0);
    $type = (string)($d['type'] ?? '');
    if ($parcours_id <= 0 || !slide_type_valide($type)) { echo json_encode(['error' => 'Type de slide inconnu.']); exit; }

    $v = valider_contenu($type, $d['contenu'] ?? []);
    if (!$v['ok']) { echo json_encode(['error' => $v['erreur']]); exit; }

    $titre  = mb_substr(trim((string)($d['titre'] ?? '')), 0, 200);
    $points = max(0, min(1000, (int)($d['points'] ?? 0)));
    // Une slide qui ne se répond pas ne rapporte rien : évite un total de
    // points faussé par une valeur saisie sur une slide d'affichage.
    $reg = slides_registre();
    if ($reg[$type]['note'] === false) $points = 0;

    $ordre = ordre_suivant($conn, $parcours_id);
    $json  = json_encode($v['contenu'], JSON_UNESCAPED_UNICODE);

    $stmt = mysqli_prepare($conn,
        'INSERT INTO parcours_slides (parcours_id, ordre, type, titre, contenu, points) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('iisssi', $parcours_id, $ordre, $type, $titre, $json, $points);
    $stmt->execute();

    mysqli_query($conn, 'UPDATE parcours SET maj_at = NOW() WHERE id = ' . $parcours_id);
    echo json_encode(['ok' => true, 'id' => $stmt->insert_id], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── MODIFIER UNE SLIDE ──────────────────────────────────────────────────────
if ($action === 'slide_modifier') {
    $d  = evt_corps_json();
    $id = (int)($d['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Slide invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT parcours_id, type FROM parcours_slides WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $s = $stmt->get_result()->fetch_assoc();
    if (!$s) { echo json_encode(['error' => 'Slide introuvable.']); exit; }

    // Le type d'une slide ne change pas après création : changer de type
    // rendrait le contenu déjà saisi incohérent. Pour en changer, on supprime
    // et on recrée.
    $v = valider_contenu($s['type'], $d['contenu'] ?? []);
    if (!$v['ok']) { echo json_encode(['error' => $v['erreur']]); exit; }

    $titre  = mb_substr(trim((string)($d['titre'] ?? '')), 0, 200);
    $points = max(0, min(1000, (int)($d['points'] ?? 0)));
    $reg = slides_registre();
    if ($reg[$s['type']]['note'] === false) $points = 0;
    $json = json_encode($v['contenu'], JSON_UNESCAPED_UNICODE);

    $stmt = mysqli_prepare($conn, 'UPDATE parcours_slides SET titre = ?, contenu = ?, points = ? WHERE id = ?');
    $stmt->bind_param('ssii', $titre, $json, $points, $id);
    $stmt->execute();

    mysqli_query($conn, 'UPDATE parcours SET maj_at = NOW() WHERE id = ' . (int)$s['parcours_id']);
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER UNE SLIDE ─────────────────────────────────────────────────────
if ($action === 'slide_supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Slide invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'DELETE FROM parcours_slides WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Slide introuvable.']); exit; }

    echo json_encode(['ok' => true]);
    exit;
}

// ── RÉORDONNER ──────────────────────────────────────────────────────────────
// Reçoit la liste ordonnée des ids ; réécrit `ordre` en une passe.
if ($action === 'slide_reordonner') {
    $d = evt_corps_json();
    $parcours_id = (int)($d['parcours_id'] ?? 0);
    $ids = array_values(array_filter(array_map('intval', (array)($d['ordre'] ?? []))));
    if ($parcours_id <= 0 || !$ids) { echo json_encode(['error' => 'Ordre invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE parcours_slides SET ordre = ? WHERE id = ? AND parcours_id = ?');
    foreach ($ids as $rang => $sid) {
        $stmt->bind_param('iii', $rang, $sid, $parcours_id);
        $stmt->execute();
    }

    mysqli_query($conn, 'UPDATE parcours SET maj_at = NOW() WHERE id = ' . $parcours_id);
    echo json_encode(['ok' => true]);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
