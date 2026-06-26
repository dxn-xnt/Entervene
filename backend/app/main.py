from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
from fastapi import Depends
from app.core.Config import settings
from app.core.Csrf import CSRFMiddleware
from app.db.Session import get_db
from app.api.v1.routes.Predictions import router as predictions_router
from app.api.v1.routes.Auth import router as auth_router
from app.api.v1.routes.Students import router as students_router
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Lessons import router as lessons_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.api.v1.routes.Suggestions import router as suggestions_router
from app.api.v1.routes.Users import router as users_router
from app.api.v1.routes.Classes import router as classes_router
from app.services.classes.ClassShared import ClassManagementError, class_management_error_handler

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(CSRFMiddleware)
app.add_exception_handler(ClassManagementError, class_management_error_handler)

# Cannot use allow_origins=["*"] with allow_credentials=True (browser rejects).
# List common dev origins + regex for LAN (Expo) so preflight/login always get CORS headers.
_CORS_DEV_ORIGINS = [ 
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://localhost:8082",
    "http://127.0.0.1:19006",
    "http://localhost:5173",
    # "http://192.168.1.119:8081",
    # "http://192.168.1.119:8000",
    "http://192.168.56.1:8081",
    "http://192.168.56.1:8000",
    "http://10.32.177.70:8081",

]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_DEV_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router,        prefix="/api/v1/auth",                 tags=["Auth"])
app.include_router(users_router,       prefix="/api/v1",                      tags=["Users"])
app.include_router(predictions_router, prefix="/api/v1/predictions",           tags=["Predictions"])
app.include_router(students_router,    prefix="/api/v1/students",              tags=["Students"])
app.include_router(
    classworks_router,
    prefix="/api/v1/classwork-assignments",
    tags=["Classwork"],
)
app.include_router(lessons_router,     prefix="/api/v1/lessons",               tags=["Lessons"])
app.include_router(submissions_router, prefix="/api/v1/submissions",           tags=["Submissions"])
app.include_router(quizzes_router,     prefix="/api/v1/quizzes",               tags=["Quizzes"])
app.include_router(suggestions_router, prefix="/api/v1/suggestions",           tags=["Suggestions"])
app.include_router(classes_router,     prefix="/api/v1/classes",               tags=["Classes"])

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "app": settings.app_name, "db": "connected"}
    except Exception as e:
        return {"status": "ok", "app": settings.app_name, "db": "failed", "error": str(e)}
