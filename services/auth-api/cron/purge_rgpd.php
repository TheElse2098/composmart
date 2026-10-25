<?php
/**
 * Purge nocturne RGPD de db-core — durées de conservation annoncées dans
 * /confidentialite. Lancée chaque nuit par le CronJob k8s `purge-rgpd-core`
 * (et le service compose `purge-cron`), avec l'image auth-api.
 *
 * Déposé HORS de la racine web (/var/www/cron/) : ce script supprime des
 * comptes, il ne doit jamais être joignable par une URL.
 *
 *   1. jetons (vérification, réinitialisation) expirés ou utilisés → effacés ;
 *   2. comptes jamais vérifiés depuis 30 jours → supprimés ;
 *   3. historique de connexion > 12 mois → agrégé par jour puis effacé ;
 *   4. comptes sans connexion depuis 3 ans → email de prévenance, puis
 *      suppression 30 jours plus tard sans nouvelle connexion ;
 *   5. demandes de contact closes depuis 2 ans → effacées (fil compris) ;
 *   6. journal d'administration > 1 an → effacé.
 *
 * Les suppressions de comptes passent par supprimer_compte() (_guard.php) :
 * mêmes purges des autres bases que la suppression par la personne elle-même.
 * Les comptes administrateurs ne sont jamais supprimés automatiquement.
 *
 * La sortie ne contient que des compteurs : aucune donnée personnelle dans
 * les journaux du CronJob.
 *
 * Usage : php /var/www/cron/purge_rgpd.php [--dry]   (--dry : compte sans rien effacer)
 */

require_once getenv('GUARD_PATH') ?: '/var/www/html/api/_guard.php';
mysqli_report(MYSQLI_REPORT_OFF);

$dry = in_array('--dry', $argv ?? [], true);

const JOURS_NON_VERIFIE  = 30;
const MOIS_LOGINS        = 12;
const ANS_INACTIVITE     = 3;
const JOURS_PREVENANCE   = 30;
const ANS_TICKETS_CLOS   = 2;
const MOIS_AUDIT         = 12;

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-core',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { fwrite(STDERR, "[purge-rgpd] connexion db-core impossible\n"); exit(1); }
mysqli_set_charset($c, 'utf8mb4');

function log_purge($etape, $n) {
    echo '[purge-rgpd] ' . date('Y-m-d H:i:s') . " $etape : $n\n";
}

/** Exécute un DELETE/UPDATE, ou compte les lignes visées en mode --dry. */
function executer($c, $dry, $sql_ecriture, $sql_compte) {
    if ($dry) {
        $r = mysqli_query($c, $sql_compte);
        return $r ? (int)mysqli_fetch_row($r)[0] : 0;
    }
    return mysqli_query($c, $sql_ecriture) ? mysqli_affected_rows($c) : 0;
}

/** Supprime une liste de comptes [id, username] ; renvoie le nombre supprimé. */
function supprimer_lot($c, $dry, $rows, $motif) {
    if ($dry) return count($rows);
    $n = 0;
    foreach ($rows as $u) {
        $res = supprimer_compte($c, (int)$u['id'], $u['username'], null, $motif);
        if ($res['ok']) $n++;
    }
    return $n;
}

function lignes($c, $sql) {
    $r = mysqli_query($c, $sql);
    return $r ? mysqli_fetch_all($r, MYSQLI_ASSOC) : [];
}

// ── 1. Jetons expirés ou consommés ─────────────────────────────────────────
log_purge('jetons effacés', executer($c, $dry,
    "DELETE FROM user_tokens WHERE expire_at < NOW() OR used_at IS NOT NULL",
    "SELECT COUNT(*) FROM user_tokens WHERE expire_at < NOW() OR used_at IS NOT NULL"));

