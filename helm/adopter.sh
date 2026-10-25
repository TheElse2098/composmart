#!/usr/bin/env bash
# ============================================================================
# À LANCER UNE SEULE FOIS, sur le VPS, avant le premier ./helm/deploy.sh.
#
# Le cluster a été monté avec « kubectl apply -f k8s/composmart.yaml ». Helm
# refuse de toucher à des ressources qu'il n'a pas créées : ce script les lui
# confie (annotations meta.helm.sh/*), sans rien recréer ni redémarrer.
# Les bases et leurs volumes restent en place, aucune donnée n'est touchée.
#
#   ./helm/adopter.sh
# ============================================================================
set -euo pipefail

NS=composmart
RELEASE=composmart

if [ -z "${KUBECONFIG:-}" ]; then
  if [ -f "$HOME/.kube/config" ]; then export KUBECONFIG="$HOME/.kube/config"
  else export KUBECONFIG=/etc/rancher/k3s/k3s.yaml; fi
fi

# Ressources désormais décrites par le chart.
RESSOURCES="
deployment/redis service/redis
statefulset/db-map statefulset/db-games statefulset/db-core statefulset/db-evenements
service/db-map service/db-games service/db-core service/db-evenements
configmap/map-schema configmap/games-schema configmap/core-schema configmap/evenements-schema
cronjob/osm-refresh cronjob/purge-rgpd-core cronjob/purge-rgpd-evenements
ingress/composmart
"
for svc in web map-api games-api courses-api auth-api evenements-api; do
  RESSOURCES="$RESSOURCES deployment/$svc service/$svc"
  [ "$svc" != web ] && RESSOURCES="$RESSOURCES horizontalpodautoscaler/$svc"
done

for r in $RESSOURCES; do
  if kubectl -n "$NS" get "$r" >/dev/null 2>&1; then
    kubectl -n "$NS" annotate --overwrite "$r" \
      meta.helm.sh/release-name="$RELEASE" meta.helm.sh/release-namespace="$NS" >/dev/null
    kubectl -n "$NS" label --overwrite "$r" app.kubernetes.io/managed-by=Helm >/dev/null
    echo "  ✓ $r"
  else
    echo "  – $r (absente, Helm la créera)"
  fi
done

# Anciens Jobs de seed (ils ne sont plus relancés en prod) et ConfigMap des
# seeds (les scripts sont maintenant lus dans les images).
kubectl -n "$NS" delete job seed-map seed-core --ignore-not-found
kubectl -n "$NS" delete configmap seeds --ignore-not-found

echo "✔ Ressources confiées à Helm. Étape suivante : ./helm/deploy.sh"
