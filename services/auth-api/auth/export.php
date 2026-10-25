<?php
/**
 * « Télécharger mes données » — droit d'accès et de portabilité (art. 15 et 20
 * RGPD). Renvoie un fichier JSON avec tout ce que Composmart conserve sur le
 * compte connecté, toutes bases confondues :
 *   - db-core (ici)        : compte, progression, XP, connexions, demandes de contact ;
 *   - db-games             : scores            (games-api/jeux/export.php) ;
 *   - db-map               : signalements, composteurs proposés (map-api/carte/export.php) ;
 *   - db-evenements        : participations aux ateliers (evenements-api/evenements/export.php).
 *
 * Un service injoignable n'empêche pas l'export : sa section vaut null et la
 * liste `sections_indisponibles` le signale, pour que la personne sache que
 * le fichier est incomplet et puisse réessayer.
 */
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once __DIR__ . '/../_guard.php';
secure_session_start();
ob_clean();
mysqli_report(MYSQLI_REPORT_OFF);

function erreur($code, $msg) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $msg]);
    exit;
}

if (empty($_SESSION['user_id'])) erreur(401, 'Connexion requise');
if (!rate_limit('export_donnees', 5, 3600)) erreur(429, 'Trop de téléchargements récents. Réessaie dans une heure.');

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) erreur(500, 'Service indisponible');
mysqli_set_charset($c, 'utf8mb4');

$uid = (int)$_SESSION['user_id'];

/** Lignes d'une requête préparée sur l'utilisateur ; [] si la table manque. */
function lignes($c, $sql, $uid) {
    $stmt = mysqli_prepare($c, $sql);
    if (!$stmt) return [];
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

$compte = lignes($c, 'SELECT * FROM users WHERE id = ?', $uid)[0] ?? null;
if (!$compte) erreur(404, 'Compte introuvable');
// Le mot de passe n'est stocké que sous forme d'empreinte irréversible : elle
// n'apprend rien à la personne et n'a pas à circuler dans un fichier.
unset($compte['password_hash']);
$compte['isAdmin'] = (bool)$compte['isAdmin'];
$compte['email_verifie'] = (bool)$compte['email_verifie'];

$demandes = lignes($c,
    'SELECT id, categorie, sujet, message, statut, created_at FROM contact_messages
      WHERE user_id = ? ORDER BY created_at', $uid);
$fil = mysqli_prepare($c,
    'SELECT user_id, est_admin, corps, created_at FROM ticket_messages
      WHERE ticket_id = ? ORDER BY created_at');
foreach ($demandes as &$d) {
    $d['echanges'] = [];
    if (!$fil) continue;
    $tid = (int)$d['id'];
    $fil->bind_param('i', $tid);
    $fil->execute();
    foreach ($fil->get_result()->fetch_all(MYSQLI_ASSOC) as $m) {
        // Les réponses de l'équipe sont signées « Équipe Composmart » : le
        // pseudo de l'administrateur n'est pas une donnée de la personne.
        $d['echanges'][] = [
            'auteur' => (int)$m['user_id'] === $uid ? 'moi' : 'Équipe Composmart',
            'message' => $m['corps'],
            'date' => $m['created_at'],
        ];
    }
    unset($d['id']);
}
unset($d);

$export = [
    'genere_le' => date('c'),
    'site' => site_url(),
    'a_propos' => 'Données personnelles conservées par Composmart pour ce compte. '
               . 'Détail des usages et durées : ' . site_url() . '/confidentialite',
    'compte' => $compte,
    'cours_termines' => lignes($c,
        'SELECT cours_id AS cours, completed_at AS date FROM user_progress WHERE user_id = ? ORDER BY completed_at', $uid),
    'historique_xp' => lignes($c,
        'SELECT delta AS xp, source, label, created_at AS date FROM xp_log WHERE user_id = ? ORDER BY created_at', $uid),
    'connexions' => array_column(lignes($c,
        'SELECT logged_at FROM logins WHERE user_id = ? ORDER BY logged_at', $uid), 'logged_at'),
    'demandes_de_contact' => $demandes,
];

// ── Autres bases, via les endpoints internes ───────────────────────────────
$indisponibles = [];
$jeux = appel_interne(getenv('GAMES_EXPORT_URL') ?: '', ['uid' => $uid]);
$carte = appel_interne(getenv('MAP_EXPORT_URL') ?: '', ['uid' => $uid, 'username' => $compte['username']]);
$ateliers = appel_interne(getenv('EVENEMENTS_EXPORT_URL') ?: '', ['uid' => $uid]);

$export['scores_jeux'] = $jeux['scores'] ?? null;
$export['signalements_carte'] = $carte['signalements'] ?? null;
$export['composteurs_proposes'] = $carte['composteurs_proposes'] ?? null;
$export['ateliers'] = $ateliers['ateliers'] ?? null;
if ($jeux === null)     $indisponibles[] = 'scores_jeux';
if ($carte === null)    array_push($indisponibles, 'signalements_carte', 'composteurs_proposes');
if ($ateliers === null) $indisponibles[] = 'ateliers';
$export['sections_indisponibles'] = $indisponibles;

header('Content-Type: application/json; charset=utf-8');
header('Content-Disposition: attachment; filename="composmart-mes-donnees-' . date('Y-m-d') . '.json"');
header('Cache-Control: no-store');
echo json_encode($export, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
