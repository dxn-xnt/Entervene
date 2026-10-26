"""Regression tests for Task 4.7B.3: WW/PT Remediation Finalization Safeguards.

Verifies:
1. Open-period remediation submissions and grading succeed.
2. Finalized-period attempts and submissions to linked remediation are rejected with HTTP 409.
3. Finalized-period teacher grading and regrading of linked remediation are rejected with HTTP 409.
4. Quiz and non-quiz remediation activities are protected.
5. Existing Examination remediation remains protected and unchanged.
6. Ordinary WW/PT classworks remain unaffected by remediation finalization checks.
7. Correct student, subject, and academic period isolation.
8. No grade or submission mutation occurs on rejected requests.
9. Single-attempt policy is strictly enforced on linked remedial quizzes.
"""

from __future__ import annotations

import asyncio
import io
import json
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.people.Student import Student
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Activity import BulkScoreItem, BulkScoreUpdateRequest
from app.schemas.Quiz import QuizAnswerIn, QuizSubmitRequest, TeacherGradeQuizSubmissionRequest, TeacherQuizAnswerGradeItem
from app.schemas.Submission import GradeRequest
from app.services.activity.ActivityService import bulk_update_activity_scores
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.grading.RemedialExamination import ensure_remedial_period_open
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan
from app.services.quiz.QuizAnalysisService import grade_teacher_quiz_submission
from app.services.quiz.QuizAttemptService import start_student_quiz_attempt, submit_student_quiz_attempt
from app.services.submission.SubmissionService import grade_student_submission, submit_student_work, unsubmit_student_work
from tests.test_classwork_submission_authorization import _valid_quiz_payload
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_intervention_support_materials import _activate
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_targeted_remedial_classwork import _linked_classwork_kwargs
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _set_period_finalized(db, student_id, class_id, subject_id, academic_period_id, is_finalized=True):
    pg = db.query(StudentPeriodGrade).filter_by(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    ).first()
    if pg:
        pg.is_finalized = is_finalized
    else:
        pg = StudentPeriodGrade(
            student_id=student_id,
            class_id=class_id,
            subject_id=subject_id,
            academic_period_id=academic_period_id,
            is_finalized=is_finalized,
        )
        db.add(pg)
    db.commit()
    return pg


class DummyRequest:
    async def form(self):
        return {}


def _make_dummy_upload(filename="remedial_work.pdf", content=b"%PDF-1.4"):
    file_obj = io.BytesIO(content)
    return UploadFile(filename=filename, file=file_obj)


# ---------------------------------------------------------------------------
# Test 1: Open-period non-quiz remediation submission and grading
# ---------------------------------------------------------------------------

def test_open_period_remediation_submission_and_grading_succeeds(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW", score=10.0, points=30.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
            score_adjustment_cap=75.0,
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 30
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Open period: student submits work
    upload = _make_dummy_upload()
    async def dummy_save(file, folder):
        return {"file_path": f"{folder}/{file.filename}", "file_name": file.filename, "file_type": "application/pdf", "file_size": 100}

    sub_res = asyncio.run(submit_student_work(
        remediation.classwork_assignment_id,
        DummyRequest(),
        [upload],
        c["student"],
        db,
        save_file_func=dummy_save,
    ))
    assert sub_res.status in ("submitted", "late")

    # Open period: teacher grades work
    grade_res = grade_student_submission(
        sub_res.submission_id,
        GradeRequest(grade=26.0, feedback="Good remedial attempt"),
        _staff(c),
        db,
    )
    assert float(grade_res.grade) == 26.0


# ---------------------------------------------------------------------------
# Test 2: Finalized-period non-quiz attempts and submissions rejected (HTTP 409)
# ---------------------------------------------------------------------------

def test_finalized_period_non_quiz_submission_rejected(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW", score=10.0, points=30.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 30
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Finalize student's period grade
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )

    upload = _make_dummy_upload()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(submit_student_work(
            remediation.classwork_assignment_id,
            DummyRequest(),
            [upload],
            c["student"],
            db,
        ))
    assert exc.value.status_code == 409
    assert exc.value.detail == "The period grade is finalized"

    # Verify no submission mutation occurred
    subs = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
    ).all()
    assert len(subs) == 0


def test_finalized_period_unsubmit_rejected(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW", score=10.0, points=30.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 30
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Open period: student submits
    sub = StudentSubmission(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="submitted",
        attempt_count=1,
    )
    db.add(sub)
    db.commit()

    # Now finalize period
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )

    # Attempt to unsubmit
    with pytest.raises(HTTPException) as exc:
        unsubmit_student_work(remediation.classwork_assignment_id, c["student"], db)
    assert exc.value.status_code == 409
    assert exc.value.detail == "The period grade is finalized"

    # Submission status remains submitted
    db.refresh(sub)
    assert sub.status == "submitted"


