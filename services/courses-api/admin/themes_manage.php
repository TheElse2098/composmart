<?php
/**
 * Thèmes et arborescence du catalogue pour /admin/themes.
 *
 *   GET                       → tous les thèmes avec leurs cours (brouillons compris)
 *   POST {action:'save'}      → création / modification d'un thème
 *   POST {action:'delete'}    → suppression d'un thème vide
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();

// ── Lecture ────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $themes = [];
    $res = mysqli_query($c, 'SELECT id, slug, nom, emoji, couleur, description, ordre FROM themes ORDER BY ordre, id');
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $r['id'] = (int)$r['id'];
        $r['ordre'] = (int)$r['ordre'];
        $r['cours'] = [];
        $themes[$r['id']] = $r;
    }

    $res = mysqli_query($c,
        'SELECT c.id, c.slug, c.theme_id, c.titre, c.emoji, c.niveau, c.xp_reward,
                c.statut, c.nb_questions, c.has_text, c.ordre, c.termine_anonyme,
                (SELECT COUNT(*) FROM user_progress up WHERE up.cours_id = c.slug) AS termine_par
         FROM cours c ORDER BY c.theme_id, c.ordre, c.id');
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $tid = (int)$r['theme_id'];
        if (!isset($themes[$tid])) continue;
        $themes[$tid]['cours'][] = [
            'id'           => (int)$r['id'],
            'slug'         => $r['slug'],
            'titre'        => $r['titre'],
            'emoji'        => $r['emoji'],
            'niveau'       => $r['niveau'],
            'xp'           => (int)$r['xp_reward'],
            'statut'       => $r['statut'],
            'nb_questions' => (int)$r['nb_questions'],
            'has_text'     => (int)$r['has_text'],
            'termine_par'  => (int)$r['termine_par'],       // comptes (user_progress)
            'termine_anonyme' => (int)$r['termine_anonyme'], // visiteurs sans compte (simple compteur)
        ];
    }

    echo json_encode(['themes' => array_values($themes)], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}
csrf_check();

$d = corps_json();
$action = $d['action'] ?? '';

// ── Suppression ────────────────────────────────────────────────────────────
if ($action === 'delete') {
    $id = (int)($d['id'] ?? 0);
    // La clé étrangère cours.theme_id est en ON DELETE CASCADE : supprimer un
    // thème peuplé emporterait silencieusement tous ses cours, et avec eux la
    // progression des lecteurs. On exige donc qu'il soit vide.
    $r = mysqli_query($c, "SELECT COUNT(*) FROM cours WHERE theme_id = $id");
    $n = $r ? (int)(mysqli_fetch_row($r)[0] ?? 0) : 0;
    if ($n > 0) {
        echo json_encode(['error' => "Ce thème contient encore $n cours. Déplace-les avant de le supprimer."]);
        exit;
    }
    $stmt = mysqli_prepare($c, 'DELETE FROM themes WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    audit_log($c, 'theme_supprime', "thème #$id", ['target_type' => 'theme', 'target_id' => $id]);
    echo json_encode(['ok' => true]);
    exit;
}

// ── Création / modification ────────────────────────────────────────────────
if ($action !== 'save') { echo json_encode(['error' => 'Action inconnue.']); exit; }

$id  = (int)($d['id'] ?? 0);
$nom = trim((string)($d['nom'] ?? ''));
if ($nom === '' || mb_strlen($nom) > 120) {
    echo json_encode(['error' => 'Le nom est obligatoire (120 caractères maximum).']); exit;
}
$emoji       = mb_substr(trim((string)($d['emoji'] ?? '📂')), 0, 8);
$couleur     = mb_substr(trim((string)($d['couleur'] ?? 'linear-gradient(135deg,#1e6e3e,#2d9959)')), 0, 80);
$description = mb_substr(trim((string)($d['description'] ?? '')), 0, 200);
if ($description === '') $description = null;

if ($id > 0) {
    // Le slug d'un thème n'est pas modifiable : il sert d'adresse aux pages
    // d'édition (/admin/themes/<theme>/<cours>) et de clé au seed.
    $stmt = mysqli_prepare($c, 'UPDATE themes SET nom = ?, emoji = ?, couleur = ?, description = ? WHERE id = ?');
    $stmt->bind_param('ssssi', $nom, $emoji, $couleur, $description, $id);
    if (!$stmt->execute()) { echo json_encode(['error' => "L'enregistrement a échoué."]); exit; }
    audit_log($c, 'theme_modifie', $nom, ['target_type' => 'theme', 'target_id' => $id]);
    echo json_encode(['ok' => true, 'id' => $id]);
    exit;
}

$slug = slugifier($d['slug'] ?? $nom);
if ($slug === '') { echo json_encode(['error' => 'Impossible de déduire une adresse depuis ce nom.']); exit; }
$slug = mb_substr($slug, 0, 80);

$stmt = mysqli_prepare($c, 'SELECT id FROM themes WHERE slug = ?');
$stmt->bind_param('s', $slug);
$stmt->execute();
if ($stmt->get_result()->fetch_assoc()) {
    echo json_encode(['error' => "L'adresse « $slug » est déjà prise par un autre thème."]); exit;
}

$r = mysqli_query($c, 'SELECT COALESCE(MAX(ordre), -1) + 1 FROM themes');
$ordre = $r ? (int)(mysqli_fetch_row($r)[0] ?? 0) : 0;

$stmt = mysqli_prepare($c,
    'INSERT INTO themes (slug, nom, emoji, couleur, description, ordre) VALUES (?, ?, ?, ?, ?, ?)');
$stmt->bind_param('sssssi', $slug, $nom, $emoji, $couleur, $description, $ordre);
if (!$stmt->execute()) { echo json_encode(['error' => 'La création a échoué.']); exit; }

$id = (int)mysqli_insert_id($c);
audit_log($c, 'theme_cree', $nom, ['target_type' => 'theme', 'target_id' => $id]);
echo json_encode(['ok' => true, 'id' => $id, 'slug' => $slug], JSON_UNESCAPED_UNICODE);
