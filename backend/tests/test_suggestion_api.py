import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Suggestions import router as suggestions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.suggestion.SuggestionClasswork import SuggestionClasswork
from app.schemas.Suggestion import RecommendationDraftRequest
from app.services.suggestion.RecommendationService import generate_recommendation_drafts


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    ClassworkLesson.__table__,
    StudentSubmission.__table__,
    StudentSuggestion.__table__,
    SuggestionClasswork.__table__,
]


@pytest.fixture
def suggestion_api_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()
    period = AcademicPeriod(
        period_name="Q1",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    subject = Subject(subject_name="English", academic_level_id=level.academic_level_id)
    other_subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    db.add_all([period, subject, other_subject])
    db.flush()

    accounts = {
        name: UserAccount(user_id=uuid.uuid4(), email=f"{name}@example.test", password_hash="x")
        for name in ("owner", "other_teacher", "student", "other_student")
    }
    db.add_all(accounts.values())
    db.flush()
    owner = AcademicStaff(
        staff_id="T-SUG",
        first_name="Suggest",
        last_name="Teacher",
        user_id=accounts["owner"].user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=accounts["other_teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Study",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="223456789012",
        first_name="Other",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["other_student"].user_id,
    )
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Ruby",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, student, other_student, class_, other_class])
    db.flush()
    db.add_all([
        StudentClass(
            student_id=student.student_id,
            class_id=class_.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ),
        StudentClass(
            student_id=other_student.student_id,
            class_id=other_class.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=subject.subject_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            status="active",
        ),
        SubjectLoad(
            staff_id=other_teacher.staff_id,
            subject_id=other_subject.subject_id,
            class_id=other_class.class_id,
            academic_period_id=period.academic_period_id,
            status="active",
        ),
    ])
    db.flush()

    lesson = Lesson(
        title="Nouns",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_draft=False,
    )
    hidden_lesson = Lesson(
        title="Hidden",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=False,
        is_draft=True,
    )
    classwork = Classwork(
        title="Nouns Reading",
        classwork_type="READING",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        total_points=None,
        is_published=True,
    )
    locked_classwork = Classwork(
        title="Locked Reading",
        classwork_type="READING",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        total_points=None,
        is_published=True,
    )
    db.add_all([lesson, hidden_lesson, classwork, locked_classwork])
    db.flush()
    lesson_assignment = LessonAssignment(
        lesson_id=lesson.lesson_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
    )
    hidden_lesson_assignment = LessonAssignment(
        lesson_id=hidden_lesson.lesson_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=False,
    )
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
    )
    locked_assignment = ClassworkAssignment(
        classwork_id=locked_classwork.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
        lock_date=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db.add_all([lesson_assignment, hidden_lesson_assignment, assignment, locked_assignment])
    db.commit()

    identity = {"sub": accounts["owner"].user_id, "role": "teacher"}
    app = FastAPI()
    app.include_router(suggestions_router, prefix="/api/v1/suggestions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "accounts": accounts,
            "owner": owner,
            "student": student,
            "other_student": other_student,
            "subject": subject,
            "lesson": lesson,
            "hidden_lesson": hidden_lesson,
            "assignment": assignment,
            "locked_assignment": locked_assignment,
        }
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _act_as(context, account_name: str, role: str) -> None:
    context["identity"].update(sub=context["accounts"][account_name].user_id, role=role)


def _lesson_payload(context, **overrides):
    payload = {
        "student_id": str(context["student"].student_id),
        "subject_id": context["subject"].subject_id,
        "resource_type": "LESSON",
        "lesson_id": context["lesson"].lesson_id,
        "title": "Review nouns",
        "description": "Read the noun lesson again.",
        "priority": "HIGH",
    }
    payload.update(overrides)
    return payload


def _classwork_payload(context, **overrides):
    payload = {
        "student_id": str(context["student"].student_id),
        "subject_id": context["subject"].subject_id,
        "resource_type": "CLASSWORK",
        "classwork_assignment_id": context["assignment"].classwork_assignment_id,
        "title": "Open nouns reading",
        "description": "Review the reading material.",
        "priority": "NORMAL",
    }
    payload.update(overrides)
    return payload


def _link_payload(context, **overrides):
    payload = {
        "student_id": str(context["student"].student_id),
        "subject_id": context["subject"].subject_id,
        "resource_type": "LINK",
        "title": "Review phonological processes",
        "description": "Read this resource before the next activity.",
        "external_url": "https://example.org/learning/phonology",
        "priority": "NORMAL",
    }
    payload.update(overrides)
    return payload


def test_link_suggestion_is_standalone_and_student_private(suggestion_api_context):
    c = suggestion_api_context
    response = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["resource_type"] == "LINK"
    assert body["lesson_id"] is None
    assert body["classwork_link"] is None
    assert body["resource"]["external_url"] == "https://example.org/learning/phonology"
    assert body["resource"]["is_available"] is True
    stored = c["db"].get(StudentSuggestion, body["student_suggestion_id"])
    assert stored.external_url == body["resource"]["external_url"]
    assert stored.resource_links is None

    _act_as(c, "other_student", "student")
    assert c["client"].get(f"/api/v1/suggestions/my/{body['student_suggestion_id']}").status_code == 404
    assert c["client"].get("/api/v1/suggestions/my").json()["suggestions"] == []
    _act_as(c, "student", "student")
    mine = c["client"].get("/api/v1/suggestions/my").json()["suggestions"]
    assert len(mine) == 1 and mine[0]["resource"]["external_url"] == stored.external_url
    viewed = c["client"].patch(f"/api/v1/suggestions/my/{body['student_suggestion_id']}/viewed")
    assert viewed.status_code == 200 and viewed.json()["is_viewed"] is True
    completed = c["client"].patch(f"/api/v1/suggestions/my/{body['student_suggestion_id']}/complete")
    assert completed.status_code == 200 and completed.json()["status"] == "COMPLETED"


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "data:text/html,hello", "file:///secret", "https://user:password@example.org/x",
    "https://", "https://example.org/a b", "https://example.org/" + "a" * 2048,
])
def test_link_rejects_unsafe_urls_without_persistence(suggestion_api_context, url):
    c = suggestion_api_context
    response = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c, external_url=url))
    assert response.status_code == 422
    assert c["db"].query(StudentSuggestion).count() == 0


