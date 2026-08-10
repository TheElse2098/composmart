<?php
/**
 * Tickets de l'utilisateur connecté (signalements « nous contacter »).
 *
 *   GET                       → liste de SES tickets (ouverts + clos)
 *   GET  ?id=N                → fil complet d'UN de ses tickets (marque comme lu)
 *   POST action=repondre      → ajoute un message (ticket ouvert uniquement)
 *   POST action=clore         → ouvert → clos
 *   POST action=rouvrir       → clos → ouvert (jamais depuis clos_definitif)
 *
 * SÉCURITÉ — le point central de ce fichier : la propriété est vérifiée DANS la
 * requête SQL elle-même (AND user_id = <session>), jamais après coup. Un ticket
 * qui n'appartient pas au demandeur produit exactement la même réponse 404
 * qu'un identifiant inexistant : impossible de distinguer « pas à moi » de
 * « n'existe pas », donc impossible d'énumérer les tickets des autres.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();
mysqli_report(MYSQLI_REPORT_OFF);

if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Connexion requise']);
    exit;
}
$uid = (int)$_SESSION['user_id'];

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

function introuvable() {
    http_response_code(404);
    echo json_encode(['error' => 'Signalement introuvable.']);
    exit;
}

/** Le ticket, seulement s'il appartient à l'utilisateur courant. */
function mon_ticket($c, $uid, $id) {
    $stmt = mysqli_prepare($c,
        'SELECT id, sujet, categorie, message, username, statut, created_at,
                derniere_activite, dernier_auteur_admin, lu_par_user_at
         FROM contact_messages WHERE id = ? AND user_id = ?');
    $stmt->bind_param('ii', $id, $uid);
    $stmt->execute();
    return $stmt->get_result()->fetch_assoc();
}

// ── POST : répondre / clore / rouvrir ──────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $action = $_POST['action'] ?? '';
    $id     = (int)($_POST['id'] ?? 0);
    if ($id <= 0) introuvable();

    $t = mon_ticket($c, $uid, $id);
    if (!$t) introuvable();

    if ($action === 'repondre') {
        if ($t['statut'] === 'clos_definitif') {
            echo json_encode(['error' => 'Ce signalement est définitivement clos.']); exit;
        }
        if ($t['statut'] !== 'ouvert') {
            echo json_encode(['error' => 'Ce signalement est clos. Rouvre-le pour répondre.']); exit;
        }
        if (!rate_limit('ticket_msg', 20, 3600)) {
            http_response_code(429);
            echo json_encode(['error' => 'Trop de messages récents. Réessaie plus tard.']); exit;
        }
        $corps = trim($_POST['corps'] ?? '');
        if (mb_strlen($corps) < 1 || mb_strlen($corps) > 3000) {
            echo json_encode(['error' => 'Le message doit faire entre 1 et 3000 caractères.']); exit;
        }
        $uname = $_SESSION['username'] ?? '';
        $stmt = mysqli_prepare($c,
            'INSERT INTO ticket_messages (ticket_id, user_id, auteur, est_admin, corps) VALUES (?, ?, ?, 0, ?)');
        $stmt->bind_param('iiss', $id, $uid, $uname, $corps);
        if (!$stmt->execute()) { http_response_code(500); echo json_encode(['error' => "L'envoi a échoué."]); exit; }
        // lu_par_user_at avance aussi : écrire implique avoir lu ce qui précède.
        mysqli_query($c, "UPDATE contact_messages
                          SET derniere_activite = NOW(), dernier_auteur_admin = 0, lu_par_user_at = NOW()
                          WHERE id = $id");
        echo json_encode(['ok' => true]);
        exit;
    }

    if ($action === 'clore' || $action === 'rouvrir') {
        if (!rate_limit('ticket_action', 30, 3600)) {
            http_response_code(429);
            echo json_encode(['error' => 'Trop d\'actions récentes. Réessaie plus tard.']); exit;
        }
        if ($t['statut'] === 'clos_definitif') {
            echo json_encode(['error' => 'Ce signalement est définitivement clos.']); exit;
        }
        $de   = $action === 'clore' ? 'ouvert' : 'clos';
        $vers = $action === 'clore' ? 'clos'   : 'ouvert';
        // Le statut attendu est DANS le WHERE : deux onglets qui cliquent en
        // même temps ne produisent qu'une transition, l'autre échoue proprement.
        $stmt = mysqli_prepare($c,
            'UPDATE contact_messages SET statut = ?, derniere_activite = NOW()
             WHERE id = ? AND user_id = ? AND statut = ?');
        $stmt->bind_param('siis', $vers, $id, $uid, $de);
        $stmt->execute();
        if (mysqli_stmt_affected_rows($stmt) < 1) {
            echo json_encode(['error' => 'Ce signalement a changé d\'état entre-temps. Recharge la page.']); exit;
        }
        echo json_encode(['ok' => true, 'statut' => $vers]);
        exit;
    }

    echo json_encode(['error' => 'Action inconnue.']);
    exit;
}

// ── GET ?id= : fil complet d'un ticket ─────────────────────────────────────
if (isset($_GET['id'])) {
    $id = (int)$_GET['id'];
    if ($id <= 0) introuvable();
    $t = mon_ticket($c, $uid, $id);
    if (!$t) introuvable();

    // Le premier message du fil est le message d'origine du formulaire.
    $messages = [[
        'auteur'     => $t['username'] ?: 'Moi',
        'est_admin'  => false,
        'corps'      => $t['message'],
        'created_at' => $t['created_at'],
    ]];
    $stmt = mysqli_prepare($c,
        'SELECT auteur, est_admin, corps, created_at
         FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($m = $res->fetch_assoc()) {
        $messages[] = [
            'auteur'     => $m['auteur'] ?: ($m['est_admin'] ? 'Admin' : 'Moi'),
            'est_admin'  => (bool)$m['est_admin'],
            'corps'      => $m['corps'],
            'created_at' => $m['created_at'],
        ];
    }

    // Consulter le fil vaut lecture : la pastille du profil s'éteint.
    mysqli_query($c, "UPDATE contact_messages SET lu_par_user_at = NOW() WHERE id = $id");

    echo json_encode([
        'ticket' => [
            'id'        => (int)$t['id'],
            'sujet'     => $t['sujet'],
            'categorie' => $t['categorie'],
            'statut'    => $t['statut'],
            'date'      => $t['created_at'],
        ],
        'messages' => $messages,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── GET : liste de mes tickets ─────────────────────────────────────────────
$stmt = mysqli_prepare($c,
    'SELECT id, sujet, categorie, statut, created_at, derniere_activite,
            dernier_auteur_admin, lu_par_user_at
     FROM contact_messages WHERE user_id = ?
     ORDER BY (statut = \'ouvert\') DESC, derniere_activite DESC, id DESC
     LIMIT 200');
$stmt->bind_param('i', $uid);
$stmt->execute();
$res = $stmt->get_result();
$tickets = [];
while ($t = $res->fetch_assoc()) {
    $tickets[] = [
        'id'       => (int)$t['id'],
        'sujet'    => $t['sujet'],
        'categorie'=> $t['categorie'],
        'statut'   => $t['statut'],
        'date'     => $t['created_at'],
        'activite' => $t['derniere_activite'] ?: $t['created_at'],
        // Pastille « réponse » : le dernier mot est à un admin et il est
        // postérieur à la dernière lecture.
        'non_lu'   => (int)$t['dernier_auteur_admin'] === 1
                      && ($t['lu_par_user_at'] === null || $t['derniere_activite'] > $t['lu_par_user_at']),
    ];
}
echo json_encode(['tickets' => $tickets], JSON_UNESCAPED_UNICODE);
