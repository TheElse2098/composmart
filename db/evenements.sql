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
  -- 5 statuts de cycle de vie, mutuellement exclusifs. 'en_cours'/'termine'
  -- sont des bascules manuelles le jour de l'atelier, indépendantes de
  -- date_debut/date_fin (pas de calcul automatique par horloge). 'ouvert' peut
  -- revenir à 'prevu' (inscriptions temporairement coupées sans annuler).
  `statut`        enum('prevu','ouvert','en_cours','annule','termine') NOT NULL DEFAULT 'prevu',
  -- Suppression douce, indépendante du statut de cycle de vie ci-dessus : un
  -- événement supprimé garde son statut inchangé mais est masqué de la vue
  -- par défaut. Jamais de DELETE SQL, les données (dont les participants) ne
  -- sont jamais effacées.
  `supprime`      tinyint(1)   NOT NULL DEFAULT 0,
  -- Parcours source, à titre informatif : les slides sont COPIÉES dans
  -- evenement_slides à l'affectation (cf. commentaire de cette table).
  `parcours_id`   int          DEFAULT NULL,
  `mode_equipes`  enum('aucun','manuel','auto','libre') NOT NULL DEFAULT 'aucun',
  -- 'commun' = tout le monde sur la même slide, l'animateur fait avancer.
  -- 'individuel' = chacun progresse à son rythme (participants.slide_index).
  `mode_parcours` enum('commun','individuel') NOT NULL DEFAULT 'commun',
  -- Charte visuelle des slides : 'foret' (cartes claires sur fond feuillage),
  -- 'papier' (fond crème, cadres épais, accent terracotta) ou 'simpliste'
  -- (cadre vert Composmart, carte blanche, sans ornement). Cf. slides.css.
  `theme_slides`  enum('foret','papier','simpliste') NOT NULL DEFAULT 'foret',
  `slide_courante_id` int      DEFAULT NULL,       -- mode commun : slide projetée
  `cree_par`      varchar(100) DEFAULT NULL,       -- username admin, dénormalisé (cf. cours_versions.auteur)
  `created_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── PARCOURS (bibliothèque réutilisable) ────────────────────────────────────
-- Un parcours est un modèle d'animation : une suite de slides écrite une fois
-- et rejouable auprès de plusieurs entreprises.
CREATE TABLE `parcours` (
  `id`          int          NOT NULL AUTO_INCREMENT,
  `nom`         varchar(150) NOT NULL,
  `description` varchar(300) DEFAULT NULL,
  `cree_par`    varchar(100) DEFAULT NULL,
  `created_at`  datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `maj_at`      datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- `type` en varchar et non enum : ajouter un type de slide ne doit pas
-- imposer une migration de schéma. Le registre fait foi côté PHP
-- (evenements/_slides.php), qui valide aussi la forme de `contenu`.
CREATE TABLE `parcours_slides` (
  `id`          int          NOT NULL AUTO_INCREMENT,
  `parcours_id` int          NOT NULL,
  `ordre`       int          NOT NULL DEFAULT 0,
  `type`        varchar(30)  NOT NULL,
  `titre`       varchar(200) DEFAULT NULL,
  `contenu`     longtext     DEFAULT NULL,   -- JSON, forme dépendant du type
  `points`      int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `parcours_ordre` (`parcours_id`, `ordre`),
  CONSTRAINT `pslides_ibfk_1` FOREIGN KEY (`parcours_id`) REFERENCES `parcours` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── BANQUE D'ANECDOTES ──────────────────────────────────────────────────────
-- Réservoir partagé par tous les parcours. Une slide de type « anecdote »
-- peut soit porter son propre texte, soit pointer une anecdote d'ici, soit
-- en tirer une au hasard (le tirage est dérivé du couple participant/slide
-- côté PHP : il est donc stable, et différent d'un participant à l'autre).
CREATE TABLE `anecdotes` (
  `id`         int          NOT NULL AUTO_INCREMENT,
  `texte`      varchar(1000) NOT NULL,
  `emoji`      varchar(10)  DEFAULT NULL,
  `theme`      varchar(60)  DEFAULT NULL,   -- regroupement libre (compost, tri, biodiversité…)
  `cree_par`   varchar(100) DEFAULT NULL,
  `created_at` datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `theme` (`theme`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mots-cles d'une anecdote. Table de liaison plutot qu'une colonne de mots
-- separes par des virgules : filtrer un varchar imposerait un LIKE '%tri%',
-- qui attrape aussi « nutrition ». La cle composite interdit le doublon.
CREATE TABLE `anecdote_mots` (
  `anecdote_id` int         NOT NULL,
  `mot`         varchar(40) NOT NULL,
  PRIMARY KEY (`anecdote_id`, `mot`),
  KEY `mot` (`mot`),
  CONSTRAINT `anecmots_ibfk_1` FOREIGN KEY (`anecdote_id`) REFERENCES `anecdotes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SLIDES D'UN ÉVÉNEMENT (copie figée du parcours) ─────────────────────────
