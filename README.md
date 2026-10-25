# Composmart

Site de sensibilisation au compostage — **https://composmart.fr** :
carte interactive des composteurs, cours avec quiz, mini-jeux, classements et
ateliers animés en présentiel (code ou QR code, équipes, suivi en direct).

Conçu, développé et exploité par **Eliott Seuret**. Dépôt public à titre de
portfolio, tous droits réservés (voir [LICENSE](LICENSE)).

> **In English** — Composmart is a production web platform promoting home
> composting: an interactive map of ~6,000 composting sites across France,
> courses with quizzes, mini-games with leaderboards, and live workshops
> joined by QR code. It runs as six PHP microservices with four MariaDB
> databases and Redis on a self-managed k3s cluster, deployed with a custom
> Helm chart. Built and operated end-to-end by Eliott Seuret.

## Points notables

- **Microservices** : six services indépendants, une base par domaine,
  communication interne authentifiée ; une panne ou une charge sur la carte
  n'affecte pas les cours ni les ateliers.
- **Kubernetes en production** (k3s sur VPS), chart Helm écrit pour le
  projet : déploiement en une commande, reconstruction des seuls services
  modifiés (dépendances lues dans les Dockerfile), migrations SQL appliquées
  automatiquement et une seule fois, retour arrière avec `helm rollback`.
- **Carte de ~6 000 composteurs** : import nocturne OpenStreetMap et open
  data de collectivités, chargement par zone visible, cache Redis.
- **Ateliers en direct** : participation par code ou QR code, équipes,
  parcours de questions synchronisé par l'animateur.
- **Sécurité** : CSRF, limitation des abus, sessions côté serveur,
  requêtes préparées, journal d'audit, pages d'administration invisibles
  pour un non-admin.
