"""Opt-in cloning parity, concurrency, idempotency, and rollback on guarded disposable PostgreSQL.

The shared guard accepts only the verified local activity_test target on port 55432
and creates a unique temporary schema for each test. Nothing runs when its URL is unset.
"""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.classwork.Classwork import Classwork
from app.models.cloning.ContentCloning import (
    ContentCloneOperation,
    ContentSharePackage,
    ContentShareRequest,
)
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.notifications.Notification import Notification
from app.schemas.ContentCloning import PackageDecision, PackageDecisionRequest
from app.services.cloning.ContentCloningErrors import ContentCloningError
from app.services.cloning.ContentCloningExecutionService import ContentCloningExecutionService
from app.services.cloning.ContentCloningPackageService import ContentCloningPackageService
from app.services.cloning.ContentCloningRequestService import ContentCloningRequestService
from tests import test_content_cloning_contract as cloning_cases
from tests import test_teacher_dashboard_postgres as postgres_guard

postgres_dashboard_session = postgres_guard.postgres_dashboard_session
prohibit_external_provider_http = postgres_guard.prohibit_external_provider_http


def _safe_failure(case: str, error: Exception) -> str:
    safe_case = case if case in {
        "copy", "concurrent_accept", "concurrent_create", "accept_decline_race",
        "idempotency_retry", "failure_rollback"
    } else "unknown"
    return postgres_guard._safe_failure("cloning parity", error) + f"; case={safe_case}"


def _sync_postgres_sequences(db: Session):
    """Synchronize PostgreSQL sequences after inserting manual fixture IDs."""
    tables = [
        ("competency", "competency_id"),
        ("lesson", "lesson_id"),
        ("classwork", "classwork_id"),
        ("quiz", "quiz_id"),
        ("question", "question_id"),
        ("question_option", "option_id"),
        ("classwork_assignment", "classwork_assignment_id"),
        ("activity_rubric_level", "rubric_level_id"),
        ("classwork_coverage", "coverage_id"),
        ("content_clone_operation", "operation_id"),
        ("content_share_event", "event_id"),
        ("content_share_package_item", "package_item_id"),
        ("notification", "notification_id"),
    ]
    for tbl, col in tables:
        db.execute(text(f"""
            DO $$
            DECLARE seq text;
            BEGIN
                seq := pg_get_serial_sequence('{tbl}', '{col}');
                IF seq IS NOT NULL THEN
                    PERFORM setval(seq, COALESCE((SELECT MAX({col}) FROM {tbl}), 1));
                END IF;
            END $$;
        """))
    db.commit()


def test_content_cloning_single_copy_on_guarded_postgres(
    postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Scenario 1A: Single copy parity on real PostgreSQL."""
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch_ctx:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch_ctx)
            request = cloning_cases._send_full_clone_package(db, scenario)
            _sync_postgres_sequences(db)

            # Baseline counts
            lessons_before = db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count()
            classworks_before = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count()
            notifs_before = db.query(Notification).count()

            operation, replayed = ContentCloningExecutionService.accept_package(
                db, request_id=request.request_id, actor_staff_id="REQ",
                expected_version=2, idempotency_key="pg-copy-single",
                period_mappings=[],
            )

            assert not replayed
            assert operation.status == "SUCCEEDED"
            assert operation.summary_counts["classwork_count"] == 1
            assert operation.summary_counts["lesson_count"] == 1
            assert operation.summary_counts["competency_count"] == 1

            db.expire_all()
            assert db.query(ContentCloneOperation).filter(
                ContentCloneOperation.request_id == request.request_id
            ).count() == 1

            # Assert exactly 1 cloned lesson and 1 cloned classwork created for REQ
            lessons_after = db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count()
            classworks_after = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count()
            assert lessons_after == lessons_before + 1
            assert classworks_after == classworks_before + 1

            # Assert 1 notification staged and committed atomically
            notifs_after = db.query(Notification).count()
            assert notifs_after == notifs_before + 1

            db.refresh(request)
            assert request.status == "ACCEPTED"
    except Exception as error:
        pytest.fail(_safe_failure("copy", error), pytrace=False)


def test_content_cloning_concurrent_acceptance_race_on_guarded_postgres(
    postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Scenario 1B: Two simultaneous Accept & Clone requests on PostgreSQL.

    Verifies that real PostgreSQL row locks and unique constraints allow only one
    clone operation to succeed, while the concurrent request replays safely without
    creating duplicate content or duplicate notifications.
    """
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch_ctx:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch_ctx)
            request = cloning_cases._send_full_clone_package(db, scenario)
            _sync_postgres_sequences(db)

            bind = db.get_bind()
            req_id = request.request_id

            lessons_before = db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count()
            classworks_before = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count()
            notifs_before = db.query(Notification).count()

            def accept(index: int):
                with Session(
                    bind=bind, autoflush=False, expire_on_commit=False,
                ) as session:
                    operation, replayed = ContentCloningExecutionService.accept_package(
                        session, request_id=req_id,
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
                ContentCloneOperation.request_id == req_id
            ).count() == 1

            # Confirm only one set of copied content was created
            lessons_after = db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count()
            classworks_after = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count()
            assert lessons_after == lessons_before + 1
            assert classworks_after == classworks_before + 1

            # Confirm exactly one notification was created for the owner
            notifs_after = db.query(Notification).count()
            assert notifs_after == notifs_before + 1

            db.refresh(request)
            assert request.status == "ACCEPTED"
    except Exception as error:
        pytest.fail(_safe_failure("concurrent_accept", error), pytrace=False)


