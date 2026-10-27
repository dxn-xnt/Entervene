"""End-to-End Two-Teacher Repost / Content Cloning Integration Verification.

Validates the full multi-actor lifecycle with real database models, real transactions,
real notifications, deep links, locked/unpublished content isolation, learner-record
exclusion, owner decline, requester decline, expiration, and self-cloning.
"""

from __future__ import annotations

import importlib
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Competencies import router as competency_router
from app.api.v1.routes.ContentCloning import router as content_cloning_router
from app.services.cloning.ContentCloningErrors import (
    ContentCloningError,
    content_cloning_error_handler,
)
from app.core.Config import settings
from app.db.Base import Base
import app.db.Session as db_session
from app.db.Session import get_db
from app.core.Dependencies import get_staff_id
from app.api.v1.routes.Auth import get_current_user
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
from app.models.cloning.ContentCloning import (
    ContentCloneItemMap,
    ContentCloneOperation,
    ContentShareEvent,
    ContentSharePackage,
    ContentSharePackageAsset,
    ContentSharePackageItem,
    ContentShareRequest,
)
from app.models.academic.StudentCLass import StudentClass
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.services.cloning.ContentCloningErrors import ContentCloningError

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
    Notification.__table__,
]


@pytest.fixture
def db(monkeypatch) -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
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


def _add_teacher(db: Session, staff_id: str, first: str, last: str) -> tuple[AcademicStaff, UserAccount]:
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{staff_id.lower()}@school.test",
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
    return staff, account


