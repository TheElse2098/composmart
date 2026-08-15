-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — août 2026
--   • statut : 3 valeurs (brouillon/ouvert/ferme) → 5 valeurs mutuellement
--     exclusives (prevu/ouvert/en_cours/annule/termine)
--   • ajout de la colonne `supprime` (suppression douce, indépendante du
--     statut de cycle de vie — remplace l'ancienne idée d'un statut 'archive')
--
-- Part de l'état réellement déployé en prod (seul brouillon/ouvert/ferme a
-- été appliqué jusqu'ici). À appliquer UNE FOIS :
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u root -p"$MDP" Composmart < db/migration-2026-08-evenements-statuts.sql
--
-- Rejouable : l'UPDATE devient sans effet une fois la conversion faite, et
-- ADD COLUMN IF NOT EXISTS/MODIFY COLUMN ne cassent rien si rejoués.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Élargir temporairement l'enum pour couvrir ancien + nouveau vocabulaire :
--    MariaDB refuserait de retirer 'brouillon'/'ferme' tant que des lignes les
--    utilisent encore.
ALTER TABLE `evenements`
  MODIFY COLUMN `statut` enum('brouillon','ouvert','ferme','prevu','en_cours','annule','termine') NOT NULL DEFAULT 'brouillon';

-- 2. Convertir les valeurs existantes : brouillon et ferme deviennent tous
--    les deux 'prevu' (décision : plus de statut "fermé" distinct, "fermer"
--    équivaut désormais à repasser en "prévu").
UPDATE `evenements` SET `statut` = 'prevu' WHERE `statut` IN ('brouillon', 'ferme');

-- 3. Réduire à l'enum final.
ALTER TABLE `evenements`
  MODIFY COLUMN `statut` enum('prevu','ouvert','en_cours','annule','termine') NOT NULL DEFAULT 'prevu';

-- 4. Colonne de suppression douce.
ALTER TABLE `evenements`
  ADD COLUMN IF NOT EXISTS `supprime` tinyint(1) NOT NULL DEFAULT 0 AFTER `statut`;