# ---------------------------------------------------------------------------
# Test 3: Finalized-period teacher grading and regrading rejected
# ---------------------------------------------------------------------------

def test_finalized_period_teacher_grading_rejected_and_no_mutation(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(c, "Original WW", score=10.0, points=30.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 30
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Student submitted in open period with existing grade 18.0
    sub = StudentSubmission(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
        grade=18.0,
        status="graded",
        attempt_count=1,
    )
    db.add(sub)
    db.commit()

    # Finalize period
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )

    # Teacher regrading attempt
    with pytest.raises(HTTPException) as exc:
        grade_student_submission(
            sub.submission_id,
            GradeRequest(grade=25.0, feedback="Regraded score"),
            _staff(c),
            db,
        )
    assert exc.value.status_code == 409
    assert exc.value.detail == "The period grade is finalized"

    # Verify no grade mutation occurred
    db.refresh(sub)
    assert float(sub.grade) == 18.0

    # Bulk update scores also rejected
    with pytest.raises(HTTPException) as exc_bulk:
        bulk_update_activity_scores(
            db,
            _staff(c),
            created.classwork_id,
            BulkScoreUpdateRequest(
                class_id=c["class"].class_id,
                scores=[BulkScoreItem(student_id=c["student"].student_id, score=25.0)],
            ),
        )
    assert exc_bulk.value.status_code == 409
    assert exc_bulk.value.detail == "The period grade is finalized"
    db.refresh(sub)
    assert float(sub.grade) == 18.0


# ---------------------------------------------------------------------------
# Test 4: Remedial quiz attempt start, submit, single attempt, and finalization
# ---------------------------------------------------------------------------

def test_remedial_quiz_finalization_and_single_attempt_policy(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    original = _make_classwork_target(
        c, "Original Quiz Target", category="WRITTEN_WORK",
        classwork_type="QUIZ", score=10.0, points=20.0,
    )
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    quiz_payload = json.dumps(_valid_quiz_payload())
    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs.update(
        classwork_type="QUIZ",
        quiz_payload=quiz_payload,
        max_attempts=1,
    )
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # A: In open period, start quiz attempt succeeds
    attempt_res = start_student_quiz_attempt(db, c["student"], remediation.classwork_assignment_id)
    assert attempt_res.status == "pending"

    # Submit quiz attempt succeeds
    quiz = db.query(Quiz).filter_by(classwork_id=created.classwork_id).one()
    first_q_link = quiz.questions[0]
    submit_req = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=first_q_link.quiz_question_id,
                selected_option_id=first_q_link.question.options[0].option_id,
            ),
        ]
    )
    submit_res = submit_student_quiz_attempt(db, c["student"], remediation.classwork_assignment_id, submit_req)
    assert submit_res.status in ("graded", "submitted")

    # B: Single-attempt policy: second attempt is rejected with HTTP 403
    with pytest.raises(HTTPException) as exc_attempt:
        start_student_quiz_attempt(db, c["student"], remediation.classwork_assignment_id)
    assert exc_attempt.value.status_code == 403
    assert "Maximum attempts reached" in exc_attempt.value.detail

    # C: Finalize period
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )

    # In finalized period, quiz start is rejected with 409
    with pytest.raises(HTTPException) as exc_quiz_start:
        start_student_quiz_attempt(db, c["student"], remediation.classwork_assignment_id)
    assert exc_quiz_start.value.status_code == 409
    assert exc_quiz_start.value.detail == "The period grade is finalized"

    # In finalized period, teacher grading is rejected with 409
    sub = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=remediation.classwork_assignment_id,
        student_id=c["student"].student_id,
    ).one()
    with pytest.raises(HTTPException) as exc_teacher_grade:
        grade_teacher_quiz_submission(
            db,
            _staff(c),
            sub.submission_id,
            TeacherGradeQuizSubmissionRequest(
                answers=[
                    TeacherQuizAnswerGradeItem(
                        quiz_question_id=first_q_link.quiz_question_id,
                        points_awarded=10.0,
                    )
                ]
            ),
        )
    assert exc_teacher_grade.value.status_code == 409
    assert exc_teacher_grade.value.detail == "The period grade is finalized"


# ---------------------------------------------------------------------------
# Test 5: Existing Examination remediation unchanged
# ---------------------------------------------------------------------------

