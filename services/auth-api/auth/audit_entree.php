<?php
/**
 * Endpoint INTERNE (secret AUDIT_SECRET) : une entrée du journal d'audit pour
 * les services qui n'ont pas db-core (map-api, games-api, evenements-api),
 * quand un admin annule une action depuis le journal.
 *
 *   {id}                  → {entree: {...} | null}
 *   {id, reserver: pseudo} → {ok} : marque l'entrée annulée, si elle ne l'est pas déjà
 *   {id, liberer: 1}       → {ok} : lève la marque (l'annulation a échoué)
 *
 * Logique dans shared/_guard.php (audit_entree_local), partagée avec courses-api.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$d = endpoint_interne();
mysqli_report(MYSQLI_REPORT_OFF);

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }

$rep = audit_entree_local($c, $d);
if ($rep === null) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }
echo json_encode($rep, JSON_UNESCAPED_UNICODE);
