-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-core — août 2026
--   • email obligatoire + vérification par lien
--   • jetons à usage unique (vérification d'email, mot de passe oublié)
--   • statistiques anonymes des comptes supprimés
--
-- À appliquer UNE FOIS sur une base existante. Les fichiers db/*.sql ne sont
-- joués que par initdb, c'est-à-dire sur un volume vierge : un cluster déjà en
-- service ne les rejoue jamais.
--
--   kubectl -n composmart exec -i db-core-0 -- \
--     mariadb -u root -p"$MDP" Composmart < db/migration-2026-08.sql
--
-- Toutes les instructions sont idempotentes (IF NOT EXISTS) : la rejouer ne
-- casse rien.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── users : email + état de vérification ────────────────────────────────────
-- La colonne est ajoutée NULLABLE, contrairement à db/core.sql qui la déclare
-- NOT NULL : les comptes déjà en base n'ont pas d'adresse, et NOT NULL leur en
-- donnerait une vide — donc identique pour tous, ce que la clé UNIQUE refuse.
-- En MariaDB, plusieurs NULL cohabitent dans un index UNIQUE : les anciens
-- comptes restent valides jusqu'à ce qu'ils renseignent une adresse.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `email`         varchar(255) DEFAULT NULL AFTER `id`,
  ADD COLUMN IF NOT EXISTS `email_verifie` tinyint(1)   NOT NULL DEFAULT 0 AFTER `password_hash`;

-- Ajout séparé : ADD UNIQUE ne connaît pas IF NOT EXISTS partout, et l'index
-- peut déjà exister si la migration a été jouée deux fois.
ALTER TABLE `users` ADD UNIQUE KEY IF NOT EXISTS `email` (`email`);

-- ── Jetons à usage unique ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `user_tokens` (
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

-- ── Statistiques anonymes (comptes supprimés) ───────────────────────────────
CREATE TABLE IF NOT EXISTS `stats_anonymes` (
  `jour`  date NOT NULL,
  `type`  enum('inscription','connexion','cours_termine','xp') NOT NULL,
  `total` int  NOT NULL DEFAULT 0,
  `somme` int  NOT NULL DEFAULT 0,
  PRIMARY KEY (`jour`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Journal d'XP (si la base est antérieure à la page profil) ───────────────
CREATE TABLE IF NOT EXISTS `xp_log` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `user_id`    int          NOT NULL,
  `delta`      int          NOT NULL,
  `source`     enum('cours','jeu') NOT NULL,
  `label`      varchar(120) DEFAULT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_date` (`user_id`, `created_at`),
  CONSTRAINT `xp_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── contact_messages : le pseudo doit survivre à la suppression du compte ───
-- (dénormalisé, mis à NULL par delete_account.php ; la FK passe en SET NULL)
ALTER TABLE `contact_messages`
  ADD COLUMN IF NOT EXISTS `username` varchar(100) DEFAULT NULL AFTER `user_id`;

-- ═══════════════════════════════════════════════════════════════════════════
-- ÉDITION DES COURS DEPUIS LE SITE
-- Le contenu quitte les fichiers content/cours/ pour la base : c'est ce qui
-- permet à l'interface d'admin de l'écrire, et aux 3 réplicas de courses-api
-- de lire la même chose.
-- ═══════════════════════════════════════════════════════════════════════════

-- 'publie' par défaut : les cours déjà en ligne ne doivent pas disparaître du
-- catalogue au moment de la migration. Seuls les cours créés depuis l'éditeur
-- démarrent en brouillon (statut posé explicitement à la création).
ALTER TABLE `cours`
  ADD COLUMN IF NOT EXISTS `statut` enum('brouillon','publie','archive')
    NOT NULL DEFAULT 'publie' AFTER `nb_questions`;

CREATE TABLE IF NOT EXISTS `cours_contenu` (
  `cours_id` int      NOT NULL,
  `texte`    longtext DEFAULT NULL,
  `quiz`     longtext DEFAULT NULL,
  `video`    text     DEFAULT NULL,
  `maj_at`   datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `maj_par`  varchar(100) DEFAULT NULL,
  PRIMARY KEY (`cours_id`),
  CONSTRAINT `contenu_ibfk_1` FOREIGN KEY (`cours_id`) REFERENCES `cours` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `cours_versions` (
  `id`         int      NOT NULL AUTO_INCREMENT,
  `cours_id`   int      NOT NULL,
  `texte`      longtext DEFAULT NULL,
  `quiz`       longtext DEFAULT NULL,
  `auteur`     varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cours_date` (`cours_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `cours_supprimes` (
  `slug`         varchar(80)  NOT NULL,
  `supprime_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `supprime_par` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `cours_images` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `cours_id`   int          DEFAULT NULL,
  `nom`        varchar(200) NOT NULL,
  `mime`       varchar(80)  NOT NULL,
  `taille`     int          NOT NULL,
  `donnees`    longblob     NOT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cours` (`cours_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Le contenu des 9 cours existants est versé dans cours_contenu par le Job
-- seed-core (import_cours.php), qui n'écrase jamais une ligne déjà présente.
-- Rien à faire ici : relancer le Job après cette migration suffit.

-- ═══════════════════════════════════════════════════════════════════════════
-- SIGNALEMENTS / TICKETS
-- Les messages « nous contacter » deviennent des conversations (tickets).
-- Décision : l'historique existant est converti en tickets DÉFINITIVEMENT clos
-- avec leur unique message — lisibles par leur auteur, figés.
-- ═══════════════════════════════════════════════════════════════════════════

-- L'enum passe par une étape élargie (anciennes + nouvelles valeurs) : MariaDB
-- refuserait de retirer une valeur encore utilisée par des lignes. Rejouable :
-- l'UPDATE devient sans effet une fois la conversion faite.
ALTER TABLE `contact_messages`
  MODIFY `statut` enum('nouveau','lu','traite','ouvert','clos','clos_definitif') NOT NULL DEFAULT 'ouvert';
UPDATE `contact_messages` SET `statut` = 'clos_definitif' WHERE `statut` IN ('nouveau','lu','traite');
ALTER TABLE `contact_messages`
  MODIFY `statut` enum('ouvert','clos','clos_definitif') NOT NULL DEFAULT 'ouvert';

ALTER TABLE `contact_messages`
  ADD COLUMN IF NOT EXISTS `derniere_activite`    datetime   DEFAULT NULL AFTER `statut`,
  ADD COLUMN IF NOT EXISTS `dernier_auteur_admin` tinyint(1) NOT NULL DEFAULT 0 AFTER `derniere_activite`,
  ADD COLUMN IF NOT EXISTS `lu_par_user_at`       datetime   DEFAULT NULL AFTER `dernier_auteur_admin`,
  ADD COLUMN IF NOT EXISTS `lu_par_admin_at`      datetime   DEFAULT NULL AFTER `lu_par_user_at`,
  ADD KEY IF NOT EXISTS `user_statut` (`user_id`, `statut`);
UPDATE `contact_messages` SET `derniere_activite` = `created_at` WHERE `derniere_activite` IS NULL;

CREATE TABLE IF NOT EXISTS `ticket_messages` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `ticket_id`  int          NOT NULL,
  `user_id`    int          DEFAULT NULL,
  `auteur`     varchar(100) DEFAULT NULL,
  `est_admin`  tinyint(1)   NOT NULL DEFAULT 0,
  `corps`      text         NOT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ticket_date` (`ticket_id`, `created_at`),
  CONSTRAINT `tmsg_ibfk_1` FOREIGN KEY (`ticket_id`) REFERENCES `contact_messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Vidéo et podcast éditables depuis l'interface ──────────────────────────
-- La fiche du podcast rejoint celle de la vidéo dans cours_contenu ; le fichier
-- audio, lui, va dans la table des médias (voir juste en dessous).
ALTER TABLE `cours_contenu`
  ADD COLUMN IF NOT EXISTS `podcast` text DEFAULT NULL AFTER `video`;

-- cours_images devient cours_medias : elle accueille désormais aussi les
-- fichiers audio des podcasts. Les deux instructions se complètent — la
-- première agit sur une base déjà migrée, la seconde sur une base neuve —
-- et l'une des deux est toujours sans effet.
RENAME TABLE IF EXISTS `cours_images` TO `cours_medias`;

CREATE TABLE IF NOT EXISTS `cours_medias` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `cours_id`   int          DEFAULT NULL,
  `type`       enum('image','audio') NOT NULL DEFAULT 'image',
  `nom`        varchar(200) NOT NULL,
  `mime`       varchar(80)  NOT NULL,
  `taille`     int          NOT NULL,
  `donnees`    longblob     NOT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cours` (`cours_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `cours_medias`
  ADD COLUMN IF NOT EXISTS `type` enum('image','audio') NOT NULL DEFAULT 'image' AFTER `cours_id`;
