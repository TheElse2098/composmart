-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — thème visuel des slides (août 2026)
--   • evenements.theme_slides : 'foret' (défaut) ou 'papier'
--
-- Deux chartes coexistent (cf. assets/css/slides.css) : « forêt » (cartes
-- claires sur fond feuillage, ombres douces) et « papier » (fond crème à pois,
-- cadres épais, ombres dures, accent terracotta). Le choix est propre à chaque
-- événement : un client, une ambiance.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-evenements-theme.sql
--
-- Rejouable : ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `evenements`
  ADD COLUMN IF NOT EXISTS `theme_slides` enum('foret','papier') NOT NULL DEFAULT 'foret' AFTER `mode_parcours`;
