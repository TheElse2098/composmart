-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-core — durées de conservation RGPD (octobre 2026)
--   • users.derniere_connexion    : date de la dernière connexion
--   • users.prevenu_inactivite_at : date de l'email « ton compte va être supprimé »
--
-- Utilisées par la purge nocturne (services/auth-api/cron/purge_rgpd.php) :
-- un compte sans connexion depuis 3 ans reçoit un email, puis est supprimé
-- 30 jours plus tard s'il ne s'est toujours pas connecté. La table logins est
-- elle-même purgée à 12 mois : elle ne peut pas servir à mesurer 3 ans.
--
-- Valeur initiale : dernière ligne de logins si elle existe, sinon la date
-- d'inscription. Personne n'est donc considéré inactif à tort au déploiement.
--
--   kubectl -n composmart exec -i db-core-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-10-rgpd.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `derniere_connexion`    datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `prevenu_inactivite_at` datetime DEFAULT NULL,
  ADD INDEX IF NOT EXISTS `inactivite` (`derniere_connexion`);

UPDATE `users` u
   SET u.derniere_connexion = COALESCE(
         (SELECT MAX(l.logged_at) FROM `logins` l WHERE l.user_id = u.id),
         u.created_at)
 WHERE u.derniere_connexion IS NULL;