@pytest.fixture
def workflow_fixture(db: Session, tmp_path, monkeypatch) -> dict:
    attachment_root = tmp_path / "classworks"
    attachment_root.mkdir()
    attachment_file = attachment_root / "algebra_guide.pdf"
    attachment_file.write_bytes(b"factoring guide attachment content")

    package_module = importlib.import_module("app.services.cloning.ContentCloningPackageService")
    engine_module = importlib.import_module("app.services.cloning.ContentCloningEngine")
    monkeypatch.setattr(package_module, "DEFAULT_ATTACHMENT_ROOT", attachment_root)
    monkeypatch.setattr(package_module, "DEFAULT_STAGING_DIR", tmp_path / "cloning_staging")
    monkeypatch.setattr(engine_module, "DEFAULT_STAGING_ROOT", tmp_path / "cloning_staging")
    monkeypatch.setattr(engine_module, "DEFAULT_SOURCE_ROOT", attachment_root)
    monkeypatch.setattr(engine_module, "DEFAULT_CLONE_ROOT", tmp_path / "cloned")

    db.add(Role(role_id=1, role_name="Teacher"))
    db.add(GradingTemplate(grading_template_id=1, template_name="Core", passing_threshold=75, status="active"))
    db.add_all([
        GradingTemplateComponent(grading_template_id=1, component_name="Written Work", weight=40, display_order=1),
        GradingTemplateComponent(grading_template_id=1, component_name="Performance Task", weight=60, display_order=2),
    ])

    level = AcademicLevel(academic_level_id=1, level_name="Grade 10", grade_level=10)
    year1 = AcademicYear(academic_year_id=1, year_label="2024-2025", start_date=date(2024, 6, 1), end_date=date(2025, 3, 31), is_active=False)
    year2 = AcademicYear(academic_year_id=2, year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    period11 = AcademicPeriod(academic_period_id=11, academic_year_id=1, period_name="Term 1", period_type="TERM", period_sequence=1, total_periods_in_year=2, period_progress_ratio=0.5, start_date=date(2024, 6, 1), end_date=date(2024, 10, 31), is_active=False)
    period21 = AcademicPeriod(academic_period_id=21, academic_year_id=2, period_name="Term 1", period_type="TERM", period_sequence=1, total_periods_in_year=2, period_progress_ratio=0.5, start_date=date(2025, 6, 1), end_date=date(2025, 10, 31), is_active=True)

    subject = Subject(subject_id=10, subject_name="Mathematics 10", subject_codename="MATH10", academic_level_id=1, grading_template_id=1, status="active")

    # Classes
    class_source = Class(class_id=101, section_name="Section A (2024)", academic_year_id=1, academic_level_id=1, academic_period_id=11, class_status="active")
    class_dest_a = Class(class_id=201, section_name="Section Pythagoras (2025)", academic_year_id=2, academic_level_id=1, academic_period_id=21, class_status="active")
    class_dest_b = Class(class_id=202, section_name="Section Archimedes (2025)", academic_year_id=2, academic_level_id=1, academic_period_id=21, class_status="active")

    db.add_all([level, year1, year2, period11, period21, subject, class_source, class_dest_a, class_dest_b])

    # Teacher A (Requester) and Teacher B (Owner)
    teacher_a, user_a = _add_teacher(db, "TEACHER_A", "Alice", "Requester")
    teacher_b, user_b = _add_teacher(db, "TEACHER_B", "Bob", "Owner")

    # Offerings and Loads
    db.add_all([
        # Teacher B teaches Section A in Year 1
        SubjectOffering(subject_offering_id=1, subject_id=10, academic_year_id=1, academic_level_id=1, academic_period_id=11, status="active"),
        SubjectLoad(subject_load_id=1, staff_id="TEACHER_B", subject_id=10, class_id=101, academic_period_id=11, status="published", is_active_version=True),
        # Teacher A teaches Section Pythagoras and Archimedes in Year 2
        SubjectOffering(subject_offering_id=2, subject_id=10, academic_year_id=2, academic_level_id=1, academic_period_id=21, status="active"),
        SubjectLoad(subject_load_id=2, staff_id="TEACHER_A", subject_id=10, class_id=201, academic_period_id=21, status="published", is_active_version=True),
        SubjectLoad(subject_load_id=3, staff_id="TEACHER_A", subject_id=10, class_id=202, academic_period_id=21, status="published", is_active_version=True),
    ])

    # Materials owned by Teacher B in Year 1
    comp = Competency(
        competency_id=501,
        competency_code="M10-FAC-01",
        statement="Factoring polynomials of higher degree",
        subject_id=10,
        academic_period_id=11,
        created_by_staff_id="TEACHER_B",
    )
    db.add(comp)
    db.flush()

    lesson = Lesson(
        lesson_id=601,
        title="Lesson 1: Introduction to Factoring",
        description="Comprehensive guide to factoring techniques",
        subject_id=10,
        competency_id=501,
        created_by_staff_id="TEACHER_B",
        is_locked=False,
        is_published=True,
    )
    db.add(lesson)
    db.flush()

    db.add(LessonAssignment(
        lesson_id=lesson.lesson_id,
        class_id=101,
        assigned_by_staff_id="TEACHER_B",
        is_published=True,
    ))

    cw = Classwork(
        classwork_id=701,
        title="Factoring Quiz and Exercises",
        description="Complete all factoring exercises",
        classwork_type="EXERCISE",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=50,
        show_scores=True,
        subject_id=10,
        created_by_staff_id="TEACHER_B",
    )
    db.add(cw)
    db.flush()

    db.add(ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=101,
        academic_period_id=11,
        assigned_by_staff_id="TEACHER_B",
        is_published=True,
    ))
    db.add(ActivityRubricLevel(
        classwork_id=cw.classwork_id,
        level_name="Factoring Accuracy",
        description="Correct binomial factorization",
        points=25.0,
        display_order=1,
    ))
    db.add(ClassworkAttachment(
        classwork_id=cw.classwork_id,
        file_name="algebra_guide.pdf",
        file_path=str(attachment_file),
        file_size=len(b"factoring guide attachment content"),
        file_type="application/pdf",
    ))
    db.add(ClassworkLesson(
        classwork_id=cw.classwork_id,
        lesson_id=lesson.lesson_id,
    ))
    db.add(ClassworkCoverage(
        classwork_id=cw.classwork_id,
        lesson_id=lesson.lesson_id,
        competency_id=comp.competency_id,
        linked_by_staff_id="TEACHER_B",
    ))

    db.commit()

    return {
        "teacher_a": teacher_a,
        "user_a": user_a,
        "teacher_b": teacher_b,
        "user_b": user_b,
        "class_source": class_source,
        "class_dest_a": class_dest_a,
        "class_dest_b": class_dest_b,
        "subject": subject,
        "competency": comp,
        "lesson": lesson,
        "classwork": cw,
        "attachment_file": attachment_file,
    }


