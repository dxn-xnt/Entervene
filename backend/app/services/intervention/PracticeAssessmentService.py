"""Core service for Intervention Practice Assessments.

Encapsulates teacher assessment lifecycle, draft question CRUD, validation,
student attempt execution, server-side scoring, permanent feedback snapshots,
and progression evaluation. Maintains 100% isolation from the official gradebook.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.intervention.PracticeAttemptAnswer import PracticeAttemptAnswer
from app.models.intervention.PracticeQuestion import PracticeQuestion
from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption
from app.models.people.Student import Student
from app.schemas.PracticeAssessment import (
    PracticeAssessmentCreate,
    PracticeAssessmentRead,
    PracticeAssessmentUpdate,
    PracticeAttemptActiveOption,
    PracticeAttemptActiveQuestion,
    PracticeAttemptFeedbackItem,
    PracticeAttemptFeedbackResponse,
    PracticeAttemptStartResponse,
    PracticeAttemptSubmitRequest,
    PracticeAttemptSummary,
    PracticeFeedbackOption,
    PracticeOptionIn,
    PracticeOptionRead,
    PracticeProgressionEvaluation,
    PracticeQuestionBatchSave,
    PracticeQuestionCreate,
    PracticeQuestionRead,
    PracticeQuestionUpdate,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.quiz.quiz_normalization import is_identification_correct


# ---------------------------------------------------------------------------
# Scope & Authorization Helpers
# ---------------------------------------------------------------------------

def _require_teacher_scope(db: Session, staff_id: str, row: Intervention) -> None:
    """Verify that staff_id currently teaches or substitutes the intervention's class and subject."""
    load = SubjectLoadAuthorizationService.get_active_published_load(
        db, row.class_id, row.subject_id, row.academic_period_id,
    )
    if load is None:
        raise HTTPException(status_code=403, detail="Active subject load not found for this intervention scope")
    substitution = SubstitutionService.get_active_substitution(db, load.subject_load_id)
    responsible = substitution.substitute_staff_id if substitution is not None else load.staff_id
    if staff_id != responsible:
        raise HTTPException(status_code=403, detail="You do not have teaching permissions for this intervention scope")


def _require_student_scope(db: Session, student_id: UUID, row: Intervention) -> None:
    """Verify that student is the designated recipient and currently enrolled."""
    if row.student_id != student_id:
        raise HTTPException(status_code=403, detail="This intervention belongs to another student")
    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=student_id, class_id=row.class_id, enrollment_status="enrolled",
    ).first() is not None
    if not enrolled:
        raise HTTPException(status_code=403, detail="Student is not actively enrolled in this class")


def _assert_no_student_attempts(db: Session, assessment: PracticeAssessment) -> None:
    """Guard against modifying question content once student attempts exist."""
    attempt_count = db.query(PracticeAttempt.attempt_id).filter_by(
        practice_assessment_id=assessment.practice_assessment_id,
    ).count()
    if attempt_count > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot modify question content on a practice assessment with existing student attempts.",
        )


# ---------------------------------------------------------------------------
# Teacher Assessment Management
# ---------------------------------------------------------------------------

def get_or_create_assessment(
    db: Session,
    staff_id: str,
    intervention_id: int,
    payload: PracticeAssessmentCreate | None = None,
) -> PracticeAssessment:
    """Retrieve existing practice assessment for an intervention or initialize a new DRAFT."""
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_teacher_scope(db, staff_id, intervention)

    assessment = db.query(PracticeAssessment).filter_by(intervention_id=intervention_id).first()
    if assessment is not None:
        return assessment

    # Initialize new draft assessment
    cfg = payload or PracticeAssessmentCreate()
    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        title=cfg.title,
        status="DRAFT",
        gatekeeper_policy=cfg.gatekeeper_policy,
        passing_percentage=cfg.passing_percentage,
        shuffle_options=cfg.shuffle_options,
        created_by_staff_id=staff_id,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment


def get_assessment(db: Session, staff_id: str, intervention_id: int) -> PracticeAssessment:
    """Retrieve practice assessment with teacher authorization."""
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_teacher_scope(db, staff_id, intervention)

    assessment = db.query(PracticeAssessment).filter_by(intervention_id=intervention_id).first()
    if assessment is None:
        raise HTTPException(status_code=404, detail="Practice assessment not found for this intervention")
    return assessment


