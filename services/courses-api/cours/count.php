<?php
/**
 * Compteur public de cours publiés — pour le chiffre affiché sur la page
 * d'accueil ("N cours interactifs"). Même motif que map-api/carte/count.php.
 *
 * 'publie' uniquement : un brouillon en cours d'écriture depuis /admin/themes
 * ne doit pas gonfler un chiffre que les visiteurs peuvent réellement suivre.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
header('Content-Type: application/json');
ob_clean();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$res = mysqli_query($c, "SELECT COUNT(*) FROM cours WHERE statut = 'publie'");
$cours = $res ? (int)(mysqli_fetch_row($res)[0] ?? 0) : 0;

echo json_encode(['cours' => $cours]);
