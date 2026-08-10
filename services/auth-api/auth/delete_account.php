<?php
/**
 * Suppression définitive du compte de l'utilisateur connecté.
 *
 * Déroulé, dans cet ordre :
 *   1. l'activité est agrégée PAR JOUR dans stats_anonymes, sans identifiant ;
 *   2. les traces des autres bases sont purgées (scores supprimés, signalements
 *      et composteurs détachés de leur auteur) ;
 *   3. les messages de contact sont détachés (message gardé, pseudo retiré) ;
 *   4. la ligne users est supprimée — la cascade emporte logins, xp_log,
 *      user_progress et user_tokens ;
 *   5. la session est détruite.
 *
 * L'agrégation vient AVANT la suppression : les tables sources sont en
 * ON DELETE CASCADE, une fois la ligne users partie il n'y a plus rien à lire.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();

// PHP 8.1+ : mysqli lève des exceptions par défaut. Ici une requête qui échoue
// (table stats_anonymes absente sur une base pas encore migrée) ne doit pas
// interrompre la suppression — on revient au mode "valeur de retour".
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

// ── 1. Agrégation anonyme ──────────────────────────────────────────────────
// Un seul jour + un seul type par ligne, les totaux s'additionnent : rien ne
// permet de savoir combien de personnes ont contribué à un total, ni lesquelles.
mysqli_query($c, "INSERT INTO stats_anonymes (jour, type, total, somme)
    SELECT DATE(created_at), 'inscription', 1, 0 FROM users WHERE id = $uid
    ON DUPLICATE KEY UPDATE total = total + 1");

mysqli_query($c, "INSERT INTO stats_anonymes (jour, type, total, somme)
    SELECT DATE(logged_at), 'connexion', COUNT(*), 0 FROM logins WHERE user_id = $uid
    GROUP BY DATE(logged_at)
    ON DUPLICATE KEY UPDATE total = total + VALUES(total)");

mysqli_query($c, "INSERT INTO stats_anonymes (jour, type, total, somme)
    SELECT DATE(completed_at), 'cours_termine', COUNT(*), 0 FROM user_progress WHERE user_id = $uid
    GROUP BY DATE(completed_at)
    ON DUPLICATE KEY UPDATE total = total + VALUES(total)");

// xp_log peut ne pas exister sur une base pas encore migrée.
$r = mysqli_query($c, "SHOW TABLES LIKE 'xp_log'");
if ($r && mysqli_num_rows($r) > 0) {
    mysqli_query($c, "INSERT INTO stats_anonymes (jour, type, total, somme)
        SELECT DATE(created_at), 'xp', COUNT(*), COALESCE(SUM(delta), 0) FROM xp_log WHERE user_id = $uid
        GROUP BY DATE(created_at)
        ON DUPLICATE KEY UPDATE total = total + VALUES(total), somme = somme + VALUES(somme)");
}

// ── 2. Purge des autres bases (best-effort) ────────────────────────────────
// Ces appels traversent le réseau : un service momentanément indisponible ne
// doit pas empêcher la suppression du compte, qui est un droit de la personne.
// L'échec est journalisé pour permettre un rattrapage manuel.
function purger($url, $payload) {
    if (!$url) return false;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Audit-Secret: ' . (getenv('AUDIT_SECRET') ?: '')],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
    ]);
    $rep = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code === 200 && $rep !== false;
}

$purges = [
    'jeux'  => purger(getenv('GAMES_PURGE_URL') ?: '', ['uid' => $uid]),
    'carte' => purger(getenv('MAP_PURGE_URL') ?: '', ['uid' => $uid, 'username' => $u['username']]),
];

// ── 3. Messages de contact : contenu gardé, auteur détaché ─────────────────
// Les messages du fil de tickets suivent la même règle que le ticket lui-même,
// y compris ceux écrits comme admin : le pseudo disparaît partout, l'affichage
// retombe sur « Admin ». (Table absente sur une base non migrée : échec silencieux.)
mysqli_query($c, "UPDATE ticket_messages SET user_id = NULL, auteur = NULL WHERE user_id = $uid");
mysqli_query($c, "UPDATE contact_messages SET user_id = NULL, username = NULL WHERE user_id = $uid");

// ── 4. Journal d'audit SANS identifiant ────────────────────────────────────
// user_id et username sont volontairement NULL : écrire le pseudo ici
// reviendrait à le conserver après l'avoir effacé partout ailleurs. L'admin
// voit qu'une suppression a eu lieu, pas de qui.
audit_log_write($c, null, null, 'compte_supprime',
    'un compte a été supprimé par son propriétaire', 'user', null,
    json_encode(['purges' => $purges]));

$stmt = mysqli_prepare($c, 'DELETE FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
if (!$stmt->execute()) {
    http_response_code(500); echo json_encode(['error' => 'La suppression a échoué.']); exit;
}

// ── 5. Fin de session ──────────────────────────────────────────────────────
$_SESSION = [];
session_destroy();

echo json_encode(['ok' => true, 'purges' => $purges]);
