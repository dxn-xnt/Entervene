"""Unit and integration test suite for Intervention Practice Assessment Phase 2.

Covers:
1. Teacher Assessment CRUD, draft question validation, reordering, and publishing guards.
2. Edit locking once student attempts exist.
3. Student attempt lifecycle: active taking (no keys leaked), deterministic shuffling, resume idempotency.
4. Server-side auto-scoring (MCQ, True/False, Identification) and permanent attempt snapshots.
5. Mandatory diagnostic feedback: reveals authoritative correct answers & explanations on ALL attempts,
   including failed attempts (0% score) and unanswered questions.
6. Progression gatekeeper evaluator: REQUIRE_PASS, REQUIRE_ATTEMPT, OPTIONAL policies,
   and the non-revocation invariant (later failed retakes never revoke passing qualification).
7. AI generation adapter (reading-grounded, MCQ only, rejects < 50 chars).
8. File import adapter (accepts MCQ/TF/ID, rejects Short Answer / Essay).
9. Strict isolation: zero rows created in student_submission, student_grade, or remediation gradebook tables.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine, func
from sqlalchemy.orm import Session

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.intervention.PracticeAttemptAnswer import PracticeAttemptAnswer
from app.models.intervention.PracticeQuestion import PracticeQuestion
from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.PracticeAssessment import (
    AIGeneratePracticeQuestionsRequest,
    PracticeAssessmentCreate,
    PracticeAssessmentUpdate,
    PracticeAttemptAnswerSubmission,
    PracticeAttemptSubmitRequest,
    PracticeOptionIn,
    PracticeQuestionBatchSave,
    PracticeQuestionCreate,
    PracticeQuestionsReorderRequest,
    PracticeQuestionUpdate,
)
from app.schemas.Quiz import QuizImportPreviewResponse, QuizOptionIn, QuizQuestionIn
from app.services.intervention import (
    PracticeAssessmentAIService,
    PracticeAssessmentImportService,
    PracticeAssessmentService,
)


@pytest.fixture
def db_env():
    """Isolated in-memory SQLite database with seeded academic prerequisites."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        # Academic structure
        lvl = AcademicLevel(academic_level_id=1, level_name="Grade 10", grade_level=10)
        ay = AcademicYear(
            academic_year_id=1,
            year_label="2026-2027",
            start_date=date(2026, 8, 1),
            end_date=date(2027, 5, 31),
            is_active=True,
        )
        ap = AcademicPeriod(
            academic_period_id=1,
            academic_year_id=1,
            period_name="1st Quarter",
            period_sequence=1,
            start_date=date(2026, 8, 1),
            end_date=date(2026, 10, 15),
            is_active=True,
        )
        cls_obj = Class(
            class_id=1,
            academic_year_id=1,
            academic_level_id=1,
            section_name="Grade 10 - Newton",
        )
        subj = Subject(subject_id=1, subject_name="Mathematics")
        staff = AcademicStaff(staff_id="STAFF-01", first_name="Maria", last_name="Santos")
        student = Student(student_id=uuid4(), student_lrn="100000000001", first_name="Juan", last_name="Dela Cruz")

        load = SubjectLoad(
            staff_id=staff.staff_id,
            class_id=cls_obj.class_id,
            subject_id=subj.subject_id,
            academic_period_id=ap.academic_period_id,
            status="published",
            is_active_version=True,
        )
        sc = StudentClass(
            student_id=student.student_id,
            class_id=cls_obj.class_id,
            academic_year_id=ay.academic_year_id,
            enrollment_status="enrolled",
        )
        intervention = Intervention(
            student_id=student.student_id,
            class_id=cls_obj.class_id,
            subject_id=subj.subject_id,
            academic_period_id=ap.academic_period_id,
            source_prediction_id=99901,
            status="ACTIVE",
            activated_at=datetime.now(timezone.utc),
            activated_by_staff_id=staff.staff_id,
            diagnosis_snapshot={"weakest_supported_components": ["EXAMINATION"]},
        )

        db.add_all([lvl, ay, ap, cls_obj, subj, staff, student, load, sc, intervention])
        db.commit()

        yield {
            "db": db,
            "engine": engine,
            "staff": staff,
            "student": student,
            "intervention": intervention,
            "subject": subj,
            "class": cls_obj,
            "period": ap,
        }

    engine.dispose()


