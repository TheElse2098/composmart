<?php
/**
 * Tickets côté administrateurs.
 *
 *   GET  ?statut=&page=       → liste filtrée + compteur « à traiter »
 *   GET  ?id=N                → fil complet (marque comme lu côté admin)
 *   POST action=repondre      → répond au nom de l'admin connecté (+ mail sobre)
 *   POST action=clore         → ouvert → clos
 *   POST action=rouvrir       → clos → ouvert
 *   POST action=fermer_definitif → terminal, aucune réouverture possible
 *
 * Chaque action d'écriture est journalisée dans l'audit. La réponse déclenche
 * un email SOBRE (« un administrateur a répondu ») : jamais le contenu du
 * message, qui ne se lit que sur le site, et seulement si l'utilisateur n'a
 * pas déjà une réponse non lue — pas de rafale quand un admin écrit trois
 * messages d'affilée.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/_admin_guard.php';
$c = admin_connexion_ou_403();
ob_clean();
csrf_check();

const PAR_PAGE = 20;

// ── POST : actions ─────────────────────────────────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $d      = corps_json();
    $action = $d['action'] ?? '';
    $id     = (int)($d['id'] ?? 0);
    if ($id <= 0) { http_response_code(404); echo json_encode(['error' => 'Ticket introuvable.']); exit; }

    $stmt = mysqli_prepare($c,
        'SELECT id, user_id, username, sujet, statut, derniere_activite, dernier_auteur_admin, lu_par_user_at
         FROM contact_messages WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $t = $stmt->get_result()->fetch_assoc();
    if (!$t) { http_response_code(404); echo json_encode(['error' => 'Ticket introuvable.']); exit; }

    if ($action === 'repondre') {
        if ($t['statut'] === 'clos_definitif') {
            echo json_encode(['error' => 'Ticket définitivement clos.']); exit;
        }
        if ($t['statut'] !== 'ouvert') {
            echo json_encode(['error' => 'Ticket clos : rouvre-le pour répondre.']); exit;
        }
        $corps = trim($d['corps'] ?? '');
        if (mb_strlen($corps) < 1 || mb_strlen($corps) > 3000) {
            echo json_encode(['error' => 'Le message doit faire entre 1 et 3000 caractères.']); exit;
        }

        // Décidé AVANT l'insertion : y avait-il déjà une réponse admin non lue ?
        $deja_non_lu = (int)$t['dernier_auteur_admin'] === 1
            && ($t['lu_par_user_at'] === null || $t['derniere_activite'] > $t['lu_par_user_at']);

        $admin_id = (int)$_SESSION['user_id'];
        $admin    = $_SESSION['username'] ?? 'Admin';
        $stmt = mysqli_prepare($c,
            'INSERT INTO ticket_messages (ticket_id, user_id, auteur, est_admin, corps) VALUES (?, ?, ?, 1, ?)');
        $stmt->bind_param('iiss', $id, $admin_id, $admin, $corps);
        if (!$stmt->execute()) { http_response_code(500); echo json_encode(['error' => "L'envoi a échoué."]); exit; }
        mysqli_query($c, "UPDATE contact_messages
                          SET derniere_activite = NOW(), dernier_auteur_admin = 1, lu_par_admin_at = NOW()
                          WHERE id = $id");

        // ── Notification email sobre ──
        $mail_envoye = false;
        if (!$deja_non_lu && !empty($t['user_id'])) {
            $r = mysqli_query($c, 'SELECT email, username FROM users WHERE id = ' . (int)$t['user_id']);
            $u = $r ? mysqli_fetch_assoc($r) : null;
            if ($u && !empty($u['email'])) {
                $sujet_mail = 'Réponse à ton signalement #' . $id . ' — Composmart';
                $corps_mail = 'Bonjour ' . $u['username'] . ",\n\n"
                    . "Un administrateur a répondu à ton signalement #$id « " . $t['sujet'] . " ».\n"
                    . "La réponse se lit sur le site, depuis ta page de compte :\n\n"
                    . site_url() . "/compte\n\n"
                    . "— L'équipe Composmart";
                $mail_envoye = send_mail($u['email'], $sujet_mail, $corps_mail);
                audit_log($c, 'mail_envoye', ($mail_envoye ? 'Envoyé' : 'Échec') . ' — réponse ticket #' . $id, [
                    'target_type' => 'mail',
                    'snapshot'    => [
                        'to'     => $u['email'],
                        'sujet'  => $sujet_mail,
                        'ok'     => $mail_envoye,
                        'erreur' => $mail_envoye ? null : mb_substr(send_mail_last_error(), 0, 300),
                    ],
                ]);
            }
        }

        audit_log($c, 'ticket_repondu', 'réponse sur « ' . mb_substr($t['sujet'], 0, 80) . ' »', [
            'target_type' => 'ticket', 'target_id' => $id,
        ]);
        echo json_encode(['ok' => true, 'mail_envoye' => $mail_envoye]);
        exit;
    }

    if ($action === 'clore' || $action === 'rouvrir' || $action === 'fermer_definitif') {
        if ($action === 'fermer_definitif') {
            // Terminal : accessible depuis ouvert ET clos, mais jamais l'inverse.
            $ok = $t['statut'] !== 'clos_definitif';
            $vers = 'clos_definitif';
            $libelle = 'fermeture définitive';
        } elseif ($action === 'clore') {
            $ok = $t['statut'] === 'ouvert';
            $vers = 'clos';
            $libelle = 'clôture';
        } else {
            $ok = $t['statut'] === 'clos';   // clos_definitif ne se rouvre pas, même par un admin
            $vers = 'ouvert';
            $libelle = 'réouverture';
        }
        if (!$ok) { echo json_encode(['error' => 'Transition impossible depuis l\'état actuel.']); exit; }

        $stmt = mysqli_prepare($c,
            'UPDATE contact_messages SET statut = ?, derniere_activite = NOW() WHERE id = ? AND statut = ?');
        $stmt->bind_param('sis', $vers, $id, $t['statut']);
        $stmt->execute();
        if (mysqli_stmt_affected_rows($stmt) < 1) {
            echo json_encode(['error' => 'Le ticket a changé d\'état entre-temps.']); exit;
        }
        audit_log($c, 'ticket_' . ($vers === 'ouvert' ? 'rouvert' : ($vers === 'clos' ? 'clos' : 'ferme_definitif')),
            $libelle . ' de « ' . mb_substr($t['sujet'], 0, 80) . ' »',
            ['target_type' => 'ticket', 'target_id' => $id]);
        echo json_encode(['ok' => true, 'statut' => $vers]);
        exit;
    }

    echo json_encode(['error' => 'Action inconnue.']);
    exit;
}

// ── GET ?id= : fil complet ─────────────────────────────────────────────────
if (isset($_GET['id'])) {
    $id = (int)$_GET['id'];
    $stmt = mysqli_prepare($c,
        'SELECT id, user_id, username, categorie, sujet, message, statut, created_at
         FROM contact_messages WHERE id = ?');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $t = $stmt->get_result()->fetch_assoc();
    if (!$t) { http_response_code(404); echo json_encode(['error' => 'Ticket introuvable.']); exit; }

    $messages = [[
        'auteur'     => $t['username'] ?: 'Compte supprimé',
        'est_admin'  => false,
        'corps'      => $t['message'],
        'created_at' => $t['created_at'],
    ]];
    $stmt = mysqli_prepare($c,
        'SELECT auteur, est_admin, corps, created_at
         FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at, id');
    $stmt->bind_param('i', $id);
    $stmt->execute();
    $res = $stmt->get_result();
    while ($m = $res->fetch_assoc()) {
        $messages[] = [
            'auteur'     => $m['auteur'] ?: ($m['est_admin'] ? 'Admin' : 'Compte supprimé'),
            'est_admin'  => (bool)$m['est_admin'],
            'corps'      => $m['corps'],
            'created_at' => $m['created_at'],
        ];
    }
    mysqli_query($c, "UPDATE contact_messages SET lu_par_admin_at = NOW() WHERE id = $id");

    echo json_encode([
        'ticket' => [
            'id'        => (int)$t['id'],
            'username'  => $t['username'] ?: 'Compte supprimé',
            'compte_supprime' => empty($t['user_id']),
            'categorie' => $t['categorie'],
            'sujet'     => $t['sujet'],
            'statut'    => $t['statut'],
            'date'      => $t['created_at'],
        ],
        'messages' => $messages,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── GET : liste filtrée + paginée ──────────────────────────────────────────
// « À traiter » = tickets ouverts dont le dernier mot est à l'utilisateur et
// pas encore lu par un admin : c'est le badge de l'onglet.
$a_traiter = (int)(mysqli_fetch_row(mysqli_query($c,
    "SELECT COUNT(*) FROM contact_messages
     WHERE statut = 'ouvert' AND dernier_auteur_admin = 0
       AND (lu_par_admin_at IS NULL OR derniere_activite > lu_par_admin_at)"))[0] ?? 0);

// Chemin rapide pour le badge d'onglet (rafraichirStats) : le compteur seul,
// sans lister vingt tickets à chaque rafraîchissement du tableau de bord.
if (isset($_GET['count'])) {
    echo json_encode(['a_traiter' => $a_traiter]);
    exit;
}

$filtre = $_GET['statut'] ?? 'ouvert';
switch ($filtre) {
    case 'clos':           $where = "WHERE statut = 'clos'"; break;
    case 'clos_definitif': $where = "WHERE statut = 'clos_definitif'"; break;
    case 'tous':           $where = ''; break;
    case 'ouvert':
    default:               $filtre = 'ouvert';
                           $where = "WHERE statut = 'ouvert'"; break;
}

$page  = max(1, (int)($_GET['page'] ?? 1));
$total = (int)(mysqli_fetch_row(mysqli_query($c, "SELECT COUNT(*) FROM contact_messages $where"))[0] ?? 0);
$pages = max(1, (int)ceil($total / PAR_PAGE));
$page  = min($page, $pages);
$offset = ($page - 1) * PAR_PAGE;

$res = mysqli_query($c,
    "SELECT id, user_id, username, categorie, sujet, statut, created_at,
            derniere_activite, dernier_auteur_admin, lu_par_admin_at,
            (SELECT COUNT(*) FROM ticket_messages tm WHERE tm.ticket_id = contact_messages.id) AS nb_reponses
     FROM contact_messages $where
     ORDER BY derniere_activite DESC, id DESC
     LIMIT " . PAR_PAGE . " OFFSET $offset");
$tickets = [];
while ($res && ($t = mysqli_fetch_assoc($res))) {
    $tickets[] = [
        'id'          => (int)$t['id'],
        'username'    => $t['username'] ?: 'Compte supprimé',
        'categorie'   => $t['categorie'],
        'sujet'       => $t['sujet'],
        'statut'      => $t['statut'],
        'date'        => $t['created_at'],
        'activite'    => $t['derniere_activite'] ?: $t['created_at'],
        'nb_messages' => 1 + (int)$t['nb_reponses'],
        'non_lu'      => (int)$t['dernier_auteur_admin'] === 0
                         && ($t['lu_par_admin_at'] === null || $t['derniere_activite'] > $t['lu_par_admin_at']),
    ];
}

echo json_encode([
    'a_traiter' => $a_traiter,
    'tickets'   => $tickets,
    'filtre'    => $filtre,
    'page'      => $page,
    'pages'     => $pages,
    'total'     => $total,
], JSON_UNESCAPED_UNICODE);
