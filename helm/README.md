# Déploiement Composmart avec Helm

Le chart `helm/composmart/` décrit tout le cluster : Redis, les 4 bases, les
6 services, les tâches planifiées, l'Ingress, les migrations SQL et les tâches
ponctuelles. C'est la seule façon de déployer Composmart (l'ancien manifeste
`k8s/` et le `docker-compose.yml` ont été supprimés, cf. historique git).

## Au quotidien

```bash
cd ~/composmart
git pull
bash helm/deploy.sh
```

C'est tout. Le script :

1. reconstruit **seulement les services dont les fichiers ont changé** et les
   importe dans k3s. Chaque image a un tag calculé sur ses propres fichiers,
   lus dans les `COPY` de son Dockerfile : modifier `shared/_guard.php`
   reconstruit les 5 API qui le copient, modifier `content/` reconstruit web et
   courses-api, modifier la carte ne touche que map-api. Les services
   inchangés gardent leur tag et ne redémarrent pas ;
2. applique les migrations SQL pas encore passées (avant de démarrer le
   nouveau code ; si une migration échoue, rien n'est changé) ;
3. met à jour les services dont l'image ou la configuration a changé ;
4. lance les tâches ponctuelles et affiche leurs journaux.

**Revenir en arrière :** `helm -n composmart rollback composmart` (version
précédente du code et de la configuration).
**Voir l'historique :** `helm -n composmart history composmart`.

## Lancer une tâche ponctuelle

Pas de `kubectl create job` : on l'ajoute dans `helm/values-prod.yaml`.

```yaml
ponctuels:
  purge-essai:
    service: auth-api          # image + variables de ce service
    command: ["php", "/var/www/cron/purge_rgpd.php", "--dry"]
```

Puis `bash helm/deploy.sh` : la tâche tourne à la fin du déploiement et ses
journaux s'affichent. Retirer l'entrée ensuite (sinon elle tourne à chaque
déploiement).

## Ajouter une migration SQL

1. Créer `db/migration-AAAA-MM-description.sql`.
2. **Sa première ligne de commentaire doit nommer la base :**
   `-- MIGRATION db-core — …` (ou `db-map`, `db-games`, `db-evenements`).
3. Reporter le changement dans le schéma initial (`db/core.sql`…) pour les
   installations neuves.
4. `bash helm/deploy.sh`.

Chaque base garde la liste des migrations passées dans sa table
`schema_migrations` : un fichier n'est jamais exécuté deux fois.

## Rejouer les seeds

```bash
bash helm/deploy.sh --set seeds.lancer=true --set seeds.relancer=true
```

(`seed-core` n'écrase jamais un cours déjà en base.)

---

## Mise en place (une seule fois)

### 1. Installer Helm sur le VPS

```bash
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
helm version
```

### Installation sur un serveur neuf

1. Installer k3s et Helm, cloner le dépôt.
2. Créer le Secret (il n'est jamais dans le dépôt) :
   ```bash
   kubectl create namespace composmart
   kubectl create secret generic composmart-secrets -n composmart \
     --from-literal=DB_NAME=Composmart \
     --from-literal=DB_USER=composmart \
     --from-literal=DB_PASSWORD='<MOT_DE_PASSE_FORT>' \
     --from-literal=DB_ROOT_PASSWORD='<ROOT_FORT>' \
     --from-literal=AUDIT_SECRET='<SECRET_ALEATOIRE>' \
     --from-literal=SMTP_HOST='ssl0.ovh.net' --from-literal=SMTP_PORT='465' \
     --from-literal=SMTP_SECURE='ssl' \
     --from-literal=SMTP_USER='contact@composmart.fr' \
     --from-literal=SMTP_PASSWORD='<MDP_BOITE_MAIL>' \
     --from-literal=MAIL_FROM='contact@composmart.fr'
   ```
3. `bash helm/deploy.sh --set seeds.lancer=true` (bases vides → seeds).
4. Créer l'admin via la page launchpad une fois le déploiement terminé.

## Test local (k3d)

```bash
k3d cluster create composmart -p "8080:80@loadbalancer"
# créer le Secret comme ci-dessus (valeurs de test)
K3D=composmart VALUES=helm/values-local.yaml bash helm/deploy.sh
```

Site sur http://localhost:8080.

## Fichiers

| Fichier | Rôle |
|---|---|
| `composmart/values.yaml` | Valeurs par défaut : services, bases, tâches, routes |
| `values-prod.yaml` | Surcharges du VPS (tâches ponctuelles, seeds) |
| `values-local.yaml` | Surcharges k3d (pas de HTTPS) |
| `deploy.sh` | Build + import des images, puis `helm upgrade --install` |

`composmart/files/` est généré par `deploy.sh` (copie de `db/*.sql`) et ignoré
par git : la source reste `db/`.
