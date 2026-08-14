<?php
// Back-office événements : créer, ouvrir/fermer, lister, suivre les inscrits.
// Ce service n'a pas accès à `users` (db-core, base séparée) : contrairement à
// courses-api/admin/_admin_guard.php qui relit isAdmin en base à chaque appel,
// on s'appuie ici sur is_admin_session() (flag posé au login), comme le font
// déjà map-api et games-api pour la même raison. Limite documentée dans
// shared/_guard.php : un admin rétrogradé garde l'accès jusqu'à reconnexion.
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

if (empty($_SESSION['user_id']) || !is_admin_session()) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé']);
    exit;
}

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-evenements',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode(['error' => 'Connexion DB échouée']); exit; }

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

// ── OUVRIR / FERMER / DÉMARRER / TERMINER ───────────────────────────────────
// Bascules manuelles du cycle de vie, indépendantes de date_debut/date_fin :
// l'admin déclenche "En cours" au moment réel où l'atelier démarre, pas selon
// une horloge (cf. discussion conception — pas d'auto-calcul par date).
$STATUTS_ACTION = ['ouvrir' => 'ouvert', 'fermer' => 'ferme', 'demarrer' => 'en_cours', 'terminer' => 'termine'];
if (isset($STATUTS_ACTION[$action])) {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $nouveau_statut = $STATUTS_ACTION[$action];
    $stmt = mysqli_prepare($conn, "UPDATE evenements SET statut = ? WHERE id = ? AND statut != 'archive'");
    $stmt->bind_param('si', $nouveau_statut, $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Événement introuvable ou supprimé.']); exit; }

    audit_log($conn, 'evenement_' . $nouveau_statut, '', ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── ANNULER (l'atelier n'aura pas lieu, distinct de "fermé") ───────────────
if ($action === 'annuler') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, "UPDATE evenements SET statut = 'annule' WHERE id = ? AND statut != 'archive'");
    $stmt->bind_param('i', $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Événement introuvable ou supprimé.']); exit; }

    audit_log($conn, 'evenement_annule', '', ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── SUPPRIMER (doux : bascule sur 'archive', aucune donnée n'est effacée) ──
if ($action === 'supprimer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, "UPDATE evenements SET statut = 'archive' WHERE id = ? AND statut != 'archive'");
    $stmt->bind_param('i', $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => 'Événement introuvable ou déjà supprimé.']); exit; }

    audit_log($conn, 'evenement_supprime', '', ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── RESTAURER (sort un événement de 'archive') ──────────────────────────────
if ($action === 'restaurer') {
    $id = (int)($_POST['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, "UPDATE evenements SET statut = 'ferme' WHERE id = ? AND statut = 'archive'");
    $stmt->bind_param('i', $id);
    $stmt->execute();

    if (mysqli_affected_rows($conn) !== 1) { echo json_encode(['error' => "Événement introuvable ou pas dans les supprimés."]); exit; }

    audit_log($conn, 'evenement_restaure', '', ['target_type' => 'evenement', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── LISTE DES ÉVÉNEMENTS ─────────────────────────────────────────────────────
// ?vue=archives → uniquement les supprimés ; par défaut → tout sauf les supprimés.
if ($action === 'liste') {
    $vue = ($_GET['vue'] ?? '') === 'archives' ? 'archives' : 'actifs';
    $filtre = $vue === 'archives' ? "e.statut = 'archive'" : "e.statut != 'archive'";
    $res = mysqli_query($conn,
        "SELECT e.id, e.titre, e.lieu, e.date_debut, e.code, e.statut, e.created_at,
                (SELECT COUNT(*) FROM participants p WHERE p.evenement_id = e.id) AS nb_participants
         FROM evenements e
         WHERE $filtre
         ORDER BY e.date_debut DESC");
    $evenements = [];
    while ($row = $res->fetch_assoc()) {
        $row['id'] = (int)$row['id'];
        $row['nb_participants'] = (int)$row['nb_participants'];
        $evenements[] = $row;
    }
    echo json_encode(['evenements' => $evenements], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── SUIVI LIVE : détail + liste des participants ────────────────────────────
if ($action === 'suivi') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) { echo json_encode(['error' => 'Événement invalide.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id, titre, lieu, date_debut, code, statut FROM evenements WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();
    if (!$evt) { echo json_encode(['error' => 'Événement introuvable.']); exit; }
    $evt['id'] = (int)$evt['id'];

    $stmt = mysqli_prepare($conn, 'SELECT nom_affiche, rejoint_at FROM participants WHERE evenement_id = ? ORDER BY rejoint_at DESC');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    $participants = [];
    while ($row = $res->fetch_assoc()) $participants[] = $row;

    echo json_encode(['evenement' => $evt, 'participants' => $participants], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
