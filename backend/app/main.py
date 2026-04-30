from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.Config import settings
from app.api.v1.routes.Predictions import router as predictions_router

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, settings.mobile_app_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(predictions_router, prefix="/api/v1/predictions", tags=["Predictions"])

@app.get("/health")
def health_check():
    return {"status": "ok", "app": settings.app_name}