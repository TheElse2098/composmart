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

// L'organisation d'avant va au journal : elle permet de défaire un
// glisser-déposer malheureux (cf. annuler.php).
$avant = cours_organisation($c);

$deplaces = cours_appliquer_organisation($c, $themes);
if ($deplaces === false) { http_response_code(500); echo json_encode(['error' => 'Échec.']); exit; }

$changements = cours_changements_organisation($avant, cours_organisation($c));
if ($changements) {
    audit_log($c, 'cours_reorganises', count($changements) . ' changement' . (count($changements) > 1 ? 's' : ''), [
        'target_type' => 'cours',
        'snapshot'    => ['changements' => $changements, 'avant' => $avant['themes']],
    ]);
}
echo json_encode(['ok' => true, 'cours' => $deplaces]);
