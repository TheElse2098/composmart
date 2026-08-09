<?php
/**
 * Contrôleur unique des pages /admin.
 *
 * Sert les interfaces d'administration APRÈS vérification de la session côté
 * serveur. Pour quiconque n'est pas administrateur — visiteur anonyme, compte
 * ordinaire, ou robot — l'URL est indiscernable d'une URL inexistante : même
 * code 404, même page d'erreur, aucun en-tête distinctif, aucun délai
 * particulier. C'est la raison d'être de ce fichier : tant que les pages
 * étaient des .html servis par « web », leur coquille était téléchargeable par
 * n'importe qui, et leur seule protection était le 403 des API.
 *
 * Les gabarits vivent HORS de la racine web (/var/www/admin-vues/) : même en
 * devinant leur nom, on ne peut pas les demander directement.
 *
 * Routes :
 *   /admin                                  → tableau de bord
 *   /admin/themes                           → thèmes + organisation des cours
 *   /admin/themes/<theme>/nouveau           → création d'un cours
 *   /admin/themes/<theme>/<cours>           → édition d'un cours existant
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/api/_guard.php';
secure_session_start();
mysqli_report(MYSQLI_REPORT_OFF);

const VUES = '/var/www/admin-vues';

/**
 * Réponse d'URL inexistante. Utilisée aussi bien pour une vraie faute de frappe
 * que pour un accès non autorisé : les deux cas doivent être indistinguables.
 */
function introuvable() {
    ob_clean();
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    // Même page que le reste du site (ErrorDocument 404 → /404.html côté web).
    $page = VUES . '/404.html';
    echo is_file($page) ? file_get_contents($page) : '<h1>404</h1>';
    exit;
}

// ── Garde ──────────────────────────────────────────────────────────────────
// isAdmin est relu en base et non pris dans la session : un compte rétrogradé
// ne doit pas garder l'accès jusqu'à sa reconnexion (cf. admin/stats.php).
if (empty($_SESSION['user_id'])) introuvable();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { ob_clean(); http_response_code(503); exit; }

$stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
$stmt->bind_param('i', $_SESSION['user_id']);
$stmt->execute();
$u = $stmt->get_result()->fetch_assoc();
if (!$u || (int)$u['isAdmin'] !== 1) introuvable();

// ── Routage ────────────────────────────────────────────────────────────────
$chemin = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$chemin = trim(preg_replace('#^/admin#', '', $chemin), '/');
$seg    = $chemin === '' ? [] : array_map('rawurldecode', explode('/', $chemin));

function propre($s) { return preg_replace('/[^a-z0-9\-]/', '', strtolower($s)); }

function rendre($vue, $vars = []) {
    $page = VUES . '/' . $vue;
    if (!is_file($page)) introuvable();
    $html = file_get_contents($page);
    // Injection des données de route : la page n'a pas à re-parser l'URL, et
    // les valeurs sont déjà validées en base ici. JSON_HEX_TAG évite qu'un nom
    // de thème contenant « </script> » ne referme le bloc.
    $json = json_encode($vars, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    $html = str_replace('/*__ROUTE__*/', 'window.ROUTE = ' . $json . ';', $html);
    ob_clean();
    header('Content-Type: text/html; charset=utf-8');
    // Page personnalisée par la session : ni cache partagé, ni cache navigateur.
    header('Cache-Control: private, no-store');
    echo $html;
    exit;
}

// /admin
if (count($seg) === 0) rendre('tableau-de-bord.html');

// /admin/themes...
if ($seg[0] !== 'themes') introuvable();

if (count($seg) === 1) rendre('themes.html');

// /admin/themes/<theme>/...
if (count($seg) !== 3) introuvable();

$theme_slug = propre($seg[1]);
$stmt = mysqli_prepare($c, 'SELECT id, nom FROM themes WHERE slug = ?');
$stmt->bind_param('s', $theme_slug);
$stmt->execute();
$theme = $stmt->get_result()->fetch_assoc();
if (!$theme) introuvable();

// /admin/themes/<theme>/nouveau
if ($seg[2] === 'nouveau') {
    rendre('cours.html', [
        'mode'       => 'nouveau',
        'theme_id'   => (int)$theme['id'],
        'theme_slug' => $theme_slug,
        'theme_nom'  => $theme['nom'],
        'slug'       => null,
    ]);
}

// /admin/themes/<theme>/<cours> — le cours doit exister ET appartenir au thème,
// sinon l'URL n'a pas de sens et vaut une 404 comme une autre.
$cours_slug = propre($seg[2]);
$stmt = mysqli_prepare($c, 'SELECT id, theme_id FROM cours WHERE slug = ?');
$stmt->bind_param('s', $cours_slug);
$stmt->execute();
$cours = $stmt->get_result()->fetch_assoc();
if (!$cours || (int)$cours['theme_id'] !== (int)$theme['id']) introuvable();

rendre('cours.html', [
    'mode'       => 'edition',
    'theme_id'   => (int)$theme['id'],
    'theme_slug' => $theme_slug,
    'theme_nom'  => $theme['nom'],
    'slug'       => $cours_slug,
    'cours_id'   => (int)$cours['id'],
]);
