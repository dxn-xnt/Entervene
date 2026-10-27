"""Atomic persistence of preflight-validated remediation assessments."""

from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.intervention.Intervention import Intervention
from app.models.quiz.Quiz import Quiz
from app.schemas.Quiz import QuizBuilderUpsert
from app.schemas.RemediationDraft import (
    RemediationAssessmentCreateResult,
    RemediationClassworkDraft,
    RemediationDraft,
    RemediationQuizDraft,
)
from app.services.classwork.ClassworkService import _replace_activity_rubric
from app.services.intervention.InterventionRemediationDraftPreflightService import (
    preflight_remediation_draft,
)
from app.services.intervention.RemediationAssignmentLinkService import (
    create_remediation_assignment_link,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.quiz.QuizBuilderService import upsert_quiz_builder


def create_remediation_assessment(
    db: Session,
    *,
    staff_id: str,
    intervention_id: int,
    remediation_request_id: UUID,
    draft_input: RemediationDraft | dict,
) -> RemediationAssessmentCreateResult:
    """Create one unpublished assessment and all canonical links in one commit.

    Preflight runs for every call, including retries, so authorization and the
    saved plan are never trusted from an earlier request. The unique remediation
    request identifier makes retries idempotent.
    """
    preflight = preflight_remediation_draft(
        db,
        staff_id=staff_id,
        intervention_id=intervention_id,
        draft_input=draft_input,
        require_readings=False,
    )
    intervention = (
        db.query(Intervention)
        .filter_by(intervention_id=intervention_id)
        .with_for_update()
        .one_or_none()
    )
    if intervention is None or intervention.status != "ACTIVE":
        raise HTTPException(status_code=404, detail="Active intervention not found")

    prior = db.query(ClassworkAssignment).filter_by(
        remediation_request_id=remediation_request_id,
    ).one_or_none()
    if prior is not None:
        return _retry_result(prior, preflight, staff_id, remediation_request_id)

    try:
        classwork_data = preflight.authoring_payload["classwork"]
        classwork = Classwork(
            title=classwork_data["title"],
            description=classwork_data.get("description"),
            instructions=(
                _complete_classwork_instructions(draft_input)
                if preflight.draft_format == "CLASSWORK"
                else classwork_data.get("instructions")
            ),
            classwork_type=classwork_data["classwork_type"],
            classwork_category=classwork_data.get("classwork_category"),
            exam_subtype=classwork_data.get("exam_subtype"),
            activity_mode=classwork_data.get("activity_mode", "ONLINE"),
            is_graded=classwork_data["is_graded"],
            total_points=classwork_data["total_points"],
            subject_id=preflight.subject_id,
            created_by_staff_id=staff_id,
            is_published=False,
            show_scores=True,
        )
        db.add(classwork)
        db.flush()

        for lesson_id in classwork_data.get("lesson_ids", []):
            db.add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=lesson_id))

        if preflight.draft_format == "CLASSWORK":
            parsed = RemediationClassworkDraft.model_validate(draft_input)
            _replace_activity_rubric(db, classwork, parsed.to_classwork_create(preflight.subject_id).rubric_levels)

        assignment = ClassworkAssignment(
            classwork_id=classwork.classwork_id,
            class_id=preflight.class_id,
            academic_period_id=preflight.academic_period_id,
            recipient_student_id=intervention.student_id,
            source_intervention_id=intervention.intervention_id,
            remediation_request_id=remediation_request_id,
            original_exam_assignment_id=(
                preflight.target_assignment_ids[0]
                if preflight.grade_treatment == "EXAMINATION"
                else None
            ),
            assigned_by_staff_id=staff_id,
            publish_date=None,
            due_date=None,
            lock_date=None,
            is_published=False,
            is_locked=False,
            allow_late_submissions=False,
            max_attempts=1 if preflight.draft_format == "QUIZ" else None,
        )
        db.add(assignment)
        db.flush()

        quiz_id = None
        if preflight.draft_format == "QUIZ":
            quiz_data = preflight.authoring_payload["quiz_builder"]
            quiz_data["status"] = "DRAFT"
            # Answer keys remain teacher-only for remediation assessments.
            quiz_data["settings"]["show_correct_answers"] = False
            quiz_data["settings"]["max_attempts"] = 1
            quiz = upsert_quiz_builder(db, classwork, QuizBuilderUpsert.model_validate(quiz_data))
            quiz_id = quiz.quiz_id

        if preflight.grade_treatment in {"WRITTEN_WORK", "PERFORMANCE_TASK"}:
            create_remediation_assignment_link(
                db,
                intervention=intervention,
                remediation_assignment=assignment,
                original_assignment_id=preflight.target_assignment_ids[0],
                component=preflight.grade_treatment,
                staff_id=staff_id,
                score_adjustment_cap=preflight.authoritative_cap,
            )

        reading_items = [
            ReadingPrerequisiteSnapshotItem(**item)
            for item in preflight.reading_prerequisites
        ]
        if reading_items:
            stage_remediation_reading_prerequisites(
                db,
                remediation_assignment_id=assignment.classwork_assignment_id,
                items=reading_items,
            )

        db.commit()
        return RemediationAssessmentCreateResult(
            remediation_request_id=remediation_request_id,
            intervention_id=intervention_id,
            classwork_id=classwork.classwork_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            quiz_id=quiz_id,
            draft_format=preflight.draft_format,
            grade_treatment=preflight.grade_treatment,
            is_published=False,
        )
    except IntegrityError:
        db.rollback()
        prior = db.query(ClassworkAssignment).filter_by(
            remediation_request_id=remediation_request_id,
        ).one_or_none()
        if prior is not None:
            return _retry_result(prior, preflight, staff_id, remediation_request_id)
        raise
    except Exception:
        db.rollback()
        raise


