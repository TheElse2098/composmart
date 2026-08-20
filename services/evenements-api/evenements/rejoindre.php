<?php
// Rejoindre un événement par code/QR — endpoint public, aucune session requise.
// Si l'appelant a une session Composmart active (cookie partagé via Redis avec
// auth-api), user_id est lié à titre informatif seulement : ce service ne doit
// jamais bloquer un participant B2B sans compte.
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
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

/** Normalise un code saisi : majuscules, espaces retirés. */
function normaliser_code($code) {
    return strtoupper(preg_replace('/\s+/', '', (string)$code));
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

// ── VÉRIFIER UN CODE (avant inscription, pour afficher titre/lieu) ─────────
// Les limites ci-dessous sont volontairement hautes : dans un atelier B2B,
// toute la salle partage l'IP publique de l'entreprise (NAT). Une limite
// « raisonnable » par IP bloquerait la moitié des participants au moment où
// ils scannent le QR tous en même temps. Le garde-fou anti-énumération reste
// solide : l'espace des codes fait 32^6 ≈ 1 milliard de combinaisons.
if ($action === 'verifier_code') {
    if (!rate_limit('evt_verifier', 300, 60)) { echo json_encode(['error' => 'Trop de tentatives, réessaie dans une minute.']); exit; }

    $code = normaliser_code($_GET['code'] ?? $_POST['code'] ?? '');
    if ($code === '') { echo json_encode(['error' => 'Code manquant.']); exit; }

    $stmt = mysqli_prepare($conn, 'SELECT id, titre, lieu, date_debut, statut, supprime FROM evenements WHERE code = ?');
    $stmt->bind_param('s', $code);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();

    // Un événement supprimé est indiscernable d'un code inexistant : jamais de
    // signal qui distinguerait "ça n'existe pas" de "on l'a retiré".
    if (!$evt || (int)$evt['supprime'] === 1) {
        echo json_encode(['error' => 'Code invalide.']);
        exit;
    }

    // Seul « ouvert » laisse entrer. Les autres statuts renvoient un motif
    // explicite : le participant doit comprendre pourquoi ça ne marche pas,
    // plutôt que de croire à une faute de frappe dans le code.
    $motifs = [
        'prevu'    => "Cet événement n'est pas encore ouvert aux inscriptions.",
        'en_cours' => "L'atelier a déjà commencé : les inscriptions sont closes.",
        'termine'  => "Cet atelier est terminé.",
        'annule'   => "Cet événement a été annulé.",
    ];
    if ($evt['statut'] !== 'ouvert') {
        echo json_encode(['error' => $motifs[$evt['statut']] ?? "Cet événement n'accepte pas d'inscription."]);
        exit;
    }

    echo json_encode([
        'ok'      => true,
        'titre'   => $evt['titre'],
        'lieu'    => $evt['lieu'],
        'date'    => $evt['date_debut'],
        'ouvert'  => true,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── REJOINDRE (inscription effective) ───────────────────────────────────────
if ($action === 'rejoindre') {
    if (!rate_limit('evt_rejoindre', 200, 60)) { echo json_encode(['error' => 'Trop de tentatives, réessaie dans une minute.']); exit; }

    $code       = normaliser_code($_POST['code'] ?? '');
    $nom_affiche = trim($_POST['nom_affiche'] ?? '');

    if ($code === '') { echo json_encode(['error' => 'Code manquant.']); exit; }
    if ($nom_affiche === '' || mb_strlen($nom_affiche) > 100) {
        echo json_encode(['error' => 'Merci de renseigner ton nom (100 caractères max).']);
        exit;
    }

    $stmt = mysqli_prepare($conn, 'SELECT id, titre, statut, supprime, mode_equipes FROM evenements WHERE code = ?');
    $stmt->bind_param('s', $code);
    $stmt->execute();
    $evt = $stmt->get_result()->fetch_assoc();

    if (!$evt || (int)$evt['supprime'] === 1) {
        echo json_encode(['error' => 'Code invalide.']);
        exit;
    }
    // Même règle qu'à la vérification du code : seul « ouvert » laisse entrer.
    // Le contrôle est refait ici, et pas seulement à l'étape précédente : le
    // statut a pu changer entre la saisie du code et la validation du nom.
    if ($evt['statut'] !== 'ouvert') {
        $motifs = [
            'prevu'    => "Cet événement n'est pas encore ouvert aux inscriptions.",
            'en_cours' => "L'atelier a déjà commencé : les inscriptions sont closes.",
            'termine'  => "Cet atelier est terminé.",
            'annule'   => "Cet événement a été annulé.",
        ];
        echo json_encode(['error' => $motifs[$evt['statut']] ?? "Cet événement n'accepte pas d'inscription."]);
        exit;
    }

    $user_id = !empty($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;

    // Jeton d'identité : c'est lui qui permettra au participant de répondre aux
    // slides ensuite. Même mécanique que les jetons de db-core (shared/_guard.php) :
    // seul le SHA-256 est stocké, la valeur en clair n'est renvoyée qu'ici et
    // vit dans le localStorage du navigateur. Préféré à une $_SESSION : une
    // éviction de session Redis en plein atelier éjecterait sinon le participant.
    $token = generer_token();
    $hash  = hash_token($token);

    $stmt = mysqli_prepare($conn,
        'INSERT INTO participants (evenement_id, nom_affiche, user_id, token_hash) VALUES (?, ?, ?, ?)');
    $stmt->bind_param('isis', $evt['id'], $nom_affiche, $user_id, $hash);
    $stmt->execute();
    $participant_id = $stmt->insert_id;

    // Mode « auto » : les retardataires sont placés au fil de l'eau dans
    // l'équipe la moins fournie (départage aléatoire). C'est ce qui garde des
    // effectifs équilibrés quand les gens arrivent en ordre dispersé, là où un
    // tirage purement aléatoire creuserait les écarts.
    if (($evt['mode_equipes'] ?? 'aucun') === 'auto') {
        $stmt = mysqli_prepare($conn,
            'SELECT e.id FROM equipes e
             LEFT JOIN participants p ON p.equipe_id = e.id
             WHERE e.evenement_id = ?
             GROUP BY e.id
             ORDER BY COUNT(p.id) ASC, RAND() LIMIT 1');
        $stmt->bind_param('i', $evt['id']);
        $stmt->execute();
        $eq = $stmt->get_result()->fetch_assoc();
        if ($eq) {
            $stmt = mysqli_prepare($conn, 'UPDATE participants SET equipe_id = ? WHERE id = ?');
            $stmt->bind_param('ii', $eq['id'], $participant_id);
            $stmt->execute();
        }
    }

    echo json_encode([
        'ok'        => true,
        'titre'     => $evt['titre'],
        'token'     => $token,
        'participant_id' => $participant_id,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

echo json_encode(['error' => 'Action inconnue']);
