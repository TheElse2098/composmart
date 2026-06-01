# Composmart

Site web de sensibilisation écologique avec mini-jeux, cours et carte interactive.

## Stack

- **Frontend** : React + Vite
- **Backend** : Python + FastAPI
- **CI/CD** : GitHub Actions → GHCR

## Lancer en développement

```bash
cp .env.example .env
docker compose up --build
```

- Frontend : http://localhost:5173
- Backend API : http://localhost:8000
- Docs API (Swagger) : http://localhost:8000/docs

## Lancer en production (sur une machine cible)

```bash
# Copier docker-compose.prod.yml et .env sur la machine
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

## Structure

```
app/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout/     # Navbar, Footer…
│   │   │   └── Map/        # Intégration carte externe
│   │   └── pages/          # Home, Carte, Jeux, Cours
│   └── Dockerfile
└── backend/
    ├── app/
    │   ├── main.py
    │   └── routers/        # courses, games, map
    └── Dockerfile
```
