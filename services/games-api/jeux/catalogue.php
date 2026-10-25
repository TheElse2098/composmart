<?php
/**
 * Lecture publique des mini-jeux (contenu et règles vivent dans db-games).
 *
 *   GET ?action=liste            → jeux publiés, dans l'ordre (hub /jeux, accueil)
 *   GET ?action=jeu&slug=<slug>  → tout ce qu'il faut à la page pour jouer
 *   GET ?action=pools            → éléments des jeux repris dans les slides
 *                                  d'atelier (éditeur de parcours d'evenements-api)
 *
 * Un jeu en brouillon n'existe pas pour le public (404) ; un administrateur le
 * voit partout, pour pouvoir le tester avant de le publier.
 * Les réponses ne sont pas mises en cache : une modification faite dans
 * /jeux-admin doit être visible à la partie suivante.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_jeux.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');
ob_clean();

$c = jeux_connexion();
if (!$c) { http_response_code(503); echo json_encode(['error' => 'Jeux indisponibles.']); exit; }

$admin  = is_admin_session();
$action = $_GET['action'] ?? '';

// ── LISTE ──────────────────────────────────────────────────────────────────
if ($action === 'liste') {
    $res = mysqli_query($c,
        'SELECT slug, nom, emoji, description, statut, score_max FROM jeux ORDER BY ordre, slug');
    $jeux = [];
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        if ($r['statut'] !== 'publie' && !$admin) continue;
        $r['score_max'] = (int)$r['score_max'];
        $jeux[] = $r;
    }
    echo json_encode(['jeux' => $jeux], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── UN JEU ─────────────────────────────────────────────────────────────────
if ($action === 'jeu') {
    $slug = (string)($_GET['slug'] ?? '');
    $j = jeux_slug_valide($slug) ? jeux_charger($c, $slug) : null;
    if (!$j || ($j['statut'] !== 'publie' && !$admin)) {
        http_response_code(404);
        echo json_encode(['error' => 'Jeu introuvable.']);
        exit;
    }
    unset($j['maj_par'], $j['maj_at'], $j['ordre']);
    echo json_encode(['jeu' => $j], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── POOLS POUR LES ATELIERS ────────────────────────────────────────────────
// Même forme que l'ancien evenements-api/data/jeux-pools.json, que l'éditeur
// de parcours sait déjà lire : {slug: {nom, consigne, items}}. Les éléments
// sont recopiés dans la slide à l'import : un parcours écrit ne bouge pas si
// le jeu évolue ensuite. Tri éclair n'a pas d'équivalent en slide.
if ($action === 'pools') {
    $moteurs = jeux_moteurs();
    $pools = [];
    foreach (['compost-ou-pas', 'temps-decompo', 'mot-mystere'] as $slug) {
        $j = jeux_charger($c, $slug);
        if (!$j) continue;
        $items = $j['items'];
        if ($slug === 'mot-mystere') {
            // En slide, `nom` porte l'indice affiché et `mot` la réponse masquée.
            $items = array_map(fn($m) => [
                'nom' => $m['indice'], 'emoji' => $m['emoji'] ?? '', 'mot' => $m['mot'], 'info' => '',
            ], $items);
        }
        $pools[$slug] = ['nom' => $j['nom'], 'consigne' => $moteurs[$slug]['consigne'], 'items' => $items];
    }
    echo json_encode(['pools' => $pools], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Action inconnue']);
