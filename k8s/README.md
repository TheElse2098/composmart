# k8s/ — manifests Composmart (SQUELETTE)

> ⚠️ Squelette de référence accompagnant `../MIGRATION-K8S.md`. Les images, endpoints
> `health.php` et ConfigMaps d'init **n'existent pas encore** : ils sont créés aux
> étapes 1-3 du plan de migration. Ne pas appliquer en prod tel quel.

## Contenu

| Fichier | Rôle |
|---|---|
| `namespace.yaml` | Namespace `composmart` |
| `secrets.example.yaml` | Modèle de secrets (1 par base) — copier en `secrets.yaml` (gitignored) |
| `redis.yaml` | Redis (sessions + rate-limit partagés) |
| `db-shared.yaml` | **Variante A** : 1 MariaDB, 3 bases logiques (petit VPS) |
| `db-per-service.yaml` | **Variante B** : 3 StatefulSets MariaDB indépendants |
| `web.yaml` | Front nginx + HPA |
| `map-api.yaml` | `api/carte/*` + HPA (autoscaling prioritaire, max 8) |
| `games-api.yaml` | `api/jeux/*` + HPA |
| `courses-api.yaml` | `api/cours/*` + `api/admin/*` + HPA |
| `auth-api.yaml` | `api/auth/*` + HPA |
| `ingress.yaml` | Traefik, routage par chemin |

Choisir **une seule** variante DB (A *ou* B), pas les deux.

## Ordre d'application (une fois les images construites)

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml          # copié depuis secrets.example.yaml
# ConfigMaps d'init DB (schémas SQL découpés) :
kubectl create configmap mariadb-init --from-file=db/ -n composmart   # variante A
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/db-shared.yaml        # OU db-per-service.yaml
kubectl apply -f k8s/web.yaml -f k8s/map-api.yaml -f k8s/games-api.yaml \
               -f k8s/courses-api.yaml -f k8s/auth-api.yaml
kubectl apply -f k8s/ingress.yaml
kubectl get pods -n composmart -w
```

## Repartir d'une base vide (wipe assumé)

Les `volumeClaimTemplates` des StatefulSets **conservent** les données entre
redéploiements. Pour repartir réellement de zéro (wipe assumé), supprimer les PVC :

```bash
kubectl delete statefulset db-map db-games db-core -n composmart
kubectl delete pvc -l 'app in (db-map,db-games,db-core)' -n composmart
# puis ré-appliquer db-per-service.yaml : les seeds repeuplent au 1er démarrage
```

## Prérequis HPA

Les HorizontalPodAutoscaler ont besoin du **metrics-server** (k3s : `kubectl apply -f`
le manifest officiel ou activé par défaut selon la version). Sans lui, les HPA restent
en `<unknown>/65%`.

## Reste à faire avant application (cf. MIGRATION-K8S.md)

- [ ] Étape 0 : refactor `_guard.php` → Redis (sessions + rate-limit)
- [ ] Étape 1 : 5 Dockerfiles + images GHCR
- [ ] Étape 2 : découper `db/schema.sql` en `map.sql`/`games.sql`/`core.sql`, retirer la FK `scores→users`, dénormaliser `scores.username`
- [ ] Ajouter un `health.php` trivial à chaque API (utilisé par les readinessProbe)
- [ ] Étape 3 : valider sur kind/k3d
- [ ] Étape 4 : migration des données prod + bascule k3s
