-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION db-evenements — mots-clés multiples sur les anecdotes (août 2026)
--   • nouvelle table `anecdote_mots`
--
-- Une anecdote portait un seul `theme` (varchar libre). Elle peut désormais
-- porter autant de mots-clés qu'on veut, en plus de son thème : « compost » et
-- « chiffre-choc » et « démarrage » à la fois.
--
-- Table de liaison plutôt qu'une colonne de mots séparés par des virgules :
-- filtrer une liste stockée en varchar impose un LIKE '%tri%', qui attrape
-- aussi « nutrition » et « tri-sélectif ». La clé primaire composite
-- (anecdote_id, mot) interdit en prime le doublon sans code applicatif.
--
--   kubectl -n composmart exec -i db-evenements-0 -- \
--     mariadb -u composmart -p"$MDP" Composmart < db/migration-2026-08-anecdotes-mots-cles.sql
--
-- Rejouable : CREATE TABLE IF NOT EXISTS. Aucune donnée existante n'est
-- touchée — les anecdotes déjà en base démarrent simplement sans mot-clé.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `anecdote_mots` (
  `anecdote_id` int         NOT NULL,
  `mot`         varchar(40) NOT NULL,
  PRIMARY KEY (`anecdote_id`, `mot`),
  KEY `mot` (`mot`),
  CONSTRAINT `anecmots_ibfk_1` FOREIGN KEY (`anecdote_id`) REFERENCES `anecdotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
