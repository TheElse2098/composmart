<?php
/**
 * Export interne des participations aux ateliers d'un compte (droit d'accès /
 * portabilité, art. 15 et 20 RGPD). Appelé par auth/export.php.
 *
 * Seules les participations faites en étant connecté sont rattachées au
 * compte (participants.user_id). Une participation anonyme, ou anonymisée par
 * la purge (6 mois après l'atelier), n'est plus reliable à personne.
 *
 * Endpoint INTERNE : protégé par le secret partagé (AUDIT_SECRET).
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
header('Content-Type: application/json; charset=utf-8');
ob_clean();

$body = endpoint_interne();
$uid  = (int)($body['uid'] ?? 0);
if ($uid <= 0) { http_response_code(400); echo json_encode(['error' => 'bad_request']); exit; }

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-evenements',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'db']); exit; }
mysqli_set_charset($c, 'utf8mb4');

$stmt = mysqli_prepare($c,
    'SELECT p.id, e.titre AS atelier, e.lieu, e.date_debut, p.nom_affiche AS pseudo,
            q.nom AS equipe, p.rejoint_at
       FROM participants p
       JOIN evenements e ON e.id = p.evenement_id
       LEFT JOIN equipes q ON q.id = p.equipe_id
      WHERE p.user_id = ? ORDER BY p.rejoint_at');
$stmt->bind_param('i', $uid);
$stmt->execute();
$participations = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

$rep = mysqli_prepare($c,
    'SELECT s.titre AS question, r.reponse, r.points, r.repondu_at
       FROM reponses r LEFT JOIN evenement_slides s ON s.id = r.slide_id
      WHERE r.participant_id = ? ORDER BY r.repondu_at');
foreach ($participations as &$p) {
    $pid = (int)$p['id'];
    $rep->bind_param('i', $pid);
    $rep->execute();
    $p['reponses'] = $rep->get_result()->fetch_all(MYSQLI_ASSOC);
    unset($p['id']);
}
unset($p);

echo json_encode(['ateliers' => $participations], JSON_UNESCAPED_UNICODE);
