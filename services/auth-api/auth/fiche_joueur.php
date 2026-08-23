<?php
/**
 * Fiche joueur réduite, pour un admin qui enquête sur un bug signalé par un
 * utilisateur (repérer un score ou une XP incohérente, un niveau qui ne colle
 * pas à ce que la personne rapporte, etc.).
 *
 * Volontairement MINIMAL — pseudo, niveau, XP totale, historique d'XP (pour le
 * graphe), cours terminés : rien de plus. Ni email, ni date d'inscription, ni
 * statut admin de la cible, ni aucune autre donnée de compte. Les cours
 * viennent d'ici (même base, db-core) ; les jeux, eux, vivent dans db-games et
 * sont renvoyés séparément par games-api (le front assemble les deux) — même
 * principe de limiter chacun au strict « quoi », jamais à autre chose sur la
 * personne.
 *
 * Appelé par le navigateur de l'admin (pas un service) : gardé par sa PROPRE
 * session, relue en base à chaque appel — un compte rétrogradé perd l'accès
 * immédiatement, pas seulement à sa prochaine connexion.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// ── Garde admin (vérifiée en base, pas dans la session) ─────────────────────
$me = (int)($_SESSION['user_id'] ?? 0);
$is_admin = false;
if ($me > 0) {
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $me);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $is_admin = $row && (int)$row['isAdmin'] === 1;
}
if (!$is_admin) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé aux administrateurs.']);
    exit;
}

$uid = (int)($_GET['user_id'] ?? 0);
if ($uid <= 0) { echo json_encode(['error' => 'Utilisateur invalide.']); exit; }

$stmt = mysqli_prepare($c, 'SELECT username, xp, niveau FROM users WHERE id = ?');
$stmt->bind_param('i', $uid);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();
if (!$u) { http_response_code(404); echo json_encode(['error' => 'Utilisateur introuvable.']); exit; }

// Même requête que profile.php (self), sans source/label : le graphe ne
// consomme que delta + date, pas la peine de renvoyer plus.
$xp_history = [];
$stmt = mysqli_prepare($c, 'SELECT delta, created_at FROM xp_log WHERE user_id = ? ORDER BY created_at ASC LIMIT 200');
$stmt->bind_param('i', $uid);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $xp_history[] = ['delta' => (int)$row['delta'], 'created_at' => $row['created_at']];
}

// Cours terminés : même requête que profile.php (self), même limitation au
// strict nécessaire pour les identifier — pas la description, pas le thème.
$cours = [];
$stmt = mysqli_prepare($c,
    'SELECT c.slug, c.titre, c.emoji, up.completed_at
     FROM user_progress up JOIN cours c ON c.slug = up.cours_id
     WHERE up.user_id = ?
     ORDER BY up.completed_at DESC');
$stmt->bind_param('i', $uid);
$stmt->execute();
$res = $stmt->get_result();
while ($row = $res->fetch_assoc()) {
    $cours[] = [
        'slug'         => $row['slug'],
        'titre'        => $row['titre'],
        'emoji'        => $row['emoji'] ?: '📘',
        'completed_at' => $row['completed_at'],
    ];
}

echo json_encode([
    'ok'         => true,
    'username'   => $u['username'],
    'niveau'     => (int)$u['niveau'],
    'xp'         => (int)$u['xp'],
    'xp_history' => $xp_history,
    'cours'      => $cours,
], JSON_UNESCAPED_UNICODE);