def _retry_result(
    assignment: ClassworkAssignment,
    preflight,
    staff_id: str,
    request_id: UUID,
) -> RemediationAssessmentCreateResult:
    if (
        assignment.source_intervention_id != preflight.intervention_id
        or assignment.recipient_student_id is None
        or str(assignment.recipient_student_id) != preflight.student_id
        or assignment.assigned_by_staff_id != staff_id
        or assignment.classwork is None
        or assignment.classwork.subject_id != preflight.subject_id
        or assignment.class_id != preflight.class_id
        or assignment.academic_period_id != preflight.academic_period_id
    ):
        raise HTTPException(status_code=409, detail="Remediation request was already used for different content")
    existing_format = "QUIZ" if assignment.classwork.quiz is not None else "CLASSWORK"
    if existing_format != preflight.draft_format or assignment.classwork.title != preflight.title:
        raise HTTPException(status_code=409, detail="Remediation request was already used for a different draft")
    return RemediationAssessmentCreateResult(
        remediation_request_id=request_id,
        intervention_id=preflight.intervention_id,
        classwork_id=assignment.classwork_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        quiz_id=assignment.classwork.quiz.quiz_id if assignment.classwork.quiz is not None else None,
        draft_format=preflight.draft_format,
        grade_treatment=preflight.grade_treatment,
        is_published=False,
    )


def _complete_classwork_instructions(draft_input: RemediationDraft | dict) -> str:
    draft = (
        draft_input
        if isinstance(draft_input, RemediationClassworkDraft)
        else RemediationClassworkDraft.model_validate(draft_input)
    )
    sections = [draft.student_instructions.strip(), "Tasks"]
    sections.extend(
        f"{task.task_number}. {task.title}: {task.instructions}"
        for task in draft.tasks
    )
    sections.append("Deliverables")
    sections.extend(
        f"- {item.deliverable_name} ({item.deliverable_type}): {item.description}"
        for item in draft.deliverables
    )
    sections.extend(["Accepted upload formats", ", ".join(draft.supported_upload_formats)])
    return "\n\n".join(sections)
