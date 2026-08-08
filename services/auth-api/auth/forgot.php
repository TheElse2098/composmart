<?php
/**
 * Mot de passe oublié — étape 1 : on identifie le compte par son nom
 * d'utilisateur OU son adresse email, et on envoie un lien de réinitialisation.
 *
 * La réponse est TOUJOURS la même, que le compte existe ou non : sinon cet
 * endpoint deviendrait un moyen de tester quels pseudos et quelles adresses
 * sont inscrits sur le site.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}

// Réponse neutre commune : elle sert aussi en cas de blocage par le rate-limit,
// pour ne pas révéler que la limite a été atteinte sur un identifiant précis.
$reponse = ['ok' => true, 'message' => 'Si un compte correspond, un email vient d\'être envoyé.'];

if (!rate_limit('forgot', 5, 3600)) { echo json_encode($reponse); exit; }

$identifiant = trim($_POST['identifiant'] ?? '');
if ($identifiant === '' || strlen($identifiant) > 255) { echo json_encode($reponse); exit; }

$conn = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$conn) { echo json_encode($reponse); exit; }

// Un seul passage : l'identifiant peut être l'un ou l'autre.
$stmt = mysqli_prepare($conn, 'SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1');
$stmt->bind_param('ss', $identifiant, $identifiant);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();

if ($u) {
    // 1 h de validité : bien plus court que la confirmation d'inscription, parce
    // qu'un lien de réinitialisation permet la prise de contrôle du compte.
    $token = creer_token($conn, (int)$u['id'], 'reset', 60);
    if ($token) {
        $lien = site_url() . '/reinitialiser?token=' . urlencode($token);
        $ok = send_mail($u['email'], 'Réinitialiser ton mot de passe Composmart',
            "Bonjour {$u['username']},\n\n"
          . "Tu as demandé à réinitialiser ton mot de passe. Ouvre ce lien :\n$lien\n\n"
          . "Ce lien est valable 1 heure et ne peut servir qu'une fois.\n\n"
          . "Si tu n'es pas à l'origine de cette demande, ignore ce message :\n"
          . "ton mot de passe actuel reste valable.\n");

        audit_log($conn, 'mail_envoye', ($ok ? 'Envoyé' : 'Échec') . ' — réinitialisation mot de passe', [
            'target_type' => 'mail',
            'snapshot' => [
                'to' => $u['email'], 'sujet' => 'Réinitialiser ton mot de passe', 'ok' => $ok,
                'erreur' => $ok ? null : mb_substr(send_mail_last_error(), 0, 300),
            ],
        ]);
    }
}

echo json_encode($reponse);
