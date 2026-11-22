import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Lessons import router as lessons_router
from app.api.v1.routes.Students import router as students_router
from app.core.Security import create_access_token
from app.db.Session import get_db
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import (
    ClassworkAssignmentRecipient,
)
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.ClassworkReferenceLink import ClassworkReferenceLink
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.notifications.Notification import Notification
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import ensure_lessons_owned

TABLES = [
    GradingTemplate.__table__,
    GradingTemplateComponent.__table__,
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Competency.__table__,
    Class.__table__,
    TeacherSubstitution.__table__,
    SubjectLoad.__table__,
    StudentClass.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    Classwork.__table__,
    ClassworkAttachment.__table__,
    ActivityRubricLevel.__table__,
    ClassworkAssignment.__table__,
    ClassworkAssignmentRecipient.__table__,
    RemediationAssignmentLink.__table__,
    ClassworkLesson.__table__,
    ClassworkReferenceLink.__table__,
    Notification.__table__,
    StudentSubmission.__table__,
    Quiz.__table__,
    QuizSetting.__table__,
    Question.__table__,
    QuestionOption.__table__,
    QuizQuestion.__table__,
]


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next((c for c in Student.__table__.constraints if getattr(c, "name", None) == "student_lrn_format_check"), None)
    if lrn_check:
        Student.__table__.constraints.remove(lrn_check)
    try:
        for table in TABLES:
            table.create(bind=engine, checkfirst=True)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)

    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = Session()

    try:
        yield session
    finally:
        session.close()
        for table in reversed(TABLES):
            table.drop(bind=engine, checkfirst=True)


@pytest.fixture
def client(test_db):
    app = FastAPI()
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(lessons_router, prefix="/api/v1/lessons")
    app.include_router(students_router, prefix="/api/v1/students")

    def override_get_db():
        yield test_db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def seed_basic_data(db):
    year = AcademicYear(
        academic_year_id=1,
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=True,
    )
    level = AcademicLevel(academic_level_id=1, level_name="Grade 8", grade_level=8)
    template = GradingTemplate(
        grading_template_id=1,
        template_name="Core",
        passing_threshold=87.0,
        status="active",
    )
    template.components = [
        GradingTemplateComponent(component_name="Written Work", weight=20.0, display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=50.0, display_order=2),
        GradingTemplateComponent(component_name="Exams", weight=30.0, display_order=3),
    ]
    db.add_all([year, period, level, template])
    db.flush()

    teacher_uid = uuid.uuid4()
    student_uid = uuid.uuid4()
    teacher_account = UserAccount(
        user_id=teacher_uid,
        email="teacher1@example.test",
        password_hash="fakehash",
    )
    student_account = UserAccount(
        user_id=student_uid,
        email="student1@example.test",
        password_hash="fakehash",
    )
    db.add_all([teacher_account, student_account])
    db.flush()

    staff = AcademicStaff(
        staff_id="STF001",
        user_id=teacher_uid,
        first_name="Jane",
        last_name="Doe",
    )
    student = Student(
        student_id=uuid.uuid4(),
        user_id=student_uid,
        first_name="Juan",
        last_name="Aquino",
        student_lrn="100000000001",
        academic_level_id=1,
    )
    db.add_all([staff, student])
    db.flush()

    subj = Subject(
        subject_id=10,
        subject_name="English 8",
        subject_codename="ENG8",
        academic_level_id=1,
        grading_template_id=1,
    )
    db.add(subj)
    db.flush()

    comp = Competency(
        competency_id=1,
        subject_id=10,
        academic_period_id=1,
        statement="Analyze elements of poetry",
        competency_code="ENG8-Q1-C1",
    )
    db.add(comp)
    db.flush()

    cls = Class(
        class_id=100,
        section_name="Section Diamond",
        academic_year_id=1,
        academic_level_id=1,
    )
    db.add(cls)
    db.flush()

    load = SubjectLoad(
        subject_load_id=1,
        staff_id="STF001",
        subject_id=10,
        class_id=100,
        academic_period_id=1,
        status="active",
        is_active_version=True,
    )
    enrollment = StudentClass(
        student_class_id=1,
        student_id=student.student_id,
        class_id=100,
        academic_year_id=1,
        enrollment_status="enrolled",
    )
    lesson = Lesson(
        lesson_id=1,
        title="Elements of Poetry",
        subject_id=10,
        competency_id=1,
        order_index=1,
        is_published=True,
        is_draft=False,
        is_archived=False,
        created_by_staff_id="STF001",
    )
    db.add_all([load, enrollment, lesson])
    db.flush()

    lesson_assign = LessonAssignment(
        lesson_id=1,
        class_id=100,
        is_published=True,
    )
    db.add(lesson_assign)
    db.flush()

    return {
        "staff": staff,
        "student": student,
        "teacher_account": teacher_account,
        "student_account": student_account,
        "subject": subj,
        "competency": comp,
        "class": cls,
        "lesson": lesson,
        "period": period,
    }


