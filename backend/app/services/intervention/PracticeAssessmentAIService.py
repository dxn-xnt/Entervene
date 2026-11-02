"""AI question generation adapter for Intervention Practice Assessments.

Grounds generated questions exclusively in the teacher-assigned reading materials
associated with the intervention. Enforces strictly MULTIPLE_CHOICE questions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.schemas.PracticeAssessment import (
    AIGeneratePracticeQuestionsRequest,
    PracticeOptionIn,
    PracticeQuestionCreate,
)
from app.services.ai.AIQuizGeneratorService import generate_quiz_questions
from app.services.intervention.InterventionGenerationEvidenceScopeService import (
    resolve_generation_evidence_scope,
)
from app.services.intervention.InterventionRemediationMaterialContextService import (
    resolve_remediation_material_context,
)
from app.services.intervention.PracticeAssessmentService import _require_teacher_scope

logger = logging.getLogger(__name__)


async def generate_practice_questions_ai(
    db: Session,
    staff_id: str,
    intervention_id: int,
    payload: AIGeneratePracticeQuestionsRequest,
) -> list[PracticeQuestionCreate]:
    """Generate multiple-choice practice questions grounded strictly in intervention reading materials.

    Does not modify database records directly; returns draft question payloads for teacher review.
    """
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_teacher_scope(db, staff_id, intervention)

    # 1. Resolve generation evidence scope or provide safe fallback
    try:
        scope = resolve_generation_evidence_scope(db, intervention)
    except Exception as exc:
        logger.info("Defaulting to unconstrained reading scope for intervention %s: %s", intervention_id, exc)
        scope = {
            "academic_scope": {"evidence_cutoff_at": datetime.now(timezone.utc).isoformat()},
            "competencies": [],
            "lessons": [],
        }

    # 2. Resolve target reading classwork IDs
    selected_rids = payload.reading_classwork_ids
    if selected_rids is None:
        plan = intervention.remediation_plan or {}
        plan_rids = [
            ref.get("id")
            for ref in plan.get("selected_resources") or []
            if isinstance(ref, dict) and ref.get("kind") == "CLASSWORK" and ref.get("id")
        ]
        if plan_rids:
            selected_rids = plan_rids
        else:
            candidates = (
                db.query(ClassworkAssignment.classwork_id)
                .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
                .filter(
                    ClassworkAssignment.class_id == intervention.class_id,
                    ClassworkAssignment.academic_period_id == intervention.academic_period_id,
                    Classwork.classwork_type == "READING",
                    Classwork.is_archived.is_(False),
                )
                .all()
            )
            if candidates:
                selected_rids = [c[0] for c in candidates]

    # 3. Extract reading materials context
    context = resolve_remediation_material_context(
        db,
        intervention,
        scope,
        selected_reading_ids=selected_rids,
        max_total_chars=8000,
    )

    text_segments: list[str] = []
    lesson_titles: list[str] = []
    for rm in context.reading_materials:
        lesson_titles.append(rm.title)
        if rm.description:
            text_segments.append(f"Reading: {rm.title}\n{rm.description}")
        if rm.instructions:
            text_segments.append(f"Instructions: {rm.instructions}")
        for att in rm.attachments:
            if att.status == "EXTRACTED" and att.text:
                text_segments.append(f"Source text ({att.file_name}):\n{att.text}")

    if payload.additional_guidance and payload.additional_guidance.strip():
        text_segments.append(f"Teacher Focus / Guidance:\n{payload.additional_guidance.strip()}")

    combined_text = "\n\n".join(text_segments).strip()
    if len(combined_text) < 50:
        raise HTTPException(
            status_code=422,
            detail=(
                "No readable reading materials found for this intervention. "
                "AI question generation requires readable text from assigned reading classworks or attachments."
            ),
        )

    # 3. Retrieve subject name
    subject_row = db.get(Subject, intervention.subject_id)
    subject_name = subject_row.subject_name if subject_row else "General Subject"

    # 4. Call AI Generator (strictly MULTIPLE_CHOICE)
    test_parts = [
        {
            "type": "MULTIPLE_CHOICE",
            "count": payload.target_count,
            "points_per_item": 1.0,
        }
    ]

    raw_questions = await generate_quiz_questions(
        subject=subject_name,
        lessons=lesson_titles or ["Assigned Intervention Reading Materials"],
        content_text=combined_text,
        test_parts=test_parts,
    )

    # 5. Transform to PracticeQuestionCreate
    converted: list[PracticeQuestionCreate] = []
    for idx, q in enumerate(raw_questions, start=1):
        raw_options = q.get("options", [])
        options = [
            PracticeOptionIn(
                option_text=o["option_text"],
                is_correct=bool(o.get("is_correct")),
                option_order=o.get("option_order", o_idx),
            )
            for o_idx, o in enumerate(raw_options, start=1)
        ]

        converted.append(
            PracticeQuestionCreate(
                question_text=q["question_text"],
                question_type="MULTIPLE_CHOICE",
                points=Decimal("1.00"),
                explanation=q.get("explanation"),
                display_order=idx,
                is_ai_generated=True,
                options=options,
            )
        )

    return converted
