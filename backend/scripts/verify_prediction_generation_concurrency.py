"""Read-only verification of Phase 1 advisory-lock transaction behavior.

Run from ``backend`` as ``python -m scripts.verify_prediction_generation_concurrency``
with the normal application database configuration. The script creates no
application rows; it only opens transactions and takes an advisory lock that
PostgreSQL releases on commit/rollback.
"""

from __future__ import annotations

import threading
from uuid import uuid4

from sqlalchemy import text

from app.services.prediction.PredictionGenerationTransaction import (
    run_prediction_generation_transaction,
)


scope = {
    "student_id": uuid4(),
    "class_id": 1,
    "subject_id": 2,
    "source_period_id": 3,
    "target_period_id": 4,
}
first_entered = threading.Event()
release_first = threading.Event()
second_entered = threading.Event()
errors: list[Exception] = []
order: list[str] = []


def first_operation(db):
    assert db.execute(text("SHOW transaction_isolation")).scalar() == "repeatable read"
    first_entered.set()
    assert release_first.wait(timeout=10)
    order.append("first")


def second_operation(db):
    assert db.execute(text("SHOW transaction_isolation")).scalar() == "repeatable read"
    second_entered.set()
    order.append("second")


def run(operation):
    try:
        run_prediction_generation_transaction(scope, "verification", operation)
    except Exception as exc:  # pragma: no cover - command-line diagnostic
        errors.append(exc)


first = threading.Thread(target=run, args=(first_operation,))
second = threading.Thread(target=run, args=(second_operation,))
first.start()
if not first_entered.wait(timeout=10):
    raise RuntimeError(f"First transaction did not enter: {errors!r}")
second.start()
if second_entered.wait(timeout=0.25):
    raise RuntimeError("Same-scope generation was not serialized")
release_first.set()
first.join(timeout=10)
second.join(timeout=10)
if errors or order != ["first", "second"]:
    raise RuntimeError(f"Unexpected advisory-lock result: order={order!r}, errors={errors!r}")


class ExpectedRollback(Exception):
    pass


try:
    run_prediction_generation_transaction(
        scope,
        "verification",
        lambda _db: (_ for _ in ()).throw(ExpectedRollback()),
    )
except ExpectedRollback:
    pass
else:
    raise RuntimeError("Rollback verification did not raise its expected exception")

assert run_prediction_generation_transaction(scope, "verification", lambda _db: "released") == "released"
print("Prediction generation advisory-lock verification passed.")
