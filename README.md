# Composmart

Site web de sensibilisation écologique avec carte interactive des composteurs, mini-jeux et cours.

## Stack

- **Frontend** : HTML / CSS / JavaScript + Leaflet.js
- **Backend** : PHP 8.3 (Apache)
- **Base de données** : MariaDB 11
- **CI/CD** : GitHub Actions → GHCR

## Lancer en développement

```bash
cp .env.example .env
# Éditer .env si besoin
docker compose up --build
```

- Site : http://localhost

> La base de données est initialisée automatiquement depuis `db/init.sql` au premier démarrage.

## Lancer en production (sur une machine cible)

```bash
# Copier docker-compose.prod.yml, db/init.sql et .env sur la machine
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Structure

```
app/
└── web/
    ├── index.html       # Accueil
    ├── carte.html       # Carte interactive (Leaflet)
    ├── cours.html       # Les cours
    ├── parcours.html    # Mes parcours
    ├── compte.html      # Mon compte
    ├── materiel.html    # Le matériel
    ├── achat.html       # Achat
    ├── sites1.php       # API PHP (CRUD composts ↔ MariaDB)
    ├── leaflet/         # Plugins Leaflet locaux (fullscreen, shpfile)
    └── Dockerfile
db/
└── init.sql             # Schéma + données initiales
```
