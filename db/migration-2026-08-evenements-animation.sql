-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — animation d'atelier (août 2026)
--   • parcours réutilisables (parcours, parcours_slides)
--   • slides d'un événement, copie figée du parcours (evenement_slides)
--   • équipes (equipes) + rattachement des participants
--   • réponses et scoring (reponses)
--   • jeton d'identité participant, progression individuelle
--
-- À appliquer APRÈS migration-2026-08-evenements-statuts.sql (qui pose les
-- 5 statuts et la colonne `supprime`).
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-evenements-animation.sql
--
-- Rejouable : tout est en CREATE TABLE IF NOT EXISTS / ADD ... IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Réglages d'animation sur l'événement ────────────────────────────────────
ALTER TABLE `evenements`
  ADD COLUMN IF NOT EXISTS `parcours_id`       int NULL AFTER `supprime`,
  ADD COLUMN IF NOT EXISTS `mode_equipes`      enum('aucun','manuel','auto','libre') NOT NULL DEFAULT 'aucun' AFTER `parcours_id`,
  ADD COLUMN IF NOT EXISTS `mode_parcours`     enum('commun','individuel') NOT NULL DEFAULT 'commun' AFTER `mode_equipes`,
  ADD COLUMN IF NOT EXISTS `slide_courante_id` int NULL AFTER `mode_parcours`;

-- ── Parcours (bibliothèque réutilisable) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS `parcours` (
  `id`          int          NOT NULL AUTO_INCREMENT,
  `nom`         varchar(150) NOT NULL,
  `description` varchar(300) DEFAULT NULL,
  `cree_par`    varchar(100) DEFAULT NULL,
  `created_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `maj_at`      datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `parcours_slides` (
  `id`          int          NOT NULL AUTO_INCREMENT,
  `parcours_id` int          NOT NULL,
  `ordre`       int          NOT NULL DEFAULT 0,
  `type`        varchar(30)  NOT NULL,
  `titre`       varchar(200) DEFAULT NULL,
  `contenu`     longtext     DEFAULT NULL,
  `points`      int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `parcours_ordre` (`parcours_id`, `ordre`),
  CONSTRAINT `pslides_ibfk_1` FOREIGN KEY (`parcours_id`) REFERENCES `parcours` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Slides de l'événement (copie figée, cf. db/evenements.sql) ──────────────
CREATE TABLE IF NOT EXISTS `evenement_slides` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `evenement_id` int          NOT NULL,
  `ordre`        int          NOT NULL DEFAULT 0,
  `type`         varchar(30)  NOT NULL,
  `titre`        varchar(200) DEFAULT NULL,
  `contenu`      longtext     DEFAULT NULL,
  `points`       int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `evt_ordre` (`evenement_id`, `ordre`),
  CONSTRAINT `eslides_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Équipes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `equipes` (
  `id`           int         NOT NULL AUTO_INCREMENT,
  `evenement_id` int         NOT NULL,
  `nom`          varchar(80) NOT NULL,
  `couleur`      varchar(20) DEFAULT NULL,
  `ordre`        int         NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `evenement` (`evenement_id`),
  CONSTRAINT `equipes_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Participants : équipe, jeton d'identité, progression ────────────────────
ALTER TABLE `participants`
  ADD COLUMN IF NOT EXISTS `equipe_id`   int      NULL AFTER `user_id`,
  ADD COLUMN IF NOT EXISTS `token_hash`  char(64) NULL AFTER `equipe_id`,
  ADD COLUMN IF NOT EXISTS `slide_index` int      NOT NULL DEFAULT 0 AFTER `token_hash`,
  ADD KEY IF NOT EXISTS `token`  (`token_hash`),
  ADD KEY IF NOT EXISTS `equipe` (`equipe_id`);

-- En MariaDB, IF NOT EXISTS se place APRÈS « FOREIGN KEY », pas après
-- « ADD CONSTRAINT <nom> » : la forme inverse est une erreur de syntaxe.
ALTER TABLE `participants`
  ADD CONSTRAINT `participants_ibfk_2`
    FOREIGN KEY IF NOT EXISTS (`equipe_id`) REFERENCES `equipes` (`id`) ON DELETE SET NULL;

-- ── Réponses (source unique du scoring) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `reponses` (
  `id`             int        NOT NULL AUTO_INCREMENT,
  `evenement_id`   int        NOT NULL,
  `slide_id`       int        NOT NULL,
  `participant_id` int        NOT NULL,
  `reponse`        text       DEFAULT NULL,
  `points`         int        NOT NULL DEFAULT 0,
  `correct`        tinyint(1) DEFAULT NULL,
  `repondu_at`     datetime   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slide_participant` (`slide_id`, `participant_id`),
  KEY `evt_participant` (`evenement_id`, `participant_id`),
  CONSTRAINT `reponses_ibfk_1` FOREIGN KEY (`slide_id`) REFERENCES `evenement_slides` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reponses_ibfk_2` FOREIGN KEY (`participant_id`) REFERENCES `participants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
