-- db-games — mini-jeux : contenu, règles et scores. Service propriétaire : games-api.
-- Note : pas de FK vers users (table dans db-core). Le username est dénormalisé
-- (snapshot au moment du score) pour afficher le top-5 sans jointure cross-base.
-- Le contenu initial des 4 jeux est inséré par db/migration-2026-10-jeux-contenu.sql
-- (jouée aussi sur une installation neuve).
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

CREATE TABLE `scores` (
  `id`        int          NOT NULL AUTO_INCREMENT,
  `user_id`   int          NOT NULL,
  `username`  varchar(100) NOT NULL DEFAULT '',  -- dénormalisé depuis db-core
  `is_admin`  tinyint(1)   NOT NULL DEFAULT 0,   -- dénormalisé depuis db-core, exclu des tops publics
  `jeu_id`    varchar(100) NOT NULL,
  `score`     int          NOT NULL,
  -- Score maximum en vigueur lors de la partie : si les règles changent, le
  -- score est converti à la nouvelle échelle à l'affichage (jamais réécrit).
  `score_max` int          DEFAULT NULL,
  `played_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_jeu` (`user_id`, `jeu_id`),
  KEY `jeu_score` (`jeu_id`, `score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Un jeu = ses textes, ses règles et son contenu, édités depuis /jeux-admin.
-- regles / messages / items sont des JSON validés par games-api/jeux/_jeux.php
-- (forme propre à chaque jeu). Les pages jeu-<slug>.html restent la mécanique.
CREATE TABLE `jeux` (
  `slug`        varchar(40)  NOT NULL,
  `nom`         varchar(80)  NOT NULL,
  `emoji`       varchar(16)  NOT NULL DEFAULT '🎮',
  `description` varchar(300) NOT NULL DEFAULT '',
  `statut`      enum('brouillon','publie') NOT NULL DEFAULT 'publie',
  `ordre`       int          NOT NULL DEFAULT 0,
  `regles`      text         NOT NULL,
  `messages`    text         NOT NULL,
  `items`       mediumtext   NOT NULL,
  `score_max`   int          NOT NULL,   -- calculé depuis les règles, jamais saisi
  `xp_reserve`  int          NOT NULL DEFAULT 50,
  `maj_at`      datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `maj_par`     varchar(100) DEFAULT NULL,
  PRIMARY KEY (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historique : état complet d'un jeu écrit AVANT chaque sauvegarde.
CREATE TABLE `jeux_versions` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `slug`       varchar(40)  NOT NULL,
  `contenu`    mediumtext   NOT NULL,
  `auteur`     varchar(100) DEFAULT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `slug_date` (`slug`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
