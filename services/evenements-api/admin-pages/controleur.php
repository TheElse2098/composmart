<?php
/**
 * Contrôleur unique des pages /evenements-admin.
 *
 * Même principe que courses-api/admin-pages/controleur.php : pour quiconque
 * n'est pas administrateur, l'URL est indiscernable d'une URL inexistante
 * (même 404, aucun en-tête distinctif). Les gabarits vivent hors de la racine
 * web (/var/www/evenements-admin-vues/) pour ne pas être atteignables même en
 * devinant leur nom.
 *
 * Différence avec courses-api : ce service n'a pas accès à la table `users`
 * (db-core, base séparée). isAdmin est donc vérifié via un appel interne à
 * auth-api (secret partagé, même domaine de confiance que audit_log()/
 * crediter_xp() dans shared/_guard.php) plutôt qu'une requête SQL locale.
 * Un échec réseau vers auth-api est traité comme un refus, jamais comme un
 * accès accordé par défaut.
 *
 * Routes :
 *   /evenements-admin                → liste des événements + création
 *   /evenements-admin/parcours       → bibliothèque de parcours
 *   /evenements-admin/parcours/<id>  → éditeur d'un parcours
 *   /evenements-admin/anecdotes      → banque d'anecdotes
 *   /evenements-admin/<id>           → suivi live d'un événement
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/api/_guard.php';
secure_session_start();

const VUES = '/var/www/evenements-admin-vues';

function introuvable() {
    ob_clean();
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    $page = VUES . '/404.html';
    echo is_file($page) ? file_get_contents($page) : '<h1>404</h1>';
    exit;
}

/** Vérifie isAdmin via l'endpoint interne d'auth-api. Refuse si l'appel échoue. */
function est_admin_via_auth($uid) {
    $url = getenv('AUTH_ADMIN_CHECK_URL') ?: '';
    if ($url === '') return false;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['uid' => $uid]),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'X-Audit-Secret: ' . (getenv('AUDIT_SECRET') ?: '')],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
    ]);
    $raw = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($http !== 200 || $raw === false) return false;
    $rep = json_decode($raw, true);
    return is_array($rep) && !empty($rep['ok']) && !empty($rep['isAdmin']);
}

// ── Garde ──────────────────────────────────────────────────────────────────
if (empty($_SESSION['user_id'])) introuvable();
if (!est_admin_via_auth((int)$_SESSION['user_id'])) introuvable();

// ── Routage ────────────────────────────────────────────────────────────────
$chemin = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$chemin = trim(preg_replace('#^/evenements-admin#', '', $chemin), '/');
$seg    = $chemin === '' ? [] : array_map('rawurldecode', explode('/', $chemin));

function rendre($vue, $vars = []) {
    $page = VUES . '/' . $vue;
    if (!is_file($page)) introuvable();
    $html = file_get_contents($page);
    $json = json_encode($vars, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    $html = str_replace('/*__ROUTE__*/', 'window.ROUTE = ' . $json . ';', $html);
    ob_clean();
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: private, no-store');
    echo $html;
    exit;
}

// /evenements-admin
if (count($seg) === 0) rendre('liste.html');

// /evenements-admin/parcours — bibliothèque, et /parcours/<id> — éditeur.
// Une seule vue pour les deux : window.ROUTE.parcours_id distingue le mode,
// comme cours.html côté courses-api (mode 'nouveau' / 'edition').
if ($seg[0] === 'parcours') {
    if (count($seg) === 1) rendre('parcours.html', ['parcours_id' => null]);
    if (count($seg) === 2 && ctype_digit($seg[1])) rendre('parcours.html', ['parcours_id' => (int)$seg[1]]);
    introuvable();
}

// /evenements-admin/anecdotes — banque partagée par tous les parcours
if ($seg[0] === 'anecdotes' && count($seg) === 1) rendre('anecdotes.html');

// /evenements-admin/<id>
if (count($seg) === 1 && ctype_digit($seg[0])) {
    rendre('suivi.html', ['evenement_id' => (int)$seg[0]]);
}

introuvable();
