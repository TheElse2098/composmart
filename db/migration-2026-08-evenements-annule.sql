-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — août 2026
--   • ajout des statuts 'en_cours', 'termine' (bascules manuelles le jour J)
--   • ajout du statut 'annule' (distinct de 'ferme')
--
-- À appliquer UNE FOIS sur une base existante. Les fichiers db/*.sql ne sont
-- joués que par initdb, c'est-à-dire sur un volume vierge : un cluster déjà en
-- service ne les rejoue jamais.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u root -p"$MDP" Composmart < db/migration-2026-08-evenements-annule.sql
--
-- Rejouable : MODIFY COLUMN redéclarant le même enum est sans effet.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `evenements`
  MODIFY COLUMN `statut` enum('brouillon','ouvert','ferme','en_cours','termine','archive','annule') NOT NULL DEFAULT 'brouillon';