def auth_headers(account, role="teacher"):
    token = create_access_token(str(account.user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_lesson_classwork_assignments_respects_scheduled_quiz_results_release(client, test_db):
    data = seed_basic_data(test_db)
    cw = Classwork(
        classwork_id=10,
        title="Poetry Quiz 1",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        subject_id=10,
        total_points=20.0,
        is_published=True,
        show_scores=True,
        created_by_staff_id="STF001",
    )
    test_db.add(cw)
    test_db.flush()
    release_at = datetime.now(timezone.utc) + timedelta(days=1)
    setting = QuizSetting(
        classwork_id=cw.classwork_id,
        show_correct_answers=True,
        summary_release_mode="SCHEDULED",
        summary_release_at=release_at,
    )
    test_db.add(setting)

    test_db.add(ClassworkLesson(classwork_id=10, lesson_id=1))
    cwa = ClassworkAssignment(
        classwork_assignment_id=101,
        classwork_id=10,
        class_id=100,
        academic_period_id=1,
        assigned_by_staff_id="STF001",
        is_published=True,
    )
    test_db.add(cwa)
    test_db.flush()

    sub = StudentSubmission(
        submission_id=1,
        classwork_assignment_id=101,
        student_id=data["student"].student_id,
        status="graded",
        grade=18.0,
    )
    test_db.add(sub)
    test_db.commit()

    headers = auth_headers(data["student_account"], role="student")
    res = client.get("/api/v1/lessons/1/classwork-assignments?class_id=100", headers=headers)
    assert res.status_code == 200, res.text
    items = res.json()
    assert len(items) == 1
    item = items[0]
    assert item["classwork_assignment_id"] == 101
    assert item["is_submitted"] is True
    assert item["grade"] is None
    assert item["show_scores"] is False

    setting.summary_release_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    test_db.commit()
    released = client.get(
        "/api/v1/lessons/1/classwork-assignments?class_id=100",
        headers=headers,
    )
    assert released.status_code == 200, released.text
    assert released.json()[0]["grade"] == 18.0
    assert released.json()[0]["show_scores"] is True


def test_lesson_classwork_assignments_hides_scores_when_show_scores_is_false(client, test_db):
    data = seed_basic_data(test_db)
    cw = Classwork(
        classwork_id=11,
        title="Poetry Exam",
        classwork_type="QUIZ",
        classwork_category="QUARTERLY_ASSESSMENT",
        subject_id=10,
        total_points=50.0,
        is_published=True,
        show_scores=False,
        created_by_staff_id="STF001",
    )
    test_db.add(cw)
    test_db.flush()

    test_db.add(ClassworkLesson(classwork_id=11, lesson_id=1))
    cwa = ClassworkAssignment(
        classwork_assignment_id=102,
        classwork_id=11,
        class_id=100,
        academic_period_id=1,
        assigned_by_staff_id="STF001",
        is_published=True,
    )
    test_db.add(cwa)
    test_db.flush()

    sub = StudentSubmission(
        submission_id=2,
        classwork_assignment_id=102,
        student_id=data["student"].student_id,
        status="graded",
        grade=45.0,
    )
    test_db.add(sub)
    test_db.commit()

    headers = auth_headers(data["student_account"], role="student")
    res = client.get("/api/v1/lessons/1/classwork-assignments?class_id=100", headers=headers)
    assert res.status_code == 200, res.text
    item = res.json()[0]
    assert item["is_submitted"] is True
    assert item["grade"] is None  # Hidden because show_scores is False
    assert item["show_scores"] is False


def test_ensure_lessons_owned_prevents_misassociations(test_db):
    data = seed_basic_data(test_db)
    # 1. Valid association succeeds (does not raise)
    ensure_lessons_owned(
        test_db,
        staff_id="STF001",
        subject_id=10,
        lesson_ids=[1],
        class_ids=[100],
        academic_period_id=1,
    )

    # 2. Archived lesson fails
    archived_lesson = Lesson(
        lesson_id=2,
        title="Archived Lesson",
        subject_id=10,
        order_index=2,
        is_published=True,
        is_draft=False,
        is_archived=True,
        created_by_staff_id="STF001",
    )
    test_db.add(archived_lesson)
    test_db.flush()
    with pytest.raises(HTTPException) as exc:
        ensure_lessons_owned(
            test_db,
            staff_id="STF001",
            subject_id=10,
            lesson_ids=[2],
        )
    assert exc.value.status_code == 400
    assert "cannot be linked" in exc.value.detail

    # 3. Cross-class misassociation fails
    cls2 = Class(
        class_id=200,
        section_name="Section Gold",
        academic_year_id=1,
        academic_level_id=1,
    )
    test_db.add(cls2)
    test_db.flush()
    with pytest.raises(HTTPException) as exc:
        ensure_lessons_owned(
            test_db,
            staff_id="STF001",
            subject_id=10,
            lesson_ids=[1],
            class_ids=[100, 200],  # Lesson 1 is assigned only to 100
        )
    assert exc.value.status_code == 400
    assert "not assigned to the selected class sections" in exc.value.detail


def test_quiz_creation_rejects_reference_links_but_edit_accepts_them(client, test_db):
    data = seed_basic_data(test_db)
    teacher_headers = auth_headers(data["teacher_account"], role="teacher")

    # 1. Quiz creation with reference_links fails
    quiz_data = {
        "title": "Quiz With Links",
        "instructions": "Answer questions",
        "classwork_type": "QUIZ",
        "classwork_category": "WRITTEN_WORK",
        "total_points": "10",
        "subject_id": "10",
        "is_published": "true",
        "show_scores": "true",
        "class_ids": json.dumps([100]),
        "lesson_ids": json.dumps([1]),
        "reference_links": json.dumps([{"url": "https://example.com", "title": "Example"}]),
        "quiz_payload": json.dumps({
            "questions": [{
                "question_text": "What is 2+2?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 10,
                "display_order": 1,
                "lesson_id": 1,
                "options": [
                    {"option_text": "4", "is_correct": True, "option_order": 1},
                    {"option_text": "5", "is_correct": False, "option_order": 2},
                ],
            }],
            "settings": {"max_attempts": 1, "shuffle_questions": False, "shuffle_options": False},
        }),
    }
    res = client.post("/api/v1/classwork-assignments/with-assignments", data=quiz_data, headers=teacher_headers)
    assert res.status_code == 400
    assert "Reference links are not supported for quizzes" in res.json()["detail"]

    # 2. Quiz creation without reference_links succeeds
    quiz_data_clean = dict(quiz_data)
    del quiz_data_clean["reference_links"]
    res_clean = client.post("/api/v1/classwork-assignments/with-assignments", data=quiz_data_clean, headers=teacher_headers)
    assert res_clean.status_code in (200, 201), res_clean.text
    created_quiz_id = res_clean.json()["classwork_id"]

    # 3. Existing quizzes can add reference links from the Edit Classwork modal.
    res_update = client.put(
        f"/api/v1/classwork-assignments/classwork/{created_quiz_id}",
        json={"title": "Updated Quiz", "reference_links": [{"url": "https://example.com/quiz-reference"}]},
        headers=teacher_headers,
    )
    assert res_update.status_code == 200
    assert res_update.json()["reference_links"][0]["url"] == "https://example.com/quiz-reference"

    # 4. Assignment creation with reference_links succeeds
    assignment_data = {
        "title": "Essay Assignment",
        "instructions": "Write an essay",
        "classwork_type": "ASSIGNMENT",
        "classwork_category": "PERFORMANCE_TASK",
        "total_points": "50",
        "subject_id": "10",
        "is_published": "true",
        "show_scores": "true",
        "class_ids": json.dumps([100]),
        "lesson_ids": json.dumps([1]),
        "reference_links": json.dumps([{"url": "https://poetry.org", "title": "Poetry Foundation"}]),
    }
    res_asgn = client.post("/api/v1/classwork-assignments/with-assignments", data=assignment_data, headers=teacher_headers)
    assert res_asgn.status_code in (200, 201), res_asgn.text
    created_asgn = res_asgn.json()
    assert created_asgn["title"] == "Essay Assignment"
    assert len(created_asgn["reference_links"]) == 1
    assert created_asgn["reference_links"][0]["url"] == "https://poetry.org"


def test_published_quiz_creation_rejects_unmapped_questions(client, test_db):
    data = seed_basic_data(test_db)
    response = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Unmapped quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": "10",
            "subject_id": "10",
            "is_published": "true",
            "class_ids": json.dumps([100]),
            "lesson_ids": json.dumps([1]),
            "quiz_payload": json.dumps({
                "status": "DRAFT",
                "questions": [{
                    "question_text": "What is 2+2?",
                    "question_type": "MULTIPLE_CHOICE",
                    "points": 10,
                    "display_order": 1,
                    "options": [
                        {"option_text": "4", "is_correct": True, "option_order": 1},
                        {"option_text": "5", "is_correct": False, "option_order": 2},
                    ],
                }],
            }),
        },
        headers=auth_headers(data["teacher_account"], role="teacher"),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "QUIZ_NOT_PUBLISH_READY"
    assert detail["readiness_errors"] == [
        "Question 1 needs a lesson mapping to one of the quiz's linked lessons"
    ]


def test_publishing_draft_quiz_via_update_with_lesson_ids_succeeds(client, test_db):
    data = seed_basic_data(test_db)
    teacher_headers = auth_headers(data["teacher_account"], role="teacher")

    create_res = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Draft Remediation Quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": "10",
            "subject_id": "10",
            "is_published": "false",
            "class_ids": json.dumps([100]),
            "lesson_ids": json.dumps([1]),
            "quiz_payload": json.dumps({
                "status": "DRAFT",
                "questions": [
                    {
                        "question_text": "What is a point?",
                        "question_type": "MULTIPLE_CHOICE",
                        "points": 5,
                        "display_order": 1,
                        "lesson_id": 1,
                        "options": [
                            {"option_text": "Exact location", "is_correct": True, "option_order": 1},
                            {"option_text": "Curved line", "is_correct": False, "option_order": 2},
                        ],
                    },
                    {
                        "question_text": "A line extends endlessly in both directions.",
                        "question_type": "MULTIPLE_CHOICE",
                        "points": 5,
                        "display_order": 2,
                        "lesson_id": 1,
                        "options": [
                            {"option_text": "True", "is_correct": True, "option_order": 1},
                            {"option_text": "False", "is_correct": False, "option_order": 2},
                        ],
                    },
                ],
            }),
        },
        headers=teacher_headers,
    )
    assert create_res.status_code in (200, 201), create_res.text
    classwork_id = create_res.json()["classwork_id"]

    # Match production SessionLocal(autoflush=False) so bulk delete + re-add of
    # ClassworkLesson rows must flush before quiz publish readiness checks run.
    test_db.autoflush = False
    publish_res = client.put(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        json={
            "title": "Draft Remediation Quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": 10,
            "is_published": True,
            "lesson_ids": [1],
        },
        headers=teacher_headers,
    )
    assert publish_res.status_code == 200, publish_res.text
    updated = publish_res.json()
    assert updated["is_published"] is True
    assert [lesson["lesson_id"] for lesson in updated["linked_lessons"]] == [1]

    # Removing the linked lesson must still block publishing with readiness_errors.
    unlinked_res = client.put(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        json={
            "title": "Draft Remediation Quiz",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": 10,
            "is_published": True,
            "lesson_ids": [],
        },
        headers=teacher_headers,
    )
    assert unlinked_res.status_code == 422, unlinked_res.text
    detail = unlinked_res.json()["detail"]
    assert detail["code"] == "QUIZ_NOT_PUBLISH_READY"
    assert len(detail["readiness_errors"]) == 2

