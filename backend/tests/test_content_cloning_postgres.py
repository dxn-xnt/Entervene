"""Opt-in cloning parity and concurrent acceptance on the guarded disposable DB.

The shared guard accepts only the verified local activity_test target and creates
a unique temporary schema for each test. Nothing runs when its URL is unset.
"""

from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy.orm import Session

from tests import test_content_cloning_contract as cloning_cases
from tests import test_teacher_dashboard_postgres as postgres_guard
from app.models.cloning.ContentCloning import ContentCloneOperation
from app.services.cloning.ContentCloningExecutionService import ContentCloningExecutionService


postgres_dashboard_session = postgres_guard.postgres_dashboard_session
prohibit_external_provider_http = postgres_guard.prohibit_external_provider_http


def _safe_failure(case: str, error: Exception) -> str:
    safe_case = case if case in {"copy", "concurrent"} else "unknown"
    return postgres_guard._safe_failure("cloning parity", error) + f"; case={safe_case}"


@pytest.mark.parametrize("case", ["copy", "concurrent"])
def test_content_cloning_execute_on_guarded_postgres(
    case, postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Real PostgreSQL constraints and row locks; no mocked authorization."""
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch)
            request = cloning_cases._send_full_clone_package(db, scenario)
            if case == "copy":
                operation, replayed = ContentCloningExecutionService.accept_package(
                    db, request_id=request.request_id, actor_staff_id="REQ",
                    expected_version=2, idempotency_key="pg-copy",
                    period_mappings=[],
                )
                assert not replayed
                assert operation.status == "SUCCEEDED"
                assert operation.summary_counts["classwork_count"] == 1
            else:
                # Distinct connections exercise the PostgreSQL row lock and
                # deterministic one-operation-per-request uniqueness.
                bind = db.get_bind()

                def accept(index: int):
                    with Session(
                        bind=bind, autoflush=False, expire_on_commit=False,
                    ) as session:
                        operation, replayed = ContentCloningExecutionService.accept_package(
                            session, request_id=request.request_id,
                            actor_staff_id="REQ", expected_version=2,
                            idempotency_key=f"pg-race-{index}",
                            period_mappings=[],
                        )
                        return operation.operation_id, replayed

                with ThreadPoolExecutor(max_workers=2) as pool:
                    futures = [pool.submit(accept, index) for index in range(2)]
                    results = [future.result(timeout=20) for future in futures]
                assert len({operation_id for operation_id, _ in results}) == 1
                assert sorted(replayed for _, replayed in results) == [False, True]
            db.expire_all()
            assert db.query(ContentCloneOperation).filter(
                ContentCloneOperation.request_id == request.request_id
            ).count() == 1
            db.refresh(request)
            assert request.status == "ACCEPTED"
    except Exception as error:
        pytest.fail(_safe_failure(case, error), pytrace=False)
