-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — banque d'images illustrant les slides (août 2026)
--   • table `images`      : les fichiers eux-mêmes
--   • table `image_tags`  : leurs tags, comme anecdote_mots
--   • evenements.image_tags : les tags retenus pour un événement
--
-- STOCKAGE EN BASE, pas sur un volume. Même raison que cours_medias dans
-- db-core : le stockage par défaut de k3s est ReadWriteOnce et evenements-api
-- peut monter à plusieurs réplicas — trois pods écrivant chacun sur son disque
-- local divergeraient. Bénéfice annexe : les images sont incluses dans le
-- mysqldump de sauvegarde plutôt que d'être un état à sauvegarder à part.
--
-- `largeur` et `hauteur` sont relevées au téléversement : le bloc image des
-- slides est de taille fixe, mais connaître le ratio permet de cadrer sans
-- attendre que le fichier soit chargé côté navigateur.
--
-- evenements.image_tags est une simple liste séparée par des virgules, et non
-- une table de liaison : c'est un RÉGLAGE de l'événement, enregistré d'un bloc
-- avec le mode de parcours et le thème dans le même UPDATE. Une table imposerait
-- un cycle supprimer/réinsérer pour un gain nul — à la différence des tags des
-- images elles-mêmes, sur lesquels on filtre et qu'on dénombre.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-banque-images.sql
--
-- Rejouable : CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `images` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `nom`        varchar(200) NOT NULL,
  `mime`       varchar(80)  NOT NULL,
  `taille`     int          NOT NULL,
  `largeur`    int          DEFAULT NULL,
  `hauteur`    int          DEFAULT NULL,
  `donnees`    longblob     NOT NULL,
  `cree_par`   varchar(100) DEFAULT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `image_tags` (
  `image_id` int         NOT NULL,
  `tag`      varchar(40) NOT NULL,
  PRIMARY KEY (`image_id`, `tag`),
  KEY `tag` (`tag`),
  CONSTRAINT `imgtags_ibfk_1` FOREIGN KEY (`image_id`) REFERENCES `images` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `evenements`
  ADD COLUMN IF NOT EXISTS `image_tags` varchar(400) NOT NULL DEFAULT '' AFTER `theme_slides`;