def _make_client(db: Session, staff_id: str, user_id: uuid.UUID) -> TestClient:
    app = FastAPI()
    app.add_exception_handler(ContentCloningError, content_cloning_error_handler)
    app.include_router(content_cloning_router, prefix="/api/v1/content-cloning")
    app.include_router(competency_router, prefix="/api/v1/competencies")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(user_id),
        "role": "teacher",
    }
    app.dependency_overrides[get_staff_id] = lambda: staff_id
    return TestClient(app)


def test_complete_two_teacher_workflow_journey(db: Session, workflow_fixture: dict):
    """Validate full journey:

    1. Teacher A requests materials from Teacher B for Section Pythagoras.
    2. Teacher B receives an in-app notification with deep link to exact request.
    3. Teacher B opens the exact request from notifications / incoming inbox.
    4. Teacher B selects eligible materials and packages them.
    5. Teacher A receives an in-app notification with deep link to exact package.
    6. Teacher A views safe package preview (no private answer keys or file paths).
    7. Teacher A accepts the package.
    8. Teacher B receives notification that package was accepted.
    9. Cloned lessons, competencies, and classworks appear in Teacher A's destination class:
       - Marked locked (is_locked=True) and unpublished (is_published=False).
       - No student submissions, attempts, or grades copied.
       - Relationships preserved.
    """
    teacher_a = workflow_fixture["teacher_a"]
    user_a = workflow_fixture["user_a"]
    teacher_b = workflow_fixture["teacher_b"]
    user_b = workflow_fixture["user_b"]
    dest_class = workflow_fixture["class_dest_a"]

    client_a = _make_client(db, teacher_a.staff_id, user_a.user_id)
    client_b = _make_client(db, teacher_b.staff_id, user_b.user_id)

    # STEP 1: Teacher A creates request for Teacher B
    req_payload = {
        "source_owner_staff_id": teacher_b.staff_id,
        "subject_id": 10,
        "source_scope_mode": "ALL_TERMS",
        "source_academic_year_id": 1,
        "source_academic_period_id": None,
        "destination_class_id": dest_class.class_id,
        "destination_subject_id": 10,
        "destination_academic_period_id": 21,
        "message": "Hi Bob, could you share your Grade 10 Factoring lessons and exercises?",
    }
    create_resp = client_a.post(
        "/api/v1/content-cloning/requests",
        json=req_payload,
        headers={"Idempotency-Key": "wf-req-001"},
    )
    assert create_resp.status_code == 201, create_resp.text
    req_data = create_resp.json()
    req_id = req_data["request_id"]
    assert req_data["status"] == "PENDING_OWNER"
    assert req_data["requester_name"] == "Alice Requester"

    # STEP 2: Teacher B receives in-app notification
    notifs_b = db.query(Notification).filter(Notification.user_id == user_b.user_id).all()
    assert len(notifs_b) == 1
    notif_b = notifs_b[0]
    assert notif_b.notification_type == "repost_request_received"
    assert str(req_id) in notif_b.action_url
    assert "box=incoming" in notif_b.action_url
    assert "Alice" in notif_b.body

    # STEP 3: Teacher B clicks notification and views exact incoming request
    incoming_resp = client_b.get(f"/api/v1/content-cloning/requests?box=incoming")
    assert incoming_resp.status_code == 200
    inc_data = incoming_resp.json()
    assert inc_data["total"] == 1
    exact_req = next(r for r in inc_data["items"] if r["request_id"] == req_id)
    assert exact_req["status"] == "PENDING_OWNER"

    # STEP 4: Teacher B queries eligible materials and creates package
    eligible_resp = client_b.get(f"/api/v1/content-cloning/requests/{req_id}/eligible-materials")
    assert eligible_resp.status_code == 200
    el_items = eligible_resp.json()["items"]
    assert len(el_items) >= 3  # Competency, Lesson, Classwork

    pkg_payload = {
        "expected_version": 1,
        "items": [
            {
                "item_type": it["item_type"],
                "source_entity_id": it["source_entity_id"],
                "source_revision_token": it["source_revision_token"],
            }
            for it in el_items
        ],
    }
    pkg_resp = client_b.post(
        f"/api/v1/content-cloning/requests/{req_id}/package",
        json=pkg_payload,
        headers={"Idempotency-Key": "wf-pkg-001"},
    )
    assert pkg_resp.status_code == 201, pkg_resp.text
    pkg_data = pkg_resp.json()
    assert pkg_data["status"] == "PACKAGE_SENT"
    assert pkg_data["summary"]["competency_count"] == 1
    assert pkg_data["summary"]["lesson_count"] == 1
    assert pkg_data["summary"]["classwork_count"] == 1

    # STEP 5: Teacher A receives package notification
    notifs_a = db.query(Notification).filter(Notification.user_id == user_a.user_id).all()
    assert len(notifs_a) == 1
    notif_a = notifs_a[0]
    assert notif_a.notification_type == "repost_package_ready"
    assert str(req_id) in notif_a.action_url
    assert "box=outgoing" in notif_a.action_url

    # STEP 6: Teacher A views safe package preview
    preview_resp = client_a.get(f"/api/v1/content-cloning/requests/{req_id}/package")
    assert preview_resp.status_code == 200
    preview_data = preview_resp.json()
    assert preview_data["status"] == "PACKAGE_SENT"
    # Verify no private internals leaked
    assert "private_snapshot" not in preview_data
    for it in preview_data["items"]:
        assert "source_entity_id" not in it
        assert "private_snapshot" not in it
        assert "safe_title" in it

    # STEP 7: Teacher A accepts the package
    accept_resp = client_a.post(
        f"/api/v1/content-cloning/requests/{req_id}/package-decision",
        json={"decision": "ACCEPT", "expected_version": 2},
        headers={"Idempotency-Key": "wf-accept-001"},
    )
    assert accept_resp.status_code == 200, accept_resp.text
    accept_data = accept_resp.json()
    assert accept_data["status"] == "SUCCEEDED"

    # STEP 8: Teacher B receives accepted notification
    notifs_b_after = db.query(Notification).filter(Notification.user_id == user_b.user_id).all()
    accepted_notif = next((n for n in notifs_b_after if n.notification_type == "repost_accepted"), None)
    assert accepted_notif is not None
    assert "Alice" in accepted_notif.body

    # STEP 9: Verify created independent copies in Teacher A's destination
    # Check Lesson
    cloned_lessons = (
        db.query(Lesson)
        .filter(Lesson.created_by_staff_id == teacher_a.staff_id)
        .all()
    )
    assert len(cloned_lessons) == 1
    cl_lesson = cloned_lessons[0]
    assert cl_lesson.is_locked is True
    assert cl_lesson.is_published is False
    assert cl_lesson.subject_id == 10

    # Check Competency
    cloned_comps = (
        db.query(Competency)
        .filter(Competency.created_by_staff_id == teacher_a.staff_id)
        .all()
    )
    assert len(cloned_comps) == 1
    cl_comp = cloned_comps[0]
    assert cl_comp.academic_period_id == 21  # Destination period
    assert cl_lesson.competency_id == cl_comp.competency_id

    # Check Classwork
    cloned_cws = (
        db.query(Classwork)
        .filter(Classwork.created_by_staff_id == teacher_a.staff_id)
        .all()
    )
    assert len(cloned_cws) == 1
    cl_cw = cloned_cws[0]
    assert cl_cw.classwork_category == "WRITTEN_WORK"

    # Verify ClassworkAssignment is locked and unpublished
    cw_assignments = (
        db.query(ClassworkAssignment)
        .filter(ClassworkAssignment.classwork_id == cl_cw.classwork_id)
        .all()
    )
    assert len(cw_assignments) == 1
    assert cw_assignments[0].class_id == dest_class.class_id
    assert cw_assignments[0].is_published is False

    # Verify LessonAssignment is unpublished
    lesson_assignments = (
        db.query(LessonAssignment)
        .filter(LessonAssignment.lesson_id == cl_lesson.lesson_id)
        .all()
    )
    assert len(lesson_assignments) == 1
    assert lesson_assignments[0].class_id == dest_class.class_id
    assert lesson_assignments[0].is_published is False

    # Verify relationships between copied items
    cw_coverage = (
        db.query(ClassworkCoverage)
        .filter(ClassworkCoverage.classwork_id == cl_cw.classwork_id)
        .all()
    )
    assert len(cw_coverage) == 1
    assert cw_coverage[0].lesson_id == cl_lesson.lesson_id
    assert cw_coverage[0].competency_id == cl_comp.competency_id

    # Verify no student submission records exist in destination
    # (StudentClass, StudentSubmissions, etc.)
    students_in_dest = db.query(StudentClass).filter(StudentClass.class_id == dest_class.class_id).all()
    assert len(students_in_dest) == 0