@pytest.mark.parametrize("overrides", [
    {"external_url": None},
    {"lesson_id": 1},
    {"classwork_assignment_id": 1},
])
def test_link_rejects_missing_url_or_internal_ids(suggestion_api_context, overrides):
    c = suggestion_api_context
    response = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c, **overrides))
    assert response.status_code in {400, 422}
    assert c["db"].query(StudentSuggestion).count() == 0


def test_link_respects_teacher_scope_and_duplicate_rule(suggestion_api_context):
    c = suggestion_api_context
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c)).status_code == 403
    _act_as(c, "owner", "teacher")
    assert c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c)).status_code == 200
    assert c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c)).status_code == 409
    assert c["db"].query(StudentSuggestion).count() == 1


def test_teacher_list_keeps_student_and_subject_load_paired(suggestion_api_context):
    c = suggestion_api_context
    db = c["db"]
    science = db.query(Subject).filter(Subject.subject_name == "Science").one()
    ruby = db.query(Class).filter(Class.section_name == "Ruby").one()
    period = db.query(AcademicPeriod).one()
    db.add(SubjectLoad(
        staff_id=c["owner"].staff_id, subject_id=science.subject_id,
        class_id=ruby.class_id, academic_period_id=period.academic_period_id,
        status="active",
    ))
    db.add(StudentSuggestion(
        resource_type="LINK", title="Other class material",
        external_url="https://example.org/private",
        student_id=c["student"].student_id, subject_id=science.subject_id,
        created_by_staff_id="T-OTHER",
    ))
    db.commit()
    listed = c["client"].get("/api/v1/suggestions/teacher")
    assert listed.status_code == 200
    assert listed.json()["suggestions"] == []
    rejected = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c, subject_id=science.subject_id))
    assert rejected.status_code == 403


def test_corrupt_stored_link_fails_closed_for_student(suggestion_api_context):
    c = suggestion_api_context
    created = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c)).json()
    stored = c["db"].get(StudentSuggestion, created["student_suggestion_id"])
    stored.external_url = "javascript:alert(1)"
    c["db"].commit()
    _act_as(c, "student", "student")
    response = c["client"].get(f"/api/v1/suggestions/my/{stored.student_suggestion_id}")
    assert response.status_code == 200
    assert response.json()["resource"]["is_available"] is False
    assert response.json()["resource"]["external_url"] is None
    assert c["client"].patch(f"/api/v1/suggestions/my/{stored.student_suggestion_id}/complete").status_code == 403


