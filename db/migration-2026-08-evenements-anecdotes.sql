-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — banque d'anecdotes (août 2026)
--   • table `anecdotes` : réservoir partagé par tous les parcours
--
-- Une slide de type « anecdote » peut désormais porter son propre texte
-- (comportement d'origine, inchangé), pointer une anecdote de la banque, ou
-- en tirer une au hasard. Le tirage aléatoire est dérivé du couple
-- (participant, slide) côté PHP : stable pendant toute la slide, et différent
-- d'un participant à l'autre. Rien n'est donc stocké ici pour les tirages.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-evenements-anecdotes.sql
--
-- Rejouable : CREATE TABLE IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `anecdotes` (
  `id`         int           NOT NULL AUTO_INCREMENT,
  `texte`      varchar(1000) NOT NULL,
  `emoji`      varchar(10)   DEFAULT NULL,
  `theme`      varchar(60)   DEFAULT NULL,
  `cree_par`   varchar(100)  DEFAULT NULL,
  `created_at` datetime      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `theme` (`theme`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