# ---------------------------------------------------------------------------
# 1. Teacher Assessment CRUD & Validation
# ---------------------------------------------------------------------------

class TestTeacherAssessmentLifecycle:
    def test_create_or_get_initial_draft(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id

        # First call creates draft
        assessment = PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)
        assert assessment.practice_assessment_id is not None
        assert assessment.status == "DRAFT"
        assert assessment.passing_percentage == Decimal("75.00")
        assert assessment.gatekeeper_policy == "REQUIRE_PASS"
        assert assessment.shuffle_options is True

        # Second call returns existing instance
        same_assessment = PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)
        assert same_assessment.practice_assessment_id == assessment.practice_assessment_id

    def test_update_assessment_config(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id

        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)
        updated = PracticeAssessmentService.update_assessment_config(
            db,
            staff_id,
            intervention_id,
            PracticeAssessmentUpdate(
                title="Algebra Mastery Practice",
                passing_percentage=Decimal("80.00"),
                gatekeeper_policy="REQUIRE_ATTEMPT",
                shuffle_options=False,
            ),
        )
        assert updated.title == "Algebra Mastery Practice"
        assert updated.passing_percentage == Decimal("80.00")
        assert updated.gatekeeper_policy == "REQUIRE_ATTEMPT"
        assert updated.shuffle_options is False

    def test_add_valid_questions(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)

        # 1. Multiple Choice
        q_mcq = PracticeAssessmentService.add_question(
            db,
            staff_id,
            intervention_id,
            PracticeQuestionCreate(
                question_text="What is 2 + 2?",
                question_type="MULTIPLE_CHOICE",
                points=Decimal("1.00"),
                explanation="2 + 2 equals 4.",
                options=[
                    PracticeOptionIn(option_text="3", is_correct=False, option_order=1),
                    PracticeOptionIn(option_text="4", is_correct=True, option_order=2),
                    PracticeOptionIn(option_text="5", is_correct=False, option_order=3),
                ],
            ),
        )
        assert q_mcq.practice_question_id is not None
        assert q_mcq.display_order == 1
        assert len(q_mcq.options) == 3

        # 2. True / False
        q_tf = PracticeAssessmentService.add_question(
            db,
            staff_id,
            intervention_id,
            PracticeQuestionCreate(
                question_text="A triangle has 3 sides.",
                question_type="TRUE_FALSE",
                points=Decimal("1.00"),
                options=[
                    PracticeOptionIn(option_text="True", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="False", is_correct=False, option_order=2),
                ],
            ),
        )
        assert q_tf.display_order == 2
        assert len(q_tf.options) == 2

        # 3. Identification
        q_id = PracticeAssessmentService.add_question(
            db,
            staff_id,
            intervention_id,
            PracticeQuestionCreate(
                question_text="The chemical symbol for water is ___.",
                question_type="IDENTIFICATION",
                points=Decimal("2.00"),
                explanation="H2O is water.",
                options=[
                    PracticeOptionIn(option_text="H2O", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="water", is_correct=True, option_order=2),
                ],
            ),
        )
        assert q_id.display_order == 3
        assert len(q_id.options) == 2

    def test_question_validation_rejections(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)

        # MCQ with no correct option
        with pytest.raises(HTTPException) as exc:
            PracticeAssessmentService.add_question(
                db, staff_id, intervention_id,
                PracticeQuestionCreate(
                    question_text="MCQ test",
                    question_type="MULTIPLE_CHOICE",
                    options=[
                        PracticeOptionIn(option_text="A", is_correct=False, option_order=1),
                        PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                    ],
                ),
            )
        assert exc.value.status_code == 422
        assert "must have exactly one correct answer option" in exc.value.detail

        # MCQ with two correct options
        with pytest.raises(HTTPException) as exc:
            PracticeAssessmentService.add_question(
                db, staff_id, intervention_id,
                PracticeQuestionCreate(
                    question_text="MCQ test",
                    question_type="MULTIPLE_CHOICE",
                    options=[
                        PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                        PracticeOptionIn(option_text="B", is_correct=True, option_order=2),
                    ],
                ),
            )
        assert exc.value.status_code == 422
        assert "found 2" in exc.value.detail

        # Identification without keys
        with pytest.raises(HTTPException) as exc:
            PracticeAssessmentService.add_question(
                db, staff_id, intervention_id,
                PracticeQuestionCreate(
                    question_text="Identification test",
                    question_type="IDENTIFICATION",
                    options=[],
                ),
            )
        assert exc.value.status_code == 422
        assert "requires at least one accepted answer key" in exc.value.detail

    def test_update_and_delete_question(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)

        q1 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Question 1",
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )
        q2 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Question 2",
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )

        # Update Q1
        updated = PracticeAssessmentService.update_question(
            db, staff_id, intervention_id, q1.practice_question_id,
            PracticeQuestionUpdate(question_text="Updated Q1 Prompt"),
        )
        assert updated.question_text == "Updated Q1 Prompt"

        # Delete Q1 and check Q2 re-sequencing
        PracticeAssessmentService.delete_question(db, staff_id, intervention_id, q1.practice_question_id)
        db.refresh(q2)
        assert q2.display_order == 1

    def test_reorder_questions(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)

        q1 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Q1",
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )
        q2 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Q2",
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )
        # Reorder [q2, q1]
        reordered = PracticeAssessmentService.reorder_questions(
            db, staff_id, intervention_id, [q2.practice_question_id, q1.practice_question_id]
        )
        assert [q.practice_question_id for q in reordered] == [q2.practice_question_id, q1.practice_question_id]
        assert reordered[0].display_order == 1
        assert reordered[1].display_order == 2

    def test_batch_save_questions(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)

        batch = PracticeQuestionBatchSave(
            questions=[
                PracticeQuestionCreate(
                    question_text=f"Batch Item {i}",
                    options=[
                        PracticeOptionIn(option_text="Correct", is_correct=True, option_order=1),
                        PracticeOptionIn(option_text="Wrong", is_correct=False, option_order=2),
                    ],
                )
                for i in range(1, 4)
            ],
            replace_existing=True,
        )
        created = PracticeAssessmentService.batch_save_questions(db, staff_id, intervention_id, batch)
        assert len(created) == 3
        assert [q.display_order for q in created] == [1, 2, 3]

    def test_publish_validation(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)

        # Cannot publish with 0 questions
        with pytest.raises(HTTPException) as exc:
            PracticeAssessmentService.publish_assessment(db, staff_id, intervention_id)
        assert exc.value.status_code == 422
        assert "zero questions" in exc.value.detail

        # Add question and publish
        PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Valid item",
                options=[
                    PracticeOptionIn(option_text="Yes", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="No", is_correct=False, option_order=2),
                ],
            ),
        )
        published = PracticeAssessmentService.publish_assessment(db, staff_id, intervention_id)
        assert published.status == "PUBLISHED"

    def test_archive_assessment(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)
        archived = PracticeAssessmentService.archive_assessment(db, staff_id, intervention_id)
        assert archived.status == "ARCHIVED"

    def test_edit_locking_after_student_attempts(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)
        q = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Pre-attempt question",
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )
        PracticeAssessmentService.publish_assessment(db, staff_id, intervention_id)

        # Student starts an attempt
        PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)

        # Attempt to modify question content now raises 409
        with pytest.raises(HTTPException) as exc:
            PracticeAssessmentService.add_question(
                db, staff_id, intervention_id,
                PracticeQuestionCreate(
                    question_text="Post-attempt question",
                    options=[
                        PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                        PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                    ],
                ),
            )
        assert exc.value.status_code == 409
        assert "Cannot modify question content on a practice assessment with existing student attempts" in exc.value.detail