def test_existing_examination_remediation_finalization_unchanged(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    # Create exam classwork
    exam_cw = Classwork(
        title="Quarterly Exam", classwork_category="EXAMINATION",
        classwork_type="EXAM", exam_subtype="TERM_EXAM",
        subject_id=c["subject"].subject_id, created_by_staff_id=_staff(c),
        total_points=50.0, is_graded=True,
    )
    db.add(exam_cw)
    db.flush()

    orig_exam_asgn = ClassworkAssignment(
        classwork_id=exam_cw.classwork_id, class_id=c["class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=_staff(c), is_published=True,
    )
    db.add(orig_exam_asgn)
    db.flush()

    rem_exam_cw = Classwork(
        title="Remedial Quarterly Exam", classwork_category="EXAMINATION",
        classwork_type="EXAM", exam_subtype="TERM_EXAM",
        subject_id=c["subject"].subject_id, created_by_staff_id=_staff(c),
        total_points=50.0, is_graded=True,
    )
    db.add(rem_exam_cw)
    db.flush()

    rem_exam_asgn = ClassworkAssignment(
        classwork_id=rem_exam_cw.classwork_id, class_id=c["class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=_staff(c), is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=_id(c),
        remediation_request_id=uuid4(),
        original_exam_assignment_id=orig_exam_asgn.classwork_assignment_id,
    )
    db.add(rem_exam_asgn)
    db.flush()

    # Open period: ensure_remedial_period_open does not raise
    ensure_remedial_period_open(db, rem_exam_asgn, c["student"].student_id)

    # Finalize period
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )

    # Finalized period: raises 409
    with pytest.raises(HTTPException) as exc:
        ensure_remedial_period_open(db, rem_exam_asgn, c["student"].student_id)
    assert exc.value.status_code == 409
    assert exc.value.detail == "The period grade is finalized"


# ---------------------------------------------------------------------------
# Test 6: Ordinary WW/PT classworks unaffected
# ---------------------------------------------------------------------------

def test_ordinary_ww_pt_classworks_unaffected_by_finalization_checks(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    # Ordinary classwork assigned to the class (no remediation link)
    ordinary = _make_classwork_target(c, "Ordinary Whole-Class WW", score=20.0, points=40.0)

    # Period grade is finalized
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )

    # ensure_remedial_period_open must return cleanly for ordinary assignments
    ensure_remedial_period_open(db, ordinary, c["student"].student_id)

    # Grading ordinary classwork submission is NOT blocked by remediation finalization check
    sub = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=ordinary.classwork_assignment_id,
        student_id=c["student"].student_id,
    ).one()

    graded = grade_student_submission(
        sub.submission_id,
        GradeRequest(grade=25.0, feedback="Ordinary classwork grade update"),
        _staff(c),
        db,
    )
    assert float(graded.grade) == 25.0


# ---------------------------------------------------------------------------
# Test 7: Correct student, subject, and period isolation
# ---------------------------------------------------------------------------

def test_student_subject_and_period_isolation(candidate_context):
    c = candidate_context
    db = c["db"]
    _activate(c)

    # Setup second student B
    student_b = Student(
        student_id=uuid4(),
        user_id=uuid4(),
        student_lrn="999123456789",
        first_name="Isolated",
        last_name="StudentB",
    )
    db.add(student_b)
    db.flush()
    db.add(StudentClass(
        student_id=student_b.student_id,
        class_id=c["class"].class_id,
        academic_year_id=c["class"].academic_year_id,
        enrollment_status="enrolled",
    ))
    db.commit()

    # Original classwork
    original = _make_classwork_target(c, "Original Target", score=10.0, points=30.0)
    save_plan(
        db, _staff(c), _id(c),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[original.classwork_assignment_id],
        ),
    )

    kwargs = _linked_classwork_kwargs(c, uuid4(), original.classwork_assignment_id)
    kwargs["total_points"] = 30
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    remediation = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Finalize student A only
    _set_period_finalized(
        db,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    )
    # Student B's period grade is OPEN
    _set_period_finalized(
        db,
        student_id=student_b.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=False,
    )

    # Student A on Student A's remedial activity raises 409
    with pytest.raises(HTTPException) as exc_a:
        ensure_remedial_period_open(db, remediation, c["student"].student_id)
    assert exc_a.value.status_code == 409

    # Student B is open: ensure_remedial_period_open does not raise
    ensure_remedial_period_open(db, remediation, student_b.student_id)

    # Subject isolation: Second subject in the same class and period
    subj2 = Subject(
        subject_codename=f"SCI-{uuid4().hex[:4]}",
        subject_name="Science",
        grading_template_id=c["subject"].grading_template_id,
    )
    db.add(subj2)
    db.flush()

    rem_cw_subj2 = Classwork(
        title="Remedial Science", classwork_category="WRITTEN_WORK",
        classwork_type="ASSIGNMENT", subject_id=subj2.subject_id,
        created_by_staff_id=_staff(c), total_points=30.0, is_graded=True,
    )
    db.add(rem_cw_subj2)
    db.flush()
    rem_asgn_subj2 = ClassworkAssignment(
        classwork_id=rem_cw_subj2.classwork_id,
        class_id=c["class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=_staff(c),
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=_id(c),
        remediation_request_id=uuid4(),
    )
    db.add(rem_asgn_subj2)
    db.flush()

    # Student A in Subject 2 is open -> ensure_remedial_period_open does not raise
    ensure_remedial_period_open(db, rem_asgn_subj2, c["student"].student_id)
