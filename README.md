# Composmart

Site web de sensibilisation écologique au compostage : carte interactive des composteurs, système de cours avec quiz, dark mode.

## Stack

- **Frontend** : HTML / CSS / JavaScript + Leaflet.js
- **Backend** : PHP 8.3 (Apache)
- **Base de données** : MariaDB 11
- **CI/CD** : GitHub Actions → GHCR

## Lancer en développement

```bash
cp .env.example .env
docker compose up --build
```

- Site : http://localhost
- Au premier démarrage, la DB est peuplée automatiquement (~45s) : villes open data (Montpellier, Rennes, Marseille) + OSM France (~5 800 composteurs) + cours depuis `content/`
- Les redémarrages suivants sont immédiats (données déjà en base)

## Lancer en production

```bash
# Copier docker-compose.prod.yml, db/schema.sql et .env sur la machine cible
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Structure

```
composmart/
├── front/                  ← Frontend (HTML, CSS, JS, images)
│   ├── *.html              ← Pages (URLs propres via .htaccess)
│   ├── cours-detail.html   ← Page de lecture d'un cours (slug via .htaccess)
│   ├── assets/
│   │   ├── img/            ← Icônes et images
│   │   ├── css/
│   │   │   └── dark.css    ← Overrides dark mode (html.dark)
│   │   ├── js/
│   │   │   └── theme.js    ← Toggle dark/light + persistance localStorage
│   │   └── libs/           ← Plugins Leaflet locaux
│   ├── favicon.svg
│   └── Dockerfile
│
├── api/                    ← Backend PHP
│   ├── carte/
│   │   └── sites.php       ← API CRUD des composteurs
│   ├── cours/
│   │   ├── list.php        ← Retourne thèmes + cours (depuis DB)
│   │   ├── get.php         ← Retourne contenu d'un cours (depuis content/)
│   │   └── complete.php    ← Valide quiz, enregistre progression, crédite XP
│   └── auth/               ← Authentification (à venir)
│
├── db/
│   ├── schema.sql          ← Schéma : themes, cours, composts, users, progression
│   └── seeds/
│       ├── seed.php        ← Script lancé au démarrage (import auto)
│       ├── import_osm.php  ← Import OpenStreetMap (Overpass API)
│       ├── import_city.php ← Import open data villes (formats hétérogènes)
│       ├── import_cours.php← Scan content/cours/*/meta.json → DB (idempotent)
│       ├── montpellier.json
│       ├── rennes.json
│       └── marseille.json
│
└── content/                ← Données éditoriales — bind-monté en dev
    ├── themes/
    │   ├── pratique.json   ← { nom, emoji, couleur, ordre }
    │   └── science.json
    └── cours/
        └── <slug>/
            ├── meta.json   ← titre, theme_slug, emoji, niveau, xp, ordre
            ├── texte.md    ← Contenu Markdown (optionnel)
            ├── video.json  ← { url, titre, auteur, duree, description } (optionnel)
            ├── podcast.json← { url, titre, auteur, duree, description } (optionnel)
            └── quiz.json   ← [{ question, options[], correct }] (optionnel)
```

## Système de cours

Les cours sont définis par des fichiers dans `content/cours/<slug>/`. Au démarrage, `import_cours.php` les importe en base. Les médias manquants (vidéo, podcast) affichent un bouton grisé.

- **URL** : `/cours` → liste, `/cours/<slug>` → détail
- **Médias** : YouTube/Vimeo auto-détecté (iframe embed), fichier direct (`<video>`), podcast (`<audio>`)
- **Quiz** : score minimum 50% pour valider et gagner l'XP

Pour ajouter un cours, créer un dossier dans `content/cours/` et redémarrer — aucun rebuild nécessaire en dev (bind mount).

## Sources de données

| Source | Contenu | Mise à jour |
|---|---|---|
| OpenStreetMap (Overpass) | ~4 500 composteurs France | Automatique au 1er démarrage |
| Open data Montpellier | ~420 points d'apport | Automatique au 1er démarrage |
| Open data Rennes Métropole | ~590 composteurs | Automatique au 1er démarrage |
| Open data Marseille | ~320 composteurs | Automatique au 1er démarrage |
| Ajouts manuels (carte) | Points ajoutés via l'interface | Persistés en base |
| Fichiers `content/` | Cours, thèmes, quiz | Import au démarrage (idempotent) |


## TODO LIST

- User system
- isAdmin dans la table des users
- modifier/supprimer un composter que pour les admins
- système de signalement d'erreur : mauvaise position/mauvais paramètres pour les composters, pour les utilisateurs classiques, et retour visible pour les comptes admins.