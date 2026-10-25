#!/usr/bin/env bash
# ============================================================================
# Déploiement Composmart — une seule commande, à relancer après chaque git pull :
#
#   ./helm/deploy.sh
#
# 1. reconstruit et importe dans k3s SEULEMENT les images dont les fichiers
#    ont changé (tag par service, dépendances lues dans les Dockerfile) ;
#    les services inchangés ne sont pas redémarrés ;
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

# ── Tag des images : un par service, d'après SES fichiers ─────────────────
# Entrées d'une image = son Dockerfile + toutes les sources de ses COPY, lues
# DANS le Dockerfile (jamais une liste tenue à la main, qui finirait par
# oublier un fichier partagé). Exemple : shared/_guard.php est copié par 5
# images → le modifier reconstruit ces 5 services, et eux seuls ; content/
# reconstruit web et courses-api. Les « COPY --from=… » (étapes de build ou
# images externes) ne sont pas des fichiers du dépôt et sont ignorés.
entrees() {
  local df="services/$1/Dockerfile"
  echo "$df"
  grep -E '^[[:space:]]*COPY[[:space:]]' "$df" | grep -v -- '--from=' \
    | awk '{ for (i = 2; i < NF; i++) if ($i !~ /^--/) print $i }' \
    | sed 's#/$##' | sort -u
}

# Empreinte git des fichiers d'entrée : identique tant qu'ils ne changent
# pas, quel que soit le nombre de commits. Un service inchangé garde donc son
# tag : ni reconstruit, ni redémarré. Modifications non commitées : prises en
# compte via le diff et les fichiers non suivis.
tag_service() {
  local chemins; chemins=$(entrees "$1")
  {
    for p in $chemins; do git rev-parse "HEAD:$p"; done
    if [ -n "$(git status --porcelain -- $chemins)" ]; then
      git diff HEAD -- $chemins
      git ls-files --others --exclude-standard -- $chemins | xargs -r cat
    fi
  } | sha1sum | cut -c1-12
}

# Liste des images k3s lue UNE fois. Surtout pas « ctr images ls | grep -q » :
# grep -q quitte au premier résultat, ctr reçoit SIGPIPE et sort en erreur,
# que pipefail transforme en « image absente » → reconstruction inutile,
# au hasard selon la place de l'image dans la liste.
IMAGES_K3S=""
[ -z "${K3D:-}" ] && IMAGES_K3S=$($SUDO k3s ctr images ls -q)

image_presente() {
  if [ -n "${K3D:-}" ]; then docker image inspect "composmart/$1:$2" >/dev/null 2>&1
  else grep -qx "docker.io/composmart/$1:$2" <<< "$IMAGES_K3S"; fi
}

# ── 1. Images (seulement celles dont les fichiers ont changé) ─────────────
TAGS_HELM=()
for s in $SERVICES; do
  t=$(tag_service "$s")
  TAGS_HELM+=(--set "image.tags.$s=$t")
  if image_presente "$s" "$t"; then
    echo "  ✓ $s : inchangé ($t)"
    continue
  fi
  echo "  ⚙ $s : modifié, construction ($t)…"
  local_modifs=$(git status --porcelain -- $(entrees "$s"))
  if [ -n "$local_modifs" ]; then
    echo "    ↳ dont des fichiers modifiés sur cette machine, non commités :"
    echo "$local_modifs" | sed 's/^/      /'
  fi
  docker build --pull -q -t "composmart/$s:$t" -f "services/$s/Dockerfile" . >/dev/null
  if [ -n "${K3D:-}" ]; then k3d image import -c "$K3D" "composmart/$s:$t"
  else docker save "composmart/$s:$t" | $SUDO k3s ctr images import - >/dev/null; fi
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
  "${TAGS_HELM[@]}" \
  --wait --timeout 15m \
  "$@"

# ── 4. Journaux ────────────────────────────────────────────────────────────
echo "▶ Migrations :"
kubectl -n "$NS" logs job/migrations 2>/dev/null | sed 's/^/  /' || echo "  (aucune exécution)"

if kubectl -n "$NS" get jobs -l composmart.fr/ponctuel=true -o name 2>/dev/null | grep -q .; then
  echo "▶ Tâches ponctuelles :"
  kubectl -n "$NS" logs -l composmart.fr/ponctuel=true --prefix --tail=-1 | sed 's/^/  /'
fi

echo "✔ Déployé. Historique : helm -n $NS history $RELEASE — retour arrière : helm -n $NS rollback $RELEASE"
