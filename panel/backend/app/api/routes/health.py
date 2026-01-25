from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "healthy"}


@router.get("/ready")
async def ready() -> dict:
    return {"status": "ready"}