def update_assessment_config(
    db: Session,
    staff_id: str,
    intervention_id: int,
    payload: PracticeAssessmentUpdate,
) -> PracticeAssessment:
    """Update title, threshold, progression policy, or shuffling options."""
    assessment = get_assessment(db, staff_id, intervention_id)
    if payload.title is not None:
        assessment.title = payload.title.strip()
    if payload.passing_percentage is not None:
        assessment.passing_percentage = payload.passing_percentage
    if payload.gatekeeper_policy is not None:
        assessment.gatekeeper_policy = payload.gatekeeper_policy
    if payload.shuffle_options is not None:
        assessment.shuffle_options = payload.shuffle_options
    db.commit()
    db.refresh(assessment)
    return assessment


def format_assessment_read(assessment: PracticeAssessment) -> PracticeAssessmentRead:
    """Format assessment into full response schema with question details."""
    questions = sorted(assessment.questions, key=lambda q: q.display_order)
    q_reads = []
    total_pts = Decimal("0.00")
    for q in questions:
        total_pts += q.points
        opts = sorted(q.options, key=lambda o: o.option_order)
        q_reads.append(PracticeQuestionRead(
            practice_question_id=q.practice_question_id,
            version=q.version,
            question_text=q.question_text,
            question_type=q.question_type,
            points=q.points,
            explanation=q.explanation,
            display_order=q.display_order,
            is_ai_generated=q.is_ai_generated,
            options=[PracticeOptionRead.model_validate(opt) for opt in opts],
        ))
    return PracticeAssessmentRead(
        practice_assessment_id=assessment.practice_assessment_id,
        intervention_id=assessment.intervention_id,
        title=assessment.title,
        status=assessment.status,
        gatekeeper_policy=assessment.gatekeeper_policy,
        passing_percentage=assessment.passing_percentage,
        version=assessment.version,
        shuffle_options=assessment.shuffle_options,
        created_by_staff_id=assessment.created_by_staff_id,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        total_questions=len(q_reads),
        total_points=total_pts,
        questions=q_reads,
    )


# ---------------------------------------------------------------------------
# Question Authoring & Validation
# ---------------------------------------------------------------------------

def _validate_question_payload(payload: PracticeQuestionCreate) -> None:
    """Validate question and options for correctness and scoring eligibility."""
    if not payload.question_text.strip():
        raise HTTPException(status_code=422, detail="Question text cannot be blank.")
    if payload.points <= 0:
        raise HTTPException(status_code=422, detail="Question points must be greater than zero.")

    qtype = payload.question_type
    opts = payload.options

    if qtype in {"MULTIPLE_CHOICE", "TRUE_FALSE"}:
        if len(opts) < 2:
            raise HTTPException(
                status_code=422,
                detail=f"{qtype} requires at least 2 distinct answer options.",
            )
        correct_count = sum(1 for o in opts if o.is_correct)
        if correct_count != 1:
            raise HTTPException(
                status_code=422,
                detail=f"{qtype} must have exactly one correct answer option (found {correct_count}).",
            )
        for o in opts:
            if not o.option_text.strip():
                raise HTTPException(status_code=422, detail="Option text cannot be blank.")
    elif qtype == "IDENTIFICATION":
        if not opts:
            raise HTTPException(
                status_code=422,
                detail="Identification question requires at least one accepted answer key in options.",
            )
        if not any(o.option_text.strip() for o in opts):
            raise HTTPException(status_code=422, detail="Identification answer key cannot be blank.")
    else:
        raise HTTPException(status_code=422, detail=f"Unsupported question type '{qtype}'.")


def add_question(
    db: Session,
    staff_id: str,
    intervention_id: int,
    payload: PracticeQuestionCreate,
) -> PracticeQuestion:
    """Add a question item to a draft assessment."""
    assessment = get_assessment(db, staff_id, intervention_id)
    _assert_no_student_attempts(db, assessment)
    _validate_question_payload(payload)

    max_order = db.query(func.max(PracticeQuestion.display_order)).filter_by(
        practice_assessment_id=assessment.practice_assessment_id,
        version=assessment.version,
    ).scalar() or 0

    question = PracticeQuestion(
        practice_assessment_id=assessment.practice_assessment_id,
        version=assessment.version,
        question_text=payload.question_text.strip(),
        question_type=payload.question_type,
        points=payload.points,
        explanation=payload.explanation.strip() if payload.explanation else None,
        display_order=max_order + 1,
        is_ai_generated=payload.is_ai_generated,
    )
    db.add(question)
    db.flush()

    for idx, opt in enumerate(payload.options, start=1):
        db.add(PracticeQuestionOption(
            practice_question_id=question.practice_question_id,
            option_text=opt.option_text.strip(),
            is_correct=opt.is_correct if payload.question_type != "IDENTIFICATION" else True,
            option_order=idx,
        ))

    db.commit()
    db.refresh(question)
    return question


