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

/** Une slide de parcours telle que le journal la garde. */
function slide_lire($conn, $sid) {
    $stmt = mysqli_prepare($conn, 'SELECT s.parcours_id, s.ordre, s.type, s.titre, s.contenu, s.points, p.nom AS parcours
                                   FROM parcours_slides s JOIN parcours p ON p.id = s.parcours_id WHERE s.id = ?');
    $stmt->bind_param('i', $sid);
    $stmt->execute();
    $s = $stmt->get_result()->fetch_assoc();
    if (!$s) return null;
    $s['contenu'] = json_decode($s['contenu'] ?? '', true) ?: [];
    $s['points'] = (int)$s['points'];
    return $s;
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

// Pools des jeux (pour peupler une slide de type « jeu ») : servis par
// games-api, propriétaire du contenu des jeux (/api/jeux/catalogue.php?action=pools).

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

    $stmt = mysqli_prepare($conn, 'SELECT nom, description FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $avant = $stmt->get_result()->fetch_assoc();
    if (!$avant) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }

    $stmt = mysqli_prepare($conn, 'UPDATE parcours SET nom = ?, description = ? WHERE id = ?');
    $stmt->bind_param('ssi', $nom, $desc, $id);
    $stmt->execute();

    audit_log($conn, 'parcours_modifie', $nom, [
        'target_type' => 'parcours', 'target_id' => $id,
        'snapshot'    => ['changements' => audit_changements($avant, ['nom' => $nom, 'description' => $desc])],
    ]);
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

    // État complet, slides comprises, lu avant que la cascade ne les emporte :
    // le journal le garde pour pouvoir recréer le parcours.
    $stmt = mysqli_prepare($conn, 'SELECT nom, description, cree_par FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $p = $stmt->get_result()->fetch_assoc();
    if ($p) $p['slides'] = lire_slides($conn, $id);

    $stmt = mysqli_prepare($conn, 'DELETE FROM parcours WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Parcours introuvable.']); exit; }

    audit_log($conn, 'parcours_supprime', $p['nom'] ?? "parcours #$id", [
        'target_type' => 'parcours', 'target_id' => $id, 'snapshot' => ['etat' => $p],
    ]);
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

    $avant = slide_lire($conn, $id);
    $stmt = mysqli_prepare($conn, 'UPDATE parcours_slides SET titre = ?, contenu = ?, points = ? WHERE id = ?');
    $stmt->bind_param('ssii', $titre, $json, $points, $id);
    $stmt->execute();

    $champs = fn($x) => ['titre' => $x['titre'], 'points' => $x['points'], 'contenu' => $x['contenu']];
    $changements = audit_changements($champs($avant), $champs(slide_lire($conn, $id)));
    if ($changements) {
        audit_log($conn, 'parcours_slide_modifiee', $avant['parcours'] . ' : ' . ($titre !== '' ? $titre : $s['type']), [
            'target_type' => 'parcours', 'target_id' => (int)$s['parcours_id'],
            'snapshot'    => ['type' => $s['type'], 'slide_id' => $id, 'changements' => $changements],
        ]);
    }

    mysqli_query($conn, 'UPDATE parcours SET maj_at = NOW() WHERE id = ' . (int)$s['parcours_id']);
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER UNE SLIDE ─────────────────────────────────────────────────────
if ($action === 'slide_supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Slide invalide.']); exit; }

    $etat = slide_lire($conn, $id);
    $stmt = mysqli_prepare($conn, 'DELETE FROM parcours_slides WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Slide introuvable.']); exit; }

    audit_log($conn, 'parcours_slide_supprimee', $etat['parcours'] . ' : ' . ($etat['titre'] ?: $etat['type']), [
        'target_type' => 'parcours', 'target_id' => (int)$etat['parcours_id'], 'snapshot' => ['etat' => $etat],
    ]);

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

