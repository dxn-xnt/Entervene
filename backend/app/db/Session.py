from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import OperationalError, ProgrammingError
from app.core.Config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        # Effective-dated bell-schedule replacements activate on the first
        # request at or after their date. Import lazily to keep model startup
        # ordering and migration commands free of service-level cycles.
        try:
            from app.services.academic.PeriodTemplateRevisionService import PeriodTemplateRevisionService
            PeriodTemplateRevisionService.activate_due_revisions(db)
        except (OperationalError, ProgrammingError):
            # Deployments may serve briefly while a migration is pending, and
            # narrow unit-test schemas intentionally omit unrelated tables.
            db.rollback()
        yield db
    finally:
        db.close()