- **RGPD** : aucun bandeau cookies nécessaire (aucun traceur ni service tiers
  sans action de l'utilisateur), durées de conservation appliquées par des
  tâches nocturnes, export et suppression des données en libre-service.

## Architecture

Six services PHP indépendants, chacun avec sa propre base, derrière un Ingress
qui route par préfixe d'URL. La charge de l'un (la carte, un atelier en cours)
n'affecte pas les autres.

| Service | Rôle | URL | Base |
|---|---|---|---|
| **web** | Front statique (HTML/CSS/JS, Leaflet) | `/` | — |
| **map-api** | Composteurs, propositions, signalements | `/api/carte` | db-map |
| **games-api** | Scores des mini-jeux | `/api/jeux` | db-games |
| **courses-api** | Cours, quiz, contact, back-office | `/api/cours`, `/api/contact`, `/api/admin`, `/admin` | db-core |
| **auth-api** | Comptes, connexion, profil, classement, export RGPD | `/api/auth` | db-core |
| **evenements-api** | Ateliers, parcours de slides, suivi live | `/api/evenements`, `/evenements-admin` | db-evenements |
| **redis** | Sessions partagées, limitation d'abus, cache de la carte | — | — |

- **Stack** : PHP 8.3 (Apache), MariaDB 11 (4 bases), Redis 7, Leaflet.
- **Hébergement** : VPS OVH (Gravelines), Kubernetes **k3s**, Ingress Traefik,
  HTTPS Let's Encrypt (cert-manager).
- **Communication entre services** : appels HTTP internes protégés par un
  secret partagé (`AUDIT_SECRET`) — journal d'audit, crédit d'XP, vérification
  admin, purge et export des données d'un compte.
- **Pages d'administration** (`/admin`, `/evenements-admin`) : servies par un
  contrôleur PHP qui vérifie la session ; un non-admin reçoit une 404.

## Déployer

Tout passe par le chart Helm `helm/composmart/` :

```bash
git pull
bash helm/deploy.sh
```

Le script reconstruit seulement les services modifiés, applique les migrations
SQL en attente, met à jour le cluster et affiche les journaux des tâches
ponctuelles. Détails, installation, test local (k3d), tâches ponctuelles et
retour arrière : **[helm/README.md](helm/README.md)**.

## Structure

```
composmart/
├── services/
│   ├── web/front/            pages HTML, assets/ (css, js, vendor/ = bibliothèques
│   │                         hébergées localement), partials/ (nav, footer)
│   ├── map-api/carte/        sites.php (CRUD + cache Redis), signalement.php…
│   ├── games-api/jeux/       score.php
│   ├── courses-api/          cours/, admin/, contact/, admin-pages/ (vues du back-office)
│   ├── auth-api/             auth/ (login, register, export, change_email…), cron/ (purge RGPD)
│   └── evenements-api/       evenements/, admin-pages/, cron/ (purge RGPD)
├── shared/
│   ├── _guard.php            garde commun : sessions, CSRF, rate-limit, audit, mail,
│   │                         suppression de compte — SOURCE UNIQUE, copiée dans les images
│   └── seeds/                remplissage initial (composteurs, cours)
├── db/
│   ├── map.sql, games.sql, core.sql, evenements.sql   schémas initiaux
│   └── migration-*.sql       évolutions, appliquées automatiquement au déploiement
├── content/                  cours et thèmes (graine de la base, cf. ci-dessous)
└── helm/                     chart Helm + deploy.sh
```

Chaque Dockerfile (`services/<service>/Dockerfile`) se construit depuis la
racine du dépôt et ne copie que les fichiers de son service, plus ceux de
`shared/` dont il a besoin.

## Conventions

- **Modifier le schéma d'une base** : créer `db/migration-AAAA-MM-sujet.sql`
  dont la première ligne de commentaire nomme la base
  (`-- MIGRATION db-core — …`), et reporter le changement dans le schéma
  initial `db/<base>.sql`. Le déploiement l'applique une seule fois.
- **Lancer une tâche sur le cluster** : jamais de `kubectl` à la main ; une
  entrée `ponctuels:` dans `helm/values-prod.yaml`, puis `deploy.sh`.
- **Code partagé** : éditer `shared/_guard.php`, jamais une copie.
- **Bibliothèques front** : hébergées dans `services/web/front/assets/vendor/`,
  avec leur version dans le nom du dossier. Aucun CDN ni Google Fonts (RGPD).
- **Boîtes de dialogue** : `assets/js/confirmer.js` ou une modale intégrée,
  jamais `alert` / `confirm` / `prompt`.

## Cours

Les cours s'éditent depuis **/admin** et vivent en base (db-core). Le dossier
`content/cours/<slug>/` (`meta.json`, `texte.md`, `quiz.json`, médias) ne sert
que de graine : le seed l'importe dans une base vierge et n'écrase jamais un
cours existant. Un quiz est validé à partir de 50 % de bonnes réponses.

## Sources de données de la carte

| Source | Contenu | Mise à jour |
|---|---|---|
| OpenStreetMap (Overpass) | Composteurs de France | Chaque nuit à 3 h 15 (CronJob `osm-refresh`) |
| Open data Montpellier, Rennes, Marseille | Points d'apport, composteurs | Au premier remplissage |
| Utilisateurs | Propositions validées par un admin | En continu |

## RGPD

- Pages publiques : `/mentions-legales`, `/confidentialite` (dont cookies),
  `/cgu`, liées depuis le footer. **À mettre à jour à chaque nouvelle donnée
  collectée.**
- Aucun bandeau cookies nécessaire : seul le cookie de session est déposé, et
  aucun service tiers n'est contacté sans action de l'utilisateur (vidéos
  chargées au clic, polices et bibliothèques hébergées localement).
- Durées de conservation appliquées chaque nuit par `services/*/cron/purge_rgpd.php`
  (CronJobs `purge-rgpd-core` et `purge-rgpd-evenements`).
- Droits des utilisateurs dans **Mon compte** : télécharger ses données,
  changer d'email, supprimer son compte (purge de toutes les bases).
- Le registre des traitements et la procédure en cas de violation de données
  sont tenus **hors du dépôt** (documents internes).

## Licence

© 2026 Eliott Seuret — **tous droits réservés**. Le code et les contenus sont
consultables ici à titre de présentation ; toute réutilisation demande une
autorisation écrite ([LICENSE](LICENSE)). Les bibliothèques, polices et
données de tiers gardent leur propre licence
([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Contact : contact@composmart.fr
