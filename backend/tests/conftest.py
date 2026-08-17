import os
from sqlalchemy import CheckConstraint

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/entervene_test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-with-at-least-32-characters")
os.environ.setdefault("COOKIE_SECURE", "false")

try:
    from app.models.people.Student import Student
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
except Exception:
    pass