// ── 2. Comptes jamais vérifiés ─────────────────────────────────────────────
$rows = lignes($c, "SELECT id, username FROM users
    WHERE email_verifie = 0 AND isAdmin = 0
      AND created_at < NOW() - INTERVAL " . JOURS_NON_VERIFIE . " DAY");
log_purge('comptes non vérifiés supprimés',
    supprimer_lot($c, $dry, $rows, 'compte non vérifié depuis ' . JOURS_NON_VERIFIE . ' jours (purge automatique)'));

// ── 3. Historique de connexion > 12 mois ───────────────────────────────────
// Agrégé d'abord dans stats_anonymes (mêmes totaux par jour qu'à la suppression
// d'un compte) : les courbes de l'admin, qui additionnent logins et
// stats_anonymes, ne bougent pas.
$borne_logins = "logged_at < NOW() - INTERVAL " . MOIS_LOGINS . " MONTH";
if (!$dry) {
    mysqli_begin_transaction($c);
    $ok = mysqli_query($c, "INSERT INTO stats_anonymes (jour, type, total, somme)
        SELECT DATE(logged_at), 'connexion', COUNT(*), 0 FROM logins WHERE $borne_logins
        GROUP BY DATE(logged_at)
        ON DUPLICATE KEY UPDATE total = total + VALUES(total)");
    // Agrégat ET effacement, ou rien : un agrégat sans effacement compterait
    // ces connexions deux fois dans les courbes.
    $ok = $ok && mysqli_query($c, "DELETE FROM logins WHERE $borne_logins");
    $n = $ok ? mysqli_affected_rows($c) : 0;
    $ok ? mysqli_commit($c) : mysqli_rollback($c);
} else {
    $n = (int)mysqli_fetch_row(mysqli_query($c, "SELECT COUNT(*) FROM logins WHERE $borne_logins"))[0];
}
log_purge('connexions > ' . MOIS_LOGINS . ' mois agrégées et effacées', $n);

// ── 4. Comptes inactifs ────────────────────────────────────────────────────
// Colonnes ajoutées par db/migration-2026-10-rgpd.sql : sans elles, on saute
// l'étape plutôt que de supprimer à l'aveugle.
$a_colonnes = ($r = mysqli_query($c, "SHOW COLUMNS FROM users LIKE 'prevenu_inactivite_at'")) && mysqli_num_rows($r) > 0;
if (!$a_colonnes) {
    log_purge('inactivité', 'ignorée (migration 2026-10-rgpd non appliquée)');
} else {
    $inactif = "isAdmin = 0 AND email_verifie = 1
        AND COALESCE(derniere_connexion, created_at) < NOW() - INTERVAL " . ANS_INACTIVITE . " YEAR";

    // 4a. Suppression : prévenus depuis plus de 30 jours, toujours inactifs.
    $rows = lignes($c, "SELECT id, username FROM users WHERE $inactif
        AND prevenu_inactivite_at IS NOT NULL
        AND prevenu_inactivite_at < NOW() - INTERVAL " . JOURS_PREVENANCE . " DAY");
    log_purge('comptes inactifs supprimés',
        supprimer_lot($c, $dry, $rows, 'compte inactif depuis ' . ANS_INACTIVITE . ' ans (purge automatique)'));

    // 4b. Prévenance : inactifs pas encore prévenus. Le drapeau n'est posé que
    // si le mail est parti : un échec SMTP sera retenté la nuit suivante, on ne
    // supprime jamais quelqu'un qui n'a pas été prévenu.
    $rows = lignes($c, "SELECT id, username, email FROM users WHERE $inactif AND prevenu_inactivite_at IS NULL");
    $prevenus = 0;
    foreach ($rows as $u) {
        if ($dry) { $prevenus++; continue; }
        $ok = send_mail($u['email'], 'Ton compte Composmart va être supprimé',
            "Bonjour {$u['username']},\n\n"
          . "Tu ne t'es pas connecté à Composmart depuis plus de " . ANS_INACTIVITE . " ans.\n"
          . "Pour ne pas garder tes données inutilement, ton compte sera supprimé dans "
          . JOURS_PREVENANCE . " jours.\n\n"
          . "Tu veux le garder ? Il suffit de te connecter avant cette date :\n"
          . site_url() . "/login\n\n"
          . "Sinon, tu n'as rien à faire : ton compte, ta progression et tes scores seront effacés.\n\n"
          . "En savoir plus : " . site_url() . "/confidentialite\n");
        if ($ok) {
            $stmt = mysqli_prepare($c, 'UPDATE users SET prevenu_inactivite_at = NOW() WHERE id = ?');
            $stmt->bind_param('i', $u['id']);
            $stmt->execute();
            $prevenus++;
        }
    }
    log_purge('comptes inactifs prévenus par email', $prevenus . ' / ' . count($rows));
}

// ── 5. Demandes de contact closes depuis 2 ans ─────────────────────────────
// ticket_messages suit en ON DELETE CASCADE.
$closes = "statut IN ('clos', 'clos_definitif')
    AND COALESCE(derniere_activite, created_at) < NOW() - INTERVAL " . ANS_TICKETS_CLOS . " YEAR";
log_purge('demandes de contact closes effacées', executer($c, $dry,
    "DELETE FROM contact_messages WHERE $closes",
    "SELECT COUNT(*) FROM contact_messages WHERE $closes"));

// ── 6. Journal d'administration > 1 an ─────────────────────────────────────
$vieux = "created_at < NOW() - INTERVAL " . MOIS_AUDIT . " MONTH";
log_purge('lignes du journal d\'administration effacées', executer($c, $dry,
    "DELETE FROM audit_log WHERE $vieux",
    "SELECT COUNT(*) FROM audit_log WHERE $vieux"));

log_purge('terminé', $dry ? 'simulation, rien n\'a été effacé' : 'ok');