# ---------------------------------------------------------------------------
# 2. Student Attempt Execution, Security & Scoring
# ---------------------------------------------------------------------------

class TestStudentAttemptExecution:
    @pytest.fixture(autouse=True)
    def setup_assessment_with_questions(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id

        PracticeAssessmentService.get_or_create_assessment(
            db, staff_id, intervention_id,
            PracticeAssessmentCreate(passing_percentage=Decimal("70.00"), gatekeeper_policy="REQUIRE_PASS"),
        )
        # Q1: MCQ (Points: 1.0)
        self.q1 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="What is the capital of France?",
                question_type="MULTIPLE_CHOICE",
                points=Decimal("1.00"),
                explanation="Paris is the capital of France.",
                options=[
                    PracticeOptionIn(option_text="Paris", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="London", is_correct=False, option_order=2),
                    PracticeOptionIn(option_text="Rome", is_correct=False, option_order=3),
                ],
            ),
        )
        # Q2: True/False (Points: 1.0)
        self.q2 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="The earth revolves around the sun.",
                question_type="TRUE_FALSE",
                points=Decimal("1.00"),
                explanation="Heliocentrism is scientifically proven.",
                options=[
                    PracticeOptionIn(option_text="True", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="False", is_correct=False, option_order=2),
                ],
            ),
        )
        # Q3: Identification (Points: 2.0)
        self.q3 = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Identify the powerhouse of the cell.",
                question_type="IDENTIFICATION",
                points=Decimal("2.00"),
                explanation="Mitochondria generate ATP.",
                options=[
                    PracticeOptionIn(option_text="Mitochondria", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="Mitochondrion", is_correct=True, option_order=2),
                ],
            ),
        )
        PracticeAssessmentService.publish_assessment(db, staff_id, intervention_id)

    def test_student_metadata_does_not_leak_questions(self, db_env):
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        meta = PracticeAssessmentService.get_student_assessment_metadata(db, student_id, intervention_id)
        assert meta["title"] == "Practice Assessment"
        assert meta["total_questions"] == 3
        assert meta["total_points"] == 4.0
        assert meta["passing_percentage"] == 70.0
        assert meta["attempts_count"] == 0
        assert meta["has_active_attempt"] is False
        assert "questions" not in meta  # No question content exposed!

    def test_student_start_attempt_scrubs_keys_and_explanations(self, db_env):
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        started = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        assert started.status == "STARTED"
        assert started.total_questions == 3

        for q in started.questions:
            # Question level check
            assert not hasattr(q, "explanation") or getattr(q, "explanation", None) is None
            # Option level check
            for opt in q.options:
                assert not hasattr(opt, "is_correct")  # Answer keys strictly omitted!

    def test_idempotent_resume(self, db_env):
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        attempt1 = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        attempt2 = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)

        assert attempt1.attempt_id == attempt2.attempt_id
        assert [q.practice_question_id for q in attempt1.questions] == [q.practice_question_id for q in attempt2.questions]

    def test_submission_and_scoring(self, db_env):
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        started = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)

        # Find Paris option_id
        paris_opt = next(o.option_id for o in self.q1.options if o.option_text == "Paris")
        true_opt = next(o.option_id for o in self.q2.options if o.option_text == "True")

        submission = PracticeAttemptSubmitRequest(
            answers=[
                PracticeAttemptAnswerSubmission(practice_question_id=self.q1.practice_question_id, selected_option_id=paris_opt),
                PracticeAttemptAnswerSubmission(practice_question_id=self.q2.practice_question_id, selected_option_id=true_opt),
                PracticeAttemptAnswerSubmission(practice_question_id=self.q3.practice_question_id, student_answer_text="mitochondria"),
            ]
        )
        feedback = PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, started.attempt_id, submission
        )

        assert feedback.status == "SUBMITTED"
        assert feedback.total_score == Decimal("4.00")
        assert feedback.max_score == Decimal("4.00")
        assert feedback.score_percentage == Decimal("100.00")
        assert feedback.is_passed is True
        assert feedback.result_status == "PASSED"
        assert feedback.eligible_for_remediation is True
        assert len(feedback.items) == 3

    def test_mandatory_feedback_always_reveals_correct_answers_on_failure(self, db_env):
        """CRITICAL PRODUCT REQUIREMENT:
        When a student fails (e.g. 0% score or leaves questions unanswered), the system
        MUST return the authoritative correct answer AND explanation for every item.
        """
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        started = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)

        # Intentionally pick wrong answers or leave unanswered
        london_opt = next(o.option_id for o in self.q1.options if o.option_text == "London")

        submission = PracticeAttemptSubmitRequest(
            answers=[
                PracticeAttemptAnswerSubmission(practice_question_id=self.q1.practice_question_id, selected_option_id=london_opt),
                # Q2 and Q3 are left completely unanswered!
            ]
        )
        feedback = PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, started.attempt_id, submission
        )

        assert feedback.status == "SUBMITTED"
        assert feedback.total_score == Decimal("0.00")
        assert feedback.score_percentage == Decimal("0.00")
        assert feedback.is_passed is False
        assert feedback.result_status == "BELOW_PASSING"
        assert feedback.eligible_for_remediation is False

        # Verify correct answers and explanations are present for ALL 3 questions
        q1_item = next(it for it in feedback.items if it.practice_question_id == self.q1.practice_question_id)
        assert q1_item.is_correct is False
        assert q1_item.student_answer == "London"
        assert q1_item.correct_answer == "Paris"
        assert q1_item.explanation == "Paris is the capital of France."

        q2_item = next(it for it in feedback.items if it.practice_question_id == self.q2.practice_question_id)
        assert q2_item.is_correct is False
        assert q2_item.student_answer is None  # Unanswered
        assert q2_item.correct_answer == "True"
        assert q2_item.explanation == "Heliocentrism is scientifically proven."

        q3_item = next(it for it in feedback.items if it.practice_question_id == self.q3.practice_question_id)
        assert q3_item.is_correct is False
        assert q3_item.student_answer is None  # Unanswered
        assert q3_item.correct_answer == "Mitochondria"
        assert q3_item.explanation == "Mitochondria generate ATP."