-- Copie et non pointeur vers parcours_slides, à dessein : l'animateur peut
-- adapter le déroulé pour UN client sans toucher au modèle, et retoucher le
-- modèle plus tard ne réécrit pas un atelier déjà joué. Les réponses des
-- participants pointent ici, donc ces lignes doivent rester stables
-- (même raisonnement que cours_versions dans db-core).
-- Provenance des parcours enchaines sur un evenement. Purement informatif :
-- les slides de `evenement_slides` sont des copies independantes, cette table
-- sert seulement a afficher d'ou vient chaque bloc du deroule.
CREATE TABLE `evenement_parcours` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `evenement_id` int          NOT NULL,
  `parcours_id`  int          DEFAULT NULL,
  `nom`          varchar(150) NOT NULL,
  `ordre`        int          NOT NULL DEFAULT 0,
  `nb_slides`    int          NOT NULL DEFAULT 0,
  `ajoute_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `evt_ordre` (`evenement_id`, `ordre`),
  KEY `parcours` (`parcours_id`),
  CONSTRAINT `evtparc_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `evtparc_ibfk_2` FOREIGN KEY (`parcours_id`)  REFERENCES `parcours` (`id`)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `evenement_slides` (
  `id`           int          NOT NULL AUTO_INCREMENT,
  `evenement_id` int          NOT NULL,
  `ordre`        int          NOT NULL DEFAULT 0,
  `type`         varchar(30)  NOT NULL,
  `titre`        varchar(200) DEFAULT NULL,
  `contenu`      longtext     DEFAULT NULL,
  `points`       int          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `evt_ordre` (`evenement_id`, `ordre`),
  CONSTRAINT `eslides_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── ÉQUIPES ─────────────────────────────────────────────────────────────────
-- Nombre et noms fixés par l'animateur à la création. Le score d'une équipe
-- est la somme des points de ses membres (pas de colonne score : toujours
-- recalculé depuis `reponses`, donc jamais désynchronisé).
CREATE TABLE `equipes` (
  `id`           int         NOT NULL AUTO_INCREMENT,
  `evenement_id` int         NOT NULL,
  `nom`          varchar(80) NOT NULL,
  `couleur`      varchar(20) DEFAULT NULL,
  `ordre`        int         NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `evenement` (`evenement_id`),
  CONSTRAINT `equipes_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE
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
  `equipe_id`     int          DEFAULT NULL,
  -- Identité du participant sur les requêtes suivantes (répondre, progresser).
  -- Même mécanique que user_tokens dans db-core : seul le SHA-256 est stocké,
  -- le jeton en clair ne vit que dans le localStorage du navigateur. Choisi
  -- plutôt qu'une $_SESSION : survit à une éviction de session Redis en plein
  -- atelier, ce qui sinon éjecterait un participant au milieu du parcours.
  `token_hash`    char(64)     DEFAULT NULL,
  `slide_index`   int          NOT NULL DEFAULT 0, -- progression propre (mode individuel)
  `rejoint_at`    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `evenement` (`evenement_id`, `rejoint_at`),
  KEY `token` (`token_hash`),
  KEY `equipe` (`equipe_id`),
  CONSTRAINT `participants_ibfk_1` FOREIGN KEY (`evenement_id`) REFERENCES `evenements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `participants_ibfk_2` FOREIGN KEY (`equipe_id`) REFERENCES `equipes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── RÉPONSES (source unique du scoring) ─────────────────────────────────────
-- Les points ne sont jamais stockés ailleurs : classements individuel et par
-- équipe sont toujours recalculés d'ici, donc jamais désynchronisés.
CREATE TABLE `reponses` (
  `id`             int        NOT NULL AUTO_INCREMENT,
  `evenement_id`   int        NOT NULL,
  `slide_id`       int        NOT NULL,
  `participant_id` int        NOT NULL,
  `reponse`        text       DEFAULT NULL,   -- JSON ou valeur brute selon le type
  `points`         int        NOT NULL DEFAULT 0,
  `correct`        tinyint(1) DEFAULT NULL,   -- NULL = pas de bonne réponse (sondage, défi…)
  `repondu_at`     datetime   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- Une seule réponse par slide et par participant : empêche le double scoring
  -- sur double clic ou rejeu de requête.
  UNIQUE KEY `slide_participant` (`slide_id`, `participant_id`),
  KEY `evt_participant` (`evenement_id`, `participant_id`),
  CONSTRAINT `reponses_ibfk_1` FOREIGN KEY (`slide_id`) REFERENCES `evenement_slides` (`id`) ON DELETE CASCADE,
  CONSTRAINT `reponses_ibfk_2` FOREIGN KEY (`participant_id`) REFERENCES `participants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