def update_question(
    db: Session,
    staff_id: str,
    intervention_id: int,
    question_id: int,
    payload: PracticeQuestionUpdate,
) -> PracticeQuestion:
    """Update question content in draft state."""
    assessment = get_assessment(db, staff_id, intervention_id)
    _assert_no_student_attempts(db, assessment)

    question = db.get(PracticeQuestion, question_id)
    if question is None or question.practice_assessment_id != assessment.practice_assessment_id:
        raise HTTPException(status_code=404, detail="Question not found on this practice assessment")

    if payload.question_text is not None:
        question.question_text = payload.question_text.strip()
    if payload.question_type is not None:
        question.question_type = payload.question_type
    if payload.points is not None:
        question.points = payload.points
    if payload.explanation is not None:
        question.explanation = payload.explanation.strip() if payload.explanation else None

    if payload.options is not None:
        # Validate replacement options
        dummy_create = PracticeQuestionCreate(
            question_text=question.question_text,
            question_type=question.question_type,
            points=question.points,
            explanation=question.explanation,
            options=payload.options,
        )
        _validate_question_payload(dummy_create)

        # Replace options
        db.query(PracticeQuestionOption).filter_by(practice_question_id=question.practice_question_id).delete()
        for idx, opt in enumerate(payload.options, start=1):
            db.add(PracticeQuestionOption(
                practice_question_id=question.practice_question_id,
                option_text=opt.option_text.strip(),
                is_correct=opt.is_correct if question.question_type != "IDENTIFICATION" else True,
                option_order=idx,
            ))

    db.commit()
    db.refresh(question)
    return question


def delete_question(db: Session, staff_id: str, intervention_id: int, question_id: int) -> None:
    """Delete a draft question and re-sequence remaining items."""
    assessment = get_assessment(db, staff_id, intervention_id)
    _assert_no_student_attempts(db, assessment)

    question = db.get(PracticeQuestion, question_id)
    if question is None or question.practice_assessment_id != assessment.practice_assessment_id:
        raise HTTPException(status_code=404, detail="Question not found on this practice assessment")

    db.delete(question)
    db.flush()

    # Re-order remaining questions
    remaining = (
        db.query(PracticeQuestion)
        .filter_by(practice_assessment_id=assessment.practice_assessment_id, version=assessment.version)
        .order_by(PracticeQuestion.display_order.asc())
        .all()
    )
    for idx, q in enumerate(remaining, start=1):
        q.display_order = idx

    db.commit()


def reorder_questions(
    db: Session,
    staff_id: str,
    intervention_id: int,
    ordered_question_ids: list[int],
) -> list[PracticeQuestion]:
    """Reorder questions by ID sequence."""
    assessment = get_assessment(db, staff_id, intervention_id)
    _assert_no_student_attempts(db, assessment)

    questions = db.query(PracticeQuestion).filter_by(
        practice_assessment_id=assessment.practice_assessment_id,
        version=assessment.version,
    ).all()
    q_map = {q.practice_question_id: q for q in questions}

    if set(ordered_question_ids) != set(q_map.keys()):
        raise HTTPException(status_code=422, detail="Provided question IDs do not match assessment questions exactly.")

    # Temporary offset avoids unique constraint conflicts during re-sequencing
    for q in questions:
        q.display_order = 10000 + q.practice_question_id
    db.flush()

    for idx, qid in enumerate(ordered_question_ids, start=1):
        q_map[qid].display_order = idx

    db.commit()
    return sorted(questions, key=lambda q: q.display_order)


