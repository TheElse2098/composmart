# Composmart

Site web de sensibilisation écologique au compostage : carte interactive des composteurs, mini-jeux et cours.

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
- Au premier démarrage, la DB est peuplée automatiquement (~45s) : villes open data (Montpellier, Rennes, Marseille) + OSM France (~5 800 composteurs)
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
│   ├── assets/
│   │   ├── img/            ← Icônes et images
│   │   ├── css/
│   │   └── libs/           ← Plugins Leaflet locaux
│   └── Dockerfile
│
├── api/                    ← Backend PHP
│   └── carte/
│       └── sites.php       ← API CRUD des composteurs
│
├── db/
│   ├── schema.sql          ← Schéma : composts, users, progression, scores
│   └── seeds/
│       ├── seed.php        ← Script lancé au démarrage (import auto)
│       ├── import_osm.php  ← Import OpenStreetMap (Overpass API)
│       ├── import_city.php ← Import open data villes (formats hétérogènes)
│       ├── montpellier.json
│       ├── rennes.json
│       └── marseille.json
│
└── content/                ← Données éditoriales (cours, jeux) — à alimenter
    ├── cours/
    └── jeux/
```

## Sources de données

| Source | Contenu | Mise à jour |
|---|---|---|
| OpenStreetMap (Overpass) | ~4 500 composteurs France | Automatique au 1er démarrage |
| Open data Montpellier | ~420 points d'apport | Automatique au 1er démarrage |
| Open data Rennes Métropole | ~590 composteurs | Automatique au 1er démarrage |
| Open data Marseille | ~320 composteurs | Automatique au 1er démarrage |
| Ajouts manuels (carte) | Points ajoutés via l'interface | Persistés en base |
