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
-- UTILISATEURS
-- ─────────────────────────────────────────

CREATE TABLE `users` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `email`         varchar(255) NOT NULL,
  `username`      varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `created_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `xp`            int          NOT NULL DEFAULT 0,
  `niveau`        int          NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
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
