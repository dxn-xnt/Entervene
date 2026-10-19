from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone

# Project fail-safe isolation:
# If DATABASE_URL is not set in the process environment (e.g. in a clean worktree
# or CI without a checked-in .env), supply a benign in-memory SQLite URL so
# Config.Settings() can load without failure.
# If DATABASE_URL IS already configured (such as to entervene_preview or a shared DB),
# the fail_safe_db_isolation fixture below intercepts it, neutralizes settings.database_url,
# and redirects engine/SessionLocal to SQLite so no external DB can be contacted.
_INITIAL_DATABASE_URL = os.environ.get("DATABASE_URL")
if not _INITIAL_DATABASE_URL:
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.db.Session as db_session
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.ContentCloning import router as content_cloning_router
from app.core.Config import settings
from app.core.Dependencies import get_staff_id
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.cloning.ContentCloning import (
    ContentCloneItemMap,
    ContentCloneOperation,
    ContentShareEvent,
    ContentSharePackage,
    ContentSharePackageAsset,
    ContentSharePackageItem,
    ContentShareRequest,
)
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.ContentCloning import (
    OwnerEligibleMaterialItem,
    OwnerEligibleMaterialsResponse,
    PackageDecision,
    PackageDecisionRequest,
    PackagePreviewItem,
    RequesterVisiblePackageSummary,
)
from app.services.cloning.ContentCloningAuthorizationService import (
    ContentCloningAuthorizationService,
)
from app.services.cloning.ContentCloningErrors import (
    ContentCloningError,
    content_cloning_error_handler,
)
from app.services.cloning.ContentCloningLifecycleService import (
    effective_request_status,
    package_expires_at,
    request_expires_at,
    transition_request,
)
from app.services.cloning.ContentCloningRequestService import (
    ContentCloningRequestService,
)

FORBIDDEN_DATABASES = frozenset({"entervene_preview", "activity_db", "entervene_db"})


@pytest.fixture(autouse=True)
def fail_safe_db_isolation(monkeypatch):
    """Fail-safe isolation: ensures tests run on an isolated SQLite engine and never touch shared/preview databases."""
    # 1. Neutralize settings.database_url if pointing to a forbidden or non-test database
    for forbidden in FORBIDDEN_DATABASES:
        if forbidden in (settings.database_url or "").lower():
            monkeypatch.setattr(settings, "database_url", "sqlite://")

    # 2. Guard db_session.engine and db_session.SessionLocal
    # Replace with an engine that refuses any non-sqlite connection
    mock_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    mock_session_factory = sessionmaker(bind=mock_engine, autoflush=False)
    monkeypatch.setattr(db_session, "engine", mock_engine)
    monkeypatch.setattr(db_session, "SessionLocal", mock_session_factory)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    GradingTemplate.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    SubjectLoad.__table__,
    SubjectOffering.__table__,
    SubjectOfferingPathway.__table__,
    TeacherSubstitution.__table__,
    Competency.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    ContentShareRequest.__table__,
    ContentSharePackage.__table__,
    ContentSharePackageItem.__table__,
    ContentSharePackageAsset.__table__,
    ContentCloneOperation.__table__,
    ContentCloneItemMap.__table__,
    ContentShareEvent.__table__,
]


@pytest.fixture
def db(monkeypatch) -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    assert engine.dialect.name == "sqlite", "Fail-safe: only sqlite engine permitted for contract tests"
    Base.metadata.create_all(engine, tables=TABLES)
    session_factory = sessionmaker(bind=engine, autoflush=False)
    session = session_factory()
    monkeypatch.setattr(db_session, "engine", engine)
    monkeypatch.setattr(db_session, "SessionLocal", session_factory)
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine, tables=list(reversed(TABLES)))
        engine.dispose()


def _add_teacher(db: Session, staff_id: str, first: str, last: str) -> AcademicStaff:
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{staff_id.lower()}@example.test",
        password_hash="hash",
        account_status="active",
    )
    staff = AcademicStaff(
        staff_id=staff_id,
        user_id=account.user_id,
        first_name=first,
        last_name=last,
    )
    db.add_all([account, staff, UserRoles(user_id=account.user_id, role_id=1)])
    return staff