# ---------------------------------------------------------------------------
# 3. Progression Policy Evaluator & Invariant Non-Revocation
# ---------------------------------------------------------------------------

class TestProgressionGatekeeper:
    @pytest.fixture(autouse=True)
    def setup_assessment(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id

        self.assessment = PracticeAssessmentService.get_or_create_assessment(
            db, staff_id, intervention_id,
            PracticeAssessmentCreate(passing_percentage=Decimal("75.00"), gatekeeper_policy="REQUIRE_PASS"),
        )
        self.q = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Simple question",
                points=Decimal("1.00"),
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )
        PracticeAssessmentService.publish_assessment(db, staff_id, intervention_id)

    def test_progression_require_pass_policy(self, db_env):
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        # 0 attempts -> not eligible
        prog = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        assert prog.eligible_for_remediation is False
        assert prog.practice_completed is False
        assert prog.practice_passed is False

        # Attempt 1: Failed
        att1 = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        wrong_opt = next(o.option_id for o in self.q.options if not o.is_correct)
        PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, att1.attempt_id,
            PracticeAttemptSubmitRequest(
                answers=[PracticeAttemptAnswerSubmission(practice_question_id=self.q.practice_question_id, selected_option_id=wrong_opt)]
            ),
        )

        prog_after_fail = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        assert prog_after_fail.practice_completed is True
        assert prog_after_fail.practice_passed is False
        assert prog_after_fail.eligible_for_remediation is False

        # Attempt 2: Passed
        att2 = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        assert att2.attempt_number == 2
        correct_opt = next(o.option_id for o in self.q.options if o.is_correct)
        PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, att2.attempt_id,
            PracticeAttemptSubmitRequest(
                answers=[PracticeAttemptAnswerSubmission(practice_question_id=self.q.practice_question_id, selected_option_id=correct_opt)]
            ),
        )

        prog_after_pass = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        assert prog_after_pass.practice_completed is True
        assert prog_after_pass.practice_passed is True
        assert prog_after_pass.eligible_for_remediation is True
        assert prog_after_pass.best_score_percentage == Decimal("100.00")

    def test_progression_invariant_non_revocation(self, db_env):
        """CRITICAL INVARIANT:
        If a student achieves passing qualification on Attempt 1, and retries in Attempt 2
        scoring below passing (or even 0%), practice_passed and eligible_for_remediation
        MUST REMAIN TRUE.
        """
        db = db_env["db"]
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        # Attempt 1: Passed (100%)
        att1 = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        correct_opt = next(o.option_id for o in self.q.options if o.is_correct)
        PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, att1.attempt_id,
            PracticeAttemptSubmitRequest(
                answers=[PracticeAttemptAnswerSubmission(practice_question_id=self.q.practice_question_id, selected_option_id=correct_opt)]
            ),
        )

        prog1 = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        assert prog1.practice_passed is True
        assert prog1.eligible_for_remediation is True

        # Attempt 2: Failed (0%)
        att2 = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        wrong_opt = next(o.option_id for o in self.q.options if not o.is_correct)
        PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, att2.attempt_id,
            PracticeAttemptSubmitRequest(
                answers=[PracticeAttemptAnswerSubmission(practice_question_id=self.q.practice_question_id, selected_option_id=wrong_opt)]
            ),
        )

        prog2 = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        # Passing eligibility is permanently preserved!
        assert prog2.attempts_count == 2
        assert prog2.practice_passed is True
        assert prog2.eligible_for_remediation is True
        assert prog2.best_score_percentage == Decimal("100.00")

    def test_progression_require_attempt_policy(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        PracticeAssessmentService.update_assessment_config(
            db, staff_id, intervention_id,
            PracticeAssessmentUpdate(gatekeeper_policy="REQUIRE_ATTEMPT"),
        )
        # 0 attempts -> not eligible
        assert PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id).eligible_for_remediation is False

        # Attempt with 0% score -> eligible!
        att = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        wrong_opt = next(o.option_id for o in self.q.options if not o.is_correct)
        PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, att.attempt_id,
            PracticeAttemptSubmitRequest(
                answers=[PracticeAttemptAnswerSubmission(practice_question_id=self.q.practice_question_id, selected_option_id=wrong_opt)]
            ),
        )
        prog = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        assert prog.practice_completed is True
        assert prog.practice_passed is False
        assert prog.eligible_for_remediation is True

    def test_progression_optional_policy(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        PracticeAssessmentService.update_assessment_config(
            db, staff_id, intervention_id,
            PracticeAssessmentUpdate(gatekeeper_policy="OPTIONAL"),
        )
        prog = PracticeAssessmentService.evaluate_practice_progression(db, intervention_id, student_id)
        assert prog.eligible_for_remediation is True


# ---------------------------------------------------------------------------
# 4. AI Generation & Quiz Import Adapters
# ---------------------------------------------------------------------------

class TestAdapters:
    def test_ai_generation_rejects_missing_or_empty_readings(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id

        # No reading materials configured for this intervention
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                PracticeAssessmentAIService.generate_practice_questions_ai(
                    db, staff_id, intervention_id,
                    AIGeneratePracticeQuestionsRequest(target_count=3),
                )
            )
        assert exc.value.status_code == 422
        assert "No readable reading materials found" in exc.value.detail

    def test_ai_generation_success_with_readings(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        subj = db_env["subject"]
        cls_obj = db_env["class"]
        period = db_env["period"]

        # Seed a reading classwork with substantial text
        cw = Classwork(
            subject_id=subj.subject_id,
            created_by_staff_id=staff_id,
            classwork_type="READING",
            title="Introduction to Linear Functions",
            description="Linear functions have a constant rate of change represented by slope m. The equation is y = mx + b.",
            instructions="Read through the definition and review the formula for slope between two points.",
            is_archived=False,
            is_graded=False,
        )
        db.add(cw)
        db.flush()

        cw_assign = ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=cls_obj.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=staff_id,
        )
        db.add(cw_assign)
        db_env["intervention"].remediation_plan = {
            "selected_resources": [{"kind": "CLASSWORK", "id": cw.classwork_id}]
        }
        db.commit()

        # Mock the AI generator function
        mock_raw_ai_questions = [
            {
                "question_text": "What does 'm' represent in the slope-intercept form y = mx + b?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 1.0,
                "display_order": 1,
                "explanation": "'m' represents the slope.",
                "options": [
                    {"option_text": "Slope", "is_correct": True, "option_order": 1},
                    {"option_text": "Y-intercept", "is_correct": False, "option_order": 2},
                    {"option_text": "X-intercept", "is_correct": False, "option_order": 3},
                    {"option_text": "Origin", "is_correct": False, "option_order": 4},
                ],
            }
        ]

        with patch(
            "app.services.intervention.PracticeAssessmentAIService.generate_quiz_questions",
            new=AsyncMock(return_value=mock_raw_ai_questions),
        ):
            preview = asyncio.run(
                PracticeAssessmentAIService.generate_practice_questions_ai(
                    db, staff_id, intervention_id,
                    AIGeneratePracticeQuestionsRequest(target_count=1),
                )
            )

        assert len(preview) == 1
        assert preview[0].question_type == "MULTIPLE_CHOICE"
        assert preview[0].is_ai_generated is True
        assert len(preview[0].options) == 4
        assert any(o.is_correct for o in preview[0].options)

    def test_ai_generation_rejects_unapproved_reading_ids(self, db_env):
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        intervention_id = db_env["intervention"].intervention_id
        subj = db_env["subject"]
        cls_obj = db_env["class"]
        period = db_env["period"]

        cw1 = Classwork(
            subject_id=subj.subject_id,
            created_by_staff_id=staff_id,
            classwork_type="READING",
            title="Approved Reading",
            description="Content of approved reading",
            instructions="Read this.",
            is_archived=False,
            is_graded=False,
        )
        cw2 = Classwork(
            subject_id=subj.subject_id,
            created_by_staff_id=staff_id,
            classwork_type="READING",
            title="Unapproved Class Reading",
            description="Content of unapproved reading",
            instructions="Read this.",
            is_archived=False,
            is_graded=False,
        )
        db.add_all([cw1, cw2])
        db.flush()

        db.add(ClassworkAssignment(
            classwork_id=cw1.classwork_id,
            class_id=cls_obj.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=staff_id,
        ))
        db.add(ClassworkAssignment(
            classwork_id=cw2.classwork_id,
            class_id=cls_obj.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=staff_id,
        ))
        db_env["intervention"].remediation_plan = {
            "selected_resources": [{"kind": "CLASSWORK", "id": cw1.classwork_id}]
        }
        db.commit()

        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                PracticeAssessmentAIService.generate_practice_questions_ai(
                    db, staff_id, intervention_id,
                    AIGeneratePracticeQuestionsRequest(
                        target_count=1,
                        reading_classwork_ids=[cw2.classwork_id],
                    ),
                )
            )
        assert exc.value.status_code == 422
        assert "not approved supporting materials" in exc.value.detail

    def test_quiz_import_adapter_allowed_types(self):
        mock_parsed_preview = QuizImportPreviewResponse(
            title="Sample Quiz",
            questions=[
                QuizQuestionIn(
                    question_text="Imported MCQ",
                    question_type="MULTIPLE_CHOICE",
                    points=1.0,
                    display_order=1,
                    options=[
                        QuizOptionIn(option_text="A", is_correct=True, option_order=1),
                        QuizOptionIn(option_text="B", is_correct=False, option_order=2),
                    ],
                ),
                QuizQuestionIn(
                    question_text="Imported True False",
                    question_type="TRUE_FALSE",
                    points=1.0,
                    display_order=2,
                    options=[
                        QuizOptionIn(option_text="True", is_correct=True, option_order=1),
                        QuizOptionIn(option_text="False", is_correct=False, option_order=2),
                    ],
                ),
                QuizQuestionIn(
                    question_text="Imported Identification",
                    question_type="IDENTIFICATION",
                    points=1.0,
                    display_order=3,
                    options=[
                        QuizOptionIn(option_text="Key Term", is_correct=True, option_order=1),
                    ],
                ),
            ],
            warnings=[],
        )

        dummy_file = UploadFile(filename="quiz.docx", file=BytesIO(b"fake docx"))

        with patch(
            "app.services.intervention.PracticeAssessmentImportService.preview_quiz_import",
            new=AsyncMock(return_value=mock_parsed_preview),
        ):
            preview = asyncio.run(PracticeAssessmentImportService.preview_practice_quiz_import(dummy_file))

        assert preview.total_parsed == 3
        assert [q.question_type for q in preview.questions] == ["MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION"]

    def test_quiz_import_adapter_rejects_short_answer(self):
        mock_parsed_preview = QuizImportPreviewResponse(
            title="Sample Quiz With Essay",
            questions=[
                QuizQuestionIn(
                    question_text="Explain the theory of relativity in your own words.",
                    question_type="SHORT_ANSWER",
                    points=5.0,
                    display_order=1,
                    options=[],
                ),
            ],
            warnings=[],
        )

        dummy_file = UploadFile(filename="quiz_essay.docx", file=BytesIO(b"fake docx"))

        with patch(
            "app.services.intervention.PracticeAssessmentImportService.preview_quiz_import",
            new=AsyncMock(return_value=mock_parsed_preview),
        ):
            with pytest.raises(HTTPException) as exc:
                asyncio.run(PracticeAssessmentImportService.preview_practice_quiz_import(dummy_file))

        assert exc.value.status_code == 422
        assert "do not support Short Answer or Essay items" in exc.value.detail


