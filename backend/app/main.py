from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi import Depends
from app.core.Config import settings
from app.db.Session import get_db
from app.api.v1.routes.Predictions import router as predictions_router
from app.api.v1.routes.Auth import router as auth_router

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(predictions_router, prefix="/api/v1/predictions", tags=["Predictions"])

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "app": settings.app_name, "db": "connected"}
    except Exception as e:
        return {"status": "ok", "app": settings.app_name, "db": "failed", "error": str(e)}