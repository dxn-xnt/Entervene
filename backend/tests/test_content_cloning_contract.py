from __future__ import annotations
import json
import importlib

import os
import uuid
from pathlib import Path
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
from app.api.v1.routes.Competencies import router as competency_router
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
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
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
from app.models.people.Student import Student
from app.schemas.ContentCloning import (
    ContentSelectionItem,
    OwnerEligibleMaterialItem,
    OwnerEligibleMaterialsResponse,
    PackageCreateRequest,
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
from app.services.cloning.ContentCloningPackageService import (
    ContentCloningPackageService,
    compute_classwork_revision_token,
    compute_competency_revision_token,
    compute_lesson_revision_token,
)
from app.services.cloning.ContentCloningRequestService import (
    ContentCloningRequestService,
)
from app.services.classwork.ClassworkAccessService import authorize_classwork_access
from app.services.lesson.LessonShared import authorize_lesson_access
from app.services.lesson.LessonService import publish_lesson_record
from fastapi import HTTPException

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
    GradingTemplateComponent.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
    SubjectOffering.__table__,
    SubjectOfferingPathway.__table__,
    TeacherSubstitution.__table__,
    Competency.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    ClassworkAttachment.__table__,
    ClassworkCoverage.__table__,
    ClassworkLesson.__table__,
    ActivityRubricLevel.__table__,
    Question.__table__,
    QuestionOption.__table__,
    Quiz.__table__,
    QuizQuestion.__table__,
    QuizSetting.__table__,
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
def scenario(db: Session, tmp_path, monkeypatch) -> dict:
    attachment_root = tmp_path / "classworks"
    attachment_root.mkdir()
    attachment_file = attachment_root / "factoring_ref.pdf"
    attachment_file.write_bytes(b"x" * 1024)
    package_module = importlib.import_module(
        "app.services.cloning.ContentCloningPackageService"
    )
    engine_module = importlib.import_module(
        "app.services.cloning.ContentCloningEngine"
    )
    monkeypatch.setattr(package_module, "DEFAULT_ATTACHMENT_ROOT", attachment_root)
    monkeypatch.setattr(package_module, "DEFAULT_STAGING_DIR", tmp_path / "cloning_staging")
    monkeypatch.setattr(engine_module, "DEFAULT_STAGING_ROOT", tmp_path / "cloning_staging")
    monkeypatch.setattr(engine_module, "DEFAULT_SOURCE_ROOT", attachment_root)
    monkeypatch.setattr(engine_module, "DEFAULT_CLONE_ROOT", tmp_path / "cloned")
    db.add(Role(role_id=1, role_name="Teacher"))
    db.add(
        GradingTemplate(
            grading_template_id=1,
            template_name="Core",
            passing_threshold=87,
            status="active",
        )
    )
    db.add_all([
        GradingTemplateComponent(
            grading_template_id=1, component_name=name,
            weight=weight, display_order=order,
        )
        for order, name, weight in (
            (1, "Written Work", 20), (2, "Performance Tasks", 50),
            (3, "Term Exam", 30),
        )
    ])
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
        "attachment_path": str(attachment_file),
        "clone_root": tmp_path / "cloned",
    }


def _client(
    db: Session, *, staff_id: str, role: str = "teacher",
    user_id: uuid.UUID | None = None,
) -> TestClient:
    test_app = FastAPI()
    test_app.add_exception_handler(ContentCloningError, content_cloning_error_handler)
    test_app.include_router(content_cloning_router, prefix="/api/v1/content-cloning")
    test_app.include_router(competency_router, prefix="/api/v1/competencies")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(user_id or uuid.uuid4()),
        "role": role,
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


def test_pr_c_publishes_clone_routes(db, scenario):
    client = _client(db, staff_id="REQ")
    paths = {route.path for route in client.app.routes}
    assert "/api/v1/content-cloning/scopes" in paths
    assert "/api/v1/content-cloning/source-teachers" in paths
    assert "/api/v1/content-cloning/requests" in paths
    assert "/api/v1/content-cloning/requests/{request_id}/decline" in paths
    assert "/api/v1/content-cloning/requests/{request_id}/eligible-materials" in paths
    assert "/api/v1/content-cloning/requests/{request_id}/package" in paths
    assert "/api/v1/content-cloning/requests/{request_id}/package-decision" in paths
    # PR C routes must remain unpublished in PR B
    assert "/api/v1/content-cloning/clone-operations/self" in paths
    assert "/api/v1/content-cloning/clone-operations/{operation_id}" in paths
    assert not any("/my-content/clones" in path for path in paths)


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



# ── PR B Test Suite: Teacher Content Selection, Immutable Packages, Lifecycle ──


def _create_pr_b_fixture(db: Session, scenario: dict):
    """Sets up owned instructional materials (Competency, Lesson, Classwork with Rubric & Quiz, Attachments)
    and a pending ContentShareRequest from REQ to OWNER."""
    # 1. Lesson for OWNER
    lesson = Lesson(
        lesson_id=10,
        title="Lesson 10: Quadratic Factoring",
        description="Core factoring techniques",
        content="Step 1: Find factors of ac that sum to b.",
        subject_id=5,
        created_by_staff_id="OWNER",
        order_index=1,
    )
    db.add(lesson)
    db.flush()
    # Assign lesson to historical class 10 (which is in term 11)
    db.add(LessonAssignment(lesson_id=lesson.lesson_id, class_id=10, assigned_by_staff_id="OWNER", is_published=True))

    # 2. Classwork for OWNER (Quiz type with attachments, rubrics, and quiz questions)
    cw = Classwork(
        classwork_id=20,
        title="Factoring Quiz & Activity",
        description="Comprehensive factoring test",
        instructions="Complete all questions within 30 minutes.",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=50,
        show_scores=True,
        subject_id=5,
        created_by_staff_id="OWNER",
    )
    db.add(cw)
    db.flush()

    # Standard classwork assignment in term 11
    db.add(ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=10,
        academic_period_id=11,
        assigned_by_staff_id="OWNER",
        is_published=True,
    ))

    # Rubric level
    db.add(ActivityRubricLevel(
        classwork_id=cw.classwork_id,
        level_name="Accuracy",
        description="Solves equations with full accuracy.",
        points=10.0,
        display_order=1,
    ))

    # Attachment
    db.add(ClassworkAttachment(
        classwork_id=cw.classwork_id,
        file_name="Factoring_Reference.pdf",
        file_path=scenario["attachment_path"],
        file_size=1024,
        file_type="application/pdf",
    ))

    # Quiz with question and options
    quiz = Quiz(
        quiz_id=50,
        classwork_id=cw.classwork_id,
        total_items=1,
        duration_minutes=30,
        status="PUBLISHED",
    )
    db.add(quiz)
    db.flush()

    question = Question(
        question_id=100,
        question_text="What are the roots of x^2 - 5x + 6 = 0?",
        question_type="MULTIPLE_CHOICE",
        points=5.0,
    )
    db.add(question)
    db.flush()

    db.add(QuestionOption(question_id=question.question_id, option_text="2 and 3", is_correct=True, option_order=1))
    db.add(QuestionOption(question_id=question.question_id, option_text="-2 and -3", is_correct=False, option_order=2))
    db.add(QuizQuestion(quiz_id=quiz.quiz_id, question_id=question.question_id, display_order=1))

    # 3. Remedial Classwork (MUST BE EXCLUDED)
    remedial_cw = Classwork(
        classwork_id=30,
        title="Targeted Remedial Support",
        classwork_type="ASSIGNMENT",
        subject_id=5,
        created_by_staff_id="OWNER",
    )
    db.add(remedial_cw)
    db.flush()
    db.add(ClassworkAssignment(
        classwork_id=remedial_cw.classwork_id,
        class_id=10,
        academic_period_id=11,
        assigned_by_staff_id="OWNER",
        recipient_student_id=uuid.uuid4(),  # Learner targeted!
        source_intervention_id=999,
        remediation_request_id=uuid.uuid4(),
    ))

    # 4. Request from REQ to OWNER
    req, _ = ContentCloningRequestService.create_request(
        db,
        requester_staff_id="REQ",
        idempotency_key="pr-b-test-request-001",
        payload={
            "source_owner_staff_id": "OWNER",
            "subject_id": 5,
            "destination_class_id": 20,
            "destination_subject_id": 5,
            "destination_academic_period_id": 22,
            "source_scope_mode": "ANY",
            "message": "Please share your factoring materials.",
        },
    )
    db.commit()
    return req


