import os
from sqlalchemy import CheckConstraint

# Do not inject a fictional PostgreSQL credential here.  Integration tests use
# the configured DATABASE_URL (or an explicitly supplied TEST_DATABASE_URL),
# while ordinary unit tests construct isolated SQLite engines themselves.
if os.getenv("TEST_DATABASE_URL"):
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
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
