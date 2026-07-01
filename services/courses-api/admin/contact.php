<?php
/**
 * Admin — messages de contact.
 *  GET               → liste des messages (récents d'abord) + compteur non-lus.
 *  POST action=statut → change le statut d'un message (lu / traite).
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
header('Content-Type: application/json; charset=utf-8');
ob_clean();
csrf_check();
mysqli_report(MYSQLI_REPORT_OFF);

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { http_response_code(500); echo json_encode(['error' => 'DB error']); exit; }

// ── Garde admin (vérif en base = source de vérité) ─────────────────────────
$me = (int)($_SESSION['user_id'] ?? 0);
$is_admin = false;
if ($me > 0) {
    $stmt = mysqli_prepare($c, 'SELECT isAdmin FROM users WHERE id = ?');
    $stmt->bind_param('i', $me);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $is_admin = $row && (int)$row['isAdmin'] === 1;
}
if (!$is_admin) {
    http_response_code(403);
    echo json_encode(['error' => 'Accès réservé aux administrateurs.']);
    exit;
}

// ── Actions POST : changer le statut ou supprimer ──────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $id     = (int)($_POST['id'] ?? 0);
    $action = $_POST['action'] ?? 'statut';
    if (!$id) { echo json_encode(['error' => 'Données invalides']); exit; }

    // Suppression : réservée aux messages déjà traités (garde-fou anti-erreur).
    if ($action === 'supprimer') {
        $stmt = mysqli_prepare($c, "DELETE FROM contact_messages WHERE id = ? AND statut = 'traite'");
        $stmt->bind_param('i', $id);
        $stmt->execute();
        if (mysqli_stmt_affected_rows($stmt) > 0) {
            echo json_encode(['ok' => true]);
        } else {
            echo json_encode(['error' => 'Seuls les messages traités peuvent être supprimés.']);
        }
        exit;
    }

    // Changement de statut (lu / traité)
    $statut = $_POST['statut'] ?? '';
    if (!in_array($statut, ['lu', 'traite'], true)) {
        echo json_encode(['error' => 'Données invalides']); exit;
    }
    $stmt = mysqli_prepare($c, 'UPDATE contact_messages SET statut = ? WHERE id = ?');
    $stmt->bind_param('si', $statut, $id);
    $stmt->execute();
    echo json_encode(['ok' => true]);
    exit;
}

// ── Liste filtrée + paginée ─────────────────────────────────────────────────
$nouveaux = (int)(mysqli_fetch_row(mysqli_query($c,
    "SELECT COUNT(*) FROM contact_messages WHERE statut = 'nouveau'"))[0] ?? 0);

// Filtre : 'non_lus' (nouveau), 'non_clos' (nouveau + lu), 'tous'
$filtre = $_GET['filtre'] ?? 'non_clos';
switch ($filtre) {
    case 'non_lus':  $where = "WHERE statut = 'nouveau'"; break;
    case 'tous':     $where = '';                          break;
    case 'non_clos':
    default:         $filtre = 'non_clos';
                     $where = "WHERE statut IN ('nouveau','lu')"; break;
}

// Pagination
const PAR_PAGE = 20;
$page  = max(1, (int)($_GET['page'] ?? 1));
$total = (int)(mysqli_fetch_row(mysqli_query($c, "SELECT COUNT(*) FROM contact_messages $where"))[0] ?? 0);
$pages = max(1, (int)ceil($total / PAR_PAGE));
$page  = min($page, $pages);
$offset = ($page - 1) * PAR_PAGE;

$res = mysqli_query($c,
    "SELECT id, username, categorie, sujet, message, statut, created_at
     FROM contact_messages $where ORDER BY id DESC LIMIT " . PAR_PAGE . " OFFSET $offset");
$messages = [];
while ($row = mysqli_fetch_assoc($res)) {
    $messages[] = [
        'id'        => (int)$row['id'],
        'username'  => $row['username'] ?: 'Anonyme',
        'categorie' => $row['categorie'],
        'sujet'     => $row['sujet'],
        'message'   => $row['message'],
        'statut'    => $row['statut'],
        'date'      => $row['created_at'],
    ];
}
mysqli_close($c);

echo json_encode([
    'nouveaux' => $nouveaux,
    'messages' => $messages,
    'filtre'   => $filtre,
    'page'     => $page,
    'pages'    => $pages,
    'total'    => $total,
], JSON_UNESCAPED_UNICODE);
