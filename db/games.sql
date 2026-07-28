-- db-games — scores des mini-jeux. Service propriétaire : games-api.
-- Note : pas de FK vers users (table dans db-core). Le username est dénormalisé
-- (snapshot au moment du score) pour afficher le top-5 sans jointure cross-base.
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

CREATE TABLE `scores` (
  `id`        int          NOT NULL AUTO_INCREMENT,
  `user_id`   int          NOT NULL,
  `username`  varchar(100) NOT NULL DEFAULT '',  -- dénormalisé depuis db-core
  `is_admin`  tinyint(1)   NOT NULL DEFAULT 0,   -- dénormalisé depuis db-core, exclu des tops publics
  `jeu_id`    varchar(100) NOT NULL,
  `score`     int          NOT NULL,
  `played_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_jeu` (`user_id`, `jeu_id`),
  KEY `jeu_score` (`jeu_id`, `score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
