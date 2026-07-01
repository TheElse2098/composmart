# Composmart

Site web de sensibilisation écologique au compostage : carte interactive des composteurs, système de cours avec quiz, jeux et dark mode.

Architecture **microservices** : les fonctionnalités sont découpées en services indépendants (carte, jeux, cours, auth) pour que la charge de l'un n'impacte pas les autres.

## Stack

- **Frontend** : HTML / CSS / JavaScript + Leaflet.js
- **Backend** : PHP 8.3 (Apache), découpé en 5 services
- **Bases de données** : MariaDB 11 (3 bases séparées : map / games / core)
- **Sessions & cache** : Redis (sessions partagées, rate-limiting, cache carte)
- **Orchestration** : Docker Compose (dev/prod actuel) → Kubernetes / k3s (cible, cf. `k8s/`)
- **CI/CD** : GitHub Actions → GHCR (5 images)

## Architecture

| Service | Rôle | Base |
|---|---|---|
| **web** | Sert le front statique + reverse-proxy `/api/*` vers les services | — |
| **map-api** | `api/carte/*` — CRUD composteurs, signalements (le plus lourd) | db-map |
| **games-api** | `api/jeux/*` — scores des mini-jeux | db-games |
| **courses-api** | `api/cours/*` + `api/admin/*` — cours, quiz, back-office | db-core |
| **auth-api** | `api/auth/*` — login, profil, classement, launchpad | db-core |
| **redis** | Sessions PHP partagées, rate-limiting, cache de la carte | — |

Routage par préfixe de chemin (`/api/carte` → map-api, etc.), identique en Docker Compose (proxy Apache) et en Kubernetes (Ingress Traefik). Les URLs front ne changent pas.

## Lancer en développement / production

```bash
cp .env.example .env   # renseigner les mots de passe (DB, AUDIT_SECRET)
docker compose up --build
```

- Site : http://localhost
- Au premier démarrage, les bases sont peuplées automatiquement : composteurs (villes open data + OSM France) dans db-map, cours (`content/`) dans db-core.
- L'import OSM est robuste (retries + miroirs Overpass) et rejoué chaque nuit à 3h15 (`osm-cron`).
- Créer le compte admin via la page **launchpad** une fois le seed des cours terminé (il reçoit tous les cours validés + l'XP).

### Mettre à jour

Après un push sur `main`, GitHub Actions reconstruit les 5 images sur GHCR :

```bash
docker compose pull
docker compose up -d
```

## Déploiement Kubernetes (k3s)

Voir **`k8s/README.md`** : manifests complets (`k8s/composmart.yaml`), procédure k3d local
et k3s sur serveur Linux, HPA (autoscaling de map-api), CronJob OSM, HTTPS.

## Structure

```
composmart/
├── services/
│   ├── web/         ← front statique (HTML/CSS/JS, Leaflet) + reverse-proxy Apache
│   │   └── front/
│   ├── map-api/carte/       ← sites.php (CRUD + cache Redis), signalement.php, count.php
│   ├── games-api/jeux/      ← score.php
│   ├── courses-api/
│   │   ├── cours/           ← list.php, get.php, complete.php
│   │   └── admin/           ← stats.php, users.php, evolution.php
│   └── auth-api/auth/       ← login, register, me, profile, leaderboard, launchpad, audit
│
├── shared/
│   ├── _guard.php   ← garde partagé (sessions Redis, rate-limit, csrf, audit) — SOURCE UNIQUE
│   └── seeds/       ← seed_map.php, seed_core.php, import_{osm,city,cours}.php, *.json
│
├── db/
│   ├── map.sql      ← composts, regles, elements, signalements (+ index lat/lng)
│   ├── games.sql    ← scores (username dénormalisé)
│   └── core.sql     ← users, cours, themes, user_progress, audit_log, logins
│
├── content/         ← données éditoriales (cours, thèmes) — embarqué dans courses-api
│   ├── themes/
│   └── cours/<slug>/  ← meta.json, texte.md, video.json, podcast.json, quiz.json
│
├── k8s/             ← manifests Kubernetes + guide de déploiement
├── docker-compose.yml
└── MIGRATION-K8S.md ← plan et historique de la migration monolithe → microservices
```

> Le garde `_guard.php` et les seeds vivent dans `shared/` (source unique) et sont copiés
> dans les images au build par chaque Dockerfile — pas de duplication dans le dépôt.

## Système de cours

Les cours sont définis par des fichiers dans `content/cours/<slug>/`. Au démarrage, `import_cours.php` les importe dans db-core. Les médias manquants (vidéo, podcast) affichent un bouton grisé.

- **URL** : `/cours` → liste, `/cours/<slug>` → détail
- **Médias** : YouTube/Vimeo auto-détecté (iframe embed), fichier direct (`<video>`), podcast (`<audio>`)
- **Quiz** : score minimum 50% pour valider et gagner l'XP

Pour ajouter un cours : créer un dossier dans `content/cours/` et rebuild l'image courses-api.

## Sources de données

| Source | Contenu | Mise à jour |
|---|---|---|
| OpenStreetMap (Overpass) | ~4 500 composteurs France | Auto au 1er démarrage + refresh quotidien 3h15 |
| Open data Montpellier | ~420 points d'apport | Automatique au 1er démarrage |
| Open data Rennes Métropole | ~590 composteurs | Automatique au 1er démarrage |
| Open data Marseille | ~320 composteurs | Automatique au 1er démarrage |
| Ajouts manuels (carte) | Points ajoutés via l'interface | Persistés en base |
| Fichiers `content/` | Cours, thèmes, quiz | Import au démarrage (idempotent) |

## TODO LIST

- [x] User system
- [x] isAdmin dans la table des users
- [x] modifier/supprimer un composter que pour les admins
- [x] système de signalement d'erreur : mauvaise position/mauvais paramètres pour les composters, pour les utilisateurs classiques, et retour visible pour les comptes admins.
- [x] crée une infra pour les jeux
- [x] rajoute un ou plusieurs jeux simples : mot croisés sur le thème du compostage, ou autre facile et accessible (lettres à clicker pour faire un mot genre le nom des vers de compostage)
- [x] rajoute le bloc jeu dans la page principale ainsi que le bloc compte
- [x] fais la liste des potentiels problèmes de cybersécu et l'écrire dans README.md dans une nouvelle section
- [x] découpage en microservices (map / web / games / cours / auth) + Redis
- [x] séparation des bases de données (db-map / db-games / db-core)
- [x] manifests Kubernetes (k3s) — cf. `k8s/`
- [ ] valider le déploiement Kubernetes sur un cluster (k3d local ou serveur)
