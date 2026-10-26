<?php
/**
 * Persiste le résultat d'un glisser-déposer sur /admin/themes.
 *
 * Le client envoie l'organisation complète, thème par thème, plutôt qu'un
 * « déplace X après Y » : c'est ce qui rend l'opération idempotente et immunise
 * contre les états intermédiaires (deux cours au même rang, trous dans la
 * numérotation) qu'une suite de déplacements relatifs finit toujours par créer.
 *
 * Corps : { "themes": [ {"id": 3, "cours": [12, 7, 9]}, ... ] }
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();
csrf_check();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'Méthode non autorisée']); exit;
}

$d = corps_json();
$themes = $d['themes'] ?? null;
if (!is_array($themes)) { echo json_encode(['error' => 'Organisation manquante.']); exit; }

/** Organisation actuelle, au même format que le corps reçu, + noms pour le journal. */
function organisation($c) {
    $themes = []; $noms_themes = []; $titres = []; $place = [];
    $res = mysqli_query($c, 'SELECT id, nom FROM themes ORDER BY ordre, id');
    while ($res && ($t = mysqli_fetch_assoc($res))) {
        $themes[(int)$t['id']] = ['id' => (int)$t['id'], 'cours' => []];
        $noms_themes[(int)$t['id']] = $t['nom'];
    }
    $res = mysqli_query($c, 'SELECT id, theme_id, titre FROM cours ORDER BY theme_id, ordre, id');
    while ($res && ($r = mysqli_fetch_assoc($res))) {
        $tid = (int)$r['theme_id'];
        if (!isset($themes[$tid])) continue;
        $themes[$tid]['cours'][] = (int)$r['id'];
        $titres[(int)$r['id']] = $r['titre'];
        $place[(int)$r['id']] = $noms_themes[$tid] . ' · n°' . count($themes[$tid]['cours']);
    }
    return ['themes' => array_values($themes), 'titres' => $titres, 'place' => $place,
            'noms_themes' => array_values($noms_themes)];
}

// L'organisation d'avant va au journal : elle permet de défaire un
// glisser-déposer malheureux.
$avant = organisation($c);

// Toutes les écritures dans une transaction : un rangement à moitié appliqué
// laisserait le catalogue dans un ordre incohérent.
mysqli_begin_transaction($c);

$stmt_cours  = mysqli_prepare($c, 'UPDATE cours  SET theme_id = ?, ordre = ? WHERE id = ?');
$stmt_theme  = mysqli_prepare($c, 'UPDATE themes SET ordre = ? WHERE id = ?');
if (!$stmt_cours || !$stmt_theme) {
    mysqli_rollback($c);
    http_response_code(500); echo json_encode(['error' => 'Requête impossible.']); exit;
}

$deplaces = 0;
foreach (array_values($themes) as $rang_theme => $t) {
    $theme_id = (int)($t['id'] ?? 0);
    if ($theme_id <= 0) continue;

    $stmt_theme->bind_param('ii', $rang_theme, $theme_id);
    if (!$stmt_theme->execute()) { mysqli_rollback($c); http_response_code(500); echo json_encode(['error' => 'Échec.']); exit; }

    foreach (array_values((array)($t['cours'] ?? [])) as $rang => $cours_id) {
        $cours_id = (int)$cours_id;
        if ($cours_id <= 0) continue;
        $stmt_cours->bind_param('iii', $theme_id, $rang, $cours_id);
        if (!$stmt_cours->execute()) { mysqli_rollback($c); http_response_code(500); echo json_encode(['error' => 'Échec.']); exit; }
        $deplaces++;
    }
}

mysqli_commit($c);

// Seuls les cours qui ont vraiment bougé figurent au journal, avec leur place
// avant/après (« Thème · n°2 ») : le client renvoie tout le catalogue à chaque
// dépôt, et « 23 cours replacés » ne disait pas lequel avait changé.
$apres = organisation($c);
$changements = [];
foreach ($apres['place'] as $cid => $place) {
    $ancienne = $avant['place'][$cid] ?? null;
    if ($ancienne !== $place) $changements[$apres['titres'][$cid]] = [$ancienne, $place];
}
if ($avant['noms_themes'] !== $apres['noms_themes']) {
    $changements['Ordre des thèmes'] = [$avant['noms_themes'], $apres['noms_themes']];
}
if ($changements) {
    audit_log($c, 'cours_reorganises', count($changements) . ' changement' . (count($changements) > 1 ? 's' : ''), [
        'target_type' => 'cours',
        'snapshot'    => ['changements' => $changements, 'avant' => $avant['themes']],
    ]);
}
echo json_encode(['ok' => true, 'cours' => $deplaces]);
