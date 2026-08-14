# Déploiement Kubernetes — Composmart

Manifest unique : **`composmart.yaml`** (variante B, 3 bases séparées), aligné sur
`docker-compose.yml`. Conçu pour tester en local sur **k3d** (k3s dans Docker,
même moteur que le VPS) avant tout déploiement réel.

> Les anciens fichiers éclatés (`web.yaml`, `map-api.yaml`, `db-per-service.yaml`, …)
> sont conservés comme référence historique mais **`composmart.yaml` fait foi**.

# ============================================================================
# LANCER LE PROJET EN LOCAL (k3d) — procédure complète et testée
# ============================================================================
# Toutes les commandes se lancent depuis la RACINE du repo (dossier composmart/).
# Testé sous Windows (PowerShell) + Docker Desktop, le 01/07/2026.

## Prérequis

- **Docker Desktop** installé ET démarré (icône baleine "running").
- **k3d**     : `choco install k3d -y`            (PowerShell admin)
- **kubectl** : `choco install kubernetes-cli -y`

Vérifier : `docker version`, `k3d version`, `kubectl version --client`.

## Étape 1 — Créer le cluster

```bash
k3d cluster create composmart -p "8080:80@loadbalancer"
```

Le port 8080 de la machine est mappé vers l'Ingress → le site sera sur **http://localhost:8080**.

> ⚠️ **PIÈGE Windows fréquent** : k3d écrit un kubeconfig pointant sur
> `host.docker.internal`, souvent INJOIGNABLE depuis Windows (kubectl timeout
> "connection refused" / "context deadline exceeded"). Si `kubectl get nodes`
> échoue, repointer sur 127.0.0.1 avec le port réel du cluster :
> ```bash
> # trouver le port : docker ps → ligne k3d-composmart-serverlb, colonne ...->6443/tcp
> kubectl config set-cluster k3d-composmart --server=https://127.0.0.1:<PORT>
> ```
> Vérifier ensuite : `kubectl get nodes` doit afficher le nœud `Ready`.

## Étape 2 — Builder les 5 images

```bash
docker build -f services/web/Dockerfile          -t composmart/web:local .
docker build -f services/map-api/Dockerfile      -t composmart/map-api:local .
docker build -f services/games-api/Dockerfile    -t composmart/games-api:local .
docker build -f services/courses-api/Dockerfile  -t composmart/courses-api:local .
docker build -f services/auth-api/Dockerfile     -t composmart/auth-api:local .
docker build -f services/evenements-api/Dockerfile -t composmart/evenements-api:local .
```

## Étape 3 — Importer les images dans k3d

**Indispensable** : sans ça, les pods restent en `ErrImageNeverPull` (k3d ne voit
pas les images du démon Docker local).

```bash
k3d image import -c composmart \
  composmart/web:local composmart/map-api:local composmart/games-api:local \
  composmart/courses-api:local composmart/auth-api:local composmart/evenements-api:local
```

## Étape 4 — Namespace + ConfigMaps (schémas SQL + seeds)

```bash
kubectl create namespace composmart
kubectl create configmap map-schema       --from-file=schema.sql=db/map.sql       -n composmart
kubectl create configmap games-schema     --from-file=schema.sql=db/games.sql     -n composmart
kubectl create configmap core-schema      --from-file=schema.sql=db/core.sql      -n composmart
kubectl create configmap evenements-schema --from-file=schema.sql=db/evenements.sql -n composmart
kubectl create configmap seeds            --from-file=shared/seeds/                -n composmart
```

