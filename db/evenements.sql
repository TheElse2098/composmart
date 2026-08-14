-- db-evenements — ateliers B2B en présentiel, inscription par code/QR sans compte.
-- Service : evenements-api.
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

CREATE TABLE `evenements` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `titre`         varchar(150) NOT NULL,
  `lieu`          varchar(200) DEFAULT NULL,
  `date_debut`    datetime     NOT NULL,
  `date_fin`      datetime     DEFAULT NULL,
  `capacite_max`  int          DEFAULT NULL,      -- NULL = illimité
  -- Code court affiché/projeté en salle (façon Kahoot). Alphabet sans caractères
  -- ambigus (pas de 0/O/1/I) pour rester lisible à l'oral et sur écran.
  `code`          char(6)      NOT NULL,
  -- 'ferme' = inscriptions closes avant le jour J (ex. complet). 'en_cours' /
  -- 'termine' = bascules manuelles le jour de l'atelier, indépendantes de
  -- date_debut/date_fin (pas de calcul automatique par horloge).
  -- 'archive' = supprimé (suppression douce, les données restent en base).
  -- 'annule' = l'atelier n'aura pas lieu, distinct de 'ferme'.
  `statut`        enum('brouillon','ouvert','ferme','en_cours','termine','archive','annule') NOT NULL DEFAULT 'brouillon',
  `cree_par`      varchar(100) DEFAULT NULL,       -- username admin, dénormalisé (cf. cours_versions.auteur)
  `created_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Participants inscrits via le code/QR. Pas de FK vers `users` (db-core, base
-- différente) : un participant B2B n'a pas forcément de compte Composmart.
-- Snapshot texte libre, même esprit que scores.username (db-games) et
-- contact_messages.username (db-core).
CREATE TABLE `participants` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `evenement_id`  int          NOT NULL,
  `nom_affiche`   varchar(100) NOT NULL,
  `user_id`       int          DEFAULT NULL,       -- si un compte Composmart existe, lien informatif seulement
  `rejoint_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `evenement` (`evenement_id`, `rejoint_at`),
  CONSTRAINT `participants_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
