# Notes de développement

Conventions et points de fonctionnement à connaître avant de modifier le
projet. Pour le déploiement, voir [helm/README.md](../helm/README.md).

## Conventions

- **Code partagé** : `shared/_guard.php` est la source unique (sessions, CSRF,
  limitation des abus, audit, emails, suppression et export de compte). Il est
  copié dans chaque image au build ; ne jamais en éditer une copie.
- **Schéma d'une base** : créer `db/migration-AAAA-MM-sujet.sql` dont la
  première ligne de commentaire nomme la base (`-- MIGRATION db-core — …`,
  ou `db-map`, `db-games`, `db-evenements`), et reporter le changement dans le
  schéma initial `db/<base>.sql`. Le déploiement applique chaque migration
  une seule fois.
- **Tâche ponctuelle sur le cluster** : pas de `kubectl` à la main ; une
  entrée `ponctuels:` dans `helm/values-prod.yaml`, puis `bash helm/deploy.sh`.
- **Nouvelle variable d'environnement, nouveau service, tâche planifiée** :
  dans `helm/composmart/values.yaml`.
- **Bibliothèques front** : dans `services/web/front/assets/vendor/<nom>-<version>/`,
  servies localement. Aucun CDN ni Google Fonts (RGPD). Toute nouvelle
  bibliothèque est à ajouter à `THIRD_PARTY_NOTICES.md`.
- **Boîtes de dialogue** : `assets/js/confirmer.js` ou une modale intégrée,
  jamais `alert` / `confirm` / `prompt`.
- **Interface** : mobile d'abord ; sur ordinateur (`assets/css/desktop.css`),
  utiliser la largeur plutôt qu'une colonne étroite centrée.

## Cours

Les cours s'éditent depuis `/admin` et vivent en base (db-core). Le dossier
`content/cours/<slug>/` (`meta.json`, `texte.md`, `quiz.json`, médias) ne sert
que de graine : le seed l'importe dans une base vierge et n'écrase jamais un
cours existant. Un quiz est validé à partir de 50 % de bonnes réponses.

## Données de la carte

| Source | Mise à jour |
|---|---|
| OpenStreetMap (Overpass) | Chaque nuit à 3 h 15 (CronJob `osm-refresh`) |
| Open data Montpellier, Rennes, Marseille | Au premier remplissage de la base |
| Propositions des utilisateurs | En continu, après validation par un administrateur |

## RGPD

- Pages publiques : `/mentions-legales`, `/confidentialite` (dont cookies),
  `/cgu`. **Toute nouvelle donnée collectée** (formulaire, table, service
  externe) doit y être reportée, ainsi que dans le registre des traitements
  tenu hors du dépôt.
- Durées de conservation : `services/auth-api/cron/purge_rgpd.php` et
  `services/evenements-api/cron/purge_rgpd.php`, lancés chaque nuit
  (CronJobs `purge-rgpd-core` et `purge-rgpd-evenements`). Simulation sans
  effacement : option `--dry`, via une tâche ponctuelle.
- Suppression d'un compte : toujours via `supprimer_compte()` (`shared/_guard.php`),
  qui purge aussi les autres bases.
- Export des données : `services/auth-api/auth/export.php` assemble les
  sections des autres services (`*/export.php`). Une nouvelle table contenant
  des données personnelles doit y être ajoutée.
