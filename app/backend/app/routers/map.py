from fastapi import APIRouter

router = APIRouter()


@router.get("/data")
def get_map_data():
    return {"features": []}
