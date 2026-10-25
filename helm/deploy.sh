#!/usr/bin/env bash
# ============================================================================
# Déploiement Composmart — une seule commande, à relancer après chaque git pull :
#
#   ./helm/deploy.sh
#
# 1. construit les images du commit courant (seulement celles qui manquent),
#    et les importe dans k3s ;
# 2. copie db/*.sql dans le chart (Helm ne lit pas hors de son dossier) ;
# 3. helm upgrade --install : met à jour ce qui a changé, applique les
#    migrations SQL en attente, lance les tâches ponctuelles ;
# 4. affiche les journaux des tâches ponctuelles.
#
# Variables optionnelles :
#   VALUES=helm/values-local.yaml   fichier de valeurs (défaut : values-prod.yaml)
#   K3D=composmart                  cluster k3d local : import via « k3d image import »
#   Arguments supplémentaires transmis à helm (ex. --set seeds.relancer=true).
# ============================================================================
set -euo pipefail

RACINE=$(cd "$(dirname "$0")/.." && pwd)
cd "$RACINE"

NS=composmart
RELEASE=composmart
CHART=helm/composmart
VALUES=${VALUES:-helm/values-prod.yaml}
SERVICES="web map-api games-api courses-api auth-api evenements-api"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO=sudo

if [ -z "${KUBECONFIG:-}" ]; then
  if [ -f "$HOME/.kube/config" ]; then export KUBECONFIG="$HOME/.kube/config"
  else export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; fi
fi

# ── Tag des images = commit courant ────────────────────────────────────────
# Un tag qui change à chaque commit fait redémarrer les pods concernés, et
# `helm rollback` ramène réellement l'ancienne image. Modifications locales
# non commitées : suffixe calculé sur le diff (stable tant qu'il ne change pas).
TAG=$(git rev-parse --short=10 HEAD)
if ! git diff --quiet HEAD -- services shared content; then
  TAG="$TAG-local-$(git diff HEAD -- services shared content | sha1sum | cut -c1-8)"
fi
echo "▶ Tag des images : $TAG"

# ── 1. Images ──────────────────────────────────────────────────────────────
image_presente() {
  if [ -n "${K3D:-}" ]; then docker image inspect "composmart/$1:$TAG" >/dev/null 2>&1
  else $SUDO k3s ctr images ls -q | grep -qx "docker.io/composmart/$1:$TAG"; fi
}
for s in $SERVICES; do
  if image_presente "$s"; then
    echo "  ✓ $s : déjà construite"
    continue
  fi
  echo "  ⚙ $s : construction…"
  docker build --pull -q -t "composmart/$s:$TAG" -f "services/$s/Dockerfile" . >/dev/null
  if [ -n "${K3D:-}" ]; then k3d image import -c "$K3D" "composmart/$s:$TAG"
  else docker save "composmart/$s:$TAG" | $SUDO k3s ctr images import - >/dev/null; fi
done

# ── 2. Fichiers SQL embarqués dans le chart ────────────────────────────────
rm -rf "$CHART/files"
mkdir -p "$CHART/files/db"
find db -maxdepth 1 -type f -name '*.sql' -exec cp {} "$CHART/files/db/" \;

# ── 3. Helm ────────────────────────────────────────────────────────────────
# Les tâches ponctuelles du déploiement précédent sont retirées : seules
# celles listées aujourd'hui tournent et affichent leurs journaux.
kubectl -n "$NS" delete jobs -l composmart.fr/ponctuel=true --ignore-not-found >/dev/null 2>&1 || true

echo "▶ helm upgrade --install ($VALUES)"
helm upgrade --install "$RELEASE" "$CHART" \
  -n "$NS" --create-namespace \
  -f "$VALUES" \
  --set image.tag="$TAG" \
  --wait --timeout 15m \
  "$@"

# ── 4. Journaux ────────────────────────────────────────────────────────────
echo "▶ Migrations :"
kubectl -n "$NS" logs job/migrations 2>/dev/null | sed 's/^/  /' || echo "  (aucune exécution)"

if kubectl -n "$NS" get jobs -l composmart.fr/ponctuel=true -o name 2>/dev/null | grep -q .; then
  echo "▶ Tâches ponctuelles :"
  kubectl -n "$NS" logs -l composmart.fr/ponctuel=true --prefix --tail=-1 | sed 's/^/  /'
fi

echo "✔ Déployé (tag $TAG). Historique : helm -n $NS history $RELEASE — retour arrière : helm -n $NS rollback $RELEASE"
