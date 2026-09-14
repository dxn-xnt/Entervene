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
    generation_request_id: str | None = None,
) -> T:
    """Acquire session locks before starting the consistent evidence snapshot.

    The request-key lock also serializes reuse of one key across different
    scopes. Always acquire it first, then the scope lock, to avoid deadlocks.
    """
    lock_key = advisory_lock_key(canonical_prediction_scope(scope, model_name))
    source_bind = bind or engine
    if source_bind.dialect.name != "postgresql":
        with SessionLocal(bind=source_bind) as db, db.begin():
            return operation(db)
    keys = ([advisory_lock_key('prediction-request:' + generation_request_id)] if generation_request_id else []) + [lock_key]
    with source_bind.connect() as connection:
        acquired = []
        try:
            for key in keys:
                connection.execute(text('SELECT pg_advisory_lock(CAST(:key AS bigint))'), {'key': key})
                acquired.append(key)
            connection.commit()  # discard the pre-lock snapshot; session locks survive
            connection.execution_options(isolation_level='REPEATABLE READ')
            with SessionLocal(bind=connection) as db, db.begin():
                # Establish the snapshot at a named boundary, AFTER all locks.
                boundary = db.execute(text('SELECT clock_timestamp(), pg_current_snapshot()::text')).one()
                db.info['prediction_evidence_cutoff_at'] = boundary[0].isoformat()
                db.info['prediction_database_snapshot'] = boundary[1]
                return operation(db)
        finally:
            try:
                connection.rollback()
                for key in reversed(acquired):
                    unlocked = connection.execute(text('SELECT pg_advisory_unlock(CAST(:key AS bigint))'), {'key': key}).scalar()
                    if not unlocked:
                        raise RuntimeError('Prediction advisory lock was not owned during cleanup.')
                connection.commit()
            except BaseException:
                # Discard the physical connection if cleanup cannot be proved.
                connection.invalidate()
                raise
