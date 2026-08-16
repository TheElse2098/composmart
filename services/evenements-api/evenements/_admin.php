<?php
/**
 * Garde commune aux endpoints d'administration des événements
 * (admin.php, parcours.php, animation.php).
 *
 * Ce service n'a pas accès à la table `users` (db-core, base séparée) :
 * contrairement à courses-api/admin/_admin_guard.php qui relit isAdmin en base
 * à chaque appel, on s'appuie ici sur is_admin_session() (flag posé au login),
 * comme le font déjà map-api et games-api pour la même raison. Limite
 * documentée dans shared/_guard.php : un admin rétrogradé garde l'accès
 * jusqu'à sa reconnexion.
 */
require_once __DIR__ . '/../_guard.php';

function evt_admin_connexion_ou_403() {
    secure_session_start();
    header('Content-Type: application/json; charset=utf-8');
    // mysqli en mode « retour false » plutôt qu'en exceptions : une requête
    // fautive ne doit pas se transformer en 500 opaque (cf. courses-api/
    // admin/_admin_guard.php, même choix).
    mysqli_report(MYSQLI_REPORT_OFF);
    ob_clean();
    csrf_check();

    if (empty($_SESSION['user_id']) || !is_admin_session()) {
        http_response_code(403);
        echo json_encode(['error' => 'Accès réservé']);
        exit;
    }

    $conn = mysqli_connect(
        getenv('DB_HOST') ?: 'db-evenements',
        getenv('DB_USER') ?: 'composmart',
        getenv('DB_PASSWORD') ?: '',
        getenv('DB_NAME') ?: 'Composmart'
    );
    if (!$conn) { http_response_code(500); echo json_encode(['error' => 'Connexion DB échouée']); exit; }
    return $conn;
}

/** Corps JSON de la requête, tableau vide si absent ou invalide. */
function evt_corps_json() {
    $d = json_decode(file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}
