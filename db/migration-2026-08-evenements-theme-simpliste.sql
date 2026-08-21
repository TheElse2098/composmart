-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — troisième thème visuel « simpliste » (août 2026)
--   • evenements.theme_slides : ajout de la valeur 'simpliste'
--
-- Troisième charte à côté de « forêt » et « papier » (cf. assets/css/slides.css) :
-- cadre vert Composmart plein, carte blanche à l'intérieur, titres centrés sans
-- ornement, bloc média vert foncé. C'est la variante sobre, celle qui passe
-- partout quand le client n'a pas d'identité visuelle marquée.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-evenements-theme-simpliste.sql
--
-- Rejouable : MODIFY réécrit la définition de la colonne à l'identique si la
-- valeur y est déjà. Élargir un enum ne touche aucune ligne existante — les
-- événements en 'foret' ou 'papier' gardent leur thème.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE `evenements`
  MODIFY COLUMN `theme_slides` enum('foret','papier','simpliste') NOT NULL DEFAULT 'foret';
