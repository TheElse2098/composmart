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
