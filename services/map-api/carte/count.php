<?php
/**
 * Compteurs publics de db-map pour la page admin (composts + signalements ouverts).
 * Pas de données sensibles : simples totaux.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json');
ob_clean();

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-map',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

function count_of($c, $sql) {
    $res = mysqli_query($c, $sql);
    return $res ? (int)(mysqli_fetch_row($res)[0] ?? 0) : 0;
}

echo json_encode([
    // 'composts' = ceux réellement sur la carte ; les demandes en attente sont
    // comptées à part (badge de l'onglet « Ajouts » de l'admin).
    'composts'     => count_of($c, "SELECT COUNT(*) FROM composts WHERE statut = 'valide'"),
    'en_attente'   => count_of($c, "SELECT COUNT(*) FROM composts WHERE statut = 'en_attente'"),
    'signalements' => count_of($c, "SELECT COUNT(*) FROM signalements WHERE statut = 'ouvert'"),
]);