def test_get_my_todos_respects_grading_and_score_visibility(client, test_db):
    data = seed_basic_data(test_db)
    # Graded classwork with show_scores=True
    cw1 = Classwork(
        classwork_id=20,
        title="Graded Visible Work",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        subject_id=10,
        total_points=30.0,
        is_published=True,
        show_scores=True,
        created_by_staff_id="STF001",
    )
    # Graded classwork with show_scores=False
    cw2 = Classwork(
        classwork_id=21,
        title="Graded Hidden Work",
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        subject_id=10,
        total_points=30.0,
        is_published=True,
        show_scores=False,
        created_by_staff_id="STF001",
    )
    cw3 = Classwork(
        classwork_id=22,
        title="Scheduled Quiz Result",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        subject_id=10,
        total_points=30.0,
        is_published=True,
        show_scores=True,
        created_by_staff_id="STF001",
    )
    test_db.add_all([cw1, cw2, cw3])
    test_db.flush()
    test_db.add(QuizSetting(
        classwork_id=cw3.classwork_id,
        show_correct_answers=True,
        summary_release_mode="SCHEDULED",
        summary_release_at=datetime.now(timezone.utc) + timedelta(days=1),
    ))

    cwa1 = ClassworkAssignment(
        classwork_assignment_id=201,
        classwork_id=20,
        class_id=100,
        academic_period_id=1,
        assigned_by_staff_id="STF001",
        is_published=True,
    )
    cwa2 = ClassworkAssignment(
        classwork_assignment_id=202,
        classwork_id=21,
        class_id=100,
        academic_period_id=1,
        assigned_by_staff_id="STF001",
        is_published=True,
    )
    cwa3 = ClassworkAssignment(
        classwork_assignment_id=203,
        classwork_id=22,
        class_id=100,
        academic_period_id=1,
        assigned_by_staff_id="STF001",
        is_published=True,
    )
    test_db.add_all([cwa1, cwa2, cwa3])
    test_db.flush()

    sub1 = StudentSubmission(
        submission_id=10,
        classwork_assignment_id=201,
        student_id=data["student"].student_id,
        status="graded",
        grade=28.0,
    )
    sub2 = StudentSubmission(
        submission_id=11,
        classwork_assignment_id=202,
        student_id=data["student"].student_id,
        status="graded",
        grade=25.0,
    )
    sub3 = StudentSubmission(
        submission_id=12,
        classwork_assignment_id=203,
        student_id=data["student"].student_id,
        status="graded",
        grade=24.0,
    )
    test_db.add_all([sub1, sub2, sub3])
    test_db.commit()

    headers = auth_headers(data["student_account"], role="student")
    res = client.get("/api/v1/students/me/todos?academic_period_id=1", headers=headers)
    assert res.status_code == 200, res.text
    all_todos = res.json()["all"]
    todo1 = next(t for t in all_todos if t["assignment_id"] == 201)
    todo2 = next(t for t in all_todos if t["assignment_id"] == 202)
    todo3 = next(t for t in all_todos if t["assignment_id"] == 203)

    assert todo1["grade"] == 28.0
    assert todo1["is_submitted"] is True
    assert todo2["grade"] is None  # Hidden because show_scores=False
    assert todo2["is_submitted"] is True
    assert todo3["grade"] is None
    assert todo3["show_scores"] is False
    assert todo3["is_submitted"] is True

