"""End-to-end integration tests for all three remediation quiz creation methods:
1. Reuse Quiz Questions -> Edit -> Save Draft -> Publish -> Student Attempt (shuffled) -> Grade
2. Generate with AI -> Review -> Quiz Builder -> Save Draft -> Publish -> Student Attempt -> Grade
3. Continue to Quiz Builder (Manual) -> Save Draft -> Publish -> Student Attempt -> Grade
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.api.v1.routes.TeacherInterventions import router as teacher_interventions_router
from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionReadingReviewService import (
    acknowledge_intervention_reading_review,
)
from app.services.intervention.InterventionRemediationService import get_workspace
from tests.test_current_period_live_feature_builder import current_period_context  # noqa: F401
from tests.test_remediation_draft_generation import _mapped_records, _question_snapshot
from tests.test_teacher_intervention_review import candidate_context, _id, _staff  # noqa: F401


def _build_e2e_client(ctx) -> tuple[TestClient, dict]:
    identity = {"sub": str(ctx["staff"].user_id), "role": "teacher"}
    app = FastAPI()
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.include_router(teacher_interventions_router, prefix="/api/v1/teacher/interventions")
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_staff_id] = lambda: _staff(ctx)
    return TestClient(app, raise_server_exceptions=False), identity


def _setup_remediation_quiz_scenario(ctx, *, original_score: float = 4.0, total_points: float = 20.0):
    """Create an ACTIVE intervention with:
    - an original graded QUIZ classwork (2 MC questions = 12 + 8 = 20 pts, student scored 4/20)
    - an accessible Reading prerequisite
    - a second classmate enrolled in the same class (to verify remediation access control)
    """
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention = ctx["candidate"]

    competency, lesson = _mapped_records(ctx)
    lesson.created_by_staff_id = staff_id
    if ctx["student"].user_id is None:
        student_user = UserAccount(
            user_id=uuid.uuid4(),
            email=f"target-student-{uuid.uuid4().hex[:8]}@example.test",
            password_hash="x",
        )
        db.add(student_user)
        db.flush()
        ctx["student"].user_id = student_user.user_id
    db.flush()
    _question_snapshot(ctx, competency, lesson)

    intervention.status = "ACTIVE"
    intervention.activated_at = datetime.now(timezone.utc)
    intervention.activated_by_staff_id = staff_id

    cutoff = datetime.fromisoformat(intervention.diagnosis_snapshot["evidence_cutoff_at"])
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    db.add(
        LessonDelivery(
            lesson_id=lesson.lesson_id,
            class_id=intervention.class_id,
            subject_id=intervention.subject_id,
            academic_period_id=intervention.academic_period_id,
            delivered_by_staff_id=staff_id,
            delivered_at=cutoff - timedelta(days=2),
        )
    )

    # Original graded quiz classwork
    orig_work = Classwork(
        title="Original Poetry Quiz",
        description="Original quiz for remediation reuse verification",
        instructions="Choose the best answer.",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal(str(total_points)),
        subject_id=intervention.subject_id,
        created_by_staff_id=staff_id,
        is_published=True,
        show_scores=True,
    )
    db.add(orig_work)
    db.flush()
    db.add(ClassworkLesson(classwork_id=orig_work.classwork_id, lesson_id=lesson.lesson_id))

    orig_assignment = ClassworkAssignment(
        classwork_id=orig_work.classwork_id,
        class_id=intervention.class_id,
        academic_period_id=intervention.academic_period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
        max_attempts=1,
    )
    orig_quiz = Quiz(classwork_id=orig_work.classwork_id, total_items=2, status="PUBLISHED")
    orig_setting = QuizSetting(
        classwork_id=orig_work.classwork_id,
        is_shuffle_questions=False,
        is_shuffle_options=False,
        max_attempts=1,
        show_correct_answers=True,
    )
    db.add_all([orig_assignment, orig_quiz, orig_setting])
    db.flush()

    q1 = Question(
        question_text="What is the rhyme scheme of a Shakespearean sonnet?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("12.00"),
        difficulty_level="MEDIUM",
        explanation="ABAB CDCD EFEF GG is the Shakespearean rhyme scheme.",
        lesson_id=lesson.lesson_id,
        is_ai_generated=False,
    )
    q2 = Question(
        question_text="How many lines are in a traditional sonnet?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("8.00"),
        difficulty_level="EASY",
        explanation="A sonnet has 14 lines.",
        lesson_id=lesson.lesson_id,
        is_ai_generated=False,
    )
    db.add_all([q1, q2])
    db.flush()

    q1_opts = [
        QuestionOption(question_id=q1.question_id, option_text="ABAB CDCD EFEF GG", is_correct=True, option_order=1),
        QuestionOption(question_id=q1.question_id, option_text="AABB CCDD EEFF GG", is_correct=False, option_order=2),
    ]
    q2_opts = [
        QuestionOption(question_id=q2.question_id, option_text="12 lines", is_correct=False, option_order=1),
        QuestionOption(question_id=q2.question_id, option_text="14 lines", is_correct=True, option_order=2),
    ]
    db.add_all(q1_opts + q2_opts)
    db.add_all([
        QuizQuestion(quiz_id=orig_quiz.quiz_id, question_id=q1.question_id, display_order=1),
        QuizQuestion(quiz_id=orig_quiz.quiz_id, question_id=q2.question_id, display_order=2),
    ])

    orig_submission = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=orig_assignment.classwork_assignment_id,
        status="graded",
        grade=Decimal(str(original_score)),
        submitted_at=cutoff - timedelta(days=1),
        graded_at=cutoff - timedelta(hours=12),
    )
    db.add(orig_submission)

    # Accessible reading prerequisite
    reading_work = Classwork(
        title="Poetry Study Guide",
        description="Reading material for prerequisite review",
        classwork_type="READING",
        is_graded=False,
        subject_id=intervention.subject_id,
        created_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(reading_work)
    db.flush()
    reading_assignment = ClassworkAssignment(
        classwork_id=reading_work.classwork_id,
        class_id=intervention.class_id,
        academic_period_id=intervention.academic_period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(reading_assignment)

    # Unassigned classmate enrolled in the same class
    other_user = UserAccount(
        user_id=uuid.uuid4(),
        email=f"classmate-{uuid.uuid4().hex[:8]}@example.test",
        password_hash="x",
    )
    db.add(other_user)
    db.flush()
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="999999999999",
        user_id=other_user.user_id,
        first_name="Other",
        last_name="Classmate",
    )
    db.add(other_student)
    db.flush()
    db.add(
        StudentClass(
            student_id=other_student.student_id,
            class_id=intervention.class_id,
            academic_year_id=ctx["period"].academic_year_id,
            enrollment_status="enrolled",
        )
    )

    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [orig_assignment.classwork_assignment_id],
        "score_adjustment_cap": 75.0,
        "selected_resources": [{"kind": "CLASSWORK", "id": reading_work.classwork_id}],
    }
    db.commit()

    return {
        "competency": competency,
        "lesson": lesson,
        "orig_work": orig_work,
        "orig_assignment": orig_assignment,
        "orig_submission": orig_submission,
        "reading_work": reading_work,
        "reading_assignment": reading_assignment,
        "other_user": other_user,
        "other_student": other_student,
    }


def _acknowledge_prerequisites(ctx, remediation_assignment_id: int) -> None:
    prereqs = (
        ctx["db"]
        .query(RemediationReadingPrerequisite)
        .filter_by(remediation_assignment_id=remediation_assignment_id)
        .all()
    )
    for prereq in prereqs:
        acknowledge_intervention_reading_review(
            ctx["db"],
            intervention_id=_id(ctx),
            reading_assignment_id=prereq.reading_assignment_id,
            student=ctx["student"],
        )


def test_e2e_reuse_quiz_questions_workflow(candidate_context):
    """Method 1: Reuse Quiz Questions -> Edit -> Save Draft -> Publish -> Student Answers -> Grade."""
    ctx = candidate_context
    s = _setup_remediation_quiz_scenario(ctx, original_score=4.0, total_points=20.0)
    client, identity = _build_e2e_client(ctx)

    # 1. Teacher loads original quiz questions for reuse
    orig_resp = client.get(f"/api/v1/quizzes/classwork/{s['orig_work'].classwork_id}")
    assert orig_resp.status_code == 200, orig_resp.json()
    orig_body = orig_resp.json()
    assert len(orig_body["questions"]) == 2
    assert orig_body["questions"][0]["points"] == 12.0
    assert orig_body["questions"][0]["options"][0]["is_correct"] is True
    assert orig_body["questions"][1]["points"] == 8.0
    assert orig_body["questions"][1]["options"][1]["is_correct"] is True

    # 2. Teacher edits Q1 text, enables question & choice shuffling, and saves as Draft
    reused_questions = []
    for idx, q in enumerate(orig_body["questions"], start=1):
        reused_questions.append({
            "question_text": f"{q['question_text']} (Remediation)" if idx == 1 else q["question_text"],
            "question_type": q["question_type"],
            "points": q["points"],
            "display_order": idx,
            "difficulty_level": q["difficulty_level"],
            "explanation": q["explanation"],
            "lesson_id": q["lesson_id"],
            "is_ai_generated": False,
            "options": [
                {
                    "option_text": opt["option_text"],
                    "is_correct": opt["is_correct"],
                    "option_order": opt["option_order"],
                }
                for opt in q["options"]
            ],
        })

    due_date_iso = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    create_resp = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Poetry Remediation Quiz (Reused)",
            "instructions": "Review the study guide before starting.",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": "20",
            "is_published": "false",
            "subject_id": str(ctx["subject"].subject_id),
            "show_scores": "true",
            "class_ids": json.dumps([ctx["class"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "lesson_ids": json.dumps([s["lesson"].lesson_id]),
            "due_date": due_date_iso,
            "max_attempts": "3",
            "intervention_id": str(_id(ctx)),
            "remediation_request_id": str(uuid.uuid4()),
            "original_classwork_assignment_id": str(s["orig_assignment"].classwork_assignment_id),
            "quiz_payload": json.dumps({
                "duration_minutes": 30,
                "status": "DRAFT",
                "settings": {
                    "is_shuffle_questions": True,
                    "is_shuffle_options": True,
                    "enable_per_question_scoring": True,
                    "enable_per_question_time_limits": False,
                    "max_attempts": 3,
                    "show_correct_answers": True,
                    "summary_release_mode": "IMMEDIATE",
                },
                "questions": reused_questions,
            }),
        },
    )
    assert create_resp.status_code == 200, create_resp.json()
    created = create_resp.json()
    rem_classwork_id = created["classwork_id"]
    rem_assignment_id = created["assignments"][0]["classwork_assignment_id"]
    assert created["is_published"] is False

    # Verify draft is hidden from student before publish
    identity.update({"sub": str(ctx["student"].user_id), "role": "student"})
    hidden_resp = client.get(f"/api/v1/quizzes/assignment/{rem_assignment_id}/attempt")
    assert hidden_resp.status_code in (403, 404)

    # 3. Teacher publishes the remediation quiz
    identity.update({"sub": str(ctx["staff"].user_id), "role": "teacher"})
    pub_resp = client.post(
        f"/api/v1/classwork-assignments/classwork/{rem_classwork_id}/assign",
        json={
            "class_ids": [ctx["class"].class_id],
            "academic_period_id": ctx["period"].academic_period_id,
            "due_date": due_date_iso,
            "is_published": True,
            "max_attempts": 3,
        },
    )
    assert pub_resp.status_code == 200, pub_resp.json()

    # Verify shuffle settings persisted after publish
    rem_quiz_resp = client.get(f"/api/v1/quizzes/classwork/{rem_classwork_id}")
    assert rem_quiz_resp.status_code == 200
    rem_quiz_body = rem_quiz_resp.json()
    assert rem_quiz_body["settings"]["is_shuffle_questions"] is True
    assert rem_quiz_body["settings"]["is_shuffle_options"] is True
    canonical_q_ids = [q["quiz_question_id"] for q in rem_quiz_body["questions"]]
    canonical_opts_by_q = {
        q["quiz_question_id"]: [o["option_id"] for o in q["options"]]
        for q in rem_quiz_body["questions"]
    }
    correct_opt_by_q = {
        q["quiz_question_id"]: next(o["option_id"] for o in q["options"] if o["is_correct"])
        for q in rem_quiz_body["questions"]
    }

    # 4. Unassigned classmate cannot access the remediation quiz
    identity.update({"sub": str(s["other_user"].user_id), "role": "student"})
    unassigned_resp = client.get(f"/api/v1/quizzes/assignment/{rem_assignment_id}/attempt")
    assert unassigned_resp.status_code == 404

    # 5. Assigned student completes prerequisite reading and starts quiz attempt
    _acknowledge_prerequisites(ctx, rem_assignment_id)
    identity.update({"sub": str(ctx["student"].user_id), "role": "student"})
    start_resp = client.post(f"/api/v1/quizzes/assignment/{rem_assignment_id}/start")
    assert start_resp.status_code == 200, start_resp.json()
    started = start_resp.json()
    started_q_ids = [q["quiz_question_id"] for q in started["questions"]]
    assert started_q_ids != canonical_q_ids
    assert [q["display_order"] for q in started["questions"]] == [1, 2]
    for q in started["questions"]:
        assert [o["option_id"] for o in q["options"]] != canonical_opts_by_q[q["quiz_question_id"]]
        assert [o["option_order"] for o in q["options"]] == [1, 2]

    # Reload keeps identical shuffled order during active attempt
    reload_resp = client.get(f"/api/v1/quizzes/assignment/{rem_assignment_id}/attempt")
    assert reload_resp.status_code == 200
    assert [q["quiz_question_id"] for q in reload_resp.json()["questions"]] == started_q_ids

    # 6. Assigned student submits all correct answers -> graded 20/20 raw, capped at 15/20 (75%)
    with patch(
        "app.services.quiz.QuizAttemptService.refresh_after_committed_grade_change"
    ) as refresh_mock:
        submit_resp = client.post(
            f"/api/v1/quizzes/assignment/{rem_assignment_id}/submit",
            json={
                "answers": [
                    {
                        "quiz_question_id": q["quiz_question_id"],
                        "selected_option_id": correct_opt_by_q[q["quiz_question_id"]],
                    }
                    for q in started["questions"]
                ]
            },
        )
        assert submit_resp.status_code == 200, submit_resp.json()
        submitted = submit_resp.json()
        assert submitted["status"] == "graded"
        assert submitted["grade"] == 20.0
        refresh_mock.assert_called_once()

    # 7. Original quiz questions & original submission score are completely unchanged
    identity.update({"sub": str(ctx["staff"].user_id), "role": "teacher"})
    orig_after = client.get(f"/api/v1/quizzes/classwork/{s['orig_work'].classwork_id}").json()
    assert orig_after["questions"][0]["question_text"] == "What is the rhyme scheme of a Shakespearean sonnet?"
    assert [o["option_order"] for o in orig_after["questions"][0]["options"]] == [1, 2]
    ctx["db"].refresh(s["orig_submission"])
    assert float(s["orig_submission"].grade) == 4.0

    # 8. Remediation score ceiling (75% of 20 = 15.0) & intervention workspace status follow existing rules
    workspace = get_workspace(ctx["db"], _staff(ctx), _id(ctx))
    assert workspace["progress"]["remediation_status"] == "GRADED"
    assigned_entry = next(
        item
        for item in workspace["progress"]["assigned_remediation"]
        if item["assignment_id"] == rem_assignment_id
    )
    assert assigned_entry["grade"] == 20.0
    assert assigned_entry["effective_grade"] == 15.0
    ctx["db"].refresh(ctx["candidate"])
    assert ctx["candidate"].status == "ACTIVE"


def test_e2e_ai_draft_to_quiz_builder_workflow(candidate_context):
    """Method 2: Generate with AI -> Review -> Quiz Builder -> Save Draft -> Publish -> Student Answers -> Grade."""
    ctx = candidate_context
    s = _setup_remediation_quiz_scenario(ctx, original_score=4.0, total_points=20.0)
    client, identity = _build_e2e_client(ctx)

    due_date_iso = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    create_resp = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Poetry Remediation Quiz (AI Builder)",
            "instructions": "Complete all AI-generated remediation items.",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": "20",
            "is_published": "false",
            "subject_id": str(ctx["subject"].subject_id),
            "show_scores": "true",
            "class_ids": json.dumps([ctx["class"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "lesson_ids": json.dumps([s["lesson"].lesson_id]),
            "due_date": due_date_iso,
            "max_attempts": "3",
            "intervention_id": str(_id(ctx)),
            "remediation_request_id": str(uuid.uuid4()),
            "original_classwork_assignment_id": str(s["orig_assignment"].classwork_assignment_id),
            "quiz_payload": json.dumps({
                "duration_minutes": 25,
                "status": "DRAFT",
                "settings": {
                    "is_shuffle_questions": True,
                    "is_shuffle_options": True,
                    "enable_per_question_scoring": True,
                    "enable_per_question_time_limits": False,
                    "max_attempts": 3,
                    "show_correct_answers": True,
                    "summary_release_mode": "IMMEDIATE",
                },
                "questions": [
                    {
                        "question_text": "Which device compares two things using like or as?",
                        "question_type": "MULTIPLE_CHOICE",
                        "points": 12,
                        "display_order": 1,
                        "difficulty_level": "EASY",
                        "explanation": "Simile uses like or as.",
                        "lesson_id": s["lesson"].lesson_id,
                        "is_ai_generated": True,
                        "options": [
                            {"option_text": "Simile", "is_correct": True, "option_order": 1},
                            {"option_text": "Metaphor", "is_correct": False, "option_order": 2},
                        ],
                    },
                    {
                        "question_text": "Which device gives human qualities to non-human things?",
                        "question_type": "MULTIPLE_CHOICE",
                        "points": 8,
                        "display_order": 2,
                        "difficulty_level": "MEDIUM",
                        "explanation": "Personification gives human traits.",
                        "lesson_id": s["lesson"].lesson_id,
                        "is_ai_generated": True,
                        "options": [
                            {"option_text": "Hyperbole", "is_correct": False, "option_order": 1},
                            {"option_text": "Personification", "is_correct": True, "option_order": 2},
                        ],
                    },
                ],
            }),
        },
    )
    assert create_resp.status_code == 200, create_resp.json()
    created = create_resp.json()
    rem_classwork_id = created["classwork_id"]
    rem_assignment_id = created["assignments"][0]["classwork_assignment_id"]

    # Publish
    pub_resp = client.post(
        f"/api/v1/classwork-assignments/classwork/{rem_classwork_id}/assign",
        json={
            "class_ids": [ctx["class"].class_id],
            "academic_period_id": ctx["period"].academic_period_id,
            "due_date": due_date_iso,
            "is_published": True,
            "max_attempts": 3,
        },
    )
    assert pub_resp.status_code == 200, pub_resp.json()

    rem_quiz_body = client.get(f"/api/v1/quizzes/classwork/{rem_classwork_id}").json()
    assert all(q["is_ai_generated"] is True for q in rem_quiz_body["questions"])
    q1_id = rem_quiz_body["questions"][0]["quiz_question_id"]
    q2_id = rem_quiz_body["questions"][1]["quiz_question_id"]
    q1_correct = next(o["option_id"] for o in rem_quiz_body["questions"][0]["options"] if o["is_correct"])
    q2_wrong = next(o["option_id"] for o in rem_quiz_body["questions"][1]["options"] if not o["is_correct"])

    # Unassigned classmate blocked
    identity.update({"sub": str(s["other_user"].user_id), "role": "student"})
    assert client.get(f"/api/v1/quizzes/assignment/{rem_assignment_id}/attempt").status_code == 404

    # Assigned student starts (verifies shuffling) and submits partial score (12/20, below 15.0 cap)
    _acknowledge_prerequisites(ctx, rem_assignment_id)
    identity.update({"sub": str(ctx["student"].user_id), "role": "student"})
    started = client.post(f"/api/v1/quizzes/assignment/{rem_assignment_id}/start").json()
    assert [q["quiz_question_id"] for q in started["questions"]] != [q1_id, q2_id]

    with patch(
        "app.services.quiz.QuizAttemptService.refresh_after_committed_grade_change"
    ) as refresh_mock:
        submit_resp = client.post(
            f"/api/v1/quizzes/assignment/{rem_assignment_id}/submit",
            json={
                "answers": [
                    {"quiz_question_id": q1_id, "selected_option_id": q1_correct},
                    {"quiz_question_id": q2_id, "selected_option_id": q2_wrong},
                ]
            },
        )
        assert submit_resp.status_code == 200, submit_resp.json()
        assert submit_resp.json()["grade"] == 12.0
        refresh_mock.assert_called_once()

    # Score below 75% ceiling (15.0) is applied accurately without artificial inflation; original score untouched
    workspace = get_workspace(ctx["db"], _staff(ctx), _id(ctx))
    assigned_entry = next(
        item
        for item in workspace["progress"]["assigned_remediation"]
        if item["assignment_id"] == rem_assignment_id
    )
    assert assigned_entry["grade"] == 12.0
    assert assigned_entry["effective_grade"] == 12.0
    ctx["db"].refresh(s["orig_submission"])
    assert float(s["orig_submission"].grade) == 4.0


def test_e2e_manual_quiz_builder_workflow(candidate_context):
    """Method 3: Continue to Quiz Builder -> Create Manually -> Save Draft -> Publish -> Student Answers -> Grade."""
    ctx = candidate_context
    s = _setup_remediation_quiz_scenario(ctx, original_score=4.0, total_points=20.0)
    client, identity = _build_e2e_client(ctx)

    due_date_iso = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    create_resp = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        data={
            "title": "Poetry Remediation Quiz (Manual)",
            "instructions": "Answer both manual questions carefully.",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "total_points": "20",
            "is_published": "false",
            "subject_id": str(ctx["subject"].subject_id),
            "show_scores": "true",
            "class_ids": json.dumps([ctx["class"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "lesson_ids": json.dumps([s["lesson"].lesson_id]),
            "due_date": due_date_iso,
            "max_attempts": "3",
            "intervention_id": str(_id(ctx)),
            "remediation_request_id": str(uuid.uuid4()),
            "original_classwork_assignment_id": str(s["orig_assignment"].classwork_assignment_id),
            "quiz_payload": json.dumps({
                "duration_minutes": 20,
                "status": "DRAFT",
                "settings": {
                    "is_shuffle_questions": True,
                    "is_shuffle_options": True,
                    "enable_per_question_scoring": True,
                    "enable_per_question_time_limits": False,
                    "max_attempts": 3,
                    "show_correct_answers": True,
                    "summary_release_mode": "IMMEDIATE",
                },
                "questions": [
                    {
                        "question_text": "What is a 14-line poem called?",
                        "question_type": "MULTIPLE_CHOICE",
                        "points": 10,
                        "display_order": 1,
                        "difficulty_level": "EASY",
                        "lesson_id": s["lesson"].lesson_id,
                        "is_ai_generated": False,
                        "options": [
                            {"option_text": "Sonnet", "is_correct": True, "option_order": 1},
                            {"option_text": "Haiku", "is_correct": False, "option_order": 2},
                        ],
                    },
                    {
                        "question_text": "Name the playwright famous for 154 sonnets.",
                        "question_type": "IDENTIFICATION",
                        "points": 10,
                        "display_order": 2,
                        "difficulty_level": "MEDIUM",
                        "lesson_id": s["lesson"].lesson_id,
                        "is_ai_generated": False,
                        "options": [
                            {"option_text": "William Shakespeare", "is_correct": True, "option_order": 1},
                        ],
                    },
                ],
            }),
        },
    )
    assert create_resp.status_code == 200, create_resp.json()
    created = create_resp.json()
    rem_classwork_id = created["classwork_id"]
    rem_assignment_id = created["assignments"][0]["classwork_assignment_id"]

    # Publish
    pub_resp = client.post(
        f"/api/v1/classwork-assignments/classwork/{rem_classwork_id}/assign",
        json={
            "class_ids": [ctx["class"].class_id],
            "academic_period_id": ctx["period"].academic_period_id,
            "due_date": due_date_iso,
            "is_published": True,
            "max_attempts": 3,
        },
    )
    assert pub_resp.status_code == 200, pub_resp.json()

    rem_quiz_body = client.get(f"/api/v1/quizzes/classwork/{rem_classwork_id}").json()
    mc_q = next(q for q in rem_quiz_body["questions"] if q["question_type"] == "MULTIPLE_CHOICE")
    id_q = next(q for q in rem_quiz_body["questions"] if q["question_type"] == "IDENTIFICATION")
    mc_correct_id = next(o["option_id"] for o in mc_q["options"] if o["is_correct"])
    mc_canonical_opt_ids = [o["option_id"] for o in mc_q["options"]]

    # Unassigned classmate blocked
    identity.update({"sub": str(s["other_user"].user_id), "role": "student"})
    assert client.get(f"/api/v1/quizzes/assignment/{rem_assignment_id}/attempt").status_code == 404

    # Assigned student starts attempt, verifies shuffling, and submits MC + Identification answers
    _acknowledge_prerequisites(ctx, rem_assignment_id)
    identity.update({"sub": str(ctx["student"].user_id), "role": "student"})
    started = client.post(f"/api/v1/quizzes/assignment/{rem_assignment_id}/start").json()
    assert [q["quiz_question_id"] for q in started["questions"]] != [
        mc_q["quiz_question_id"],
        id_q["quiz_question_id"],
    ]
    started_mc = next(q for q in started["questions"] if q["question_type"] == "MULTIPLE_CHOICE")
    assert [o["option_id"] for o in started_mc["options"]] != mc_canonical_opt_ids

    with patch(
        "app.services.quiz.QuizAttemptService.refresh_after_committed_grade_change"
    ) as refresh_mock:
        submit_resp = client.post(
            f"/api/v1/quizzes/assignment/{rem_assignment_id}/submit",
            json={
                "answers": [
                    {"quiz_question_id": mc_q["quiz_question_id"], "selected_option_id": mc_correct_id},
                    {"quiz_question_id": id_q["quiz_question_id"], "answer_text": "William Shakespeare"},
                ]
            },
        )
        assert submit_resp.status_code == 200, submit_resp.json()
        assert submit_resp.json()["status"] == "graded"
        assert submit_resp.json()["grade"] == 20.0
        refresh_mock.assert_called_once()

    # Remediation link, 75% score ceiling (15.0), and original score immutability verified
    link = (
        ctx["db"]
        .query(RemediationAssignmentLink)
        .filter_by(remediation_assignment_id=rem_assignment_id)
        .one()
    )
    assert float(link.score_adjustment_cap) == 75.0
    workspace = get_workspace(ctx["db"], _staff(ctx), _id(ctx))
    assigned_entry = next(
        item
        for item in workspace["progress"]["assigned_remediation"]
        if item["assignment_id"] == rem_assignment_id
    )
    assert assigned_entry["effective_grade"] == 15.0
    ctx["db"].refresh(s["orig_submission"])
    assert float(s["orig_submission"].grade) == 4.0