def batch_save_questions(
    db: Session,
    staff_id: str,
    intervention_id: int,
    payload: PracticeQuestionBatchSave,
) -> list[PracticeQuestion]:
    """Save a batch of questions (e.g. from approved AI generation or file import)."""
    assessment = get_assessment(db, staff_id, intervention_id)
    _assert_no_student_attempts(db, assessment)

    for q in payload.questions:
        _validate_question_payload(q)

    if payload.replace_existing:
        db.query(PracticeQuestion).filter_by(
            practice_assessment_id=assessment.practice_assessment_id,
            version=assessment.version,
        ).delete()
        db.flush()
        start_order = 0
    else:
        start_order = db.query(func.max(PracticeQuestion.display_order)).filter_by(
            practice_assessment_id=assessment.practice_assessment_id,
            version=assessment.version,
        ).scalar() or 0

    created = []
    for idx, item in enumerate(payload.questions, start=start_order + 1):
        question = PracticeQuestion(
            practice_assessment_id=assessment.practice_assessment_id,
            version=assessment.version,
            question_text=item.question_text.strip(),
            question_type=item.question_type,
            points=item.points,
            explanation=item.explanation.strip() if item.explanation else None,
            display_order=idx,
            is_ai_generated=item.is_ai_generated,
        )
        db.add(question)
        db.flush()

        for o_idx, opt in enumerate(item.options, start=1):
            db.add(PracticeQuestionOption(
                practice_question_id=question.practice_question_id,
                option_text=opt.option_text.strip(),
                is_correct=opt.is_correct if item.question_type != "IDENTIFICATION" else True,
                option_order=o_idx,
            ))
        created.append(question)

    db.commit()
    return created


# ---------------------------------------------------------------------------
# Assessment Publication & Archival
# ---------------------------------------------------------------------------

def publish_assessment(db: Session, staff_id: str, intervention_id: int) -> PracticeAssessment:
    """Validate assessment completeness and transition to PUBLISHED."""
    assessment = get_assessment(db, staff_id, intervention_id)
    questions = assessment.questions
    if not questions:
        raise HTTPException(
            status_code=422,
            detail="Cannot publish a practice assessment with zero questions. Add questions first.",
        )

    for q in questions:
        dummy = PracticeQuestionCreate(
            question_text=q.question_text,
            question_type=q.question_type,  # type: ignore
            points=q.points,
            explanation=q.explanation,
            display_order=q.display_order,
            options=[
                PracticeOptionIn(
                    option_text=o.option_text,
                    is_correct=o.is_correct,
                    option_order=o.option_order,
                )
                for o in q.options
            ],
        )
        _validate_question_payload(dummy)

    assessment.status = "PUBLISHED"
    db.commit()
    db.refresh(assessment)
    return assessment


def archive_assessment(db: Session, staff_id: str, intervention_id: int) -> PracticeAssessment:
    """Archive practice assessment, hiding it from future active student attempts."""
    assessment = get_assessment(db, staff_id, intervention_id)
    assessment.status = "ARCHIVED"
    db.commit()
    db.refresh(assessment)
    return assessment


# ---------------------------------------------------------------------------
# Student Attempt Execution (Lifecycle & Scoring)
# ---------------------------------------------------------------------------

def get_student_assessment_metadata(db: Session, student_id: UUID, intervention_id: int) -> dict[str, Any]:
    """Retrieve published assessment metadata for the student (no questions leaked)."""
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_student_scope(db, student_id, intervention)

    assessment = db.query(PracticeAssessment).filter_by(
        intervention_id=intervention_id,
        status="PUBLISHED",
    ).first()
    if assessment is None:
        raise HTTPException(status_code=404, detail="No published practice assessment available for this intervention")

    attempts = (
        db.query(PracticeAttempt)
        .filter_by(practice_assessment_id=assessment.practice_assessment_id, student_id=student_id)
        .order_by(PracticeAttempt.attempt_number.desc())
        .all()
    )
    active_attempt = next((a for a in attempts if a.status == "STARTED"), None)

    return {
        "practice_assessment_id": assessment.practice_assessment_id,
        "title": assessment.title,
        "gatekeeper_policy": assessment.gatekeeper_policy,
        "passing_percentage": float(assessment.passing_percentage),
        "total_questions": len(assessment.questions),
        "total_points": float(sum(q.points for q in assessment.questions)),
        "attempts_count": len([a for a in attempts if a.status == "SUBMITTED"]),
        "has_active_attempt": active_attempt is not None,
        "active_attempt_id": active_attempt.attempt_id if active_attempt else None,
        "has_passed": any(a.is_passed for a in attempts if a.status == "SUBMITTED"),
    }


