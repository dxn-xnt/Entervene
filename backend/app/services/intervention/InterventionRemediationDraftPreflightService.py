"""Preflight validation and authoring conversion for teacher-approved remediation drafts.

Validates teacher-edited AI drafts against verified evidence scope, academic plan
linkage, original target assignments, maximum points matching, Reading prerequisites,
and teacher-controlled score adjustment caps without writing to the database.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.RemediationDraft import (
    RemediationClassworkDraft,
    RemediationDraft,
    RemediationPublicationPreflightResult,
    RemediationQuizDraft,
    parse_remediation_draft,
)
from app.services.grading.ComponentMapper import (
    CanonicalGradingComponent,
    classify_classwork_component,
)
from app.services.grading.ExaminationCalculator import (
    EXAM_SUBTYPES,
    categorize_exam_subtype,
)
from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    validate_cap_percentage,
)
from app.services.intervention.InterventionRemediationDraftValidationService import (
    validate_remediation_draft,
)
from app.services.intervention.InterventionRemediationService import _row
from app.services.intervention.RemediationReadingPrerequisiteService import (
    resolve_reading_prerequisite_snapshot_items,
)


def preflight_remediation_draft(
    db: Session,
    staff_id: str,
    intervention_id: int,
    draft_input: RemediationDraft | dict[str, Any],
    *,
    require_readings: bool = True,
) -> RemediationPublicationPreflightResult:
    """Perform preflight validation and authoring payload conversion for a remediation draft.

    Enforces:
    1. Active intervention scope and teacher authorization.
    2. Complete draft schema mechanics, taught lessons, competencies, and leak guards.
    3. Strict alignment with saved plan format and grade treatment.
    4. Authoritative teacher-controlled cap preservation.
    5. Original target assignment verification, period finalization check, and point equality.
    6. Ordered Reading prerequisite validation. Unpublished draft saves may omit
       readings; publication still requires them through the existing publish gate.
    7. Clean separation of student-visible content from teacher answer keys and guides.
    8. Zero database modifications.
    """
    # 1. Authorize & retrieve active intervention
    intervention = _row(db, staff_id, intervention_id)

    # 2. Parse draft if raw dictionary
    if isinstance(draft_input, dict):
        try:
            draft = parse_remediation_draft(draft_input)
        except (ValueError, ValidationError) as err:
            raise HTTPException(
                status_code=422,
                detail=f"Malformed remediation draft schema: {err}",
            )
    else:
        draft = draft_input

    # 3. Validate draft against verified evidence scope, taught lessons, and leak guards
    validated_draft = validate_remediation_draft(db, intervention, draft)

    # 4. Validate academic plan alignment
    plan = intervention.remediation_plan if isinstance(intervention.remediation_plan, dict) else {}

    # Check format alignment with saved plan
    saved_choice = plan.get("teacher_choice")
    if saved_choice and saved_choice in {"QUIZ", "CLASSWORK"} and saved_choice != validated_draft.draft_format:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Draft format '{validated_draft.draft_format}' does not match "
                f"the saved intervention plan method '{saved_choice}'"
            ),
        )

    # Check grade treatment alignment with saved plan
    saved_treatment = plan.get("grade_treatment")
    if saved_treatment and saved_treatment != validated_draft.grade_treatment:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Draft grade treatment '{validated_draft.grade_treatment}' does not match "
                f"the saved intervention plan treatment '{saved_treatment}'"
            ),
        )

    # 5. Authoritative score adjustment cap (strictly teacher-controlled from intervention plan)
    plan_cap_raw = plan.get("score_adjustment_cap")
    if plan_cap_raw is None:
        plan_cap_raw = DEFAULT_REMEDIATION_CAP_PERCENTAGE
    try:
        authoritative_cap = float(validate_cap_percentage(plan_cap_raw))
    except (ValueError, TypeError) as err:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid intervention plan score adjustment cap: {err}",
        )

    # 6. Verify original target assignments & point matching
    resolved_target_ids: list[int] = []
    treatment = validated_draft.grade_treatment

    if treatment != "PRACTICE_ONLY":
        # Check if academic period grade is already finalized
        finalized = db.query(StudentPeriodGrade.period_grade_id).filter_by(
            student_id=intervention.student_id,
            class_id=intervention.class_id,
            subject_id=intervention.subject_id,
            academic_period_id=intervention.academic_period_id,
            is_finalized=True,
        ).first()
        if finalized:
            raise HTTPException(
                status_code=409,
                detail="The academic period grade is finalized; cannot target classworks in a finalized period",
            )

        if treatment == "EXAMINATION":
            # Must have original_exam_assignment_id
            orig_exam_id = plan.get("original_exam_assignment_id")
            if not orig_exam_id:
                plan_targets = plan.get("target_assignment_ids") or []
                orig_exam_id = plan_targets[0] if plan_targets else None

            if not orig_exam_id:
                raise HTTPException(
                    status_code=422,
                    detail="Graded EXAMINATION remediation requires a selected original Examination assignment",
                )

            orig_exam_asgn = db.get(ClassworkAssignment, orig_exam_id)
            if orig_exam_asgn is None or orig_exam_asgn.classwork is None:
                raise HTTPException(
                    status_code=422,
                    detail=f"Original examination assignment {orig_exam_id} not found",
                )
            orig_work = orig_exam_asgn.classwork
            if orig_work.is_archived or not orig_work.is_graded:
                raise HTTPException(
                    status_code=422,
                    detail="Original examination is archived or not graded",
                )
            if (
                orig_exam_asgn.class_id != intervention.class_id
                or orig_work.subject_id != intervention.subject_id
                or orig_exam_asgn.academic_period_id != intervention.academic_period_id
                or orig_exam_asgn.recipient_student_id not in (None, intervention.student_id)
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Original examination assignment is outside the intervention student and class scope",
                )

            # Check recorded submission
            sub = db.query(StudentSubmission).filter_by(
                classwork_assignment_id=orig_exam_asgn.classwork_assignment_id,
                student_id=intervention.student_id,
            ).filter(StudentSubmission.grade.isnot(None)).first()
            if not sub:
                raise HTTPException(
                    status_code=422,
                    detail="Original examination needs a recorded score for this student",
                )

            # Subtype check
            orig_subtype = categorize_exam_subtype(
                orig_work.exam_subtype, orig_work.title, orig_work.classwork_category
            )
            if orig_subtype not in EXAM_SUBTYPES:
                raise HTTPException(
                    status_code=422,
                    detail="Original assessment has no supported Examination subtype",
                )
            if validated_draft.exam_subtype != orig_subtype:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Remedial examination subtype '{validated_draft.exam_subtype}' "
                        f"must match the original examination subtype '{orig_subtype}'"
                    ),
                )

            # Maximum points check
            orig_points = orig_work.total_points
            if (
                orig_points is None
                or orig_points <= 0
                or Decimal(str(validated_draft.total_points)) != Decimal(str(orig_points))
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Remedial examination total points ({validated_draft.total_points}) "
                        f"must equal original examination maximum points ({orig_points})"
                    ),
                )
            resolved_target_ids = [orig_exam_id]

        elif treatment in ("WRITTEN_WORK", "PERFORMANCE_TASK"):
            plan_targets = plan.get("target_assignment_ids") or []
            if not plan_targets:
                raise HTTPException(
                    status_code=422,
                    detail=f"Graded {treatment.replace('_', ' ').title()} remediation requires at least one saved target classwork assignment",
                )

            expected_comp = (
                CanonicalGradingComponent.WRITTEN_WORK
                if treatment == "WRITTEN_WORK"
                else CanonicalGradingComponent.PERFORMANCE_TASK
            )

            for target_id in plan_targets:
                orig_asgn = db.get(ClassworkAssignment, target_id)
                if orig_asgn is None or orig_asgn.classwork is None:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Target classwork assignment {target_id} not found",
                    )
                orig_work = orig_asgn.classwork
                if orig_work.is_archived or not orig_work.is_graded:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Target classwork assignment {target_id} is unavailable or archived",
                    )
                if (
                    orig_asgn.class_id != intervention.class_id
                    or orig_work.subject_id != intervention.subject_id
                    or orig_asgn.academic_period_id != intervention.academic_period_id
                    or orig_asgn.recipient_student_id not in (None, intervention.student_id)
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Target classwork assignment {target_id} is outside the student intervention scope",
                    )
                if orig_asgn.source_intervention_id is not None or orig_asgn.original_exam_assignment_id is not None:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Target classwork assignment {target_id} is already a remedial assignment",
                    )

                # Check recorded submission
                sub = db.query(StudentSubmission).filter_by(
                    classwork_assignment_id=orig_asgn.classwork_assignment_id,
                    student_id=intervention.student_id,
                ).filter(StudentSubmission.grade.isnot(None)).first()
                if not sub:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Target classwork '{orig_work.title}' needs a recorded score for this student",
                    )

                # Component check
                comp = classify_classwork_component(
                    orig_work.classwork_type, orig_work.classwork_category, orig_work.exam_subtype
                )
                if comp != expected_comp:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Target classwork '{orig_work.title}' belongs to {comp.value}, "
                            f"not {expected_comp.value} (cross-category adjustment not allowed)"
                        ),
                    )

            # Check maximum points against primary target assignment (target_assignment_ids[0])
            primary_target = db.get(ClassworkAssignment, plan_targets[0])
            orig_points = primary_target.classwork.total_points if primary_target and primary_target.classwork else None
            if (
                orig_points is None
                or orig_points <= 0
                or Decimal(str(validated_draft.total_points)) != Decimal(str(orig_points))
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Remedial draft total points ({validated_draft.total_points}) "
                        f"must equal original classwork maximum points ({orig_points})"
                    ),
                )

            resolved_target_ids = list(plan_targets)

    # 7. Resolve Reading Prerequisites
    is_graded = (treatment != "PRACTICE_ONLY")
    reading_items = resolve_reading_prerequisite_snapshot_items(
        db,
        intervention=intervention,
        is_graded=is_graded if require_readings else False,
        require_readings=require_readings,
    )
    reading_prereqs = [
        {
            "reading_classwork_id": item.reading_classwork_id,
            "reading_assignment_id": item.reading_assignment_id,
            "display_order": item.display_order,
        }
        for item in reading_items
    ]

    # 8. Prepare authoring payload (without DB writes)
    if isinstance(validated_draft, RemediationQuizDraft):
        classwork_category = "EXAMS" if validated_draft.target_component == "EXAMINATION" else validated_draft.target_component
        authoring_payload = {
            "classwork": {
                "title": validated_draft.title,
                "description": validated_draft.instructions,
                "instructions": validated_draft.instructions,
                "classwork_type": "QUIZ",
                "classwork_category": classwork_category,
                "exam_subtype": validated_draft.exam_subtype,
                "activity_mode": "ONLINE",
                "is_graded": is_graded,
                "total_points": validated_draft.total_points,
                "subject_id": intervention.subject_id,
                "is_published": False,
                "lesson_ids": sorted({q.targeted_lesson_id for q in validated_draft.questions}),
            },
            "quiz_builder": {
                "duration_minutes": validated_draft.duration_minutes,
                "settings": validated_draft.settings.model_dump(),
                "questions": [q.model_dump() for q in validated_draft.to_quiz_questions_in()],
            },
        }
        teacher_guide_view = {
            "answer_keys": [
                {
                    "item_number": q.display_order,
                    "question_text": q.question_text,
                    "correct_answer": q.teacher_answer_key.correct_answer,
                    "explanation": q.teacher_answer_key.explanation,
                    "scoring_guide": q.teacher_answer_key.scoring_guide,
                }
                for q in validated_draft.questions
            ]
        }
    else:  # RemediationClassworkDraft
        cw_create = validated_draft.to_classwork_create(subject_id=intervention.subject_id)
        authoring_payload = {
            "classwork": cw_create.model_dump(),
            "tasks": [t.model_dump() for t in validated_draft.tasks],
            "deliverables": [d.model_dump() for d in validated_draft.deliverables],
            "supported_upload_formats": validated_draft.supported_upload_formats,
        }
        teacher_guide_view = {
            "exemplar_or_expected_response": validated_draft.teacher_guide.exemplar_or_expected_response,
            "evaluation_notes": validated_draft.teacher_guide.evaluation_notes,
            "common_misconceptions": validated_draft.teacher_guide.common_misconceptions,
        }

    # 9. Student view (completely free of teacher answer keys or evaluation notes)
    student_view = validated_draft.to_student_view()

    return RemediationPublicationPreflightResult(
        is_valid=True,
        draft_format=validated_draft.draft_format,
        target_component=validated_draft.target_component,
        grade_treatment=validated_draft.grade_treatment,
        exam_subtype=getattr(validated_draft, "exam_subtype", None),
        title=validated_draft.title,
        total_points=validated_draft.total_points,
        authoritative_cap=authoritative_cap,
        target_assignment_ids=resolved_target_ids,
        reading_prerequisites=reading_prereqs,
        authoring_payload=authoring_payload,
        student_view=student_view,
        teacher_guide_view=teacher_guide_view,
        intervention_id=intervention.intervention_id,
        student_id=str(intervention.student_id),
        class_id=intervention.class_id,
        subject_id=intervention.subject_id,
        academic_period_id=intervention.academic_period_id,
    )