def test_content_cloning_concurrent_request_creation_scope_lock_on_guarded_postgres(
    postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Scenario 2: Two simultaneous creation attempts for the same open-request scope.

    Verifies that PostgreSQL partial unique constraint on open_request_key ensures exactly
    one request is created, while the concurrent attempt is cleanly rejected with 409.
    """
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch_ctx:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch_ctx)
            _sync_postgres_sequences(db)

            bind = db.get_bind()
            payload = {
                "source_owner_staff_id": "OWNER",
                "subject_id": 5,
                "source_scope_mode": "ALL_TERMS",
                "source_academic_year_id": 1,
                "destination_class_id": 20,
                "destination_subject_id": 5,
                "destination_academic_period_id": 22,
            }

            requests_before = db.query(ContentShareRequest).count()
            notifs_before = db.query(Notification).count()

            def create_req(index: int):
                with Session(bind=bind, autoflush=False, expire_on_commit=False) as session:
                    try:
                        req, replayed = ContentCloningRequestService.create_request(
                            session,
                            requester_staff_id="REQ",
                            idempotency_key=f"pg-create-race-{index}",
                            payload=payload,
                        )
                        return ("SUCCESS", str(req.request_id), replayed)
                    except ContentCloningError as err:
                        return ("ERROR", err.code, err.status_code)

            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(create_req, index) for index in range(2)]
                results = [future.result(timeout=20) for future in futures]

            outcomes = [r[0] for r in results]
            assert "SUCCESS" in outcomes
            assert "ERROR" in outcomes

            # Exactly one request succeeded
            success_result = next(r for r in results if r[0] == "SUCCESS")
            error_result = next(r for r in results if r[0] == "ERROR")
            assert error_result == ("ERROR", "DUPLICATE_OPEN_REQUEST", 409)

            db.expire_all()
            requests_after = db.query(ContentShareRequest).count()
            assert requests_after == requests_before + 1

            # Exactly one notification emitted to owner
            notifs_after = db.query(Notification).filter(
                Notification.notification_type == "repost_request_received"
            ).count()
            assert notifs_after == 1
    except Exception as error:
        pytest.fail(_safe_failure("concurrent_create", error), pytrace=False)


def test_content_cloning_concurrent_accept_and_decline_race_on_guarded_postgres(
    postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Scenario 3: Simultaneous Accept and Decline on the same package.

    Verifies that row-level locking (with_for_update) and version check allow
    only one decision to take effect, cleanly rejecting the loser with a 409 conflict.
    """
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch_ctx:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch_ctx)
            request = cloning_cases._send_full_clone_package(db, scenario)
            _sync_postgres_sequences(db)

            bind = db.get_bind()
            req_id = request.request_id

            def do_accept():
                with Session(bind=bind, autoflush=False, expire_on_commit=False) as session:
                    try:
                        op, replayed = ContentCloningExecutionService.accept_package(
                            session, request_id=req_id, actor_staff_id="REQ",
                            expected_version=2, idempotency_key="pg-accept-race",
                            period_mappings=[],
                        )
                        return ("ACCEPT_SUCCESS", op.status, 200)
                    except ContentCloningError as err:
                        return ("ACCEPT_ERROR", err.code, err.status_code)

            def do_decline():
                with Session(bind=bind, autoflush=False, expire_on_commit=False) as session:
                    try:
                        req = ContentCloningPackageService.decide_package(
                            session, request_id=req_id, staff_id="REQ",
                            payload=PackageDecisionRequest(
                                decision=PackageDecision.DECLINE,
                                expected_version=2,

                            ),
                        )
                        return ("DECLINE_SUCCESS", req.status, 200)
                    except ContentCloningError as err:
                        return ("DECLINE_ERROR", err.code, err.status_code)

            with ThreadPoolExecutor(max_workers=2) as pool:
                fut_accept = pool.submit(do_accept)
                fut_decline = pool.submit(do_decline)
                res_accept = fut_accept.result(timeout=20)
                res_decline = fut_decline.result(timeout=20)

            # Exactly one succeeded and one failed with 409
            results = [res_accept, res_decline]
            success_count = sum(1 for r in results if r[0] in {"ACCEPT_SUCCESS", "DECLINE_SUCCESS"})
            error_count = sum(1 for r in results if r[0] in {"ACCEPT_ERROR", "DECLINE_ERROR"})
            assert success_count == 1
            assert error_count == 1

            db.expire_all()
            db.refresh(request)
            if res_accept[0] == "ACCEPT_SUCCESS":
                assert request.status == "ACCEPTED"
                assert db.query(ContentCloneOperation).filter(ContentCloneOperation.request_id == req_id).count() == 1
                assert res_decline[2] == 409
            else:
                assert request.status == "DECLINED_BY_REQUESTER"
                assert db.query(ContentCloneOperation).filter(ContentCloneOperation.request_id == req_id).count() == 0
                assert res_accept[2] == 409
    except Exception as error:
        pytest.fail(_safe_failure("accept_decline_race", error), pytrace=False)


