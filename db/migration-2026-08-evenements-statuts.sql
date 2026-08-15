-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — août 2026
--   • statut : ancien vocabulaire (brouillon/ouvert/ferme, +archive/en_cours/
--     termine/annule pour les bases ayant transité par une version intermédiaire
--     jamais figée en schéma source) → 5 valeurs mutuellement exclusives
--     (prevu/ouvert/en_cours/annule/termine)
--   • ajout de la colonne `supprime` (suppression douce, indépendante du
--     statut de cycle de vie — remplace l'ancienne idée d'un statut 'archive')
--
-- L'étape 1 élargit vers TOUTES les valeurs qui ont pu exister en prod à un
-- moment (y compris 'archive', utilisée le temps d'un test avant que ce
-- fichier ne soit corrigé) : MariaDB tronque silencieusement toute ligne dont
-- la valeur n'apparaît pas dans le nouvel enum, il faut donc être exhaustif
-- ici plutôt que de ne couvrir que le schéma actuellement documenté.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u root -p"$MDP" Composmart < db/migration-2026-08-evenements-statuts.sql
--
-- Rejouable : l'UPDATE devient sans effet une fois la conversion faite, et
-- ADD COLUMN IF NOT EXISTS/MODIFY COLUMN ne cassent rien si rejoués.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Élargir temporairement l'enum pour couvrir tout vocabulaire ayant pu
--    exister en prod (ancien schéma ET version intermédiaire jamais figée).
ALTER TABLE `evenements`
  MODIFY COLUMN `statut` enum('brouillon','ouvert','ferme','archive','en_cours','termine','annule','prevu') NOT NULL DEFAULT 'brouillon';

-- 2. Colonne de suppression douce, créée AVANT la conversion des statuts pour
--    pouvoir y reverser 'archive' (qui mélangeait cycle de vie et suppression
--    dans la version intermédiaire).
ALTER TABLE `evenements`
  ADD COLUMN IF NOT EXISTS `supprime` tinyint(1) NOT NULL DEFAULT 0 AFTER `statut`;

-- 3. Convertir les valeurs existantes.
--    - brouillon/ferme → prevu (plus de statut "fermé" distinct : "fermer"
--      équivaut désormais à repasser en "prévu").
--    - archive → prevu + supprime=1 (l'ancienne suppression douce devient le
--      flag dédié ; le statut de cycle de vie sous-jacent n'étant pas
--      récupérable pour ces lignes de test, "prevu" est un repli neutre).
UPDATE `evenements` SET `statut` = 'prevu' WHERE `statut` IN ('brouillon', 'ferme');
UPDATE `evenements` SET `statut` = 'prevu', `supprime` = 1 WHERE `statut` = 'archive';

-- 4. Réduire à l'enum final.
ALTER TABLE `evenements`
  MODIFY COLUMN `statut` enum('prevu','ouvert','en_cours','annule','termine') NOT NULL DEFAULT 'prevu';
