<?php
/**
 * Purge nocturne RGPD de db-evenements — durée annoncée dans /confidentialite :
 * les participants d'un atelier sont anonymisés 6 mois après sa fin.
 * Lancée chaque nuit par le CronJob k8s `purge-rgpd-evenements` (et le service
 * compose `purge-cron`), avec l'image evenements-api.
 *
 * Anonymiser, pas supprimer : la règle « jamais de DELETE » des événements
 * tient toujours (statistiques, scores d'équipe, historique des ateliers).
 * Seul ce qui identifie la personne disparaît :
 *   - nom_affiche → « Participant anonyme » ;
 *   - user_id     → NULL (plus de lien avec un compte Composmart) ;
 *   - token_hash  → NULL (le jeton du navigateur ne reconnaît plus personne).
 * Les réponses et les points restent, rattachés à un participant sans nom.
 *
 * Fin d'un atelier = date_fin, ou date_debut si date_fin n'est pas renseignée.
 * Idempotent : un participant déjà anonymisé n'est plus compté.
 *
 * Déposé HORS de la racine web (/var/www/cron/).
 * Usage : php /var/www/cron/purge_rgpd.php [--dry]
 */

mysqli_report(MYSQLI_REPORT_OFF);

$dry = in_array('--dry', $argv ?? [], true);

const MOIS_APRES_EVENEMENT = 6;
const NOM_ANONYME          = 'Participant anonyme';

$c = mysqli_connect(
    getenv('DB_HOST') ?: 'db-evenements',
    getenv('DB_USER') ?: 'composmart',
    getenv('DB_PASSWORD') ?: '',
    getenv('DB_NAME') ?: 'Composmart'
);
if (!$c) { fwrite(STDERR, "[purge-rgpd] connexion db-evenements impossible\n"); exit(1); }
mysqli_set_charset($c, 'utf8mb4');

$cible = "FROM participants p JOIN evenements e ON e.id = p.evenement_id
    WHERE COALESCE(e.date_fin, e.date_debut) < NOW() - INTERVAL " . MOIS_APRES_EVENEMENT . " MONTH
      AND (p.nom_affiche <> '" . NOM_ANONYME . "' OR p.user_id IS NOT NULL OR p.token_hash IS NOT NULL)";

if ($dry) {
    $n = (int)mysqli_fetch_row(mysqli_query($c, "SELECT COUNT(*) $cible"))[0];
} else {
    $ok = mysqli_query($c, "UPDATE participants p JOIN evenements e ON e.id = p.evenement_id
        SET p.nom_affiche = '" . NOM_ANONYME . "', p.user_id = NULL, p.token_hash = NULL
        WHERE COALESCE(e.date_fin, e.date_debut) < NOW() - INTERVAL " . MOIS_APRES_EVENEMENT . " MONTH
          AND (p.nom_affiche <> '" . NOM_ANONYME . "' OR p.user_id IS NOT NULL OR p.token_hash IS NOT NULL)");
    if (!$ok) { fwrite(STDERR, "[purge-rgpd] échec : " . mysqli_error($c) . "\n"); exit(1); }
    $n = mysqli_affected_rows($c);
}

echo '[purge-rgpd] ' . date('Y-m-d H:i:s') . ' participants anonymisés (ateliers terminés depuis '
   . MOIS_APRES_EVENEMENT . ' mois) : ' . $n . ($dry ? ' (simulation)' : '') . "\n";