# ---------------------------------------------------------------------------
# 5. Complete Gradebook & Submission Isolation
# ---------------------------------------------------------------------------

class TestGradebookIsolation:
    def test_complete_isolation_from_official_gradebook(self, db_env):
        """Verify that throughout practice assessment creation, question addition,
        student taking, and scoring, zero rows are inserted into student_submission,
        student_grade, or remediation_assignment_link.
        """
        db = db_env["db"]
        staff_id = db_env["staff"].staff_id
        student_id = db_env["student"].student_id
        intervention_id = db_env["intervention"].intervention_id

        # 1. Teacher creates assessment & adds question
        PracticeAssessmentService.get_or_create_assessment(db, staff_id, intervention_id)
        q = PracticeAssessmentService.add_question(
            db, staff_id, intervention_id,
            PracticeQuestionCreate(
                question_text="Isolation verification item",
                options=[
                    PracticeOptionIn(option_text="A", is_correct=True, option_order=1),
                    PracticeOptionIn(option_text="B", is_correct=False, option_order=2),
                ],
            ),
        )
        PracticeAssessmentService.publish_assessment(db, staff_id, intervention_id)

        # 2. Student starts and submits attempt
        attempt = PracticeAssessmentService.start_or_resume_attempt(db, student_id, intervention_id)
        correct_opt = next(o.option_id for o in q.options if o.is_correct)
        PracticeAssessmentService.submit_attempt(
            db, student_id, intervention_id, attempt.attempt_id,
            PracticeAttemptSubmitRequest(
                answers=[PracticeAttemptAnswerSubmission(practice_question_id=q.practice_question_id, selected_option_id=correct_opt)]
            ),
        )

        # 3. Assert zero contamination in official tables
        sub_count = db.query(StudentSubmission).count()
        assert sub_count == 0, f"Expected 0 student_submissions, found {sub_count}"

        grade_count = db.query(StudentPeriodGrade).count()
        assert grade_count == 0, f"Expected 0 student_period_grades, found {grade_count}"

        log_count = db.query(GradeSubmissionLog).count()
        assert log_count == 0, f"Expected 0 grade_submission_logs, found {log_count}"

        link_count = db.query(RemediationAssignmentLink).count()
        assert link_count == 0, f"Expected 0 remediation_assignment_links, found {link_count}"
