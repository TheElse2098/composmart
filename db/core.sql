-- db-core — utilisateurs, cours, progression, audit. Services : auth-api + courses-api.
-- Toutes les FK internes sont conservées (tables dans la même base).
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- ── UTILISATEURS ───────────────────────────────────────────────────────────
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

-- ── COURS ──────────────────────────────────────────────────────────────────
CREATE TABLE `themes` (
  `id`      int          NOT NULL AUTO_INCREMENT,
  `slug`    varchar(80)  NOT NULL,
  `nom`     varchar(120) NOT NULL,
  `emoji`   varchar(10)  DEFAULT NULL,
  `couleur` varchar(80)  DEFAULT NULL,
  `ordre`   int          NOT NULL DEFAULT 0,
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

-- ── PROGRESSION ────────────────────────────────────────────────────────────
CREATE TABLE `user_progress` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `user_id`      int          NOT NULL,
  `cours_id`     varchar(100) NOT NULL,
  `completed_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_cours` (`user_id`, `cours_id`),
  CONSTRAINT `progress_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── JOURNAL D'AUDIT (actions admin, écrit aussi par map-api via auth-api) ────
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

-- ── JOURNAL DE CONNEXIONS ────────────────────────────────────────────────────
CREATE TABLE `logins` (
  `id`        int      NOT NULL AUTO_INCREMENT,
  `user_id`   int      NOT NULL,
  `logged_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_date` (`logged_at`),
  CONSTRAINT `logins_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── MESSAGES DE CONTACT (formulaire "nous contacter", réservé aux connectés) ──
CREATE TABLE `contact_messages` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `user_id`    int          DEFAULT NULL,
  `username`   varchar(100) DEFAULT NULL,   -- dénormalisé (survit à la suppression du compte)
  `categorie`  enum('bug','suggestion','question','autre') NOT NULL DEFAULT 'autre',
  `sujet`      varchar(150) NOT NULL,
  `message`    text         NOT NULL,
  `statut`     enum('nouveau','lu','traite') NOT NULL DEFAULT 'nouveau',
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `statut_date` (`statut`, `created_at`),
  CONSTRAINT `contact_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
