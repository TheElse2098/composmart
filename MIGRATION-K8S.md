# Migration Composmart → Kubernetes (k3s) — Plan détaillé

> Cible : **k3s** sur le VPS de prod. Sessions : **Redis**. Bases : **une base par service**.
> Ce document est le plan de référence. Aucun code applicatif existant n'est modifié tant que les étapes ne sont pas validées une à une.

---

## 1. Objectif

Découper le monolithe PHP/Apache actuel (un seul conteneur `web` qui sert le front + toute l'API + une seule MariaDB) en services indépendants, scalables séparément, pour qu'un pic de charge sur la **carte** (requête `france` ≈ 5 800 points, formule Haversine sur toute la table `composts`) n'impacte plus le **web** ni les **jeux**.

## 2. Découpage cible

| Service | Contenu | Image de base | Profil de charge |
|---|---|---|---|
| **web** | `front/` statique (HTML/CSS/JS, Leaflet) | `nginx:alpine` | Léger, scale à coût nul |
| **map-api** | `api/carte/*` | `php:8.3-apache` | **Lourd CPU/DB** — cible n°1 de l'autoscaling |
| **games-api** | `api/jeux/*` | `php:8.3-apache` | Pics ponctuels (fin de partie) |
| **courses-api** | `api/cours/*` + `api/admin/*` + `content/` + seeds cours | `php:8.3-apache` | Lecture quasi-statique |
| **auth-api** | `api/auth/*` | `php:8.3-apache` | Transversal |

Infra :

| Composant | Rôle | Objet K8s |
|---|---|---|
| **db-map** | tables `composts`, `regles`, `elements`, `signalements` | StatefulSet + PVC |
| **db-games** | table `scores` | StatefulSet + PVC |
| **db-core** | `users`, `cours`, `themes`, `user_progress`, `audit_log`, `logins` | StatefulSet + PVC |
| **redis** | sessions PHP partagées + rate-limiting partagé | Deployment + (PVC optionnel) |

> **Décisions actées** (28/06/2026) :
> - **Variante B retenue** : 3 StatefulSets MariaDB indépendants (`db-map`, `db-games`, `db-core`), chacun avec son PVC. Isolation réelle des bases. Voir `k8s/db-per-service.yaml`.
> - **`auth-api` et `courses-api` partagent `db-core`** : leur couplage data est fort (FK `user_progress.user_id → users.id`, crédit d'XP des cours dans `complete.php` qui écrit `users` + `user_progress` dans la même logique). Les garder dans une seule base conserve ces opérations en **transaction locale**, sans appel HTTP inter-service ni risque d'incohérence. `web` n'a aucune base.
> - **Données wipées** : on part de bases vides. Pas de migration de données existantes ; les seeds (OSM/villes, cours) repeuplent au 1er démarrage.

## 3. Le point dur : couplage cross-base (XP & classement)

Le schéma actuel a deux liens qui traversent les futures frontières de service :

1. **`scores.user_id` → FK `users.id`** (db-games → db-core).
2. **`api/jeux/score.php` action `infos`** fait `JOIN users u ON u.id = s.user_id` pour afficher le top 5 avec les pseudos.
3. **`api/auth/leaderboard.php`** classe par `users.xp` (db-core uniquement — OK).
4. Les jeux ne créditent **pas** d'XP aujourd'hui (`score.php` n'écrit que dans `scores`). Seuls les cours créditent l'XP (`api/cours/complete.php` met à jour `users.xp`).

**Conséquences du choix « une base par service » :**

- La **FK `scores → users` disparaît** (bases séparées). On la remplace par une validation applicative (`user_id` issu de la session vérifiée).
- Le **JOIN top-5** ne peut plus joindre `users`. Deux options :
  - **(a) Dénormalisation** : `games-api` stocke le `username` dans une nouvelle colonne `scores.username` (snapshot au moment du score). Simple, pas de hop réseau. Le pseudo affiché peut devenir périmé si l'user se renomme — acceptable pour un top de jeu.
  - **(b) Appel interne** : `games-api` renvoie les `user_id`, et `auth-api` expose un endpoint `POST /api/auth/usernames` (liste d'IDs → pseudos). Plus « propre », un hop réseau.
  - **Recommandation : (a)** pour démarrer (le pseudo dans un leaderboard de jeu n'a pas besoin d'être temps réel).
- Si un jour les jeux créditent de l'XP : `games-api` appelle `auth-api` en HTTP interne (`POST /api/auth/xp` `{user_id, delta}`), `users.xp` reste la **source de vérité unique** dans db-core. Pas de double comptabilité.

## 4. Sessions & rate-limiting → Redis (prérequis non négociable)

Aujourd'hui (`api/_guard.php`) :
- `secure_session_start()` → sessions **fichier** PHP locales au conteneur.
- `rate_limit()` → fichiers dans `/tmp` du conteneur.

Dès qu'un service a ≥ 2 pods, ça casse : un user loggé sur le pod A est anonyme sur le pod B ; le rate-limit ne voit qu'une fraction des requêtes.

**Refactor de `_guard.php` (≈ 15 lignes) :**
- Sessions PHP → handler Redis via `session.save_handler = redis` / `session.save_path = "tcp://redis:6379"` (extension `phpredis` à installer dans les images PHP). Aucune ligne de logique métier à changer : `$_SESSION` continue de fonctionner.
- `rate_limit()` → compteur Redis (`INCR` + `EXPIRE`) au lieu des fichiers.
- `_guard.php` devient une **lib partagée** (`shared/_guard.php`) copiée dans chaque image PHP au build.

Toute la validation de session (admin, `created_composts`, `user_id`) passe alors par Redis, identique pour tous les services.

## 4 bis. Scalabilité de la couche données (point clé)

Exigence : l'archi doit rester scalable. Il faut distinguer **deux couches** qui ne scalent PAS de la même façon.

**La couche applicative scale horizontalement, nativement.** Les pods PHP sont sans état (les sessions sont dans Redis, cf. §4) : on en ajoute autant qu'on veut. Le HPA de `map-api` (min 2 / max 8) absorbe les pics de la carte sans toucher `web`, `games` ni `courses`. C'est l'objectif principal, et il est atteint dès l'étape 3.

**La couche base ne scale pas en ajoutant des replicas d'écriture.** Un StatefulSet MariaDB à `replicas: 1` reste **un seul processus d'écriture**. Mettre 8 pods `map-api` devant un unique `db-map` déplace simplement le goulot des services vers la base. Trois leviers, dans l'ordre de pertinence pour Composmart :

1. **Séparation par service (déjà fait)** — répartir la charge sur 3 bases (`db-map`, `db-games`, `db-core`) au lieu d'une seule est *en soi* un gain de scalabilité : un pic carte n'impacte pas les écritures de jeux ni le login. C'est le bénéfice direct de la variante B.

2. **Optimisation requête + index (gain n°1, à faire avant tout sharding)** — la charge de Composmart est massivement en **lecture**. La requête lourde est le `SELECT ... FROM composts` listant tous les points ([api/carte/sites.php](api/carte/sites.php)), et la formule Haversine de détection de doublon scanne toute la table. Deux optimisations à fort impact :
   - Filtrer les points par **bounding-box** (la zone visible de la carte) au lieu de tout renvoyer → réduit massivement le volume transféré et le travail DB.
   - **Index** sur `(latitude, longitude)` pour la détection de proximité.
   Ce levier coûte quelques lignes de SQL et rapporte plus que n'importe quel ajout de pod.

3. **Réplicas de lecture MariaDB (si une base sature vraiment un jour)** — passer une base en 1 *primary* (écritures) + N *replicas* (lectures). Le StatefulSet est conçu pour ça (chaque réplica a son PVC). Le code applicatif distingue alors une connexion « write » (primary) d'une connexion « read » (service replica). À ne mettre en place que si la métrique le justifie : pour le profil de charge actuel (écritures rares et rate-limitées à 15/h, lectures dominantes), un primary unique bien indexé tient très large.

**Résumé** : la scalabilité vient des **pods qui scalent** + **bases séparées** + **requêtes indexées**. Le sharding/replica DB est un levier de dernier recours, pas un prérequis.

## 5. Routage (Ingress Traefik — fourni par k3s)

k3s embarque Traefik. **Les URLs front ne changent pas** (les appels restent `fetch('api/carte/...')`). Routage par préfixe de chemin :

```
/                 → svc/web
/api/carte/       → svc/map-api
/api/jeux/        → svc/games-api
/api/cours/       → svc/courses-api
/api/admin/       → svc/courses-api
/api/auth/        → svc/auth-api
```

C'est ce routage qui réalise l'isolation : un pic sur `/api/carte/` ne consomme que les pods `map-api`.

## 6. Réorganisation du dépôt

```
composmart/
├── services/
│   ├── web/         Dockerfile (nginx) + nginx.conf ; sert front/
│   ├── map-api/     Dockerfile (php-apache) + api/carte/
│   ├── games-api/   Dockerfile + api/jeux/
│   ├── courses-api/ Dockerfile + api/cours/ + api/admin/ + content/ + seeds cours
│   └── auth-api/    Dockerfile + api/auth/
├── shared/
│   └── _guard.php   copié dans chaque image PHP
├── db/
│   ├── map.sql      composts, regles, elements, signalements
│   ├── games.sql    scores (+ colonne username dénormalisée)
│   └── core.sql     users, cours, themes, user_progress, audit_log, logins
├── k8s/             (voir §8)
└── docker-compose.yml  (réécrit en multi-services pour le dev local)
```

> Le code PHP reste quasi identique ; on déplace les fichiers et on change l'`ENTRYPOINT`/`COPY` de chaque Dockerfile. Les `getenv('DB_HOST'|'DB_NAME'|...)` sont déjà en place → chaque service reçoit simplement la config de SA base via ses variables d'env.

## 7. CI/CD

Le workflow GitHub Actions actuel build 1 image. On passe à un **build matriciel** (5 images) poussées sur GHCR :
`ghcr.io/<owner>/composmart/{web,map-api,games-api,courses-api,auth-api}:<tag>`
Tag = `latest` + SHA court. Les manifests k8s référencent le SHA pour des déploiements traçables.

## 8. Manifests K8s (squelette livré dans `k8s/`)

```
k8s/
├── namespace.yaml
├── secrets.example.yaml      ← à copier en secrets.yaml (gitignored) avec les vrais mots de passe
├── redis.yaml                ← Deployment + Service
├── db-shared.yaml            ← VARIANTE A : 1 MariaDB, 3 bases logiques (petit VPS)
├── db-per-service.yaml       ← VARIANTE B : 3 StatefulSets (scaling DB indépendant)
├── web.yaml                  ← Deployment + Service + HPA
├── map-api.yaml              ← Deployment + Service + HPA (autoscaling prioritaire)
├── games-api.yaml            ← Deployment + Service + HPA
├── courses-api.yaml          ← Deployment + Service + HPA
├── auth-api.yaml             ← Deployment + Service + HPA
└── ingress.yaml              ← Traefik, routage par chemin (§5)
```

Conventions communes : `resources.requests/limits` posés, `readinessProbe`/`livenessProbe`, HPA sur CPU (map-api : min 2 / max 8 ; autres : min 1 / max 3), secrets montés en `envFrom`.

## 9. Ordre de migration (incrémental, jamais de big-bang)

- [ ] **Étape 0 — Redis + `_guard.php`.** Ajouter Redis au `docker-compose` actuel, basculer sessions + rate-limit sur Redis, valider que TOUT fonctionne encore en monolithe. *Rien d'autre ne bouge. Prérequis de tout le reste.*
- [ ] **Étape 1 — 5 images.** Découper les Dockerfiles, réécrire `docker-compose.yml` en multi-services, valider en local que les 5 services + Redis + DB tournent ensemble.
- [ ] **Étape 2 — Bases séparées.** Éclater `schema.sql` en `map.sql` / `games.sql` / `core.sql`, supprimer la FK `scores→users`, ajouter la dénormalisation `scores.username`, adapter le top-5 de `score.php`. Valider.
- [ ] **Étape 3 — K8s en local.** Tester tous les manifests sur **kind/k3d** (cluster jetable) avant de toucher le VPS. Valider le routage Ingress et l'autoscaling (test de charge sur `/api/carte/`).
- [ ] **Étape 4 — k3s sur le VPS.** Installer k3s, appliquer les manifests, migrer les données existantes (dump → import dans les 3 bases), basculer le DNS/Traefik. Garder l'ancien `docker-compose.prod.yml` en rollback.

## 10. Risques & points d'attention

- **Migration des données** : la prod a déjà des `composts` (5 800+), des `users`, des `scores`. L'étape 4 doit dumper et répartir ces données dans les 3 bases (les `scores.user_id` doivent rester cohérents avec les `users.id` même sans FK).
- **Seeds** : `seed.php` peuple aujourd'hui composts + cours au 1er démarrage. À scinder : la partie OSM/villes va dans un Job d'init de `db-map` ; la partie cours dans `courses-api`.
- **`content/`** : aujourd'hui bind-monté en dev. En k8s, soit embarqué dans l'image `courses-api` (rebuild pour changer un cours), soit monté via PVC/ConfigMap. À trancher à l'étape 2.
- **Sécurité** : l'audit cybersécu existant reste valable ; le découpage ne le résout pas mais isole les surfaces.