def test_content_cloning_same_idempotency_key_retries_on_guarded_postgres(
    postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Scenario 4: Same-idempotency-key retries return cached result without duplicate execution."""
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch_ctx:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch_ctx)
            request = cloning_cases._send_full_clone_package(db, scenario)
            _sync_postgres_sequences(db)

            # Initial execution
            op1, replayed1 = ContentCloningExecutionService.accept_package(
                db, request_id=request.request_id, actor_staff_id="REQ",
                expected_version=2, idempotency_key="pg-idemp-key-001",
                period_mappings=[],
            )
            assert not replayed1
            assert op1.status == "SUCCEEDED"

            lessons_count = db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count()
            classworks_count = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count()
            notifs_count = db.query(Notification).count()

            # Retry with EXACT same idempotency key
            op2, replayed2 = ContentCloningExecutionService.accept_package(
                db, request_id=request.request_id, actor_staff_id="REQ",
                expected_version=2, idempotency_key="pg-idemp-key-001",
                period_mappings=[],
            )
            assert replayed2 is True
            assert op2.operation_id == op1.operation_id

            # Verify no duplicate rows were created
            assert db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count() == lessons_count
            assert db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count() == classworks_count
            assert db.query(Notification).count() == notifs_count
            assert db.query(ContentCloneOperation).filter(ContentCloneOperation.request_id == request.request_id).count() == 1
    except Exception as error:
        pytest.fail(_safe_failure("idempotency_retry", error), pytrace=False)


def test_content_cloning_partial_failure_and_rollback_on_guarded_postgres(
    postgres_dashboard_session, tmp_path, monkeypatch,
    prohibit_external_provider_http,
):
    """Scenario 5 & 6: Partial cloning failure triggers atomic transaction rollback and notification rollback."""
    db = postgres_dashboard_session
    try:
        with monkeypatch.context() as patch_ctx:
            scenario = cloning_cases.scenario.__wrapped__(db, tmp_path, patch_ctx)
            request = cloning_cases._send_full_clone_package(db, scenario)
            _sync_postgres_sequences(db)

            lessons_before = db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count()
            classworks_before = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count()
            notifs_before = db.query(Notification).count()
            ops_before = db.query(ContentCloneOperation).count()

            # Simulate an unhandled database exception during clone engine execution
            from app.services.cloning import ContentCloningEngine

            def failing_clone(*args, **kwargs):
                raise RuntimeError("Simulated mid-operation database disk failure")

            with patch.object(ContentCloningEngine, "clone_snapshot_graph", side_effect=failing_clone):
                with pytest.raises(ContentCloningError) as exc_info:
                    ContentCloningExecutionService.accept_package(
                        db, request_id=request.request_id, actor_staff_id="REQ",
                        expected_version=2, idempotency_key="pg-fail-key",
                        period_mappings=[],
                    )
                assert exc_info.value.code == "CLONE_FAILED"
                assert exc_info.value.status_code == 500

            # Assert complete rollback: no partial cloned content, no operation row, no notification
            db.expire_all()
            assert db.query(ContentCloneOperation).count() == ops_before
            assert db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count() == lessons_before
            assert db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count() == classworks_before
            assert db.query(Notification).count() == notifs_before

            # Request remains untouched in PACKAGE_SENT state
            db.refresh(request)
            assert request.status == "PACKAGE_SENT"
            assert request.version == 2
    except Exception as error:
        pytest.fail(_safe_failure("failure_rollback", error), pytrace=False)