def test_link_uses_existing_dismiss_and_archive_lifecycle(suggestion_api_context):
    c = suggestion_api_context
    created = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c)).json()
    suggestion_id = created["student_suggestion_id"]
    dismissed = c["client"].patch(f"/api/v1/suggestions/{suggestion_id}/dismiss")
    assert dismissed.status_code == 200 and dismissed.json()["status"] == "DISMISSED"
    archived = c["client"].patch(f"/api/v1/suggestions/{suggestion_id}/archive")
    assert archived.status_code == 200 and archived.json()["status"] == "ARCHIVED"
    assert archived.json()["resource"]["external_url"] == "https://example.org/learning/phonology"


def test_unknown_resource_type_is_rejected_before_persistence(suggestion_api_context):
    c = suggestion_api_context
    response = c["client"].post("/api/v1/suggestions/manual", json=_link_payload(c, resource_type="WEBSITE"))
    assert response.status_code == 422
    assert c["db"].query(StudentSuggestion).count() == 0


def test_old_resource_types_reject_external_url_and_keep_internal_json(suggestion_api_context):
    c = suggestion_api_context
    for payload in (_lesson_payload(c), _classwork_payload(c)):
        assert c["client"].post("/api/v1/suggestions/manual", json={**payload, "external_url": "https://example.org"}).status_code == 400
        response = c["client"].post("/api/v1/suggestions/manual", json=payload)
        assert response.status_code == 200, response.text
    saved = c["db"].query(StudentSuggestion).order_by(StudentSuggestion.student_suggestion_id).all()
    assert [row.resource_type for row in saved] == ["LESSON", "CLASSWORK"]
    assert all(row.external_url is None and row.resource_links for row in saved)


def test_teacher_can_create_list_and_dismiss_lesson_suggestion(suggestion_api_context):
    c = suggestion_api_context
    response = c["client"].post("/api/v1/suggestions/manual", json=_lesson_payload(c))

    assert response.status_code == 200
    body = response.json()
    assert body["resource_type"] == "LESSON"
    assert body["status"] == "ACTIVE"
    assert body["resource"]["lesson_id"] == c["lesson"].lesson_id
    assert body["resource"]["is_available"] is True

    listed = c["client"].get(f"/api/v1/suggestions/teacher?student_id={c['student'].student_id}")
    assert listed.status_code == 200
    assert len(listed.json()["suggestions"]) == 1

    dismissed = c["client"].patch(f"/api/v1/suggestions/{body['student_suggestion_id']}/dismiss")
    assert dismissed.status_code == 200
    assert dismissed.json()["status"] == "DISMISSED"


def test_teacher_scope_and_duplicate_rules_are_enforced(suggestion_api_context):
    c = suggestion_api_context
    denied = c["client"].post(
        "/api/v1/suggestions/manual",
        json=_lesson_payload(c, student_id=str(c["other_student"].student_id)),
    )
    assert denied.status_code == 403

    first = c["client"].post("/api/v1/suggestions/manual", json=_classwork_payload(c))
    assert first.status_code == 200
    duplicate = c["client"].post("/api/v1/suggestions/manual", json=_classwork_payload(c))
    assert duplicate.status_code == 409

    _act_as(c, "other_teacher", "teacher")
    foreign_list = c["client"].get("/api/v1/suggestions/teacher")
    assert foreign_list.status_code == 200
    assert foreign_list.json()["suggestions"] == []


def test_student_can_only_view_and_complete_own_suggestions(suggestion_api_context):
    c = suggestion_api_context
    created = c["client"].post("/api/v1/suggestions/manual", json=_classwork_payload(c)).json()
    suggestion_id = created["student_suggestion_id"]

    _act_as(c, "other_student", "student")
    other_response = c["client"].get(f"/api/v1/suggestions/my/{suggestion_id}")
    assert other_response.status_code == 404

    _act_as(c, "student", "student")
    mine = c["client"].get("/api/v1/suggestions/my")
    assert mine.status_code == 200
    assert len(mine.json()["suggestions"]) == 1

    viewed = c["client"].patch(f"/api/v1/suggestions/my/{suggestion_id}/viewed")
    assert viewed.status_code == 200
    assert viewed.json()["is_viewed"] is True

    completed = c["client"].patch(f"/api/v1/suggestions/my/{suggestion_id}/complete")
    assert completed.status_code == 200
    body = completed.json()
    assert body["status"] == "COMPLETED"
    assert body["classwork_link"]["is_completed"] is True


