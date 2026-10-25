<?php
/**
 * Contrôleur unique des pages /jeux-admin.
 *
 * Même principe que courses-api et evenements-api : pour quiconque n'est pas
 * administrateur, l'URL est indiscernable d'une URL inexistante (même 404,
 * aucun en-tête distinctif). Les gabarits vivent hors de la racine web
 * (/var/www/jeux-admin-vues/).
 *
 * games-api n'a pas la table `users` (db-core) : isAdmin est relu en base via
 * auth-api (est_admin_via_auth(), shared/_guard.php), comme /evenements-admin.
 *
 * Routes :
 *   /jeux-admin          → liste des jeux (statut, activité, ordre)
 *   /jeux-admin/<slug>   → éditeur d'un jeu (textes, règles, contenu, historique)
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/api/jeux/_jeux.php';
secure_session_start();

const VUES = '/var/www/jeux-admin-vues';

function introuvable() {
    ob_clean();
    http_response_code(404);
    header('Content-Type: text/html; charset=utf-8');
    $page = VUES . '/404.html';
    echo is_file($page) ? file_get_contents($page) : '<h1>404</h1>';
    exit;
}

// ── Garde ──────────────────────────────────────────────────────────────────
if (empty($_SESSION['user_id'])) introuvable();
if (!est_admin_via_auth((int)$_SESSION['user_id'])) introuvable();

// ── Routage ────────────────────────────────────────────────────────────────
$chemin = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$chemin = trim(preg_replace('#^/jeux-admin#', '', $chemin), '/');
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

// /jeux-admin
if (count($seg) === 0) rendre('liste.html');

// /jeux-admin/<slug> — le jeu doit exister en base, sinon 404 comme une autre.
if (count($seg) === 1 && jeux_slug_valide($seg[0])) {
    $c = jeux_connexion();
    if (!$c) { ob_clean(); http_response_code(503); exit; }
    if (!jeux_charger($c, $seg[0])) introuvable();
    rendre('editeur.html', ['slug' => $seg[0]]);
}

introuvable();