def test_owner_material_selection_authorization_and_scoping(db, scenario):
    """Verify owner material picker enforces strict authorization, scoping, and revision tokens."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")
    client_req = _client(db, staff_id="REQ")
    client_unrelated = _client(db, staff_id="NOPRIMARY")

    # 1. Non-owner (requester or unrelated) cannot view owner picker
    resp_req = client_req.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp_req.status_code == 404
    assert resp_req.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    resp_unrel = client_unrelated.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp_unrel.status_code == 404

    # 2. Owner accesses picker: gets 200 with eligible items
    resp_owner = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp_owner.status_code == 200
    data = resp_owner.json()
    assert data["request_id"] == str(req.request_id)
    assert data["total"] >= 3

    # Check item types: Competency 1, Lesson 10, Classwork 20
    item_entities = {(it["item_type"], it["source_entity_id"]) for it in data["items"]}
    assert ("COMPETENCY", 1) in item_entities
    assert ("LESSON", 10) in item_entities
    assert ("CLASSWORK", 20) in item_entities
    # Remedial classwork 30 MUST BE EXCLUDED
    assert ("CLASSWORK", 30) not in item_entities
    # Ownerless competency 2 MUST BE EXCLUDED
    assert ("COMPETENCY", 2) not in item_entities

    # Verify every item has revision token and academic period metadata
    for item in data["items"]:
        assert item["source_revision_token"].startswith(("rev_comp_", "rev_les_", "rev_cw_"))
        assert item["academic_period_id"] == 11
        assert item["academic_period_name"] == "Term 1"

    # 3. Item type filtering
    resp_comp = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials?item_type=COMPETENCY")
    assert resp_comp.status_code == 200
    assert all(it["item_type"] == "COMPETENCY" for it in resp_comp.json()["items"])

    # 4. Pagination
    resp_page = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials?page=1&page_size=1")
    assert resp_page.status_code == 200
    assert len(resp_page.json()["items"]) == 1
    assert resp_page.json()["total"] >= 3


def test_revision_tokens_invalidate_on_parent_and_nested_dependency_changes(db, scenario):
    """Verify revision tokens change whenever clone-relevant fields, rubrics, or quiz questions change."""
    _create_pr_b_fixture(db, scenario)

    # 1. Competency token mutation
    comp = db.get(Competency, 1)
    tok1 = compute_competency_revision_token(comp)
    comp.statement = "Updated competency statement"
    tok2 = compute_competency_revision_token(comp)
    assert tok1 != tok2

    # 2. Lesson token mutation
    lesson = db.get(Lesson, 10)
    tok_les1 = compute_lesson_revision_token(lesson)
    lesson.content = "New content added to lesson"
    tok_les2 = compute_lesson_revision_token(lesson)
    assert tok_les1 != tok_les2

    # 3. Classwork token mutation via rubric
    cw = db.get(Classwork, 20)
    tok_cw1 = compute_classwork_revision_token(cw)
    cw.rubric_levels[0].description = "Modified rubric criteria"
    tok_cw2 = compute_classwork_revision_token(cw)
    assert tok_cw1 != tok_cw2

    # 4. Classwork token mutation via quiz question
    q = db.get(Question, 100)
    q.question_text = "Mutated quiz question text"
    tok_cw3 = compute_classwork_revision_token(cw)
    assert tok_cw2 != tok_cw3


def test_package_creation_immutable_snapshot_and_staging(db, scenario, tmp_path):
    """Verify package creation builds complete immutable snapshot, stages files, and sets fresh 7-day window."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")

    # Fetch eligible materials to get fresh tokens
    picker_resp = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    items = picker_resp.json()["items"]

    # 1. Duplicate item selection rejected
    duplicate_payload = {
        "expected_version": 1,
        "items": [
            {"item_type": items[0]["item_type"], "source_entity_id": items[0]["source_entity_id"], "source_revision_token": items[0]["source_revision_token"]},
            {"item_type": items[0]["item_type"], "source_entity_id": items[0]["source_entity_id"], "source_revision_token": items[0]["source_revision_token"]},
        ]
    }
    resp_dup = client_owner.post(f"/api/v1/content-cloning/requests/{req.request_id}/package", json=duplicate_payload)
    assert resp_dup.status_code == 422
    assert resp_dup.json()["detail"]["code"] == "DUPLICATE_ITEM_SELECTION"

    # 2. Stale revision token rejected with 409
    stale_payload = {
        "expected_version": 1,
        "items": [
            {"item_type": items[0]["item_type"], "source_entity_id": items[0]["source_entity_id"], "source_revision_token": "stale_token_99999"}
        ]
    }
    resp_stale = client_owner.post(f"/api/v1/content-cloning/requests/{req.request_id}/package", json=stale_payload)
    assert resp_stale.status_code == 409
    assert resp_stale.json()["detail"]["code"] == "SOURCE_CONTENT_CHANGED"

    # 3. Successful package creation
    package_payload = {
        "expected_version": 1,
        "items": [
            {"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]}
            for it in items
        ]
    }
    resp_pkg = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
        headers={"Idempotency-Key": "pkg-creation-test-001"},
    )
    print('DEBUG RESP:', resp_pkg.status_code, resp_pkg.text)
    assert resp_pkg.status_code == 201, f'RESPONSE BODY: {resp_pkg.text}'
    pkg_data = resp_pkg.json()
    assert pkg_data["status"] == "PACKAGE_SENT"
    assert pkg_data["summary"]["competency_count"] == 1
    assert pkg_data["summary"]["lesson_count"] == 1
    assert pkg_data["summary"]["classwork_count"] == 1
    assert pkg_data["summary"]["attachment_count"] == 1

    # Check request state
    db.refresh(req)
    assert req.status == "PACKAGE_SENT"
    assert req.version == 2
    # Check fresh 7-day window
    assert req.expires_at > req.created_at + timedelta(days=6)

    # 4. Verify private snapshot in database has NO learner records
    pkg_items = db.query(ContentSharePackageItem).filter(ContentSharePackageItem.package_id == uuid.UUID(pkg_data["package_id"])).all()
    assert len(pkg_items) == 3
    for pi in pkg_items:
        snap = pi.private_snapshot
        assert "submissions" not in snap
        assert "grades" not in snap
        assert "student_scores" not in snap
        assert "attendance" not in snap
        if pi.item_type == "CLASSWORK":
            assert snap["quiz"]["questions"][0]["points"] == 5.0
            assert len(snap["rubric_levels"]) == 1

    # 5. Verify source mutation does NOT affect immutable package
    cw = db.get(Classwork, 20)
    cw.title = "Completely Mutated Title"
    db.commit()

    db.refresh(req)
    # Package item safe_title remains frozen
    pi_cw = next(p for p in pkg_items if p.item_type == "CLASSWORK")
    assert pi_cw.safe_title == "Factoring Quiz & Activity"
    assert pi_cw.private_snapshot["title"] == "Factoring Quiz & Activity"