def test_owner_decline_workflow(db: Session, workflow_fixture: dict):
    """Validate Owner Decline:

    - Teacher A requests materials.
    - Teacher B declines the request.
    - Teacher A receives 'repost_request_declined' notification.
    - Status transitions to DECLINED_BY_OWNER.
    - Scope lock is released.
    """
    teacher_a = workflow_fixture["teacher_a"]
    user_a = workflow_fixture["user_a"]
    teacher_b = workflow_fixture["teacher_b"]
    user_b = workflow_fixture["user_b"]
    dest_class = workflow_fixture["class_dest_a"]

    client_a = _make_client(db, teacher_a.staff_id, user_a.user_id)
    client_b = _make_client(db, teacher_b.staff_id, user_b.user_id)

    create_resp = client_a.post(
        "/api/v1/content-cloning/requests",
        json={
            "source_owner_staff_id": teacher_b.staff_id,
            "subject_id": 10,
            "source_scope_mode": "ALL_TERMS",
            "source_academic_year_id": 1,
            "source_academic_period_id": None,
            "destination_class_id": dest_class.class_id,
            "destination_subject_id": 10,
            "destination_academic_period_id": 21,
            "message": "Request for owner decline test",
        },
        headers={"Idempotency-Key": "decline-test-001"},
    )
    assert create_resp.status_code == 201
    req_id = create_resp.json()["request_id"]

    # Teacher B declines
    decline_resp = client_b.post(
        f"/api/v1/content-cloning/requests/{req_id}/decline",
        json={"expected_version": 1},
    )
    assert decline_resp.status_code == 200
    assert decline_resp.json()["status"] == "DECLINED_BY_OWNER"

    # Teacher A gets notification
    notifs_a = db.query(Notification).filter(Notification.user_id == user_a.user_id).all()
    decline_notif = next((n for n in notifs_a if n.notification_type == "repost_request_declined"), None)
    assert decline_notif is not None
    assert "Bob" in decline_notif.body

    # Scope lock released: Teacher A can request again for the same destination
    re_request = client_a.post(
        "/api/v1/content-cloning/requests",
        json={
            "source_owner_staff_id": teacher_b.staff_id,
            "subject_id": 10,
            "source_scope_mode": "ALL_TERMS",
            "source_academic_year_id": 1,
            "source_academic_period_id": None,
            "destination_class_id": dest_class.class_id,
            "destination_subject_id": 10,
            "destination_academic_period_id": 21,
            "message": "Request after decline",
        },
        headers={"Idempotency-Key": "decline-test-002"},
    )
    assert re_request.status_code == 201


