-- db-core — utilisateurs, cours, progression, audit. Services : auth-api + courses-api.
-- Toutes les FK internes sont conservées (tables dans la même base).
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- ── UTILISATEURS ───────────────────────────────────────────────────────────
CREATE TABLE `users` (
  `id`            int          NOT NULL AUTO_INCREMENT,
  `email`         varchar(255) NOT NULL,
  `username`      varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  -- Tant que l'email n'est pas confirmé, la lecture des cours est refusée
  -- (cf. courses-api/cours/get.php). Le reste du site reste accessible.
  `email_verifie` tinyint(1)   NOT NULL DEFAULT 0,
  `created_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `xp`            int          NOT NULL DEFAULT 0,
  `niveau`        int          NOT NULL DEFAULT 1,
  `isAdmin`       tinyint(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── JETONS À USAGE UNIQUE (vérification d'email, réinitialisation de mot de passe) ──
-- Seul le SHA-256 du jeton est stocké : une fuite de la base ne permet donc pas
-- de forger un lien valide. Le jeton en clair n'existe que dans le mail envoyé.
CREATE TABLE `user_tokens` (
  `id`         int      NOT NULL AUTO_INCREMENT,
  `user_id`    int      NOT NULL,
  `type`       enum('verification','reset') NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expire_at`  datetime NOT NULL,
  `used_at`    datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `user_type` (`user_id`, `type`),
  CONSTRAINT `tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── COURS ──────────────────────────────────────────────────────────────────
CREATE TABLE `themes` (
  `id`          int          NOT NULL AUTO_INCREMENT,
  `slug`        varchar(80)  NOT NULL,
  `nom`         varchar(120) NOT NULL,
  `emoji`       varchar(10)  DEFAULT NULL,
  `couleur`     varchar(80)  DEFAULT NULL,
  `description` varchar(200) DEFAULT NULL,
  `ordre`       int          NOT NULL DEFAULT 0,
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

-- ── JOURNAL D'XP (historique daté des gains, cours + jeux) ───────────────────
-- Alimentée par complete.php (cours) et xp.php (jeux, via games-api → appel
-- interne). Sert l'histogramme d'XP dans le temps sur la page profil.
-- Ne remplace pas users.xp (source de vérité du total courant) : c'est un
-- journal write-only, jamais relu pour recalculer le total.
CREATE TABLE `xp_log` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `user_id`    int          NOT NULL,
  `delta`      int          NOT NULL,
  `source`     enum('cours','jeu') NOT NULL,
  `label`      varchar(120) DEFAULT NULL,  -- titre du cours / nom du jeu, pour affichage
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_date` (`user_id`, `created_at`),
  CONSTRAINT `xp_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
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