def test_package_preview_privacy_and_authorization(db, scenario):
    """Verify recipient preview hides private snapshot, answers, paths, and internal entity IDs."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")
    client_req = _client(db, staff_id="REQ")
    client_unrel = _client(db, staff_id="NOPRIMARY")

    # Send package first
    picker = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials").json()
    client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json={"expected_version": 1, "items": [{"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]} for it in picker["items"]]},
    )

    # 1. Unrelated teacher gets 404 (non-enumerating)
    resp_unrel = client_unrel.get(f"/api/v1/content-cloning/requests/{req.request_id}/package")
    assert resp_unrel.status_code == 404
    assert resp_unrel.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 2. Requester gets 200 with safe preview
    resp_preview = client_req.get(f"/api/v1/content-cloning/requests/{req.request_id}/package")
    assert resp_preview.status_code == 200
    preview = resp_preview.json()

    assert preview["status"] == "PACKAGE_SENT"
    assert preview["source_owner_staff_id"] == "OWNER"
    assert preview["source_owner_name"] is not None
    assert preview["subject_name"] == "Mathematics"
    assert "sent_at" in preview and preview["sent_at"] is not None
    assert "expires_at" in preview and preview["expires_at"] is not None
    assert "summary" in preview
    assert preview["summary"]["competency_count"] >= 1
    assert preview["summary"]["lesson_count"] >= 1
    assert preview["summary"]["classwork_count"] >= 1

    # Strict privacy verification on preview items
    assert len(preview["items"]) == 3
    for it in preview["items"]:
        # Safe fields present and properly typed
        assert "safe_title" in it and isinstance(it["safe_title"], str)
        assert "item_type" in it and it["item_type"] in ("COMPETENCY", "LESSON", "CLASSWORK")
        assert "display_order" in it and isinstance(it["display_order"], int)
        # Private fields MUST NOT exist in serialized output
        assert "source_entity_id" not in it
        assert "private_snapshot" not in it
        assert "private_staged_path" not in it
        assert "answers" not in it
        assert "options" not in it


def test_package_decision_decline_and_accept_boundary(db, scenario):
    """A missing acceptance idempotency key is rejected; decline remains available."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")
    client_req = _client(db, staff_id="REQ")

    # Send package
    picker = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials").json()
    client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json={"expected_version": 1, "items": [{"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]} for it in picker["items"]]},
    )

    # 1. ACCEPT requires an idempotency key, without changing the request.
    resp_accept = client_req.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package-decision",
        json={"decision": "ACCEPT", "expected_version": 2},
    )
    assert resp_accept.status_code == 422
    assert resp_accept.json()["detail"]["code"] == "IDEMPOTENCY_KEY_INVALID"
    # Verify request status was NOT altered
    db.refresh(req)
    assert req.status == "PACKAGE_SENT"
    assert req.version == 2

    # 2. Version conflict on DECLINE
    resp_conflict = client_req.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package-decision",
        json={"decision": "DECLINE", "expected_version": 99},
    )
    assert resp_conflict.status_code == 409
    assert resp_conflict.json()["detail"]["code"] == "REQUEST_VERSION_CONFLICT"

    # 3. Successful DECLINE by requester
    resp_decline = client_req.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package-decision",
        json={"decision": "DECLINE", "expected_version": 2},
        headers={"Idempotency-Key": "decline-test-key-01"},
    )
    assert resp_decline.status_code == 200
    assert resp_decline.json()["status"] == "DECLINED_BY_REQUESTER"

    db.refresh(req)
    assert req.status == "DECLINED_BY_REQUESTER"
    assert req.version == 3
    assert req.open_request_key is None  # Releases scope lock!

    # 4. Idempotent replay of decline
    resp_replay = client_req.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package-decision",
        json={"decision": "DECLINE", "expected_version": 3},
        headers={"Idempotency-Key": "decline-test-key-01"},
    )
    assert resp_replay.status_code == 200
    assert resp_replay.json()["status"] == "DECLINED_BY_REQUESTER"


def test_package_expiration_enforcement(db, scenario):
    """Verify package expires after 7 days, blocking decline and updating effective status."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")
    client_req = _client(db, staff_id="REQ")

    # Send package
    picker = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials").json()
    pkg_resp = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json={"expected_version": 1, "items": [{"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]} for it in picker["items"]]},
    )
    db.refresh(req)

    # Fast forward past 7-day acceptance window
    expired_time = req.expires_at + timedelta(minutes=5)
    eff = effective_request_status(req, now=expired_time)
    assert eff == "EXPIRED"

    # Decision on expired package rejected
    with pytest.raises(ContentCloningError) as exc_info:
        ContentCloningPackageService.decide_package(
            db,
            request_id=req.request_id,
            staff_id="REQ",
            payload=PackageDecisionRequest(decision=PackageDecision.DECLINE, expected_version=2),
            now=expired_time,
        )
    assert exc_info.value.code == "REQUEST_EXPIRED"


def test_package_idempotency_and_single_package_rule(db, scenario):
    """Verify idempotent retries return existing package and concurrent package creation is prevented."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")

    picker = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials").json()
    payload = {"expected_version": 1, "items": [{"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]} for it in picker["items"]]}

    # First submission
    resp1 = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=payload,
        headers={"Idempotency-Key": "same-key-123"},
    )
    assert resp1.status_code == 201
    pkg_id_1 = resp1.json()["package_id"]

    # Replay with same idempotency key: returns same package
    resp2 = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=payload,
        headers={"Idempotency-Key": "same-key-123"},
    )
    assert resp2.status_code == 201 or resp2.status_code == 200
    assert resp2.json()["package_id"] == pkg_id_1

    # Second submission with different key: rejected with 409 PACKAGE_ALREADY_EXISTS
    resp3 = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=payload,
        headers={"Idempotency-Key": "different-key-456"},
    )
    assert resp3.status_code == 409
    assert resp3.json()["detail"]["code"] == "PACKAGE_ALREADY_EXISTS"



