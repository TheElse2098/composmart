<?php
/**
 * Suppression définitive du compte de l'utilisateur connecté.
 *
 * Vérifie la confirmation (pseudo retapé) et le garde-fou du dernier admin,
 * puis délègue à supprimer_compte() (_guard.php), partagé avec la suppression
 * par un administrateur (admin/users.php). La session est ensuite détruite.
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

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}
if (empty($_SESSION['user_id'])) {
    http_response_code(401); echo json_encode(['error' => 'Connexion requise']); exit;
}

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'Service indisponible']); exit; }

$uid = (int)$_SESSION['user_id'];
$stmt = mysqli_prepare($c, 'SELECT username, isAdmin FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();
if (!$u) { http_response_code(404); echo json_encode(['error' => 'Compte introuvable']); exit; }

// Confirmation : le pseudo doit être retapé à l'identique.
$saisie = trim($_POST['confirmation'] ?? '');
if ($saisie !== $u['username']) {
    echo json_encode(['error' => "Le nom d'utilisateur saisi ne correspond pas."]);
    exit;
}

// Garde-fou : si le dernier admin se supprime, plus personne ne peut administrer
// le site et le launchpad refusera d'en recréer un (il vérifie qu'aucun n'existe).
if ((int)$u['isAdmin'] === 1) {
    $r = mysqli_fetch_row(mysqli_query($c, 'SELECT COUNT(*) FROM users WHERE isAdmin = 1'));
    if ((int)($r[0] ?? 0) <= 1) {
        echo json_encode(['error' => 'Impossible : ce compte est le dernier administrateur du site.']);
        exit;
    }
}

// Agrégation anonyme, purge des autres bases, détachement des messages,
// audit et suppression : cf. supprimer_compte() dans _guard.php.
$res = supprimer_compte($c, $uid, $u['username']);
if (!$res['ok']) {
    http_response_code(500); echo json_encode(['error' => 'La suppression a échoué.']); exit;
}

// Fin de session
$_SESSION = [];
session_destroy();

echo json_encode(['ok' => true, 'purges' => $res['purges']]);
