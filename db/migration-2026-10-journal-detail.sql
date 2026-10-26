-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-core — journal d'audit : détail avant/après et annulation (octobre 2026)
--   • audit_log.snapshot passe en MEDIUMTEXT : il porte désormais l'état
--     « avant » des modifications et l'état complet des éléments supprimés
--     (un parcours avec ses slides dépasse vite les 64 Ko d'un TEXT).
--   • audit_log.annule_at / annule_par : une action annulée depuis le journal
--     est marquée, ce qui empêche de l'annuler deux fois.
--   • cours_versions garde aussi les métadonnées (titre, thème, statut…), la
--     vidéo et le podcast : une version suffit alors à restaurer un cours, ou
--     à le recréer après suppression.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `audit_log`
  MODIFY `snapshot` mediumtext DEFAULT NULL,
  ADD COLUMN `annule_at`  datetime     DEFAULT NULL,
  ADD COLUMN `annule_par` varchar(100) DEFAULT NULL;

ALTER TABLE `cours_versions`
  ADD COLUMN `meta`    text DEFAULT NULL AFTER `cours_id`,
  ADD COLUMN `video`   text DEFAULT NULL AFTER `quiz`,
  ADD COLUMN `podcast` text DEFAULT NULL AFTER `video`;
