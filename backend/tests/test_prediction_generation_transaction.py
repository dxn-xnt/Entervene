from __future__ import annotations

import threading
import os
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.db.Session import engine
from app.services.prediction.PredictionGenerationTransaction import (
    advisory_lock_key,
    canonical_prediction_scope,
    run_prediction_generation_transaction,
)


pytestmark = pytest.mark.skipif(
    engine.dialect.name != "postgresql" or os.getenv("RUN_POSTGRES_CONCURRENCY_TESTS") != "1",
    reason="Set RUN_POSTGRES_CONCURRENCY_TESTS=1 against a provisioned PostgreSQL database.",
)


def _scope() -> dict[str, object]:
    return {
        "student_id": uuid4(),
        "class_id": 1,
        "subject_id": 2,
        "source_period_id": 3,
        "target_period_id": 4,
    }


def test_scope_key_is_deterministic_and_separates_different_scopes():
    scope = _scope()
    first = canonical_prediction_scope(scope, "grade_prediction")
    second = canonical_prediction_scope({**scope}, "grade_prediction")
    other = canonical_prediction_scope({**scope, "subject_id": 99}, "grade_prediction")

    assert advisory_lock_key(first) == advisory_lock_key(second)
    assert advisory_lock_key(first) != advisory_lock_key(other)


def test_generation_transaction_serializes_same_scope_and_releases_after_rollback():
    scope = _scope()
    first_entered = threading.Event()
    release_first = threading.Event()
    second_entered = threading.Event()
    errors: list[Exception] = []
    order: list[str] = []

    def first_operation(db):
        assert db.execute(text("SHOW transaction_isolation")).scalar() == "repeatable read"
        first_entered.set()
        assert release_first.wait(timeout=5)
        order.append("first")

    def second_operation(db):
        assert db.execute(text("SHOW transaction_isolation")).scalar() == "repeatable read"
        second_entered.set()
        order.append("second")

    def run_first():
        try:
            run_prediction_generation_transaction(scope, "grade_prediction", first_operation)
        except Exception as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    def run_second():
        try:
            run_prediction_generation_transaction(scope, "grade_prediction", second_operation)
        except Exception as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    first = threading.Thread(target=run_first)
    second = threading.Thread(target=run_second)
    first.start()
    if not first_entered.wait(timeout=5):
        pytest.fail(f"First generation did not enter its transaction: {errors!r}")
    second.start()
    assert not second_entered.wait(timeout=0.25)
    release_first.set()
    first.join(timeout=5)
    second.join(timeout=5)

    assert not errors
    assert order == ["first", "second"]

    class ExpectedRollback(Exception):
        pass

    with pytest.raises(ExpectedRollback):
        run_prediction_generation_transaction(
            scope,
            "grade_prediction",
            lambda _db: (_ for _ in ()).throw(ExpectedRollback()),
        )

    # If rollback retained the xact lock, this call would block indefinitely.
    assert run_prediction_generation_transaction(scope, "grade_prediction", lambda _db: "released") == "released"
