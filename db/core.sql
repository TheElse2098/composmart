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
  -- Inactivité (RGPD) : un compte sans connexion depuis 3 ans est supprimé par
  -- la purge nocturne, 30 jours après un email de prévenance. La table logins
  -- étant purgée à 12 mois, elle ne suffit pas : on garde la date ici.
  `derniere_connexion`    datetime DEFAULT NULL,
  `prevenu_inactivite_at` datetime DEFAULT NULL,  -- remis à NULL à chaque connexion
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`),
  KEY `inactivite` (`derniere_connexion`)
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
  -- Un cours en brouillon n'apparaît ni au catalogue ni en lecture : il permet
  -- d'écrire sur plusieurs jours sans exposer un texte inachevé.
  `statut`       enum('brouillon','publie','archive') NOT NULL DEFAULT 'publie',
  `ordre`        int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `theme_id` (`theme_id`),
  CONSTRAINT `cours_ibfk_1` FOREIGN KEY (`theme_id`) REFERENCES `themes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── CONTENU DES COURS ───────────────────────────────────────────────────────
-- Table séparée de `cours` à dessein : le catalogue fait un SELECT * sur `cours`
-- à chaque affichage (cf. cours/list.php). Y loger un longtext ferait transiter
-- tout le corpus pour dessiner des vignettes.
-- `texte` reste du markdown, pas une structure JSON de panneaux : c'est le
-- format que lit déjà cours-detail.html (découpage sur les titres « ## »), et
-- l'éditeur sait le parser puis le réécrire sans perte.
CREATE TABLE `cours_contenu` (
  `cours_id` int      NOT NULL,
  `texte`    longtext DEFAULT NULL,   -- markdown, panneaux séparés par « ## »
  `quiz`     longtext DEFAULT NULL,   -- JSON, même forme que l'ancien quiz.json
  `video`    text     DEFAULT NULL,   -- JSON {titre, url, auteur, duree, description}
  `podcast`  text     DEFAULT NULL,   -- JSON {titre, url, auteur, duree, description}
  `maj_at`   datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `maj_par`  varchar(100) DEFAULT NULL,
  PRIMARY KEY (`cours_id`),
  CONSTRAINT `contenu_ibfk_1` FOREIGN KEY (`cours_id`) REFERENCES `cours` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historique : une ligne est écrite AVANT chaque sauvegarde, ce qui permet de
-- revenir en arrière après une mauvaise manipulation dans l'éditeur.
-- Pas de clé étrangère : l'historique doit survivre à la suppression du cours.
CREATE TABLE `cours_versions` (
  `id`         int      NOT NULL AUTO_INCREMENT,
  `cours_id`   int      NOT NULL,
  `texte`      longtext DEFAULT NULL,
  `quiz`       longtext DEFAULT NULL,
  `auteur`     varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cours_date` (`cours_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pierres tombales : slugs supprimés depuis l'interface d'admin.
-- content/cours/ reste embarqué dans l'image comme graine d'amorçage ; sans
-- cette liste, le prochain passage du seed recréerait un cours qu'on vient de
-- supprimer, et son adresse resterait réservée à jamais.
CREATE TABLE `cours_supprimes` (
  `slug`         varchar(80)  NOT NULL,
  `supprime_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `supprime_par` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Médias téléversés depuis l'éditeur (illustrations, fichiers audio des
-- podcasts). Stockés en base et non sur un volume :
-- courses-api monte jusqu'à 3 réplicas et le stockage par défaut de k3s est
-- ReadWriteOnce — trois pods écrivant chacun sur son disque local divergeraient.
-- Bénéfice annexe : les images entrent dans le mysqldump de sauvegarde.
CREATE TABLE `cours_medias` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `cours_id`   int          DEFAULT NULL,   -- NULL = téléversé avant la 1re sauvegarde
  `type`       enum('image','audio') NOT NULL DEFAULT 'image',
  `nom`        varchar(200) NOT NULL,
  `mime`       varchar(80)  NOT NULL,
  `taille`     int          NOT NULL,
  `donnees`    longblob     NOT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cours` (`cours_id`)
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

-- ── STATISTIQUES ANONYMES (comptes supprimés) ───────────────────────────────
-- Quand un compte est supprimé, ses lignes personnelles disparaissent (cascade)
-- mais son activité est d'abord reversée ici, agrégée PAR JOUR et sans aucun
-- identifiant. Deux événements de la même personne ne sont donc plus reliables
-- entre eux : c'est ce qui distingue cette table d'une simple pseudonymisation.
-- Les graphes de l'admin additionnent ces totaux aux données encore vivantes.
CREATE TABLE `stats_anonymes` (
  `jour`  date NOT NULL,
  `type`  enum('inscription','connexion','cours_termine','xp') NOT NULL,
  `total` int  NOT NULL DEFAULT 0,  -- nombre d'événements ce jour-là
  `somme` int  NOT NULL DEFAULT 0,  -- cumul des valeurs (XP gagnée) ; 0 sinon
  PRIMARY KEY (`jour`, `type`)
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

-- ── SIGNALEMENTS / TICKETS (formulaire "nous contacter", réservé aux connectés) ──
-- Chaque message envoyé via « nous contacter » ouvre un ticket : une
-- conversation entre son auteur et les administrateurs (table ticket_messages).
-- Cycle de vie : ouvert ⇄ clos (chaque camp peut clore et rouvrir), puis
-- clos_definitif — terminal, posé par un admin seulement, lecture seule.
-- Les colonnes derniere_activite / dernier_auteur_admin / lu_par_*_at portent
-- les pastilles « réponse non lue » des deux côtés sans table supplémentaire.
CREATE TABLE `contact_messages` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `user_id`    int          DEFAULT NULL,
  `username`   varchar(100) DEFAULT NULL,   -- dénormalisé (survit à la suppression du compte)
  `categorie`  enum('bug','suggestion','question','autre') NOT NULL DEFAULT 'autre',
  `sujet`      varchar(150) NOT NULL,
  `message`    text         NOT NULL,       -- premier message du fil
  `statut`     enum('ouvert','clos','clos_definitif') NOT NULL DEFAULT 'ouvert',
  `derniere_activite`    datetime   DEFAULT NULL,
  `dernier_auteur_admin` tinyint(1) NOT NULL DEFAULT 0,
  `lu_par_user_at`       datetime   DEFAULT NULL,
  `lu_par_admin_at`      datetime   DEFAULT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `statut_date` (`statut`, `created_at`),
  KEY `user_statut` (`user_id`, `statut`),
  CONSTRAINT `contact_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fil de discussion d'un ticket. L'accès est verrouillé côté serveur : un
-- utilisateur ne lit que les fils dont contact_messages.user_id est le sien
-- (la requête intègre la condition), les admins lisent tout.
-- user_id et auteur sont mis à NULL à la suppression du compte
-- (delete_account.php), comme pour le ticket lui-même.
CREATE TABLE `ticket_messages` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `ticket_id`  int          NOT NULL,
  `user_id`    int          DEFAULT NULL,
  `auteur`     varchar(100) DEFAULT NULL,   -- pseudo dénormalisé (affichage)
  `est_admin`  tinyint(1)   NOT NULL DEFAULT 0,
  `corps`      text         NOT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ticket_date` (`ticket_id`, `created_at`),
  CONSTRAINT `tmsg_ibfk_1` FOREIGN KEY (`ticket_id`) REFERENCES `contact_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
