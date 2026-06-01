from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import courses, games, map

app = FastAPI(title="Composmart API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(courses.router, prefix="/api/courses", tags=["courses"])
app.include_router(games.router, prefix="/api/games", tags=["games"])
app.include_router(map.router, prefix="/api/map", tags=["map"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
