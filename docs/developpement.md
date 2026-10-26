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

## Accès libre

Tous les cours publiés et tous les jeux se suivent sans compte. Le compte ne
sert qu'à sauvegarder : progression et XP des cours (`user_progress`,
`xp_log`), scores des jeux (`scores`). Quand un visiteur sans compte termine un
cours, `cours/complete.php` ne garde que le fait qu'il a été terminé, sans
aucune donnée sur la personne : `cours.termine_anonyme` (affiché dans
`/admin/themes`) et le total du jour dans `stats_anonymes` (tableau de bord).
La confirmation de l'email ne conditionne plus l'accès : un compte jamais
confirmé est supprimé au bout de 30 jours (purge RGPD).

## Cours

Les cours s'éditent depuis `/admin` et vivent en base (db-core). Le dossier
`content/cours/<slug>/` (`meta.json`, `texte.md`, `quiz.json`, médias) ne sert
que de graine : le seed l'importe dans une base vierge et n'écrase jamais un
cours existant. Un quiz est validé à partir de 50 % de bonnes réponses.

## Administration

`/admin` est l'accueil du back-office : une tuile par espace, chacun servi et
protégé par son propre service.

| Espace | URL | Service |
|---|---|---|
| Admin panel (signalements, ajouts, messages, comptes, journal) | `/admin/panel` | courses-api |
| Édition des cours | `/admin/themes` | courses-api |
| Édition des jeux | `/jeux-admin` | games-api |
| Event panel | `/evenements-admin` | evenements-api |

### Journal d'activité

Toute action d'administration passe par `audit_log($conn, $action, $details,
$extra)` (`shared/_guard.php`) ; les services sans db-core l'envoient à
auth-api. Le journal se lit dans l'onglet 📜 de `/admin/panel`, une fenêtre de
détail par entrée.

- **Nom de l'action** : `<préfixe>_<verbe>` ; le préfixe range l'action dans
  une catégorie du filtre (`AUDIT_CATEGORIES` dans `tableau-de-bord.html`).
  Ajouter son libellé et son emoji dans `AUDIT_LABELS`, sinon elle s'affiche
  avec ❔ et son code brut.
- **`$details`** : ce qui rend la ligne lisible sans l'ouvrir (titre, nom).
- **Snapshot** (`$extra['snapshot']`) :
  - `changements` : ce qui a changé, via `audit_changements($avant, $apres)`.
    L'état d'avant est lu avant l'écriture, celui d'après relu en base ;
  - `etat` : l'élément entier, à la création et surtout à la suppression (il
    servira à le recréer) ;
  - contenu lourd (texte d'un cours, état complet d'un jeu) : pas dans le
    journal, mais un `version_id` vers `cours_versions` / `jeux_versions`.
- **Annulation** (bouton de la fenêtre de détail) : action `annuler` de
  l'endpoint du service propriétaire (`ANNULATION` dans la page). Le service
  relit l'entrée côté serveur (`audit_annulation_debut()`, via
  `AUDIT_ENTREE_URL` hors db-core), la marque annulée avant d'agir, remet
  l'état d'avant avec `audit_revenir()` — refus si l'élément a bougé depuis —
  puis journalise sa propre action avec `snapshot.annule`. En cas d'échec,
  `audit_annulation_echec()` lève la marque. Une entrée sans `changements`,
  `etat` ni `version_id` n'est pas annulable.

La case rouge « Admin » du bandeau (`partials/site-nav.html`) est révélée par
`assets/js/admin-badge.js` pour les administrateurs ; ce script est inclus en
`?v=N` : incrémenter N dans toutes les pages à chaque modification.

## Jeux

Le contenu (déchets, mots, durées), les règles (nombre par partie, points,
vies, chrono), les textes et les messages de fin des mini-jeux vivent dans la
table `jeux` de db-games et s'éditent depuis `/jeux-admin`. Chaque page
`jeu-<slug>.html` n'est plus qu'une mécanique : elle reçoit son jeu de
`/api/jeux/catalogue.php` via `assets/js/jeu-base.js`.

- **Forme des règles et du contenu** : `services/games-api/jeux/_jeux.php`
  (validation, score maximum déduit des règles). Une nouvelle règle se code
  là, dans la page du jeu et dans l'éditeur (`REGLES`, `CHAMPS` de
  `admin-pages/vues/editeur.html`).
- **Score maximum qui change** : chaque score garde le maximum en vigueur
  lors de la partie (`scores.score_max`) ; records et classements le
  convertissent à la nouvelle échelle à la lecture, rien n'est réécrit. L'XP se
  calcule sur la part du maximum atteinte : un changement de règles ne la
  recrédite pas.
- **Historique** : chaque sauvegarde archive l'état précédent
  (`jeux_versions`, 40 versions par jeu), restaurable depuis l'éditeur.
- On ne crée pas de nouveau jeu depuis l'admin : un jeu est une mécanique
  (page + règles dans `_jeux.php`).
- Les slides « Extrait de jeu » des ateliers importent les éléments via
  `/api/jeux/catalogue.php?action=pools` et les figent dans la slide.

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