> ⚠️ La ConfigMap `seeds` se met à jour par **delete + create**, jamais par
> `kubectl apply` (l'annotation générée dépasse la limite de 262 144 octets) :
> ```bash
> kubectl delete configmap seeds -n composmart
> kubectl create configmap seeds --from-file=shared/seeds/ -n composmart
> ```

## Étape 5 — Déployer

```bash
kubectl apply -f k8s/composmart.yaml
kubectl get pods -n composmart -w      # Ctrl-C pour arrêter le suivi
```

Ordre d'arrivée : redis + services (Running vite), puis les 3 bases deviennent
Ready (~40 s), puis les Jobs seed s'exécutent :
- `seed-core` → **Completed** (8 cours importés)
- `seed-map`  → **Completed** (villes + import OSM ≈ 5860 composts ; jusqu'à 2 min)

> ℹ️ Les seeds affichent `Error`/`CrashLoopBackOff` les premières secondes : ils
> démarrent avant que les bases soient prêtes et réessaient (`OnFailure`,
> `backoffLimit: 4`). C'est normal — ils passent `Completed` dès les bases Ready.
> S'ils restent en échec APRÈS que les bases sont Ready, voir les logs :
> `kubectl logs -n composmart -l job-name=seed-map`.

## Étape 6 — Créer l'admin

Une fois `seed-core` en **Completed** (`kubectl get jobs -n composmart`), aller sur
**http://localhost:8080** → page launchpad → créer l'admin.
Il reçoit alors les 8 cours validés + 410 XP (niveau 5).

> ⚠️ Créer l'admin AVANT la fin de seed-core → admin à 0 XP / 0 cours (bug timing).

## Étape 7 — Vérifier que tout marche

```bash
kubectl get pods -n composmart          # tous Running (services) / Completed (seeds)
kubectl get hpa  -n composmart          # autoscalers actifs (metrics-server inclus dans k3d)

curl -s localhost:8080/                        # page d'accueil (HTML)
curl -s localhost:8080/api/carte/health.php    # {"status":"ok"}
curl -s localhost:8080/api/auth/me.php         # {"logged_in":false}
curl -s localhost:8080/api/evenements/health.php   # {"status":"ok"}
curl -s localhost:8080/api/carte/sites.php -d 'france=1' | head -c 80   # JSON composts
```

Sous PowerShell, remplacer `curl -s ... -d '...'` par :
```powershell
Invoke-WebRequest -Uri "http://localhost:8080/api/carte/sites.php" -Method POST -Body "france=france" -UseBasicParsing
```

## Mettre à jour après une modif de code

```bash
# 1. rebuild + réimport de l'image concernée (ex. map-api)
docker build -f services/map-api/Dockerfile -t composmart/map-api:local .
k3d image import -c composmart composmart/map-api:local
# 2. redémarrer le déploiement pour recharger l'image
kubectl rollout restart deployment/map-api -n composmart
```

Pour un changement de **seed** (dans `shared/seeds/`) : pas de rebuild, recréer la
ConfigMap (delete+create, cf. étape 4) puis relancer le Job :
```bash
kubectl delete job seed-map -n composmart
kubectl apply -f k8s/composmart.yaml
```

## Repartir de zéro / arrêter

```bash
kubectl delete -f k8s/composmart.yaml
kubectl delete pvc --all -n composmart   # ⚠️ efface les données (wipe)
# ou tout jeter :
k3d cluster delete composmart
```

## Notes

- **content/** est embarqué dans l'image `courses-api` (COPY au build) ; pour changer
  un cours, rebuild + réimport de l'image.
- **HPA** : k3d inclut metrics-server. Sur un k3s nu, l'activer si absent.

---

# Déploiement sur un serveur Linux (k3s) — étape 4

Procédure pour mettre Composmart en production sur un VPS Linux avec **k3s**
(distribution k8s légère, idéale pour un seul serveur). Le code arrive sur le
serveur par **git pull** (workflow habituel).

> ⚠️ Dimensionnement : variante B = 3 instances MariaDB + 5 PHP + Redis + k3s.
> Prévoir **au moins 2 Go de RAM** (4 Go confortable). À 1 Go, préférer la
> variante A (1 MariaDB / 3 bases logiques) — voir `db-shared.yaml`.

## 1. Installer k3s

```bash
# Sur le VPS, en root
curl -sfL https://get.k3s.io | sh -

# k3s installe kubectl et un kubeconfig dans /etc/rancher/k3s/k3s.yaml
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes        # le nœud doit être Ready
```

k3s embarque **Traefik** (Ingress) et un **metrics-server** (HPA) : rien à installer de plus.

## 2. Récupérer le code

```bash
cd ~/composmart
git pull        # récupère k8s/composmart.yaml, db/*.sql, services/*, etc.
```

## 3. Construire les images

k3s utilise **containerd** (pas le démon Docker). Deux options :

### Option A — via GHCR (recommandée, colle au CI existant)

Le workflow GitHub Actions (`.github/workflows/deploy.yml`) build et pousse les **5
images** sur GHCR à chaque push sur `main` (job matriciel), taguées `latest` + `sha-<commit>`.

Le manifest utilise `composmart/<service>:local` (pour k3d). Pour le VPS, générer une
variante pointant vers GHCR avec un `sed` :

```bash
sed -e 's#composmart/\([a-z-]*\):local#ghcr.io/theelse2098/composmart/\1:latest#' \
    -e 's#imagePullPolicy: IfNotPresent#imagePullPolicy: Always#' \
    k8s/composmart.yaml > k8s/composmart.prod.yaml
kubectl apply -f k8s/composmart.prod.yaml
```

Si le dépôt GHCR est privé, créer un secret de pull et le référencer :

```bash
kubectl create secret docker-registry ghcr-creds \
  --docker-server=ghcr.io \
  --docker-username=theelse2098 \
  --docker-password=<TOKEN_GITHUB> \
  -n composmart
# puis ajouter sous spec.template.spec des Deployments :  imagePullSecrets: [{ name: ghcr-creds }]
```

### Option B — build local sur le VPS (sans registry)

Builder avec Docker puis importer dans containerd de k3s :

```bash
for s in web map-api games-api courses-api auth-api evenements-api; do
  docker build -f services/$s/Dockerfile -t composmart/$s:local .
  docker save composmart/$s:local | sudo k3s ctr images import -
done
```
(garder `image: composmart/<service>:local` + `imagePullPolicy: IfNotPresent` dans le manifest)

## 4. Secrets de production

**Ne pas** utiliser le Secret en clair du manifest. Le remplacer par de vraies valeurs :

```bash
kubectl create namespace composmart
kubectl create secret generic composmart-secrets -n composmart \
  --from-literal=DB_NAME=Composmart \
  --from-literal=DB_USER=composmart \
  --from-literal=DB_PASSWORD='<MOT_DE_PASSE_FORT>' \
  --from-literal=DB_ROOT_PASSWORD='<ROOT_FORT>' \
  --from-literal=AUDIT_SECRET='<SECRET_ALEATOIRE>' \
  --from-literal=SMTP_HOST='ssl0.ovh.net' \
  --from-literal=SMTP_PORT='465' \
  --from-literal=SMTP_SECURE='ssl' \
  --from-literal=SMTP_USER='contact@composmart.fr' \
  --from-literal=SMTP_PASSWORD='<MDP_BOITE_MAIL>' \
  --from-literal=MAIL_FROM='contact@composmart.fr'
```

> ⚠️ **Sans les clés `SMTP_*`, aucun mail n'est envoyé** : `send_mail()`
> (`shared/_guard.php`) sort immédiatement si `SMTP_HOST` est vide, sans tenter
> de connexion ni lever d'erreur. C'est silencieux côté utilisateur — seul le
> journal d'audit affiche « Échec » sur les entrées « Email envoyé ».
> Les clés sont déclarées `optional: true` dans le manifest : les pods démarrent
> sans elles, l'envoi est simplement désactivé.
…et retirer le bloc `kind: Secret` du début de `composmart.yaml` (ou le laisser : le
`kubectl create secret` ci-dessus prime s'il est appliqué après — au plus simple,
supprimer le bloc Secret du YAML en prod).

## 5. ConfigMaps (schémas + seeds)

```bash
kubectl create configmap map-schema       --from-file=schema.sql=db/map.sql       -n composmart
kubectl create configmap games-schema     --from-file=schema.sql=db/games.sql     -n composmart
kubectl create configmap core-schema      --from-file=schema.sql=db/core.sql      -n composmart
kubectl create configmap evenements-schema --from-file=schema.sql=db/evenements.sql -n composmart
kubectl create configmap seeds            --from-file=shared/seeds/                -n composmart
```

## 6. Déployer

```bash
kubectl apply -f k8s/composmart.yaml
kubectl get pods -n composmart -w
```

## 7. Domaine + HTTPS

Le manifest a un Ingress sans `host` (catch-all, pratique pour tester par IP).
En production avec `composmart.fr` + TLS Let's Encrypt :

```bash
# Installer cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

Puis ajouter à l'Ingress (`k8s/composmart.yaml`) :

```yaml
metadata:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts: [composmart.fr]
      secretName: composmart-tls
  rules:
    - host: composmart.fr        # ← ajouter le host sur la règle existante
      http: { ... }
```

…et créer un `ClusterIssuer` Let's Encrypt (voir doc cert-manager). Faire pointer
le DNS de `composmart.fr` vers l'IP du VPS.

## 8. Créer l'admin

Une fois `seed-core` terminé (`kubectl get jobs -n composmart`), aller sur le site
→ launchpad → créer l'admin (8 cours / 410 XP).

## Mettre à jour en production

Avec GHCR (option A) :

```bash
git pull                                    # si le manifest a changé
kubectl apply -f k8s/composmart.yaml        # applique les changements de manifest
kubectl rollout restart deployment -n composmart   # recharge les images :latest
kubectl rollout status deployment/map-api -n composmart
```

## Migrations de schéma

`db/*.sql` n'est joué que par **initdb**, c'est-à-dire sur un volume vierge : un
cluster déjà en service ne les rejoue jamais. Toute colonne ou table ajoutée
doit donc passer par un fichier de migration appliqué à la main :

```bash
kubectl -n composmart exec -i db-core-0 -- \
  mariadb -u root -p"$MDP" Composmart < db/migration-2026-08.sql
```

Les migrations sont idempotentes (`IF NOT EXISTS`) : les rejouer ne casse rien.

## Édition des cours depuis le site

Depuis août 2026, le contenu des cours vit en base (`cours_contenu`) et non plus
seulement dans `content/cours/`. Deux conséquences pratiques :

- **`content/` n'est plus la source de vérité**, seulement une graine. Le Job
  `seed-core` (`import_cours.php`) n'écrase jamais un cours déjà présent en base
  — sans quoi un `kubectl apply` de routine annulerait le travail fait depuis
  `/admin/themes`, silencieusement. Pour repartir des fichiers, il faut d'abord
  supprimer le cours en base.
- **Les pages `/admin` sont servies par `courses-api`**, pas par `web` : elles
  passent par un contrôleur qui vérifie la session avant de servir quoi que ce
  soit, et renvoie une 404 indiscernable aux autres. D'où la règle Ingress
  `/admin → courses-api`, à ne pas retirer sous peine de tomber sur le
  catch-all `/ → web` et donc sur une 404 permanente.

Après la migration, relancer le seed pour verser les cours historiques en base :

```bash
kubectl delete job seed-core -n composmart      # les Jobs sont immuables
kubectl apply -f k8s/composmart.yaml
kubectl logs job/seed-core -n composmart -f
```

## Rollback / arrêt

```bash
kubectl rollout undo deployment/<service> -n composmart   # revenir à la version précédente
kubectl delete -f k8s/composmart.yaml                     # tout arrêter
kubectl delete pvc --all -n composmart                    # ⚠️ efface les données
```

> Filet de secours : revenir à `docker-compose.yml` (l'archi microservices
> qui tourne déjà), ou à un commit antérieur via git, si le k3s pose problème.
