<?php
/**
 * Envoi d'un message de contact. Réservé aux utilisateurs connectés.
 * Enregistre dans contact_messages (db-core) → visible dans l'admin panel.
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'method']); exit; }

// Réservé aux connectés
if (empty($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(['error' => 'Connecte-toi pour envoyer un message.']);
    exit;
}

// Anti-spam : 5 messages max par heure et par IP
if (!rate_limit('contact', 5, 3600)) {
    http_response_code(429);
    echo json_encode(['error' => 'Trop de messages récents. Réessaie plus tard.']);
    exit;
}

$CATS = ['bug', 'suggestion', 'question', 'autre'];
$cat     = in_array($_POST['categorie'] ?? '', $CATS, true) ? $_POST['categorie'] : 'autre';
$sujet   = trim($_POST['sujet'] ?? '');
$message = trim($_POST['message'] ?? '');

if (mb_strlen($sujet) < 3 || mb_strlen($sujet) > 150) {
    echo json_encode(['error' => 'Le sujet doit faire entre 3 et 150 caractères.']); exit;
}
if (mb_strlen($message) < 10 || mb_strlen($message) > 3000) {
    echo json_encode(['error' => 'Le message doit faire entre 10 et 3000 caractères.']); exit;
}

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

$uid   = (int)$_SESSION['user_id'];
$uname = $_SESSION['username'] ?? '';

// Le message ouvre un TICKET (statut 'ouvert' par défaut) : une conversation
// que l'auteur retrouve sur sa page de compte et où les admins répondent.
// lu_par_user_at = NOW() : l'auteur a évidemment lu son propre message.
$stmt = mysqli_prepare($c,
    'INSERT INTO contact_messages (user_id, username, categorie, sujet, message, derniere_activite, lu_par_user_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())');
$stmt->bind_param('issss', $uid, $uname, $cat, $sujet, $message);
if ($stmt->execute()) {
    $ticket_id = (int)mysqli_insert_id($c);
    // Notification mail (best-effort : ne bloque jamais l'enregistrement du message).
    $CAT_LABELS = ['bug' => 'Bug', 'suggestion' => 'Suggestion', 'question' => 'Question', 'autre' => 'Autre'];
    $mailSujet = '[SUPPORT] [' . ($CAT_LABELS[$cat] ?? $cat) . '] ' . $sujet;
    $mailCorps = "Nouveau message de contact sur Composmart\n\n"
               . "Catégorie : " . ($CAT_LABELS[$cat] ?? $cat) . "\n"
               . "Sujet : $sujet\n"
               . "De : $uname (id=$uid)\n"
               . "Date : " . date('Y-m-d H:i:s') . "\n\n"
               . "Message :\n$message\n";
    $mail_ok = send_mail('contact@composmart.fr', $mailSujet, $mailCorps);
    audit_log($c, 'mail_envoye', ($mail_ok ? 'Envoyé' : 'Échec') . ' — ' . $mailSujet, [
        'target_type' => 'mail',
        'snapshot'    => [
            'to'     => 'contact@composmart.fr',
            'sujet'  => $mailSujet,
            'ok'     => $mail_ok,
            'erreur' => $mail_ok ? null : mb_substr(send_mail_last_error(), 0, 300),
        ],
    ]);

    echo json_encode(['ok' => true, 'ticket' => $ticket_id]);
} else {
    http_response_code(500);
    echo json_encode(['error' => "Erreur lors de l'envoi."]);
}
mysqli_close($c);
