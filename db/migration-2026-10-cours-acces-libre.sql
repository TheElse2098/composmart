-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-core — cours en accès libre (octobre 2026)
--
-- Les cours se suivent désormais sans compte ; seule la progression d'un
-- utilisateur connecté est sauvegardée (user_progress). Pour un visiteur sans
-- compte, on ne garde que le fait qu'un cours a été terminé, sans aucune
-- donnée sur la personne :
--   • cours.termine_anonyme : nombre de fois où le cours a été terminé sans
--     compte (affiché dans /admin/themes à côté des comptes) ;
--   • stats_anonymes (type cours_termine) : total du jour, déjà lu par le
--     tableau de bord.
-- Rejouable.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `cours`
  ADD COLUMN IF NOT EXISTS `termine_anonyme` int NOT NULL DEFAULT 0 AFTER `nb_questions`;