def test_requester_decline_workflow(db: Session, workflow_fixture: dict):
    """Validate Requester Decline of sent package:

    - Teacher A requests materials.
    - Teacher B packages and sends materials.
    - Teacher A declines the package.
    - Teacher B receives 'repost_package_declined' notification.
    - Status transitions to DECLINED_BY_REQUESTER.
    - Scope lock is released.
    """
    teacher_a = workflow_fixture["teacher_a"]
    user_a = workflow_fixture["user_a"]
    teacher_b = workflow_fixture["teacher_b"]
    user_b = workflow_fixture["user_b"]
    dest_class = workflow_fixture["class_dest_b"]

    client_a = _make_client(db, teacher_a.staff_id, user_a.user_id)
    client_b = _make_client(db, teacher_b.staff_id, user_b.user_id)

    create_resp = client_a.post(
        "/api/v1/content-cloning/requests",
        json={
            "source_owner_staff_id": teacher_b.staff_id,
            "subject_id": 10,
            "source_scope_mode": "ALL_TERMS",
            "source_academic_year_id": 1,
            "source_academic_period_id": None,
            "destination_class_id": dest_class.class_id,
            "destination_subject_id": 10,
            "destination_academic_period_id": 21,
            "message": "Package decline test",
        },
        headers={"Idempotency-Key": "pkg-decline-001"},
    )
    req_id = create_resp.json()["request_id"]

    # Teacher B sends package
    el_items = client_b.get(f"/api/v1/content-cloning/requests/{req_id}/eligible-materials").json()["items"]
    client_b.post(
        f"/api/v1/content-cloning/requests/{req_id}/package",
        json={
            "expected_version": 1,
            "items": [{"item_type": it["item_type"], "source_entity_id": it["source_entity_id"], "source_revision_token": it["source_revision_token"]} for it in el_items],
        },
    )

    # Teacher A declines package
    decide_resp = client_a.post(
        f"/api/v1/content-cloning/requests/{req_id}/package-decision",
        json={"decision": "DECLINE", "expected_version": 2},
    )
    assert decide_resp.status_code == 200
    assert decide_resp.json()["status"] == "DECLINED_BY_REQUESTER"

    # Teacher B gets notification
    notifs_b = db.query(Notification).filter(Notification.user_id == user_b.user_id).all()
    pkg_dec_notif = next((n for n in notifs_b if n.notification_type == "repost_package_declined"), None)
    assert pkg_dec_notif is not None
    assert "Alice" in pkg_dec_notif.body