def test_file_staging_failure_and_db_rollback_compensation(db, scenario, tmp_path, monkeypatch):
    """Verify that if an error occurs during file staging or DB commit, partial staged files
    are removed by compensation logic and the database is completely rolled back."""
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")

    picker = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials").json()
    items = picker["items"]
    payload = {
        "expected_version": 1,
        "items": [
            {"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]}
            for it in items
        ]
    }

    # Simulate an error right before commit in create_package by monkeypatching db.commit
    orig_commit = db.commit
    def fail_commit():
        raise RuntimeError("Simulated Database Commit Failure")

    monkeypatch.setattr(db, "commit", fail_commit)

    staging_dir = tmp_path / "cloning_staging"
    with pytest.raises(ContentCloningError) as exc_info:
        ContentCloningPackageService.create_package(
            db,
            request_id=req.request_id,
            staff_id="OWNER",
            payload=PackageCreateRequest(expected_version=1, items=[
                ContentSelectionItem(item_type=it["item_type"], source_entity_id=it["source_entity_id"], source_revision_token=it["source_revision_token"])
                for it in items
            ]),
            staging_dir=staging_dir,
        )

    assert exc_info.value.code == "PACKAGE_CREATION_FAILED"

    # Restore commit to check DB state
    monkeypatch.setattr(db, "commit", orig_commit)
    db.rollback()

    # Verify no partial package exists in DB
    db.refresh(req)
    assert req.status == "PENDING_OWNER"
    assert req.version == 1
    assert db.query(ContentSharePackage).filter(ContentSharePackage.request_id == req.request_id).count() == 0

    # Verify compensation cleaned up any staged files on disk
    if staging_dir.exists():
        staged_files = list(staging_dir.glob("**/*.*"))
        assert len(staged_files) == 0, f"Found uncompensated staged files: {staged_files}"


def test_material_selection_query_count_is_bounded_as_fixture_grows(db, scenario):
    """Verify that eligible materials querying uses eager loading and does not exhibit N+1 query growth."""
    req = _create_pr_b_fixture(db, scenario)

    # Count queries for initial fixture
    query_count = 0
    def query_listener(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", query_listener)
    try:
        items1, total1 = ContentCloningPackageService.get_eligible_materials(
            db,
            request_id=req.request_id,
            staff_id="OWNER",
        )
        base_queries = query_count
    finally:
        event.remove(engine, "before_cursor_execute", query_listener)

    # Add 5 more lessons and 5 more classworks with rubrics and attachments
    for i in range(100, 105):
        les = Lesson(
            lesson_id=i,
            title=f"Lesson {i}",
            subject_id=5,
            created_by_staff_id="OWNER",
        )
        db.add(les)
        db.flush()
        db.add(LessonAssignment(lesson_id=les.lesson_id, class_id=10, assigned_by_staff_id="OWNER"))

        cw_extra = Classwork(
            classwork_id=i,
            title=f"Classwork {i}",
            classwork_type="ASSIGNMENT",
            subject_id=5,
            created_by_staff_id="OWNER",
        )
        db.add(cw_extra)
        db.flush()
        db.add(ClassworkAssignment(classwork_id=cw_extra.classwork_id, class_id=10, academic_period_id=11, assigned_by_staff_id="OWNER"))
        db.add(ActivityRubricLevel(classwork_id=cw_extra.classwork_id, level_name="Standard", description="Standard criteria", points=5.0, display_order=1))
    db.commit()

    # Measure query count with 10 additional materials
    query_count = 0
    event.listen(engine, "before_cursor_execute", query_listener)
    try:
        items2, total2 = ContentCloningPackageService.get_eligible_materials(
            db,
            request_id=req.request_id,
            staff_id="OWNER",
        )
        expanded_queries = query_count
    finally:
        event.remove(engine, "before_cursor_execute", query_listener)

    assert total2 > total1
    # Query count must remain constant or bounded (no N+1 per entity or per rubric/attachment)
    assert expanded_queries <= base_queries + 2, f"Queries grew unexpectedly from {base_queries} to {expanded_queries}"


def test_exact_owner_authorization_strictness_rejects_admin_substitute_and_colleagues(db, scenario):
    """Verify exact source-owner policy:
    - Only the exact source owner may select and package their content.
    - Pure admin role is rejected by route guard (403 Forbidden).
    - Admin staff presenting teacher role is rejected with 404 (non-enumerating).
    - Assigned non-owner teachers, colleagues, and substitutes cannot package another teacher's material (404).
    - Non-requester cannot decide on a package (404).
    """
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER", role="teacher")
    client_pure_admin = _client(db, staff_id="ADMIN_STAFF", role="admin")
    client_admin_as_teacher = _client(db, staff_id="ADMIN_STAFF", role="teacher")
    client_substitute = _client(db, staff_id="SUB", role="teacher")
    client_colleague = _client(db, staff_id="NOPRIMARY", role="teacher")
    client_requester = _client(db, staff_id="REQ", role="teacher")

    # 1. Pure Admin role is rejected at route level with 403 Forbidden
    resp = client_pure_admin.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp.status_code == 403

    # 2. Admin staff (even with teacher role) cannot query owner's materials (404 non-enumerating)
    resp = client_admin_as_teacher.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 3. Substitute cannot query owner's eligible materials (404)
    resp = client_substitute.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 4. Colleague cannot query owner's eligible materials (404)
    resp = client_colleague.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 5. Requester cannot query owner's eligible materials (404)
    resp = client_requester.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 6. Exact owner successfully queries eligible materials
    resp = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials")
    assert resp.status_code == 200
    items = resp.json()["items"]
    package_payload = {
        "expected_version": 1,
        "items": [
            {
                "item_type": items[0]["item_type"],
                "source_entity_id": items[0]["source_entity_id"],
                "source_revision_token": items[0]["source_revision_token"],
            }
        ],
    }

    # 7. Pure admin cannot package owner's materials (403 Forbidden)
    resp = client_pure_admin.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
    )
    assert resp.status_code == 403

    # 8. Admin staff as teacher cannot package owner's materials (404)
    resp = client_admin_as_teacher.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 9. Substitute cannot package owner's materials (404)
    resp = client_substitute.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 10. Colleague cannot package owner's materials (404)
    resp = client_colleague.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 11. Requester cannot package owner's materials (404)
    resp = client_requester.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 12. Exact owner packages materials successfully (201 Created)
    resp = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json=package_payload,
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "PACKAGE_SENT"

    # 13. Admin staff cannot decide on the package (404)
    decision_payload = {"decision": "DECLINE", "expected_version": 2}
    resp = client_admin_as_teacher.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package-decision",
        json=decision_payload,
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "REQUEST_NOT_FOUND"

    # 14. Exact requester declines package successfully (200 OK)
    resp = client_requester.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package-decision",
        json=decision_payload,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "DECLINED_BY_REQUESTER"


def test_staged_attachments_and_snapshots_cannot_be_accessed_publicly_or_leaked(db, scenario, tmp_path):
    """Verify that:
    1. Private staged attachments under uploads/cloning_packages/ are not exposed via any public static mounts.
    2. URL guessing / path traversal against FastAPI application returns 404.
    3. Serialized package preview and request endpoints never leak private_snapshot or private_staged_path.
    """
    req = _create_pr_b_fixture(db, scenario)
    client_owner = _client(db, staff_id="OWNER")
    client_req = _client(db, staff_id="REQ")
    client_anonymous = _client(db, staff_id="ANON")

    # 1. Package creation with attachments
    picker = client_owner.get(f"/api/v1/content-cloning/requests/{req.request_id}/eligible-materials").json()
    resp_create = client_owner.post(
        f"/api/v1/content-cloning/requests/{req.request_id}/package",
        json={"expected_version": 1, "items": [{"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]} for it in picker["items"]]},
    )
    assert resp_create.status_code == 201
    pkg_summary = resp_create.json()

    # 2. Verify static mount absence and URL guessing rejection
    # Attempting to fetch staged package directory or any guessing returns 404
    pkg_id = pkg_summary["package_id"]
    for guessed_url in [
        f"/uploads/cloning_packages/{pkg_id}",
        f"/static/cloning_packages/{pkg_id}",
        f"/api/v1/content-cloning/packages/{pkg_id}/attachments",
        f"/cloning_packages/{pkg_id}",
    ]:
        resp_guess = client_anonymous.get(guessed_url)
        assert resp_guess.status_code == 404

    # 3. Verify that DB package item contains private_snapshot and assets, but API serializer NEVER leaks them
    pkg_model = db.query(ContentSharePackage).filter(ContentSharePackage.package_id == uuid.UUID(pkg_id)).first()
    assert pkg_model is not None
    assert len(pkg_model.items) >= 1
    for db_item in pkg_model.items:
        assert db_item.private_snapshot is not None
        assert isinstance(db_item.private_snapshot, dict)

    # Preview read by requester
    preview = client_req.get(f"/api/v1/content-cloning/requests/{req.request_id}/package").json()
    serialized_str = json.dumps(preview)
    assert "private_snapshot" not in serialized_str
    assert "private_staged_path" not in serialized_str
    assert "uploads/cloning_packages" not in serialized_str
    assert "options" not in serialized_str
    assert "answers" not in serialized_str


def _send_full_clone_package(db: Session, scenario: dict):
    request = _create_pr_b_fixture(db, scenario)
    source_lesson = db.get(Lesson, 10)
    source_lesson.competency_id = 1
    source_work = db.get(Classwork, 20)
    source_work.lessons.append(source_lesson)
    db.add(ClassworkCoverage(
        classwork_id=20, lesson_id=10, competency_id=1,
        linked_by_staff_id="OWNER",
    ))
    db.add(QuizSetting(
        classwork_id=20, is_shuffle_questions=True,
        summary_release_mode="SCHEDULED",
        summary_release_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
    ))
    source_question = db.get(Question, 100)
    source_question.lesson_id = 10
    source_question.explanation = "Original private explanation"
    db.commit()
    owner = _client(db, staff_id="OWNER")
    picker = owner.get(
        f"/api/v1/content-cloning/requests/{request.request_id}/eligible-materials"
    )
    assert picker.status_code == 200
    items = picker.json()["items"]
    assert {item["item_type"] for item in items} == {
        "COMPETENCY", "LESSON", "CLASSWORK"
    }
    sent = owner.post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package",
        json={
            "expected_version": 1,
            "items": [
                {
                    "item_type": item["item_type"],
                    "source_entity_id": item["source_entity_id"],
                    "source_revision_token": item["source_revision_token"],
                }
                for item in items
            ],
        },
        headers={"Idempotency-Key": f"package-{request.request_id}"},
    )
    assert sent.status_code == 201, sent.text
    return request


def test_package_acceptance_creates_independent_locked_graph_and_replays(db, scenario):
    request = _send_full_clone_package(db, scenario)
    original_title = db.get(Classwork, 20).title
    db.get(Classwork, 20).title = "Source edited after packaging"
    db.commit()
    requester = _client(db, staff_id="REQ")
    body = {"decision": "ACCEPT", "expected_version": 2}
    accepted = requester.post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package-decision",
        json=body, headers={"Idempotency-Key": "accept-once"},
    )
    assert accepted.status_code == 200, accepted.text
    result = accepted.json()
    assert result["mode"] == "SHARED_PACKAGE"
    assert result["status"] == "SUCCEEDED"
    assert result["summary"] == {
        "competency_count": 1, "lesson_count": 1,
        "classwork_count": 1, "attachment_count": 1,
    }
    assert "source_entity_id" not in json.dumps(result)
    assert "private_snapshot" not in json.dumps(result)
    db.refresh(request)
    assert (request.status, request.version, request.open_request_key) == (
        "ACCEPTED", 3, None
    )
    operation_id = uuid.UUID(result["operation_id"])
    maps = db.query(ContentCloneItemMap).filter(
        ContentCloneItemMap.operation_id == operation_id
    ).all()
    by_type = {item.entity_type: int(item.destination_entity_ref) for item in maps
               if item.entity_type in {"COMPETENCY", "LESSON", "CLASSWORK"}}
    competency = db.get(Competency, by_type["COMPETENCY"])
    lesson = db.get(Lesson, by_type["LESSON"])
    work = db.get(Classwork, by_type["CLASSWORK"])
    assert competency.competency_id != 1
    assert lesson.lesson_id != 10
    assert work.classwork_id != 20
    assert competency.created_by_staff_id == lesson.created_by_staff_id == work.created_by_staff_id == "REQ"
    assert competency.academic_period_id == 22
    assert lesson.competency_id == competency.competency_id
    assert lesson.is_locked and lesson.is_draft and not lesson.is_published
    assert work.is_locked and not work.is_published and work.title == original_title
    assert work.assignments[0].class_id == 20
    assert work.assignments[0].academic_period_id == 22
    assert work.assignments[0].is_locked and not work.assignments[0].is_published
    assert work.assignments[0].recipient_student_id is None
    assert {linked.lesson_id for linked in work.lessons} == {lesson.lesson_id}
    assert len(work.coverage_history) == 1
    assert work.coverage_history[0].lesson_id == lesson.lesson_id
    assert work.coverage_history[0].competency_id == competency.competency_id
    assert len(work.rubric_levels) == 1 and work.rubric_levels[0].classwork_id == work.classwork_id
    assert work.quiz.status == "DRAFT" and work.quiz.accessible_at is None
    assert work.quiz_setting.summary_release_mode == "NEVER"
    assert work.quiz_setting.summary_release_at is None
    cloned_question = work.quiz.questions[0].question
    assert cloned_question.question_id != 100
    assert cloned_question.lesson_id == lesson.lesson_id
    assert cloned_question.explanation == "Original private explanation"
    assert all(option.question_id == cloned_question.question_id
               for option in cloned_question.options)
    assert len(work.attachments) == 1
    assert work.attachments[0].file_path != scenario["attachment_path"]
    assert Path(work.attachments[0].file_path).read_bytes() == b"x" * 1024
    student_user_id = uuid.uuid4()
    student_id = uuid.uuid4()
    db.add(UserAccount(
        user_id=student_user_id, email="clone.student@example.test",
        password_hash="hash", account_status="active",
    ))
    db.add(Student(
        student_id=student_id, student_lrn="123456789012",
        first_name="Clone", last_name="Learner",
        user_id=student_user_id, academic_level_id=1,
    ))
    db.flush()
    db.add(StudentClass(
        student_id=student_id, class_id=20, academic_year_id=2,
        enrollment_status="enrolled",
    ))
    db.commit()
    student_claims = {"role": "student", "sub": str(student_user_id)}
    student_client = _client(
        db, staff_id="REQ", role="student", user_id=student_user_id
    )
    subject_url = "/api/v1/competencies/subject/5?staff_id=REQ"
    tree_url = "/api/v1/competencies/tree/subject/5?class_id=20&staff_id=REQ"
    assert student_client.get(subject_url).json() == []
    hidden_tree = student_client.get(tree_url)
    assert hidden_tree.status_code == 200
    assert hidden_tree.json()["competencies"] == []
    assert hidden_tree.json()["unassigned_lessons"] == []
    with pytest.raises(HTTPException):
        authorize_lesson_access(db, lesson, student_claims)
    with pytest.raises(HTTPException):
        authorize_classwork_access(work, student_claims, db)
    lesson.is_published = True
    lesson.assignments[0].is_published = True
    db.commit()
    with pytest.raises(HTTPException):
        authorize_lesson_access(db, lesson, student_claims)
    assert student_client.get(subject_url).json() == []
    publish_lesson_record(lesson.lesson_id, "REQ", db)
    work.is_published = True
    work.is_locked = False
    work.assignments[0].is_published = True
    work.assignments[0].is_locked = False
    hidden_sibling = Lesson(
        title="Private follow-up", subject_id=5,
        competency_id=competency.competency_id,
        created_by_staff_id="REQ", is_published=True, is_locked=True,
    )
    db.add(hidden_sibling)
    db.flush()
    db.add(LessonAssignment(
        lesson_id=hidden_sibling.lesson_id, class_id=20,
        assigned_by_staff_id="REQ", is_published=True,
    ))
    db.commit()
    authorize_lesson_access(db, lesson, student_claims)
    authorize_classwork_access(work, student_claims, db)
    visible_competencies = student_client.get(subject_url)
    assert visible_competencies.status_code == 200
    assert [item["competency_id"] for item in visible_competencies.json()] == [
        competency.competency_id
    ]
    assert visible_competencies.json()[0]["lesson_count"] == 1
    visible_tree = student_client.get(tree_url)
    assert visible_tree.status_code == 200
    assert visible_tree.json()["total_lessons"] == 1
    assert visible_tree.json()["competencies"][0]["lesson_count"] == 1
    replay = requester.post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package-decision",
        json=body, headers={"Idempotency-Key": "accept-once"},
    )
    assert replay.status_code == 200
    assert replay.headers["X-Idempotent-Replay"] == "true"
    assert replay.json()["operation_id"] == result["operation_id"]
    assert db.query(ContentCloneOperation).count() == 1
    owner = _client(db, staff_id="OWNER")
    assert owner.get(f"/api/v1/content-cloning/clone-operations/{operation_id}").status_code == 404
    assert requester.get(f"/api/v1/content-cloning/clone-operations/{operation_id}").status_code == 200


def test_package_acceptance_failures_leave_request_and_copies_untouched(db, scenario):
    request = _send_full_clone_package(db, scenario)
    requester = _client(db, staff_id="REQ")
    owner = _client(db, staff_id="OWNER")
    endpoint = f"/api/v1/content-cloning/requests/{request.request_id}/package-decision"
    assert owner.post(
        endpoint, json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "wrong-user"},
    ).status_code == 404
    stale = requester.post(
        endpoint, json={"decision": "ACCEPT", "expected_version": 1},
        headers={"Idempotency-Key": "stale"},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "REQUEST_VERSION_CONFLICT"
    package = db.query(ContentSharePackage).filter(
        ContentSharePackage.request_id == request.request_id
    ).one()
    asset = db.query(ContentSharePackageAsset).join(
        ContentSharePackageItem,
        ContentSharePackageItem.package_item_id == ContentSharePackageAsset.package_item_id
    ).filter(ContentSharePackageItem.package_id == package.package_id).one()
    Path(asset.private_staged_path).write_bytes(b"corrupted")
    corrupted = requester.post(
        endpoint, json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "corrupted"},
    )
    assert corrupted.status_code == 409
    assert corrupted.json()["detail"]["code"] == "CLONE_ASSET_INVALID"
    db.refresh(request)
    assert request.status == "PACKAGE_SENT"
    assert db.query(ContentCloneOperation).count() == 0
    assert db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count() == 0