def start_or_resume_attempt(
    db: Session,
    student_id: UUID,
    intervention_id: int,
) -> PracticeAttemptStartResponse:
    """Start a new attempt or resume an existing active attempt with frozen question snapshots."""
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_student_scope(db, student_id, intervention)

    assessment = db.query(PracticeAssessment).filter_by(
        intervention_id=intervention_id,
        status="PUBLISHED",
    ).first()
    if assessment is None:
        raise HTTPException(status_code=404, detail="No published practice assessment available for this intervention")

    questions = assessment.questions
    if not questions:
        raise HTTPException(status_code=422, detail="Practice assessment has no questions configured.")

    # 1. Resume active attempt if present (Idempotency Guard)
    active = (
        db.query(PracticeAttempt)
        .filter_by(
            practice_assessment_id=assessment.practice_assessment_id,
            student_id=student_id,
            status="STARTED",
        )
        .first()
    )
    if active is not None:
        return _format_active_attempt_response(active)

    # 2. Initialize new independent attempt
    max_num = db.query(func.max(PracticeAttempt.attempt_number)).filter_by(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student_id,
    ).scalar() or 0
    next_num = max_num + 1

    # Randomized question and option sequences
    q_ids = [q.practice_question_id for q in questions]
    shuffled_q_ids = random.sample(q_ids, len(q_ids))

    option_order_map: dict[str, list[int]] = {}
    snapshot_questions: list[dict[str, Any]] = []

    for q in questions:
        opt_ids = [o.option_id for o in q.options]
        if assessment.shuffle_options and q.question_type in {"MULTIPLE_CHOICE", "TRUE_FALSE"}:
            shuffled_opt_ids = random.sample(opt_ids, len(opt_ids))
        else:
            shuffled_opt_ids = sorted(opt_ids, key=lambda oid: next(o.option_order for o in q.options if o.option_id == oid))
        option_order_map[str(q.practice_question_id)] = shuffled_opt_ids

        # Build full frozen snapshot (storing correct answer securely on server)
        snapshot_questions.append({
            "practice_question_id": q.practice_question_id,
            "version": q.version,
            "question_text": q.question_text,
            "question_type": q.question_type,
            "points": float(q.points),
            "explanation": q.explanation,
            "options": [
                {
                    "option_id": o.option_id,
                    "option_text": o.option_text,
                    "is_correct": o.is_correct,
                    "option_order": o.option_order,
                }
                for o in q.options
            ],
        })

    attempt = PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student_id,
        attempt_number=next_num,
        status="STARTED",
        assessment_version=assessment.version,
        passing_threshold_snapshot=assessment.passing_percentage,
        question_order=shuffled_q_ids,
        option_order_map=option_order_map,
        attempt_snapshot={"questions": snapshot_questions},
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    return _format_active_attempt_response(attempt)


def _format_active_attempt_response(attempt: PracticeAttempt) -> PracticeAttemptStartResponse:
    """Format active attempt for student taking, strictly scrubbing correct keys and explanations."""
    snapshot = attempt.attempt_snapshot or {}
    q_snapshot_map = {
        q["practice_question_id"]: q for q in snapshot.get("questions", [])
    }
    opt_order_map = attempt.option_order_map or {}

    active_questions: list[PracticeAttemptActiveQuestion] = []
    for disp_idx, qid in enumerate(attempt.question_order, start=1):
        q_data = q_snapshot_map.get(qid)
        if not q_data:
            continue
        ordered_opt_ids = opt_order_map.get(str(qid)) or [o["option_id"] for o in q_data["options"]]
        opt_dict = {o["option_id"]: o for o in q_data["options"]}

        active_opts = []
        for o_idx, oid in enumerate(ordered_opt_ids, start=1):
            o_data = opt_dict.get(oid)
            if o_data:
                active_opts.append(PracticeAttemptActiveOption(
                    option_id=o_data["option_id"],
                    option_text=o_data["option_text"],
                    option_order=o_idx,
                ))

        active_questions.append(PracticeAttemptActiveQuestion(
            practice_question_id=qid,
            display_order=disp_idx,
            question_text=q_data["question_text"],
            question_type=q_data["question_type"],
            points=Decimal(str(q_data["points"])),
            options=active_opts,
        ))

    return PracticeAttemptStartResponse(
        attempt_id=attempt.attempt_id,
        attempt_number=attempt.attempt_number,
        status=attempt.status,
        passing_percentage=attempt.passing_threshold_snapshot,
        total_questions=len(active_questions),
        questions=active_questions,
    )