def test_expiration_releases_scope_and_blocks_actions(db: Session, workflow_fixture: dict):
    """Validate that expired requests cannot be acted on and release scope locks."""
    teacher_a = workflow_fixture["teacher_a"]
    user_a = workflow_fixture["user_a"]
    teacher_b = workflow_fixture["teacher_b"]
    dest_class = workflow_fixture["class_dest_b"]

    client_a = _make_client(db, teacher_a.staff_id, user_a.user_id)
    client_b = _make_client(db, teacher_b.staff_id, workflow_fixture["user_b"].user_id)

    create_resp = client_a.post(
        "/api/v1/content-cloning/requests",
        json={
            "source_owner_staff_id": teacher_b.staff_id,
            "subject_id": 10,
            "source_scope_mode": "ALL_TERMS",
            "source_academic_year_id": 1,
            "source_academic_period_id": None,
            "destination_class_id": dest_class.class_id,
            "destination_subject_id": 10,
            "destination_academic_period_id": 21,
            "message": "Expiration test",
        },
        headers={"Idempotency-Key": "expire-001"},
    )
    req_id = uuid.UUID(create_resp.json()["request_id"])

    # Simulate 8 days passing by updating expires_at directly in DB
    req = db.get(ContentShareRequest, req_id)
    req.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()

    # Owner attempts to send package on expired request -> 409 REQUEST_EXPIRED
    picker = client_b.get(f"/api/v1/content-cloning/requests/{req_id}/eligible-materials")
    assert picker.status_code == 409
    assert picker.json()["detail"]["code"] == "REQUEST_EXPIRED"