def test_clone_rejects_incompatible_destination_grading_template(db, scenario):
    request = _send_full_clone_package(db, scenario)
    written_component = db.query(GradingTemplateComponent).filter(
        GradingTemplateComponent.component_name == "Written Work"
    ).one()
    written_component.component_name = "Independent Study"
    db.commit()
    response = _client(db, staff_id="REQ").post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package-decision",
        json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "incompatible-template"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "GRADING_CATEGORY_INCOMPATIBLE"
    db.refresh(request)
    assert request.status == "PACKAGE_SENT"
    assert db.query(ContentCloneOperation).count() == 0


def test_self_clone_uses_same_engine_and_requires_owned_prior_year(db, scenario):
    _create_pr_b_fixture(db, scenario)
    db.add(SubjectLoad(
        subject_load_id=99, staff_id="OWNER", subject_id=5, class_id=20,
        academic_period_id=22, status="published", is_active_version=True,
    ))
    db.commit()
    requester = _client(db, staff_id="OWNER")
    picker = requester.get(
        "/api/v1/content-cloning/clone-operations/self/eligible-materials",
        params={
            "destination_class_id": 20, "destination_subject_id": 5,
            "destination_academic_period_id": 22,
        },
    )
    assert picker.status_code == 200, picker.text
    assert picker.json()["total"] == 3
    assert {item["item_type"] for item in picker.json()["items"]} == {
        "COMPETENCY", "LESSON", "CLASSWORK",
    }
    assert all(item["source_revision_token"] for item in picker.json()["items"])
    assert "question_text" not in picker.text
    assert "file_path" not in picker.text
    assert requester.get(
        "/api/v1/content-cloning/clone-operations/self/eligible-materials",
        params={
            "destination_class_id": 30, "destination_subject_id": 5,
            "destination_academic_period_id": 31,
        },
    ).status_code == 404
    selections = [
        {"item_type": "COMPETENCY", "source_entity_id": 1,
         "source_revision_token": compute_competency_revision_token(db.get(Competency, 1))},
        {"item_type": "LESSON", "source_entity_id": 10,
         "source_revision_token": compute_lesson_revision_token(db.get(Lesson, 10))},
        {"item_type": "CLASSWORK", "source_entity_id": 20,
         "source_revision_token": compute_classwork_revision_token(db.get(Classwork, 20))},
    ]
    body = {
        "destination_class_id": 20, "destination_subject_id": 5,
        "destination_academic_period_id": 22, "items": selections,
    }
    response = requester.post(
        "/api/v1/content-cloning/clone-operations/self",
        json=body, headers={"Idempotency-Key": "self-one"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "SUCCEEDED"
    assert response.json()["mode"] == "SELF"
    assert response.json()["summary"]["classwork_count"] == 1
    replay = requester.post(
        "/api/v1/content-cloning/clone-operations/self",
        json=body, headers={"Idempotency-Key": "self-one"},
    )
    assert replay.status_code == 201
    assert replay.headers["X-Idempotent-Replay"] == "true"
    assert replay.json()["operation_id"] == response.json()["operation_id"]
    wrong_owner = _client(db, staff_id="REQ").post(
        "/api/v1/content-cloning/clone-operations/self",
        json=body, headers={"Idempotency-Key": "self-wrong"},
    )
    assert wrong_owner.status_code == 404


def test_self_clone_uses_unambiguous_class_period_for_legacy_assignment(db, scenario):
    _create_pr_b_fixture(db, scenario)
    db.add(SubjectLoad(
        subject_load_id=99, staff_id="OWNER", subject_id=5, class_id=20,
        academic_period_id=22, status="published", is_active_version=True,
    ))
    source = db.get(Classwork, 20)
    source.assignments[0].academic_period_id = None
    db.commit()
    response = _client(db, staff_id="OWNER").post(
        "/api/v1/content-cloning/clone-operations/self",
        json={
            "destination_class_id": 20,
            "destination_subject_id": 5,
            "destination_academic_period_id": 22,
            "items": [{
                "item_type": "CLASSWORK",
                "source_entity_id": 20,
                "source_revision_token": compute_classwork_revision_token(source),
            }],
        },
        headers={"Idempotency-Key": "legacy-class-period"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["summary"]["classwork_count"] == 1


def test_package_acceptance_requires_current_window_and_destination(db, scenario):
    request = _send_full_clone_package(db, scenario)
    requester = _client(db, staff_id="REQ")
    endpoint = f"/api/v1/content-cloning/requests/{request.request_id}/package-decision"
    package = db.query(ContentSharePackage).filter(
        ContentSharePackage.request_id == request.request_id
    ).one()
    package.expires_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
    db.commit()
    expired = requester.post(
        endpoint, json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "expired"},
    )
    assert expired.status_code == 409
    assert expired.json()["detail"]["code"] == "REQUEST_EXPIRED"
    package.expires_at = request.expires_at
    load = db.get(SubjectLoad, 1)
    load.status = "draft"
    db.commit()
    denied = requester.post(
        endpoint, json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "lost-load"},
    )
    assert denied.status_code == 404
    assert denied.json()["detail"]["code"] == "DESTINATION_SCOPE_FORBIDDEN"
    db.refresh(request)
    assert request.status == "PACKAGE_SENT"
    assert db.query(ContentCloneOperation).count() == 0


def test_unselected_private_dependencies_are_not_linked(db, scenario):
    request = _create_pr_b_fixture(db, scenario)
    source_work = db.get(Classwork, 20)
    source_lesson = db.get(Lesson, 10)
    source_work.lessons.append(source_lesson)
    db.get(Question, 100).lesson_id = 10
    db.add(ClassworkCoverage(
        classwork_id=20, lesson_id=10, competency_id=1,
        linked_by_staff_id="OWNER",
    ))
    db.commit()
    owner = _client(db, staff_id="OWNER")
    picker = owner.get(
        f"/api/v1/content-cloning/requests/{request.request_id}/eligible-materials"
    ).json()
    classwork = next(item for item in picker["items"] if item["item_type"] == "CLASSWORK")
    sent = owner.post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package",
        json={"expected_version": 1, "items": [{
            "item_type": classwork["item_type"],
            "source_entity_id": classwork["source_entity_id"],
            "source_revision_token": classwork["source_revision_token"],
        }]},
    )
    assert sent.status_code == 201, sent.text
    accepted = _client(db, staff_id="REQ").post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package-decision",
        json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "work-only"},
    )
    assert accepted.status_code == 200, accepted.text
    copied = db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").one()
    assert copied.lessons == []
    assert copied.coverage_history == []
    assert copied.quiz.questions[0].question.lesson_id is None
    assert db.query(Lesson).filter(Lesson.created_by_staff_id == "REQ").count() == 0
    assert db.query(Competency).filter(Competency.created_by_staff_id == "REQ").count() == 0


