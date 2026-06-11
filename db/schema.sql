SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- ─────────────────────────────────────────
-- COMPOSTEURS
-- ─────────────────────────────────────────

CREATE TABLE `composts` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `latitude`     double       NOT NULL,
  `longitude`    double       NOT NULL,
  `type`         text,
  `publique`     text,
  `gestion`      text,
  `info_gestion` text,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `elements` (
  `id`  int          NOT NULL AUTO_INCREMENT,
  `nom` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `nom` (`nom`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `elements` (`id`, `nom`) VALUES
(1,  'reste de repas'),
(2,  'viande'),
(3,  'poisson'),
(4,  'produits laitiers'),
(5,  'os'),
(6,  'tonte de pelouse'),
(7,  'sac biodegradable'),
(8,  'huile'),
(9,  'marc de cafe'),
(10, 'cendres'),
(11, 'essuie-tout'),
(12, 'fromage'),
(13, 'carton');

CREATE TABLE `regles` (
  `id_compost` int        NOT NULL,
  `id_element` int        NOT NULL,
  `autorise`   tinyint(1) NOT NULL,
  PRIMARY KEY (`id_compost`, `id_element`),
  KEY `id_element` (`id_element`),
  CONSTRAINT `regles_ibfk_1` FOREIGN KEY (`id_compost`) REFERENCES `composts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `regles_ibfk_2` FOREIGN KEY (`id_element`) REFERENCES `elements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- COURS
-- ─────────────────────────────────────────

CREATE TABLE `themes` (
  `id`     int          NOT NULL AUTO_INCREMENT,
  `slug`   varchar(80)  NOT NULL,
  `nom`    varchar(120) NOT NULL,
  `emoji`  varchar(10)  DEFAULT NULL,
  `couleur` varchar(80) DEFAULT NULL,
  `ordre`  int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `cours` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `slug`         varchar(80)  NOT NULL,
  `theme_id`     int          NOT NULL,
  `titre`        varchar(200) NOT NULL,
  `description`  text         DEFAULT NULL,
  `emoji`        varchar(10)  DEFAULT NULL,
  `niveau`       enum('debutant','intermediaire','expert') NOT NULL DEFAULT 'debutant',
  `xp_reward`    int          NOT NULL DEFAULT 50,
  `has_text`     tinyint(1)   NOT NULL DEFAULT 0,
  `has_video`    tinyint(1)   NOT NULL DEFAULT 0,
  `has_podcast`  tinyint(1)   NOT NULL DEFAULT 0,
  `nb_questions` int          NOT NULL DEFAULT 0,
  `ordre`        int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `theme_id` (`theme_id`),
  CONSTRAINT `cours_ibfk_1` FOREIGN KEY (`theme_id`) REFERENCES `themes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- UTILISATEURS
-- ─────────────────────────────────────────

CREATE TABLE `users` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `email`         varchar(255) DEFAULT NULL,
  `username`      varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `xp`            int          NOT NULL DEFAULT 0,
  `niveau`        int          NOT NULL DEFAULT 1,
  `isAdmin`       tinyint(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- PROGRESSION (cours terminés)
-- ─────────────────────────────────────────

CREATE TABLE `user_progress` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `user_id`      int          NOT NULL,
  `cours_id`     varchar(100) NOT NULL,
  `completed_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_cours` (`user_id`, `cours_id`),
  CONSTRAINT `progress_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- SIGNALEMENTS (erreurs sur les composteurs)
-- ─────────────────────────────────────────

CREATE TABLE `signalements` (
  `id`          int      NOT NULL AUTO_INCREMENT,
  `compost_id`  int      NOT NULL,
  `user_id`     int      DEFAULT NULL,
  `motif`       enum('position','type_acces','regles','inexistant','autre') NOT NULL,
  `commentaire` text     DEFAULT NULL,
  `statut`      enum('ouvert','resolu','rejete') NOT NULL DEFAULT 'ouvert',
  `created_at`  datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `compost_statut` (`compost_id`, `statut`),
  CONSTRAINT `signal_ibfk_1` FOREIGN KEY (`compost_id`) REFERENCES `composts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `signal_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- JOURNAL D'AUDIT (actions admin)
-- ─────────────────────────────────────────

CREATE TABLE `audit_log` (
  `id`          int          NOT NULL AUTO_INCREMENT,
  `user_id`     int          DEFAULT NULL,
  `username`    varchar(100) DEFAULT NULL,
  `action`      varchar(60)  NOT NULL,
  `details`     varchar(255) DEFAULT NULL,
  `target_type` varchar(30)  DEFAULT NULL,
  `target_id`   int          DEFAULT NULL,
  `snapshot`    text         DEFAULT NULL,
  `created_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────
-- SCORES (mini-jeux)
-- ─────────────────────────────────────────

CREATE TABLE `scores` (
  `id`        int          NOT NULL AUTO_INCREMENT,
  `user_id`   int          NOT NULL,
  `jeu_id`    varchar(100) NOT NULL,
  `score`     int          NOT NULL,
  `played_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_jeu` (`user_id`, `jeu_id`),
  CONSTRAINT `scores_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
