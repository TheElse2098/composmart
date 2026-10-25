<?php
/**
 * Édition des mini-jeux depuis /jeux-admin.
 *
 *   GET  ?action=liste                → les jeux, brouillons compris, avec leur activité
 *   GET  ?action=jeu&slug=<slug>      → un jeu complet + son historique
 *   POST ?action=sauver     (JSON)    → textes, statut, XP, règles, messages, contenu
 *   POST ?action=ordre      (JSON)    → {slugs: [...]} ordre d'affichage
 *   POST ?action=restaurer  (JSON)    → {slug, version_id} revient à une version
 *
 * Droits : games-api n'a pas accès à la table `users` (db-core) ; comme
 * evenements-api, on s'appuie sur is_admin_session() (flag posé au login).
 * Le contrôleur des pages /jeux-admin, lui, revérifie en base via auth-api.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_jeux.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');
ob_clean();
csrf_check();

if (empty($_SESSION['user_id']) || !is_admin_session()) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé']);
    exit;
}

$c = jeux_connexion();
if (!$c) { http_response_code(500); echo json_encode(['error' => 'Connexion DB échouée']); exit; }

/** Nombre de versions gardées par jeu : l'historique sert à réparer, pas à archiver. */
const VERSIONS_MAX = 40;

$action = $_GET['action'] ?? '';
$methode = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function corps_json() {
    $d = json_decode(file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}

function sortir($donnees, $code = 200) {
    http_response_code($code);
    echo json_encode($donnees, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Activité d'un jeu (toutes saisons de règles confondues). */
function activite($c) {
    $out = [];
    $res = mysqli_query($c, 'SELECT jeu_id, COUNT(*) AS parties, COUNT(DISTINCT user_id) AS joueurs FROM scores GROUP BY jeu_id');
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $out[$r['jeu_id']] = ['parties' => (int)$r['parties'], 'joueurs' => (int)$r['joueurs']];
    }
    return $out;
}

/** Copie l'état actuel d'un jeu dans l'historique, puis élague. */
function archiver($c, $j) {
    $etat = [
        'nom' => $j['nom'], 'emoji' => $j['emoji'], 'description' => $j['description'],
        'statut' => $j['statut'], 'xp_reserve' => $j['xp_reserve'], 'score_max' => $j['score_max'],
        'regles' => $j['regles'], 'messages' => $j['messages'], 'items' => $j['items'],
    ];
    $json = json_encode($etat, JSON_UNESCAPED_UNICODE);
    $auteur = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($c, 'INSERT INTO jeux_versions (slug, contenu, auteur) VALUES (?, ?, ?)');
    $stmt->bind_param('sss', $j['slug'], $json, $auteur);
    $stmt->execute();

    $stmt = mysqli_prepare($c,
        'DELETE FROM jeux_versions WHERE slug = ? AND id NOT IN (
           SELECT id FROM (SELECT id FROM jeux_versions WHERE slug = ? ORDER BY id DESC LIMIT ' . VERSIONS_MAX . ') AS gardees)');
    $stmt->bind_param('ss', $j['slug'], $j['slug']);
    $stmt->execute();
}

/**
 * Valide un état complet de jeu (envoyé par l'éditeur ou repris d'une version).
 * Renvoie [etat_normalise, null] ou [null, erreur].
 */
function valider_etat($slug, $d) {
    $nom = jeux_txt($d['nom'] ?? null, 80);
    if ($nom === null) return [null, 'Le nom du jeu est obligatoire.'];
    $statut = in_array($d['statut'] ?? '', ['brouillon', 'publie'], true) ? $d['statut'] : 'brouillon';
    $xp = jeux_int($d['xp_reserve'] ?? null, 0, 500);
    if ($xp === null) return [null, 'Réserve d\'XP : un nombre entier entre 0 et 500.'];

    [$regles, $err] = jeux_valider_regles($slug, $d['regles'] ?? null);
    if ($err) return [null, $err];
    [$items, $err] = jeux_valider_items($slug, $d['items'] ?? null, $regles);
    if ($err) return [null, $err];
    [$messages, $err] = jeux_valider_messages($d['messages'] ?? null);
    if ($err) return [null, $err];

    return [[
        'nom'         => $nom,
        'emoji'       => jeux_txt($d['emoji'] ?? '', 16, false) ?: '🎮',
        'description' => jeux_txt($d['description'] ?? '', 300, false),
        'statut'      => $statut,
        'xp_reserve'  => $xp,
        'regles'      => $regles,
        'messages'    => $messages,
        'items'       => $items,
        'score_max'   => jeux_score_max($slug, $regles),
    ], null];
}

function ecrire($c, $slug, $e) {
    $regles   = json_encode($e['regles'], JSON_UNESCAPED_UNICODE);
    $messages = json_encode($e['messages'], JSON_UNESCAPED_UNICODE);
    $items    = json_encode($e['items'], JSON_UNESCAPED_UNICODE);
    $auteur   = $_SESSION['username'] ?? '';
    $stmt = mysqli_prepare($c,
        'UPDATE jeux SET nom = ?, emoji = ?, description = ?, statut = ?, xp_reserve = ?,
                         regles = ?, messages = ?, items = ?, score_max = ?, maj_par = ?
         WHERE slug = ?');
    //            nom emoji desc statut xp regles messages items max maj_par slug
    $stmt->bind_param('ssssisssiss', $e['nom'], $e['emoji'], $e['description'], $e['statut'],
                      $e['xp_reserve'], $regles, $messages, $items, $e['score_max'], $auteur, $slug);
    return $stmt->execute();
}

// ── LISTE ──────────────────────────────────────────────────────────────────
if ($action === 'liste' && $methode === 'GET') {
    $act = activite($c);
    $res = mysqli_query($c,
        'SELECT slug, nom, emoji, description, statut, ordre, items, score_max, xp_reserve, maj_at, maj_par
         FROM jeux ORDER BY ordre, slug');
    $jeux = [];
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $r = jeux_decoder($r);
        $r['nb_items'] = count($r['items']);
        unset($r['items']);
        $r['parties'] = $act[$r['slug']]['parties'] ?? 0;
        $r['joueurs'] = $act[$r['slug']]['joueurs'] ?? 0;
        $jeux[] = $r;
    }
    sortir(['jeux' => $jeux]);
}

// ── UN JEU ─────────────────────────────────────────────────────────────────
if ($action === 'jeu' && $methode === 'GET') {
    $slug = (string)($_GET['slug'] ?? '');
    $j = jeux_slug_valide($slug) ? jeux_charger($c, $slug) : null;
    if (!$j) sortir(['error' => 'Jeu introuvable.'], 404);

    $versions = [];
    $stmt = mysqli_prepare($c, 'SELECT id, auteur, created_at, contenu FROM jeux_versions WHERE slug = ? ORDER BY id DESC');
    $stmt->bind_param('s', $slug);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($v = $res->fetch_assoc()) {
        $etat = json_decode($v['contenu'], true) ?: [];
        $versions[] = [
            'id'        => (int)$v['id'],
            'auteur'    => $v['auteur'],
            'date'      => $v['created_at'],
            'nb_items'  => count($etat['items'] ?? []),
            'score_max' => (int)($etat['score_max'] ?? 0),
            'statut'    => $etat['statut'] ?? '',
        ];
    }
    $act = activite($c);
    sortir([
        'jeu'      => $j,
        'moteur'   => jeux_moteurs()[$slug],
        'versions' => $versions,
        'parties'  => $act[$slug]['parties'] ?? 0,
        'joueurs'  => $act[$slug]['joueurs'] ?? 0,
    ]);
}

if ($methode !== 'POST') sortir(['error' => 'Action inconnue'], 400);
$d = corps_json();

// ── SAUVER ─────────────────────────────────────────────────────────────────
if ($action === 'sauver') {
    $slug = (string)($d['slug'] ?? '');
    $avant = jeux_slug_valide($slug) ? jeux_charger($c, $slug) : null;
    if (!$avant) sortir(['error' => 'Jeu introuvable.'], 404);

    [$etat, $err] = valider_etat($slug, $d);
    if ($err) sortir(['error' => $err], 422);

    // Version précédente archivée AVANT écrasement : c'est le seul filet en cas
    // de mauvaise manipulation dans l'éditeur (cf. cours_versions).
    archiver($c, $avant);
    if (!ecrire($c, $slug, $etat)) sortir(['error' => 'L\'enregistrement a échoué.'], 500);

    $details = $etat['nom'] . ' (' . $etat['statut'] . ', ' . count($etat['items']) . ' éléments';
    if ($etat['score_max'] !== $avant['score_max']) $details .= ', score max ' . $avant['score_max'] . ' → ' . $etat['score_max'];
    audit_log($c, 'jeu_modifie', $details . ')', ['target_type' => 'jeu']);

    sortir(['ok' => true, 'jeu' => jeux_charger($c, $slug)]);
}

// ── ORDRE ──────────────────────────────────────────────────────────────────
if ($action === 'ordre') {
    $slugs = array_values(array_filter((array)($d['slugs'] ?? []), 'jeux_slug_valide'));
    $stmt = mysqli_prepare($c, 'UPDATE jeux SET ordre = ? WHERE slug = ?');
    foreach ($slugs as $i => $s) {
        $stmt->bind_param('is', $i, $s);
        $stmt->execute();
    }
    audit_log($c, 'jeux_ordre', implode(', ', $slugs), ['target_type' => 'jeu']);
    sortir(['ok' => true]);
}

// ── RESTAURER UNE VERSION ──────────────────────────────────────────────────
// La version restaurée repasse par la validation complète : le score max est
// recalculé, et une version devenue invalide (règle durcie entre-temps) est
// refusée plutôt que réinstallée cassée. L'état actuel est archivé avant :
// une restauration se défait comme une sauvegarde.
if ($action === 'restaurer') {
    $slug = (string)($d['slug'] ?? '');
    $vid  = (int)($d['version_id'] ?? 0);
    $avant = jeux_slug_valide($slug) ? jeux_charger($c, $slug) : null;
    if (!$avant) sortir(['error' => 'Jeu introuvable.'], 404);

    $stmt = mysqli_prepare($c, 'SELECT contenu, created_at FROM jeux_versions WHERE id = ? AND slug = ?');
    $stmt->bind_param('is', $vid, $slug);
    $stmt->execute();
    $v = $stmt->get_result()->fetch_assoc();
    if (!$v) sortir(['error' => 'Version introuvable.'], 404);

    [$etat, $err] = valider_etat($slug, json_decode($v['contenu'], true) ?: []);
    if ($err) sortir(['error' => 'Cette version ne peut plus être restaurée : ' . $err], 422);

    archiver($c, $avant);
    if (!ecrire($c, $slug, $etat)) sortir(['error' => 'La restauration a échoué.'], 500);
    audit_log($c, 'jeu_restaure', $etat['nom'] . ' (version du ' . $v['created_at'] . ')', ['target_type' => 'jeu']);

    sortir(['ok' => true, 'jeu' => jeux_charger($c, $slug)]);
}

sortir(['error' => 'Action inconnue'], 400);