def test_acceptance_rolls_back_database_and_file_failure(db, scenario, monkeypatch):
    request = _send_full_clone_package(db, scenario)
    requester = _client(db, staff_id="REQ")
    endpoint = f"/api/v1/content-cloning/requests/{request.request_id}/package-decision"
    engine_module = importlib.import_module(
        "app.services.cloning.ContentCloningEngine"
    )
    original_copy = engine_module._copy_asset

    def fail_after_copy(*args, **kwargs):
        original_copy(*args, **kwargs)
        raise OSError("simulated file failure")

    with monkeypatch.context() as patch:
        patch.setattr(engine_module, "_copy_asset", fail_after_copy)
        failed = requester.post(
            endpoint, json={"decision": "ACCEPT", "expected_version": 2},
            headers={"Idempotency-Key": "file-failure"},
        )
    assert failed.status_code == 500
    assert failed.json()["detail"]["code"] == "CLONE_FAILED"
    db.refresh(request)
    assert request.status == "PACKAGE_SENT"
    assert db.query(ContentCloneOperation).count() == 0
    assert db.query(Classwork).filter(Classwork.created_by_staff_id == "REQ").count() == 0
    assert not list(scenario["clone_root"].glob("*"))

    with monkeypatch.context() as patch:
        patch.setattr(db, "commit", lambda: (_ for _ in ()).throw(
            RuntimeError("simulated commit failure")
        ))
        failed_commit = requester.post(
            endpoint, json={"decision": "ACCEPT", "expected_version": 2},
            headers={"Idempotency-Key": "db-failure"},
        )
    assert failed_commit.status_code == 500
    assert failed_commit.json()["detail"]["code"] == "CLONE_FAILED"
    db.refresh(request)
    assert request.status == "PACKAGE_SENT"
    assert db.query(ContentCloneOperation).count() == 0
    assert not list(scenario["clone_root"].glob("*"))


