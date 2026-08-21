-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — déroulé propre à un événement (août 2026)
--   • nouvelle table `evenement_parcours` : provenance des parcours enchaînés
--
-- Un événement pouvait recevoir UN parcours, qui écrasait ses slides. On peut
-- désormais en enchaîner plusieurs : chaque ajout recopie les slides du modèle
-- À LA SUITE du déroulé existant. Les slides restent des copies indépendantes
-- (c'est tout l'intérêt de `evenement_slides` : adapter le déroulé pour un
-- client sans toucher au modèle, et ne pas réécrire l'historique d'un atelier
-- déjà joué). Cette table ne sert donc qu'à AFFICHER d'où viennent les slides.
--
-- `nom` est une copie du nom du parcours au moment de l'ajout, et `parcours_id`
-- passe à NULL si le parcours source est supprimé : la provenance reste lisible
-- même quand le modèle a disparu de la bibliothèque.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-evenements-deroule.sql
--
-- Rejouable : CREATE TABLE IF NOT EXISTS.
-- (Rappel : `ADD CONSTRAINT IF NOT EXISTS` n'existe pas en MariaDB — c'est
--  `FOREIGN KEY IF NOT EXISTS` qu'il faut écrire dans un ALTER. Ici la table
--  est créée d'un bloc, la question ne se pose pas.)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `evenement_parcours` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `evenement_id` int          NOT NULL,
  `parcours_id`  int          DEFAULT NULL,
  `nom`          varchar(150) NOT NULL,
  `ordre`        int          NOT NULL DEFAULT 0,
  `nb_slides`    int          NOT NULL DEFAULT 0,
  `ajoute_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `evt_ordre` (`evenement_id`, `ordre`),
  KEY `parcours` (`parcours_id`),
  CONSTRAINT `evtparc_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `evtparc_ibfk_2` FOREIGN KEY (`parcours_id`)  REFERENCES `parcours` (`id`)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
