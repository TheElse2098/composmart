-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-games — « Combien de temps ? » : deux règles de plus (octobre 2026)
--
-- Jusqu'ici fixés dans le code, désormais éditables depuis /jeux-admin :
--   • regles.seuil_court     : limite court / long, en jours (365 = 1 an)
--   • regles.seuils[i].label : message affiché au joueur pour chaque palier
--
-- Valeurs posées = celles du code d'avant : le jeu ne change pas.
-- Rejouable : ne touche que les règles qui n'ont pas encore ces champs.
-- ═══════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

UPDATE `jeux`
   SET `regles` = JSON_SET(`regles`,
         '$.seuil_court', 365,
         '$.seuils[0].label', '🎯 En plein dans le mille !',
         '$.seuils[1].label', '👍 Très proche !',
         '$.seuils[2].label', '🤏 Pas loin...')
 WHERE `slug` = 'temps-decompo'
   AND JSON_EXTRACT(`regles`, '$.seuil_court') IS NULL;