def submit_attempt(
    db: Session,
    student_id: UUID,
    intervention_id: int,
    attempt_id: int,
    payload: PracticeAttemptSubmitRequest,
) -> PracticeAttemptFeedbackResponse:
    """Score submitted answers, freeze historical answer snapshot, and return complete diagnostic feedback."""
    attempt = db.get(PracticeAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.student_id != student_id:
        raise HTTPException(status_code=403, detail="Attempt belongs to another student")
    if attempt.assessment.intervention_id != intervention_id:
        raise HTTPException(status_code=400, detail="Mismatched intervention ID for this attempt")

    # Idempotent re-submission check
    if attempt.status == "SUBMITTED":
        return get_attempt_feedback(db, {"role": "student", "user_id": str(student_id)}, intervention_id, attempt_id)
    if attempt.status != "STARTED":
        raise HTTPException(status_code=409, detail=f"Cannot submit an attempt with status '{attempt.status}'")

    snapshot = attempt.attempt_snapshot or {}
    q_snapshot_map = {
        q["practice_question_id"]: q for q in snapshot.get("questions", [])
    }
    answer_map = {ans.practice_question_id: ans for ans in payload.answers}

    total_score = Decimal("0.00")
    max_score = Decimal("0.00")
    feedback_items: list[PracticeAttemptFeedbackItem] = []

    for qid in attempt.question_order:
        q_data = q_snapshot_map.get(qid)
        if not q_data:
            continue

        q_pts = Decimal(str(q_data["points"]))
        max_score += q_pts
        q_type = q_data["question_type"]
        options = q_data.get("options", [])

        user_ans = answer_map.get(qid)
        selected_opt_id = user_ans.selected_option_id if user_ans else None
        student_text = user_ans.student_answer_text.strip() if user_ans and user_ans.student_answer_text else None

        is_correct = False
        correct_text = ""

        if q_type in {"MULTIPLE_CHOICE", "TRUE_FALSE"}:
            correct_opt = next((o for o in options if o.get("is_correct")), None)
            correct_text = correct_opt["option_text"] if correct_opt else ""
            selected_opt = next((o for o in options if o.get("option_id") == selected_opt_id), None)
            student_text = selected_opt["option_text"] if selected_opt else student_text

            if selected_opt and selected_opt.get("is_correct"):
                is_correct = True
        elif q_type == "IDENTIFICATION":
            accepted_keys = [o["option_text"] for o in options if o.get("option_text")]
            correct_text = accepted_keys[0] if accepted_keys else ""
            if student_text and accepted_keys:
                is_correct = is_identification_correct(student_text, accepted_keys)

        pts_awarded = q_pts if is_correct else Decimal("0.00")
        total_score += pts_awarded

        # Store persistent answer record
        db.add(PracticeAttemptAnswer(
            attempt_id=attempt.attempt_id,
            practice_question_id=qid,
            question_text_snapshot=q_data["question_text"],
            question_type_snapshot=q_type,
            selected_option_id=selected_opt_id,
            student_answer_text=student_text,
            correct_answer_text=correct_text,
            explanation_snapshot=q_data.get("explanation"),
            is_correct=is_correct,
            points_awarded=pts_awarded,
            points_possible=q_pts,
        ))

        feedback_items.append(PracticeAttemptFeedbackItem(
            practice_question_id=qid,
            question_text=q_data["question_text"],
            question_type=q_type,
            points_possible=q_pts,
            points_awarded=pts_awarded,
            is_correct=is_correct,
            student_answer=student_text,
            selected_option_id=selected_opt_id,
            correct_answer=correct_text,
            explanation=q_data.get("explanation"),
            options=[
                PracticeFeedbackOption(
                    option_id=o["option_id"],
                    option_text=o["option_text"],
                    is_correct=bool(o.get("is_correct")),
                )
                for o in options
            ],
        ))

    score_pct = Decimal("0.00")
    if max_score > 0:
        score_pct = (total_score / max_score * Decimal("100.00")).quantize(Decimal("0.01"))

    is_passed = score_pct >= attempt.passing_threshold_snapshot

    attempt.total_score = total_score
    attempt.max_score = max_score
    attempt.score_percentage = score_pct
    attempt.is_passed = is_passed
    attempt.status = "SUBMITTED"
    attempt.completed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(attempt)

    progression = evaluate_practice_progression(db, intervention_id, student_id)

    return PracticeAttemptFeedbackResponse(
        attempt_id=attempt.attempt_id,
        attempt_number=attempt.attempt_number,
        status="SUBMITTED",
        total_score=total_score,
        max_score=max_score,
        score_percentage=score_pct,
        passing_percentage=attempt.passing_threshold_snapshot,
        is_passed=is_passed,
        result_status="PASSED" if is_passed else "BELOW_PASSING",
        eligible_for_remediation=progression.eligible_for_remediation,
        started_at=attempt.started_at,
        completed_at=attempt.completed_at,
        items=feedback_items,
    )


def get_attempt_feedback(
    db: Session,
    current_user: dict,
    intervention_id: int,
    attempt_id: int,
) -> PracticeAttemptFeedbackResponse:
    """Retrieve full diagnostic feedback for a submitted attempt (authorized student or teacher)."""
    attempt = db.get(PracticeAttempt, attempt_id)
    if attempt is None or attempt.assessment.intervention_id != intervention_id:
        raise HTTPException(status_code=404, detail="Attempt not found for this intervention")

    role = current_user.get("role")
    user_id = current_user.get("sub") or current_user.get("user_id")

    if role == "student":
        student = db.query(Student).filter_by(user_id=UUID(str(user_id))).first()
        if student is None or attempt.student_id != student.student_id:
            raise HTTPException(status_code=403, detail="Access denied")
    elif role == "teacher":
        from app.models.people.AcademicStaff import AcademicStaff
        staff = db.query(AcademicStaff).filter_by(user_id=UUID(str(user_id))).first()
        if staff is None:
            raise HTTPException(status_code=403, detail="Staff record not found")
        _require_teacher_scope(db, staff.staff_id, attempt.assessment.intervention)
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    snapshot = attempt.attempt_snapshot or {}
    q_snapshot_map = {
        q["practice_question_id"]: q for q in snapshot.get("questions", [])
    }
    answers = db.query(PracticeAttemptAnswer).filter_by(attempt_id=attempt.attempt_id).all()
    ans_map = {a.practice_question_id: a for a in answers}

    items: list[PracticeAttemptFeedbackItem] = []
    for qid in attempt.question_order:
        ans = ans_map.get(qid)
        q_data = q_snapshot_map.get(qid)
        if not ans and not q_data:
            continue

        raw_options = q_data.get("options", []) if q_data else []
        items.append(PracticeAttemptFeedbackItem(
            practice_question_id=qid,
            question_text=ans.question_text_snapshot if ans else q_data["question_text"],
            question_type=ans.question_type_snapshot if ans else q_data["question_type"],
            points_possible=ans.points_possible if ans else Decimal(str(q_data["points"])),
            points_awarded=ans.points_awarded if ans else Decimal("0.00"),
            is_correct=ans.is_correct if ans else False,
            student_answer=ans.student_answer_text if ans else None,
            selected_option_id=ans.selected_option_id if ans else None,
            correct_answer=ans.correct_answer_text if ans else "",
            explanation=ans.explanation_snapshot if ans else (q_data.get("explanation") if q_data else None),
            options=[
                PracticeFeedbackOption(
                    option_id=o["option_id"],
                    option_text=o["option_text"],
                    is_correct=bool(o.get("is_correct")),
                )
                for o in raw_options
            ],
        ))

    progression = evaluate_practice_progression(db, intervention_id, attempt.student_id)

    return PracticeAttemptFeedbackResponse(
        attempt_id=attempt.attempt_id,
        attempt_number=attempt.attempt_number,
        status=attempt.status,
        total_score=attempt.total_score,
        max_score=attempt.max_score,
        score_percentage=attempt.score_percentage,
        passing_percentage=attempt.passing_threshold_snapshot,
        is_passed=attempt.is_passed,
        result_status="PASSED" if attempt.is_passed else "BELOW_PASSING",
        eligible_for_remediation=progression.eligible_for_remediation,
        started_at=attempt.started_at,
        completed_at=attempt.completed_at,
        items=items,
    )


def list_student_attempts(db: Session, student_id: UUID, intervention_id: int) -> list[PracticeAttemptSummary]:
    """List historical attempts for student."""
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_student_scope(db, student_id, intervention)

    assessment = db.query(PracticeAssessment).filter_by(intervention_id=intervention_id).first()
    if assessment is None:
        return []

    attempts = (
        db.query(PracticeAttempt)
        .filter_by(practice_assessment_id=assessment.practice_assessment_id, student_id=student_id)
        .order_by(PracticeAttempt.attempt_number.desc())
        .all()
    )
    return [PracticeAttemptSummary.model_validate(a) for a in attempts]


def list_teacher_attempts(db: Session, staff_id: str, intervention_id: int) -> list[PracticeAttemptSummary]:
    """List student attempts for teacher review."""
    assessment = get_assessment(db, staff_id, intervention_id)
    attempts = (
        db.query(PracticeAttempt)
        .filter_by(practice_assessment_id=assessment.practice_assessment_id)
        .order_by(PracticeAttempt.attempt_number.desc())
        .all()
    )
    return [PracticeAttemptSummary.model_validate(a) for a in attempts]


# ---------------------------------------------------------------------------
# Progression Policy Evaluator
# ---------------------------------------------------------------------------

def evaluate_practice_progression(
    db: Session,
    intervention_id: int,
    student_id: UUID,
) -> PracticeProgressionEvaluation:
    """Evaluate whether student meets the practice requirement to unlock curated remediation.

    Policies:
    - REQUIRE_PASS: At least one submitted attempt with score >= threshold required.
    - REQUIRE_ATTEMPT: At least one submitted attempt required, regardless of score.
    - OPTIONAL: Remediation unlocked directly (practice is optional).
    - No Published Assessment: Preserves existing intervention prerequisites.

    Invariant: Once a student passes, subsequent retakes scoring lower never revoke qualification.
    """
    assessment = db.query(PracticeAssessment).filter_by(intervention_id=intervention_id).first()
    if assessment is None or assessment.status != "PUBLISHED":
        return PracticeProgressionEvaluation(
            intervention_id=intervention_id,
            student_id=student_id,
            practice_exists=assessment is not None,
            assessment_status=assessment.status if assessment else None,
            gatekeeper_policy=assessment.gatekeeper_policy if assessment else "OPTIONAL",
            passing_percentage=assessment.passing_percentage if assessment else None,
            attempts_count=0,
            practice_completed=False,
            practice_passed=False,
            eligible_for_remediation=True,
            best_score_percentage=None,
            reason="No published practice assessment exists; standard prerequisites apply.",
        )

    submitted_attempts = (
        db.query(PracticeAttempt)
        .filter_by(
            practice_assessment_id=assessment.practice_assessment_id,
            student_id=student_id,
            status="SUBMITTED",
        )
        .all()
    )
    attempts_count = len(submitted_attempts)
    practice_completed = attempts_count > 0

    best_score = max((a.score_percentage for a in submitted_attempts), default=None)
    practice_passed = any(a.is_passed for a in submitted_attempts)

    policy = assessment.gatekeeper_policy
    if policy == "REQUIRE_PASS":
        eligible = practice_passed
        reason = (
            "Passing score achieved on practice assessment."
            if eligible
            else f"A passing score of at least {assessment.passing_percentage}% on the practice assessment is required."
        )
    elif policy == "REQUIRE_ATTEMPT":
        eligible = practice_completed
        reason = (
            "Practice assessment completed."
            if eligible
            else "At least one completed attempt on the practice assessment is required."
        )
    elif policy == "OPTIONAL":
        eligible = True
        reason = "Practice assessment is optional."
    else:
        eligible = practice_passed
        reason = "Practice assessment requirement evaluated."

    return PracticeProgressionEvaluation(
        intervention_id=intervention_id,
        student_id=student_id,
        practice_exists=True,
        assessment_status=assessment.status,
        gatekeeper_policy=policy,
        passing_percentage=assessment.passing_percentage,
        attempts_count=attempts_count,
        practice_completed=practice_completed,
        practice_passed=practice_passed,
        eligible_for_remediation=eligible,
        best_score_percentage=best_score,
        reason=reason,
    )