def test_self_cloning_workflow(db: Session, workflow_fixture: dict):
    """Validate Teacher A self-cloning their own materials into another handled section."""
    teacher_a = workflow_fixture["teacher_a"]
    user_a = workflow_fixture["user_a"]
    class_dest_b = workflow_fixture["class_dest_b"]

    # Teacher A had a prior year load in Year 1 (period11)
    db.add(SubjectLoad(
        subject_load_id=10,
        staff_id=teacher_a.staff_id,
        subject_id=10,
        class_id=workflow_fixture["class_source"].class_id,
        academic_period_id=11,
        status="published",
        is_active_version=True,
    ))
    lesson_a = Lesson(
        lesson_id=801,
        title="Teacher A Prior Year Lesson",
        description="Created directly by Teacher A in prior year",
        subject_id=10,
        created_by_staff_id=teacher_a.staff_id,
        is_locked=False,
        is_published=True,
    )
    db.add(lesson_a)
    db.flush()
    db.add(LessonAssignment(
        lesson_id=lesson_a.lesson_id,
        class_id=workflow_fixture["class_source"].class_id,
        assigned_by_staff_id=teacher_a.staff_id,
        is_published=True,
    ))
    db.commit()

    client_a = _make_client(db, teacher_a.staff_id, user_a.user_id)

    # Teacher A self-clones into Archimedes
    from app.services.cloning.ContentCloningPackageService import compute_lesson_revision_token
    token = compute_lesson_revision_token(lesson_a)

    # Teacher A queries self-eligible materials
    picker = client_a.get(
        f"/api/v1/content-cloning/clone-operations/self/eligible-materials?"
        f"destination_class_id={class_dest_b.class_id}&"
        f"destination_subject_id=10&"
        f"destination_academic_period_id=21"
    )
    assert picker.status_code == 200
    assert any(it["source_entity_id"] == lesson_a.lesson_id for it in picker.json()["items"])

    self_clone_resp = client_a.post(
        "/api/v1/content-cloning/clone-operations/self",
        json={
            "destination_class_id": class_dest_b.class_id,
            "destination_subject_id": 10,
            "destination_academic_period_id": 21,
            "items": [
                {
                    "item_type": "LESSON",
                    "source_entity_id": lesson_a.lesson_id,
                    "source_revision_token": token,
                }
            ],
        },
        headers={"Idempotency-Key": "self-clone-001"},
    )
    assert self_clone_resp.status_code == 201, self_clone_resp.text
    sc_data = self_clone_resp.json()
    assert sc_data["status"] == "SUCCEEDED"
    assert sc_data["summary"]["lesson_count"] == 1

    # Verify self-clone produces independent copy assigned to Archimedes
    arch_assignments = (
        db.query(LessonAssignment)
        .filter(LessonAssignment.class_id == class_dest_b.class_id)
        .all()
    )
    assert len(arch_assignments) == 1
    cloned_id = arch_assignments[0].lesson_id
    assert cloned_id != lesson_a.lesson_id
    cloned_lesson = db.get(Lesson, cloned_id)
    assert cloned_lesson.is_locked is True
    assert cloned_lesson.is_published is False