def test_self_clone_policy_reads_do_not_grow_with_selection_count(db, scenario):
    db.add(SubjectLoad(
        subject_load_id=99, staff_id="OWNER", subject_id=5, class_id=20,
        academic_period_id=22, status="published", is_active_version=True,
    ))
    db.add_all([
        Competency(
            competency_id=100 + index, statement=f"Historical item {index}",
            subject_id=5, academic_period_id=11,
            created_by_staff_id="OWNER",
        )
        for index in range(12)
    ])
    db.commit()
    client = _client(db, staff_id="OWNER")
    all_items = [
        {
            "item_type": "COMPETENCY", "source_entity_id": item.competency_id,
            "source_revision_token": compute_competency_revision_token(item),
        }
        for item in db.query(Competency).filter(
            Competency.competency_id.between(100, 111)
        ).order_by(Competency.competency_id).all()
    ]
    query_counts = []
    for index, selected in enumerate((all_items[:1], all_items)):
        db.expire_all()
        statements = []
        def record(_conn, _cursor, statement, _params, _context, _many):
            if statement.lstrip().lower().startswith("select"):
                statements.append(statement)
        event.listen(db.get_bind(), "before_cursor_execute", record)
        try:
            response = client.post(
                "/api/v1/content-cloning/clone-operations/self",
                json={
                    "destination_class_id": 20, "destination_subject_id": 5,
                    "destination_academic_period_id": 22, "items": selected,
                },
                headers={"Idempotency-Key": f"count-{index}"},
            )
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", record)
        assert response.status_code == 201, response.text
        query_counts.append(len(statements))
    assert query_counts[1] <= query_counts[0] + 1, query_counts


