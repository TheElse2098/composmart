-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — équipes créées par les participants (août 2026)
--   • evenements.mode_equipes : ajout de la valeur 'autonome'
--   • evenements.equipes_max         : plafond du nombre d'équipes  (0 = illimité)
--   • evenements.equipe_taille_max   : plafond de membres par équipe (0 = illimité)
--   • equipes.creee_par              : participant à l'origine de l'équipe
--
-- Cinquième mode, à côté de aucun / manuel / auto / libre. « Libre » laisse
-- choisir dans une liste que l'animateur a fixée ; « autonome » laisse les
-- participants CRÉER leurs équipes puis s'y retrouver par recherche.
--
-- Les deux plafonds valent 0 par défaut, c'est-à-dire aucune limite : les
-- événements déjà en base gardent exactement leur comportement actuel, et un
-- animateur qui ne touche à rien n'hérite pas d'une contrainte surprise.
--
-- `creee_par` référence participants(id) en ON DELETE SET NULL : l'équipe
-- survit au départ de celui qui l'a créée, elle appartient à ses membres.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-equipes-autonomes.sql
--
-- Rejouable : MODIFY réécrit la colonne à l'identique si la valeur y est déjà,
-- et ADD COLUMN IF NOT EXISTS ne fait rien la seconde fois.
-- (Rappel : `ADD CONSTRAINT IF NOT EXISTS` n'existe pas en MariaDB — pour une
--  clé étrangère dans un ALTER, c'est `FOREIGN KEY IF NOT EXISTS`.)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `evenements`
  MODIFY COLUMN `mode_equipes` enum('aucun','manuel','auto','libre','autonome') NOT NULL DEFAULT 'aucun';

ALTER TABLE `evenements`
  ADD COLUMN IF NOT EXISTS `equipes_max`       int NOT NULL DEFAULT 0 AFTER `mode_equipes`,
  ADD COLUMN IF NOT EXISTS `equipe_taille_max` int NOT NULL DEFAULT 0 AFTER `equipes_max`;

ALTER TABLE `equipes`
  ADD COLUMN IF NOT EXISTS `creee_par` int DEFAULT NULL AFTER `ordre`;

ALTER TABLE `equipes`
  ADD FOREIGN KEY IF NOT EXISTS (`creee_par`) REFERENCES `participants` (`id`) ON DELETE SET NULL;
