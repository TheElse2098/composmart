# Déploiement Kubernetes — Composmart

Manifest unique : **`composmart.yaml`** (variante B, 3 bases séparées), aligné sur
`docker-compose.split.yml`. Conçu pour tester en local sur **k3d** (k3s dans Docker,
même moteur que le VPS) avant tout déploiement réel.

> Les anciens fichiers éclatés (`web.yaml`, `map-api.yaml`, `db-per-service.yaml`, …)
> sont conservés comme référence historique mais **`composmart.yaml` fait foi**.

## Prérequis (machine locale)

- Docker Desktop
- `k3d`  : https://k3d.io  (`choco install k3d` sous Windows)
- `kubectl` : `choco install kubernetes-cli`

## 1. Créer le cluster local

```bash
# Cluster k3d avec le port 80 mappé vers l'Ingress Traefik (loadbalancer)
k3d cluster create composmart -p "8080:80@loadbalancer"
kubectl config use-context k3d-composmart
```

Le site sera accessible sur **http://localhost:8080**.

## 2. Builder les 5 images et les importer dans k3d

```bash
# Depuis la racine du repo (où sont les Dockerfiles services/*)
docker build -f services/web/Dockerfile         -t composmart/web:local .
docker build -f services/map-api/Dockerfile      -t composmart/map-api:local .
docker build -f services/games-api/Dockerfile    -t composmart/games-api:local .
docker build -f services/courses-api/Dockerfile  -t composmart/courses-api:local .
docker build -f services/auth-api/Dockerfile     -t composmart/auth-api:local .

# Importer les images dans le cluster (sinon k3d ne les voit pas)
k3d image import -c composmart \
  composmart/web:local composmart/map-api:local composmart/games-api:local \
  composmart/courses-api:local composmart/auth-api:local
```

## 3. Créer le namespace + les ConfigMaps de schémas et seeds

```bash
kubectl create namespace composmart

kubectl create configmap map-schema   --from-file=schema.sql=db/map.sql   -n composmart
kubectl create configmap games-schema --from-file=schema.sql=db/games.sql -n composmart
kubectl create configmap core-schema  --from-file=schema.sql=db/core.sql  -n composmart
kubectl create configmap seeds        --from-file=shared/seeds/            -n composmart
```

## 4. Déployer

```bash
kubectl apply -f k8s/composmart.yaml
kubectl get pods -n composmart -w
```

Ordre d'arrivée attendu : redis + les 3 bases (Healthy ~30 s), puis les Jobs seed
(`seed-map` importe ~5800 composts, `seed-core` les cours), puis les 5 services.

## 5. Créer l'admin

Une fois `seed-core` terminé (`kubectl get jobs -n composmart` → seed-core Complete),
aller sur http://localhost:8080 → page launchpad → créer l'admin (il aura les 8 cours / 410 XP).

> ⚠️ Créer l'admin AVANT la fin de seed-core donnerait un admin à 0 XP (cf. bug timing).

## Vérifications

```bash
kubectl get pods -n composmart           # tous Running / Ready
kubectl get hpa  -n composmart           # autoscalers (nécessite metrics-server, inclus dans k3d)
curl -s localhost:8080/api/carte/health.php   # {"status":"ok"}
curl -s localhost:8080/api/carte/sites.php -d 'france=1' | head -c 120
```

## Repartir de zéro

```bash
kubectl delete -f k8s/composmart.yaml
kubectl delete pvc --all -n composmart   # efface les données (wipe)
# ou jeter tout le cluster :
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
for s in web map-api games-api courses-api auth-api; do
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
  --from-literal=AUDIT_SECRET='<SECRET_ALEATOIRE>'
```
…et retirer le bloc `kind: Secret` du début de `composmart.yaml` (ou le laisser : le
`kubectl create secret` ci-dessus prime s'il est appliqué après — au plus simple,
supprimer le bloc Secret du YAML en prod).

## 5. ConfigMaps (schémas + seeds)

```bash
kubectl create configmap map-schema   --from-file=schema.sql=db/map.sql   -n composmart
kubectl create configmap games-schema --from-file=schema.sql=db/games.sql -n composmart
kubectl create configmap core-schema  --from-file=schema.sql=db/core.sql  -n composmart
kubectl create configmap seeds        --from-file=shared/seeds/            -n composmart
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

## Rollback / arrêt

```bash
kubectl rollout undo deployment/<service> -n composmart   # revenir à la version précédente
kubectl delete -f k8s/composmart.yaml                     # tout arrêter
kubectl delete pvc --all -n composmart                    # ⚠️ efface les données
```

> Garder l'ancien `docker-compose.prod.yml` comme filet de secours tant que le k3s
> n'est pas éprouvé : en cas de souci, on peut revenir au monolithe en quelques minutes.