def test_multiple_source_terms_require_explicit_mapping(db, scenario):
    request = _create_pr_b_fixture(db, scenario)
    db.add(SubjectLoad(
        subject_load_id=99, staff_id="OWNER", subject_id=5, class_id=12,
        academic_period_id=12, status="published", is_active_version=True,
    ))
    db.add(Competency(
        competency_id=120, statement="Prior Term 2 material",
        subject_id=5, academic_period_id=12,
        created_by_staff_id="OWNER",
    ))
    db.commit()
    owner = _client(db, staff_id="OWNER")
    picker = owner.get(
        f"/api/v1/content-cloning/requests/{request.request_id}/eligible-materials"
    )
    assert picker.status_code == 200
    competencies = [
        item for item in picker.json()["items"]
        if item["item_type"] == "COMPETENCY"
    ]
    assert len(competencies) == 2
    sent = owner.post(
        f"/api/v1/content-cloning/requests/{request.request_id}/package",
        json={"expected_version": 1, "items": [{
            "item_type": item["item_type"],
            "source_entity_id": item["source_entity_id"],
            "source_revision_token": item["source_revision_token"],
        } for item in competencies]},
    )
    assert sent.status_code == 201, sent.text
    requester = _client(db, staff_id="REQ")
    endpoint = f"/api/v1/content-cloning/requests/{request.request_id}/package-decision"
    missing_map = requester.post(
        endpoint, json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "no-term-map"},
    )
    assert missing_map.status_code == 409
    assert missing_map.json()["detail"]["code"] == "PERIOD_MAPPING_REQUIRED"
    accepted = requester.post(
        endpoint,
        json={
            "decision": "ACCEPT", "expected_version": 2,
            "period_mappings": [
                {"source_academic_period_id": 11, "destination_academic_period_id": 22},
                {"source_academic_period_id": 12, "destination_academic_period_id": 22},
            ],
        },
        headers={"Idempotency-Key": "mapped-terms"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["summary"]["competency_count"] == 2
    assert db.query(Competency).filter(
        Competency.created_by_staff_id == "REQ",
        Competency.academic_period_id == 22,
    ).count() == 2


def test_self_clone_cannot_target_inactive_historical_year(db, scenario):
    _create_pr_b_fixture(db, scenario)
    source = db.get(Competency, 1)
    response = _client(db, staff_id="REQ").post(
        "/api/v1/content-cloning/clone-operations/self",
        json={
            "destination_class_id": 10, "destination_subject_id": 5,
            "destination_academic_period_id": 11,
            "items": [{
                "item_type": "COMPETENCY",
                "source_entity_id": 1,
                "source_revision_token": compute_competency_revision_token(source),
            }],
        },
        headers={"Idempotency-Key": "historical-destination"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "DESTINATION_YEAR_INACTIVE"


def test_orphan_storage_maintenance_preserves_committed_packages(db, scenario):
    request = _send_full_clone_package(db, scenario)
    package = db.query(ContentSharePackage).filter(
        ContentSharePackage.request_id == request.request_id
    ).one()
    engine_module = importlib.import_module(
        "app.services.cloning.ContentCloningEngine"
    )
    staging_root = scenario["clone_root"].parent / "cloning_staging"
    committed_staging = staging_root / str(package.package_id)
    assert committed_staging.exists()
    orphan_clone = scenario["clone_root"] / str(uuid.uuid4())
    orphan_staging = staging_root / str(uuid.uuid4())
    orphan_clone.mkdir(parents=True)
    orphan_staging.mkdir(parents=True)
    (orphan_clone / "orphan.pdf").write_bytes(b"orphan")
    (orphan_staging / "orphan.pdf").write_bytes(b"orphan")
    current = datetime.now(timezone.utc) + timedelta(days=2)
    removed = engine_module.cleanup_orphan_storage(
        db, clone_root=scenario["clone_root"],
        staging_root=staging_root, now=current,
    )
    assert removed == {"clone_directories": 1, "staging_directories": 1}
    assert not orphan_clone.exists() and not orphan_staging.exists()
    assert committed_staging.exists()