// ── ANNULER depuis le journal ──────────────────────────────────────────────
// État d'avant relu dans le journal (db-core, via auth-api) ; refus si le
// parcours ou la slide a été retouché depuis. Un parcours supprimé revient
// sous un nouveau numéro, avec ses slides revalidées une à une.
if ($action === 'annuler') {
    $aid = audit_id_demande();
    $e = audit_annulation_debut($conn, $aid, [
        'parcours_modifie', 'parcours_supprime', 'parcours_slide_modifiee', 'parcours_slide_supprimee',
    ]);
    $s = $e['snapshot'];
    $echec = function ($m) use ($conn, $aid) { audit_annulation_echec($conn, $aid, $m); };
    $ok = function () { echo json_encode(['ok' => true]); exit; };
    $champs = fn($x) => ['titre' => $x['titre'], 'points' => $x['points'], 'contenu' => $x['contenu']];

    /** Slide revalidée (le registre a pu se durcir depuis) : [titre, json, points] ou message. */
    $preparer = function ($type, $titre, $contenu, $points) {
        if (!slide_type_valide($type)) return "type de slide « $type » inconnu";
        $v = valider_contenu($type, $contenu);
        if (!$v['ok']) return $v['erreur'];
        $reg = slides_registre();
        $points = $reg[$type]['note'] === false ? 0 : max(0, min(1000, (int)$points));
        return [mb_substr((string)$titre, 0, 200), json_encode($v['contenu'], JSON_UNESCAPED_UNICODE), $points];
    };

    if ($e['action'] === 'parcours_modifie') {
        $id = (int)$e['target_id'];
        $stmt = mysqli_prepare($conn, 'SELECT nom, description FROM parcours WHERE id = ?');
        $stmt->bind_param('i', $id);
        $stmt->execute();
        $actuel = $stmt->get_result()->fetch_assoc();
        if (!$actuel) $echec('Ce parcours a été supprimé depuis.');
        [$t, $err] = audit_revenir($actuel, $s['changements'] ?? []);
        if ($err) $echec($err);
        $stmt = mysqli_prepare($conn, 'UPDATE parcours SET nom = ?, description = ? WHERE id = ?');
        $stmt->bind_param('ssi', $t['nom'], $t['description'], $id);
        if (!$stmt->execute()) $echec("L'enregistrement a échoué.");
        audit_log($conn, 'parcours_modifie', $t['nom'], [
            'target_type' => 'parcours', 'target_id' => $id,
            'snapshot'    => ['changements' => audit_changements($actuel, $t), 'annule' => $aid],
        ]);
        $ok();
    }

    if ($e['action'] === 'parcours_supprime') {
        $p = $s['etat'] ?? null;
        if (!$p || !isset($p['nom'])) $echec("Le parcours supprimé n'a pas été conservé.");
        $auteur = $p['cree_par'] ?? ($_SESSION['username'] ?? '');
        $stmt = mysqli_prepare($conn, 'INSERT INTO parcours (nom, description, cree_par) VALUES (?, ?, ?)');
        $stmt->bind_param('sss', $p['nom'], $p['description'], $auteur);
        if (!$stmt->execute()) $echec('La recréation a échoué.');
        $id = (int)$stmt->insert_id;
        $ins = mysqli_prepare($conn,
            'INSERT INTO parcours_slides (parcours_id, ordre, type, titre, contenu, points) VALUES (?, ?, ?, ?, ?, ?)');
        $refusees = [];
        foreach ((array)($p['slides'] ?? []) as $rang => $sl) {
            $r = $preparer($sl['type'] ?? '', $sl['titre'] ?? '', $sl['contenu'] ?? [], $sl['points'] ?? 0);
            if (!is_array($r)) { $refusees[] = ($sl['titre'] ?: ($sl['type'] ?? '?')) . ' : ' . $r; continue; }
            [$titre, $json, $points] = $r;
            $type = $sl['type'];
            $ins->bind_param('iisssi', $id, $rang, $type, $titre, $json, $points);
            $ins->execute();
        }
        $etat = ['nom' => $p['nom'], 'description' => $p['description'], 'slides' => lire_slides($conn, $id)];
        if ($refusees) $etat['slides_non_retablies'] = $refusees;
        audit_log($conn, 'parcours_retabli', $p['nom'], [
            'target_type' => 'parcours', 'target_id' => $id, 'snapshot' => ['etat' => $etat, 'annule' => $aid],
        ]);
        echo json_encode(['ok' => true, 'id' => $id, 'slides_non_retablies' => $refusees], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($e['action'] === 'parcours_slide_modifiee') {
        $sid = (int)($s['slide_id'] ?? 0);
        $slide = $sid > 0 ? slide_lire($conn, $sid) : null;
        if (!$slide) $echec('Cette slide a été supprimée depuis.');
        $actuel = $champs($slide);
        [$t, $err] = audit_revenir($actuel, $s['changements'] ?? []);
        if ($err) $echec($err);
        $r = $preparer($slide['type'], $t['titre'], $t['contenu'], $t['points']);
        if (!is_array($r)) $echec('La version d\'avant ne passe plus la validation : ' . $r);
        [$titre, $json, $points] = $r;
        $stmt = mysqli_prepare($conn, 'UPDATE parcours_slides SET titre = ?, contenu = ?, points = ? WHERE id = ?');
        $stmt->bind_param('ssii', $titre, $json, $points, $sid);
        if (!$stmt->execute()) $echec("L'enregistrement a échoué.");
        mysqli_query($conn, 'UPDATE parcours SET maj_at = NOW() WHERE id = ' . (int)$slide['parcours_id']);
        audit_log($conn, 'parcours_slide_modifiee', $slide['parcours'] . ' : ' . ($titre !== '' ? $titre : $slide['type']), [
            'target_type' => 'parcours', 'target_id' => (int)$slide['parcours_id'], 'snapshot' => [
                'type' => $slide['type'], 'slide_id' => $sid, 'annule' => $aid,
                'changements' => audit_changements($actuel, $champs(slide_lire($conn, $sid))),
            ],
        ]);
        $ok();
    }

    // parcours_slide_supprimee : remise à sa place dans son parcours.
    $t = $s['etat'] ?? null;
    if (!$t) $echec("La slide supprimée n'a pas été conservée.");
    $pid = (int)$t['parcours_id'];
    $r = mysqli_query($conn, "SELECT nom FROM parcours WHERE id = $pid");
    $parc = $r ? mysqli_fetch_assoc($r) : null;
    if (!$parc) $echec('Son parcours a été supprimé depuis.');
    $prep = $preparer($t['type'], $t['titre'], $t['contenu'] ?? [], $t['points'] ?? 0);
    if (!is_array($prep)) $echec('Cette slide ne passe plus la validation : ' . $prep);
    [$titre, $json, $points] = $prep;
    $ordre = (int)$t['ordre']; $type = $t['type'];
    $stmt = mysqli_prepare($conn,
        'INSERT INTO parcours_slides (parcours_id, ordre, type, titre, contenu, points) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->bind_param('iisssi', $pid, $ordre, $type, $titre, $json, $points);
    if (!$stmt->execute()) $echec('La recréation a échoué.');
    $sid = (int)$stmt->insert_id;
    mysqli_query($conn, "UPDATE parcours SET maj_at = NOW() WHERE id = $pid");
    audit_log($conn, 'parcours_slide_retablie', $parc['nom'] . ' : ' . ($titre !== '' ? $titre : $type), [
        'target_type' => 'parcours', 'target_id' => $pid,
        'snapshot'    => ['etat' => slide_lire($conn, $sid), 'annule' => $aid],
    ]);
    $ok();
}

echo json_encode(['error' => 'Action inconnue']);
