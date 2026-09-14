"""PostgreSQL transaction boundary for one logical prediction generation.

The request-scoped FastAPI session may already have started a transaction in a
dependency.  A separate session bound to a REPEATABLE READ engine is therefore
required to guarantee that the complete evidence read and persistence use one
snapshot.
"""

from __future__ import annotations

from collections.abc import Callable
from hashlib import sha256
from typing import Any, TypeVar
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Connectable
from sqlalchemy.orm import Session

from app.db.Session import SessionLocal, engine


T = TypeVar("T")
_SCOPE_FIELDS = (
    "student_id",
    "class_id",
    "subject_id",
    "source_period_id",
    "target_period_id",
)
_LOCK_NAMESPACE = "entervene:prediction-generation:v1"


def canonical_prediction_scope(scope: dict[str, Any], model_name: str) -> str:
    """Return a canonical, delimiter-safe logical scope representation."""
    missing = [field for field in _SCOPE_FIELDS if scope.get(field) is None]
    if missing:
        raise ValueError(f"Prediction generation scope is missing: {', '.join(missing)}")
    try:
        student_id = UUID(str(scope["student_id"]))
        class_id = int(scope["class_id"])
        subject_id = int(scope["subject_id"])
        source_period_id = int(scope["source_period_id"])
        target_period_id = int(scope["target_period_id"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Prediction generation scope contains invalid identifiers.") from exc
    if min(class_id, subject_id, source_period_id, target_period_id) < 1:
        raise ValueError("Prediction generation scope identifiers must be positive.")
    return "|".join(
        (
            _LOCK_NAMESPACE,
            str(student_id),
            str(class_id),
            str(subject_id),
            str(source_period_id),
            str(target_period_id),
            model_name.strip(),
        )
    )


def advisory_lock_key(canonical_scope: str) -> int:
    """Derive PostgreSQL's signed 64-bit advisory-lock key from SHA-256."""
    digest = sha256(canonical_scope.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def run_prediction_generation_transaction(
    scope: dict[str, Any],
    model_name: str,
    operation: Callable[[Session], T],
    bind: Connectable | None = None,
) -> T:
    """Serialize one scope and run all reads/writes in one repeatable snapshot."""
    lock_key = advisory_lock_key(canonical_prediction_scope(scope, model_name))
    source_bind = bind or engine
    if source_bind.dialect.name == "postgresql":
        transaction_bind = source_bind.execution_options(isolation_level="REPEATABLE READ")
    else:
        # Unit tests use an in-memory SQLite session. Production startup is
        # PostgreSQL-only for this path; SQLite cannot exercise advisory locks.
        transaction_bind = source_bind
    db = SessionLocal(bind=transaction_bind)
    try:
        with db.begin():
            if source_bind.dialect.name == "postgresql":
                # This is deliberately the first SQL statement in the transaction.
                # pg_advisory_xact_lock is released automatically on commit/rollback.
                db.execute(
                    text("SELECT pg_advisory_xact_lock(CAST(:lock_key AS bigint))"),
                    {"lock_key": lock_key},
                )
            return operation(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
