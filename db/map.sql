-- db-map — composteurs et règles. Service propriétaire : map-api.
-- Note : signalements.user_id n'a plus de FK vers users (table dans db-core).
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

CREATE TABLE `composts` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `latitude`     double       NOT NULL,
  `longitude`    double       NOT NULL,
  `type`         text,
  `publique`     text,
  `gestion`      text,
  `info_gestion` text,
  `created_at`   datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Index pour la détection de proximité (Haversine) et le filtrage par zone.
  KEY `lat_lng` (`latitude`, `longitude`)
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

CREATE TABLE `signalements` (
  `id`          int      NOT NULL AUTO_INCREMENT,
  `compost_id`  int      NOT NULL,
  `user_id`     int      DEFAULT NULL,  -- pas de FK : users vit dans db-core
  `reporter_username` varchar(100) DEFAULT NULL,  -- dénormalisé (users en db-core)
  `motif`       enum('position','type_acces','regles','inexistant','autre') NOT NULL,
  `commentaire` text     DEFAULT NULL,
  `statut`      enum('ouvert','resolu','rejete') NOT NULL DEFAULT 'ouvert',
  `created_at`  datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `compost_statut` (`compost_id`, `statut`),
  CONSTRAINT `signal_ibfk_1` FOREIGN KEY (`compost_id`) REFERENCES `composts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