def test_student_completion_requires_available_resource(suggestion_api_context):
    c = suggestion_api_context
    payload = _classwork_payload(
        c,
        classwork_assignment_id=c["locked_assignment"].classwork_assignment_id,
        title="Locked reading",
    )
    created = c["client"].post("/api/v1/suggestions/manual", json=payload).json()

    _act_as(c, "student", "student")
    response = c["client"].patch(f"/api/v1/suggestions/my/{created['student_suggestion_id']}/complete")

    assert response.status_code == 403
    assert "locked" in response.json()["detail"].lower()


def test_teacher_can_archive_completed_or_dismissed_suggestions_only(suggestion_api_context):
    c = suggestion_api_context
    created = c["client"].post("/api/v1/suggestions/manual", json=_lesson_payload(c)).json()
    suggestion_id = created["student_suggestion_id"]

    active_archive = c["client"].patch(f"/api/v1/suggestions/{suggestion_id}/archive")
    assert active_archive.status_code == 400

    _act_as(c, "student", "student")
    completed = c["client"].patch(f"/api/v1/suggestions/my/{suggestion_id}/complete")
    assert completed.status_code == 200

    _act_as(c, "owner", "teacher")
    archived = c["client"].patch(f"/api/v1/suggestions/{suggestion_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "ARCHIVED"


def _add_low_score_source(context, grade=Decimal("58")):
    db = context["db"]
    source = Classwork(
        title="Nouns Quiz",
        classwork_type="QUIZ",
        subject_id=context["subject"].subject_id,
        created_by_staff_id=context["owner"].staff_id,
        total_points=Decimal("100"),
        is_published=True,
    )
    db.add(source)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=source.classwork_id,
        class_id=context["assignment"].class_id,
        assigned_by_staff_id=context["owner"].staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    db.add(ClassworkLesson(classwork_id=source.classwork_id, lesson_id=context["lesson"].lesson_id))
    submission = StudentSubmission(
        student_id=context["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="graded",
        grade=grade,
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
        graded_by_staff_id=context["owner"].staff_id,
    )
    db.add(submission)
    db.commit()
    return source, assignment, submission


def test_recommendation_service_creates_explainable_draft_from_low_score(suggestion_api_context):
    c = suggestion_api_context
    _add_low_score_source(c, grade=Decimal("58"))

    result = generate_recommendation_drafts(
        c["db"],
        c["owner"].staff_id,
        RecommendationDraftRequest(
            class_id=c["assignment"].class_id,
            subject_id=c["subject"].subject_id,
            low_score_threshold=75,
        ),
    )

    assert len(result.suggestions) == 1
    draft = result.suggestions[0]
    assert draft.status == "DRAFT"
    assert draft.suggestion_type == "AUTOMATED"
    assert draft.resource_type == "LESSON"
    assert draft.lesson_id == c["lesson"].lesson_id
    assert draft.priority == "HIGH"
    assert draft.source_metrics is not None
    assert draft.source_metrics["source"] == "LOW_CLASSWORK_SCORE"
    assert draft.source_metrics["score_percent"] == 58.0

    _act_as(c, "student", "student")
    hidden = c["client"].get("/api/v1/suggestions/my")
    assert hidden.status_code == 200
    assert hidden.json()["suggestions"] == []

    _act_as(c, "owner", "teacher")
    approved = c["client"].patch(f"/api/v1/suggestions/{draft.student_suggestion_id}/approve")
    assert approved.status_code == 200
    assert approved.json()["status"] == "ACTIVE"

    _act_as(c, "student", "student")
    visible = c["client"].get("/api/v1/suggestions/my")
    assert visible.status_code == 200
    assert len(visible.json()["suggestions"]) == 1


def test_recommendation_service_skips_existing_draft_duplicates(suggestion_api_context):
    c = suggestion_api_context
    _add_low_score_source(c, grade=Decimal("40"))

    request = RecommendationDraftRequest(
        class_id=c["assignment"].class_id,
        subject_id=c["subject"].subject_id,
        low_score_threshold=75,
    )
    first = generate_recommendation_drafts(c["db"], c["owner"].staff_id, request)
    second = generate_recommendation_drafts(c["db"], c["owner"].staff_id, request)

    assert len(first.suggestions) == 1
    assert first.suggestions[0].priority == "URGENT"
    assert second.suggestions == []