@pytest.fixture
def scenario(db: Session) -> dict:
    db.add(Role(role_id=1, role_name="Teacher"))
    db.add(
        GradingTemplate(
            grading_template_id=1,
            template_name="Core",
            passing_threshold=87,
            status="active",
        )
    )
    level = AcademicLevel(
        academic_level_id=1, level_name="Grade 8", grade_level=8
    )
    old_year = AcademicYear(
        academic_year_id=1,
        year_label="2024-2025",
        start_date=date(2024, 6, 1),
        end_date=date(2025, 3, 31),
        is_active=False,
    )
    active_year = AcademicYear(
        academic_year_id=2,
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    future_year = AcademicYear(
        academic_year_id=3,
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    periods = [
        AcademicPeriod(
            academic_period_id=11,
            academic_year_id=1,
            period_name="Term 1",
            period_type="TERM",
            period_sequence=1,
            total_periods_in_year=3,
            period_progress_ratio=0.3333,
            start_date=date(2024, 6, 1),
            end_date=date(2024, 9, 30),
            is_active=False,
        ),
        AcademicPeriod(
            academic_period_id=12,
            academic_year_id=1,
            period_name="Term 2",
            period_type="TERM",
            period_sequence=2,
            total_periods_in_year=3,
            period_progress_ratio=0.6667,
            start_date=date(2024, 10, 1),
            end_date=date(2024, 12, 31),
            is_active=False,
        ),
        AcademicPeriod(
            academic_period_id=21,
            academic_year_id=2,
            period_name="Term 1",
            period_type="TERM",
            period_sequence=1,
            total_periods_in_year=3,
            period_progress_ratio=0.3333,
            start_date=date(2025, 6, 1),
            end_date=date(2025, 9, 30),
            is_active=False,
        ),
        AcademicPeriod(
            academic_period_id=22,
            academic_year_id=2,
            period_name="Term 2",
            period_type="TERM",
            period_sequence=2,
            total_periods_in_year=3,
            period_progress_ratio=0.6667,
            start_date=date(2025, 10, 1),
            end_date=date(2025, 12, 31),
            is_active=True,
        ),
        AcademicPeriod(
            academic_period_id=31,
            academic_year_id=3,
            period_name="Term 1",
            period_type="TERM",
            period_sequence=1,
            total_periods_in_year=3,
            period_progress_ratio=0.3333,
            start_date=date(2026, 6, 1),
            end_date=date(2026, 9, 30),
            is_active=False,
        ),
    ]
    subject = Subject(
        subject_id=5,
        subject_name="Mathematics",
        subject_codename="MATH",
        academic_level_id=1,
        grading_template_id=1,
        status="active",
    )
    active_class = Class(
        class_id=20,
        section_name="Newton",
        academic_year_id=2,
        academic_level_id=1,
        academic_period_id=22,
        class_status="active",
    )
    future_class = Class(
        class_id=30,
        section_name="Einstein",
        academic_year_id=3,
        academic_level_id=1,
        academic_period_id=31,
        class_status="active",
    )
    historical_class = Class(
        class_id=10,
        section_name="Old Section",
        academic_year_id=1,
        academic_level_id=1,
        academic_period_id=11,
        class_status="active",
    )
    source_class = Class(
        class_id=11,
        section_name="Prior Owner Section",
        academic_year_id=1,
        academic_level_id=1,
        academic_period_id=11,
        class_status="active",
    )
    mismatched_class = Class(
        class_id=12,
        section_name="Different Prior Term",
        academic_year_id=1,
        academic_level_id=1,
        academic_period_id=12,
        class_status="active",
    )
    requester = _add_teacher(db, "REQ", "Rina", "Requester")
    owner = _add_teacher(db, "OWNER", "Olivia", "Owner")
    substitute = _add_teacher(db, "SUB", "Sam", "Substitute")
    ambiguous = _add_teacher(db, "AMB", "Amy", "Ambiguous")
    no_primary = _add_teacher(db, "NOPRIMARY", "Nora", "No Load")
    mismatched = _add_teacher(db, "MISMATCH", "Mia", "Mismatch")
    db.add_all(
        [
            level,
            old_year,
            active_year,
            future_year,
            *periods,
            subject,
            active_class,
            future_class,
            historical_class,
            source_class,
            mismatched_class,
            SubjectLoad(
                subject_load_id=1,
                staff_id="REQ",
                subject_id=5,
                class_id=20,
                academic_period_id=22,
                status="published",
                is_active_version=True,
            ),
            SubjectLoad(
                subject_load_id=2,
                staff_id="REQ",
                subject_id=5,
                class_id=30,
                academic_period_id=31,
                status="published",
                is_active_version=True,
            ),
            SubjectLoad(
                subject_load_id=3,
                staff_id="REQ",
                subject_id=5,
                class_id=10,
                academic_period_id=11,
                status="published",
                is_active_version=True,
            ),
            SubjectLoad(
                subject_load_id=4,
                staff_id="OWNER",
                subject_id=5,
                class_id=11,
                academic_period_id=11,
                status="published",
                is_active_version=True,
            ),
            SubjectLoad(
                subject_load_id=5,
                staff_id="MISMATCH",
                subject_id=5,
                class_id=12,
                academic_period_id=12,
                status="published",
                is_active_version=True,
            ),
            SubjectOffering(
                subject_offering_id=1,
                subject_id=5,
                academic_year_id=2,
                academic_level_id=1,
                academic_period_id=22,
                status="active",
            ),
            SubjectOffering(
                subject_offering_id=2,
                subject_id=5,
                academic_year_id=3,
                academic_level_id=1,
                academic_period_id=31,
                status="active",
            ),
            SubjectOffering(
                subject_offering_id=3,
                subject_id=5,
                academic_year_id=1,
                academic_level_id=1,
                academic_period_id=11,
                status="active",
            ),
            SubjectOffering(
                subject_offering_id=4,
                subject_id=5,
                academic_year_id=1,
                academic_level_id=1,
                academic_period_id=12,
                status="active",
            ),
            Competency(
                competency_id=1,
                competency_code="OLD-1",
                statement="Archived but eligible source content",
                subject_id=5,
                academic_period_id=11,
                created_by_staff_id="OWNER",
                is_archived=True,
            ),
            Competency(
                competency_id=2,
                competency_code="OWNERLESS",
                statement="Ownerless content is not eligible",
                subject_id=5,
                academic_period_id=11,
                created_by_staff_id=None,
            ),
            Competency(
                competency_id=3,
                competency_code="NO-PRIMARY",
                statement="Owned content without a primary teaching load",
                subject_id=5,
                academic_period_id=11,
                created_by_staff_id="NOPRIMARY",
            ),
            Competency(
                competency_id=4,
                competency_code="MISMATCHED-TERM",
                statement="Owned in a different term than the teacher's load",
                subject_id=5,
                academic_period_id=11,
                created_by_staff_id="MISMATCH",
            ),
            Lesson(
                lesson_id=1,
                title="Ambiguous unscoped lesson",
                subject_id=5,
                created_by_staff_id="AMB",
            ),
            TeacherSubstitution(
                substitution_id=1,
                subject_load_id=1,
                original_staff_id="REQ",
                substitute_staff_id="SUB",
                start_date=date(2025, 10, 1),
                end_date=date(2025, 12, 31),
                status="active",
            ),
        ]
    )
    db.commit()
    return {
        "requester": requester,
        "owner": owner,
        "substitute": substitute,
        "active_destination": (20, 5, 22),
        "future_destination": (30, 5, 31),
        "historical_destination": (10, 5, 11),
    }


def _client(db: Session, *, staff_id: str) -> TestClient:
    test_app = FastAPI()
    test_app.add_exception_handler(ContentCloningError, content_cloning_error_handler)
    test_app.include_router(content_cloning_router, prefix="/api/v1/content-cloning")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    test_app.dependency_overrides[get_staff_id] = lambda: staff_id
    return TestClient(test_app)


def _request_payload() -> dict:
    return {
        "source_owner_staff_id": "OWNER",
        "subject_id": 5,
        "source_scope_mode": "ALL_TERMS",
        "source_academic_year_id": 1,
        "source_academic_period_id": None,
        "destination_class_id": 20,
        "destination_subject_id": 5,
        "destination_academic_period_id": 22,
        "message": "Please share the prior material.",
    }


def test_domain_schema_has_privacy_idempotency_and_provenance_constraints():
    assert {
        "content_share_request",
        "content_share_package",
        "content_share_package_item",
        "content_share_package_asset",
        "content_clone_operation",
        "content_clone_item_map",
        "content_share_event",
    }.issubset(Base.metadata.tables)
    request_constraints = {
        constraint.name for constraint in ContentShareRequest.__table__.constraints
    }
    assert "uq_content_share_request_requester_idempotency" in request_constraints
    assert "ck_content_share_request_source_scope_shape" in request_constraints
    assert {
        "create_idempotency_key",
        "create_request_fingerprint",
        "open_request_key",
        "version",
    }.issubset(ContentShareRequest.__table__.columns.keys())
    assert {
        "private_snapshot",
        "snapshot_hash",
        "source_revision_token",
    }.issubset(ContentSharePackageItem.__table__.columns.keys())
    assert "private_snapshot" not in RequesterVisiblePackageSummary.model_fields
    assert "source_entity_id" not in RequesterVisiblePackageSummary.model_fields


def test_cloning_domain_ddl_compiles_for_postgresql_without_a_connection():
    cloning_tables = TABLES[-7:]
    for table in cloning_tables:
        sql = str(CreateTable(table).compile(dialect=postgresql.dialect()))
        assert f"CREATE TABLE {table.name}" in sql
        for index in table.indexes:
            assert str(CreateIndex(index).compile(dialect=postgresql.dialect()))


def test_lifecycle_uses_two_independent_seven_day_windows():
    now = datetime(2026, 10, 20, 1, 2, tzinfo=timezone.utc)
    assert request_expires_at(now) == now + timedelta(days=7)
    assert package_expires_at(now) == now + timedelta(days=7)
    request = ContentShareRequest(
        requester_staff_id="REQ",
        source_owner_staff_id="OWNER",
        subject_id=5,
        source_scope_mode="ANY",
        source_scope_key="ANY",
        destination_class_id=20,
        destination_subject_id=5,
        destination_academic_period_id=22,
        status="PENDING_OWNER",
        expires_at=now,
        version=1,
        create_idempotency_key="key",
        create_request_fingerprint="0" * 64,
    )
    assert effective_request_status(request, now=now) == "EXPIRED"
    with pytest.raises(ContentCloningError) as exc:
        transition_request(
            request,
            actor_staff_id="OWNER",
            expected_version=1,
            to_status="DECLINED_BY_OWNER",
            event_type="REQUEST_DECLINED_BY_OWNER",
            now=now,
        )
    assert exc.value.code == "REQUEST_EXPIRED"


def test_source_filter_shapes_and_period_membership_are_strict(db, scenario):
    any_scope = ContentCloningAuthorizationService.resolve_source_scope(
        db, mode="ANY", academic_year_id=None, academic_period_id=None
    )
    assert any_scope.key == "ANY"
    all_terms = ContentCloningAuthorizationService.resolve_source_scope(
        db, mode="ALL_TERMS", academic_year_id=1, academic_period_id=None
    )
    assert all_terms.key == "YEAR:1"
    period = ContentCloningAuthorizationService.resolve_source_scope(
        db, mode="PERIOD", academic_year_id=1, academic_period_id=11
    )
    assert period.key == "PERIOD:11"
    with pytest.raises(ContentCloningError) as exc:
        ContentCloningAuthorizationService.resolve_source_scope(
            db, mode="PERIOD", academic_year_id=2, academic_period_id=11
        )
    assert exc.value.code == "SOURCE_FILTER_INVALID"


def test_destination_requires_direct_primary_authority_and_safe_year_state(db, scenario):
    scopes = ContentCloningAuthorizationService.list_destination_scopes(
        db, actor_staff_id="REQ"
    )
    assert {
        (scope.class_id, scope.academic_period_id, scope.year_state)
        for scope in scopes
    } == {
        (20, 22, "ACTIVE"),
        (30, 31, "PREPARED_FUTURE"),
    }
    with pytest.raises(ContentCloningError) as exc:
        ContentCloningAuthorizationService.resolve_destination(
            db,
            actor_staff_id="SUB",
            class_id=20,
            subject_id=5,
            academic_period_id=22,
        )
    assert exc.value.code == "DESTINATION_SCOPE_FORBIDDEN"
    with pytest.raises(ContentCloningError) as exc:
        ContentCloningAuthorizationService.resolve_destination(
            db,
            actor_staff_id="REQ",
            class_id=10,
            subject_id=5,
            academic_period_id=11,
        )
    assert exc.value.code == "DESTINATION_YEAR_INACTIVE"


def test_source_eligibility_keeps_archived_exact_owner_and_excludes_ambiguous(db, scenario):
    destination = ContentCloningAuthorizationService.resolve_destination(
        db,
        actor_staff_id="REQ",
        class_id=20,
        subject_id=5,
        academic_period_id=22,
    )
    scope = ContentCloningAuthorizationService.resolve_source_scope(
        db, mode="ALL_TERMS", academic_year_id=1, academic_period_id=None
    )
    teachers = ContentCloningAuthorizationService.list_source_teachers(
        db,
        requester_staff_id="REQ",
        subject_id=5,
        destination_period_id=destination.academic_period_id,
        scope=scope,
    )
    assert [(teacher.staff_id, teacher.display_name) for teacher in teachers] == [
        ("OWNER", "Olivia Owner")
    ]
    assert "SUB" not in {teacher.staff_id for teacher in teachers}
    assert "AMB" not in {teacher.staff_id for teacher in teachers}
    assert "NOPRIMARY" not in {teacher.staff_id for teacher in teachers}
    assert "MISMATCH" not in {teacher.staff_id for teacher in teachers}
    assert not db.new
    assert not db.dirty
    assert not db.deleted


def test_eligibility_query_count_is_bounded_as_fixture_grows(db, scenario):
    scope = ContentCloningAuthorizationService.resolve_source_scope(
        db, mode="ALL_TERMS", academic_year_id=1, academic_period_id=None
    )

    def count_selects() -> int:
        count = 0

        def listener(conn, cursor, statement, parameters, context, executemany):
            nonlocal count
            if statement.lstrip().upper().startswith("SELECT"):
                count += 1

        db.expire_all()
        event.listen(db.get_bind(), "before_cursor_execute", listener)
        try:
            ContentCloningAuthorizationService.list_source_teachers(
                db,
                requester_staff_id="REQ",
                subject_id=5,
                destination_period_id=22,
                scope=scope,
            )
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", listener)
        return count

    baseline = count_selects()
    for index in range(5):
        staff_id = f"MORE{index}"
        _add_teacher(db, staff_id, "More", f"Teacher{index}")
        db.add_all(
            [
                Class(
                    class_id=100 + index,
                    section_name=f"Prior Section {index}",
                    academic_year_id=1,
                    academic_level_id=1,
                    academic_period_id=11,
                    class_status="active",
                ),
                SubjectLoad(
                    subject_load_id=100 + index,
                    staff_id=staff_id,
                    subject_id=5,
                    class_id=100 + index,
                    academic_period_id=11,
                    status="published",
                    is_active_version=True,
                ),
                Competency(
                competency_code=f"MORE-{index}",
                statement=f"Eligible material {index}",
                subject_id=5,
                academic_period_id=11,
                created_by_staff_id=staff_id,
                ),
            ]
        )
    db.commit()
    grown = count_selects()
    assert baseline <= 7
    assert grown == baseline


def test_api_request_idempotency_listing_privacy_and_owner_decline(db, scenario):
    requester_client = _client(db, staff_id="REQ")
    payload = _request_payload()
    created = requester_client.post(
        "/api/v1/content-cloning/requests",
        json=payload,
        headers={"Idempotency-Key": "create-request-1"},
    )
    assert created.status_code == 201, created.text
    assert created.headers["X-Idempotent-Replay"] == "false"
    body = created.json()
    assert body["status"] == "PENDING_OWNER"
    assert body["version"] == 1
    assert "create_idempotency_key" not in body
    assert "private_snapshot" not in body
    assert "source_entity_id" not in body

    replay = requester_client.post(
        "/api/v1/content-cloning/requests",
        json=payload,
        headers={"Idempotency-Key": "create-request-1"},
    )
    assert replay.status_code == 201
    assert replay.headers["X-Idempotent-Replay"] == "true"
    assert replay.json()["request_id"] == body["request_id"]

    changed = dict(payload, message="Different request")
    conflict = requester_client.post(
        "/api/v1/content-cloning/requests",
        json=changed,
        headers={"Idempotency-Key": "create-request-1"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    outgoing = requester_client.get(
        "/api/v1/content-cloning/requests?box=outgoing"
    )
    assert outgoing.status_code == 200
    assert outgoing.json()["total"] == 1
    assert outgoing.json()["badges"]["pending"] == 1

    owner_client = _client(db, staff_id="OWNER")
    declined = owner_client.post(
        f"/api/v1/content-cloning/requests/{body['request_id']}/decline",
        json={"expected_version": 1},
    )
    assert declined.status_code == 200, declined.text
    assert declined.json()["status"] == "DECLINED_BY_OWNER"
    assert declined.json()["version"] == 2

    repeated = owner_client.post(
        f"/api/v1/content-cloning/requests/{body['request_id']}/decline",
        json={"expected_version": 1},
    )
    assert repeated.status_code == 200
    assert repeated.json()["version"] == 2


def test_request_denials_are_non_enumerating_and_role_is_unchanged(db, scenario):
    requester_client = _client(db, staff_id="REQ")
    created = requester_client.post(
        "/api/v1/content-cloning/requests",
        json=_request_payload(),
        headers={"Idempotency-Key": "create-request-2"},
    )
    request_id = created.json()["request_id"]

    unrelated_client = _client(db, staff_id="SUB")
    hidden = unrelated_client.post(
        f"/api/v1/content-cloning/requests/{request_id}/decline",
        json={"expected_version": 1},
    )
    assert hidden.status_code == 404
    assert hidden.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    student_app = FastAPI()
    student_app.add_exception_handler(
        ContentCloningError, content_cloning_error_handler
    )
    student_app.include_router(
        content_cloning_router, prefix="/api/v1/content-cloning"
    )
    student_app.dependency_overrides[get_db] = lambda: db
    student_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "student",
    }
    with TestClient(student_app) as client:
        denied = client.get("/api/v1/content-cloning/scopes")
    assert denied.status_code == 403


def test_expired_open_request_releases_scope_and_records_audit_event(db, scenario):
    payload = _request_payload()
    first_now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first, replayed = ContentCloningRequestService.create_request(
        db,
        requester_staff_id="REQ",
        idempotency_key="first-expiring-key",
        payload=payload,
        now=first_now,
    )
    assert replayed is False
    with pytest.raises(ContentCloningError) as duplicate:
        ContentCloningRequestService.create_request(
            db,
            requester_staff_id="REQ",
            idempotency_key="different-key-before-expiry",
            payload=payload,
            now=first_now + timedelta(days=1),
        )
    assert duplicate.value.code == "DUPLICATE_OPEN_REQUEST"

    second, replayed = ContentCloningRequestService.create_request(
        db,
        requester_staff_id="REQ",
        idempotency_key="replacement-after-expiry",
        payload=payload,
        now=first_now + timedelta(days=8),
    )
    db.refresh(first)
    assert replayed is False
    assert second.request_id != first.request_id
    assert first.status == "EXPIRED"
    assert first.open_request_key is None
    assert (
        db.query(ContentShareEvent)
        .filter(
            ContentShareEvent.request_id == first.request_id,
            ContentShareEvent.event_type == "REQUEST_EXPIRED",
        )
        .count()
        == 1
    )


def test_version_conflict_is_typed_and_does_not_mutate_request():
    now = datetime(2026, 10, 20, tzinfo=timezone.utc)
    request = ContentShareRequest(
        requester_staff_id="REQ",
        source_owner_staff_id="OWNER",
        subject_id=5,
        source_scope_mode="ANY",
        source_scope_key="ANY",
        destination_class_id=20,
        destination_subject_id=5,
        destination_academic_period_id=22,
        status="PENDING_OWNER",
        expires_at=now + timedelta(days=7),
        version=3,
        create_idempotency_key="key",
        create_request_fingerprint="0" * 64,
    )
    with pytest.raises(ContentCloningError) as conflict:
        transition_request(
            request,
            actor_staff_id="OWNER",
            expected_version=2,
            to_status="DECLINED_BY_OWNER",
            event_type="REQUEST_DECLINED_BY_OWNER",
            now=now,
        )
    assert conflict.value.code == "REQUEST_VERSION_CONFLICT"
    assert request.status == "PENDING_OWNER"
    assert request.version == 3


def test_pr_a_does_not_publish_placeholder_package_or_clone_routes(db, scenario):
    client = _client(db, staff_id="REQ")
    paths = {route.path for route in client.app.routes}
    assert "/api/v1/content-cloning/scopes" in paths
    assert "/api/v1/content-cloning/source-teachers" in paths
    assert "/api/v1/content-cloning/requests" in paths
    assert "/api/v1/content-cloning/requests/{request_id}/decline" in paths
    assert not any("/package" in path for path in paths)
    assert not any("/accept" in path for path in paths)
    assert not any("/clone-operations" in path for path in paths)


@pytest.mark.parametrize("forbidden_db", ["entervene_preview", "activity_db", "entervene_db"])
def test_contract_suite_guards_against_configured_forbidden_databases(forbidden_db, monkeypatch):
    """Verify that even when DATABASE_URL is pre-configured with a preview/production DB,
    the test harness intercepts it and strictly confines execution to isolated SQLite."""
    monkeypatch.setattr(settings, "database_url", f"postgresql://user:pass@localhost:5432/{forbidden_db}")
    assert db_session.engine.dialect.name == "sqlite"
    assert "postgres" not in db_session.engine.url.drivername

    test_session = db_session.SessionLocal()
    try:
        assert test_session.get_bind().dialect.name == "sqlite"
    finally:
        test_session.close()


def test_package_preview_schema_includes_safe_titles_and_hides_private_data():
    """Verify safe received package previews contain item titles and counts, while hiding private content."""
    # Verify safe preview item only contains non-sensitive metadata
    assert {"item_type", "safe_title", "display_order"}.issubset(PackagePreviewItem.model_fields.keys())
    assert "source_entity_id" not in PackagePreviewItem.model_fields
    assert "private_snapshot" not in PackagePreviewItem.model_fields
    assert "quiz_questions" not in PackagePreviewItem.model_fields
    assert "answer_key" not in PackagePreviewItem.model_fields

    # Verify received package summary contains safe items list and summary counts
    assert "items" in RequesterVisiblePackageSummary.model_fields
    assert "summary" in RequesterVisiblePackageSummary.model_fields
    assert "private_snapshot" not in RequesterVisiblePackageSummary.model_fields
    assert "source_entity_id" not in RequesterVisiblePackageSummary.model_fields

    # Verify owner material selection items provide revision tokens
    assert "source_revision_token" in OwnerEligibleMaterialItem.model_fields
    assert "source_entity_id" in OwnerEligibleMaterialItem.model_fields

    # Verify package decision schema supports ACCEPT and DECLINE with expected_version
    assert set(PackageDecision.__members__.keys()) == {"ACCEPT", "DECLINE"}
    assert "expected_version" in PackageDecisionRequest.model_fields
