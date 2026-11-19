"""AI question generation adapter for Intervention Practice Assessments.

Grounds generated questions exclusively in the teacher-assigned reading materials
associated with the intervention. Enforces strictly MULTIPLE_CHOICE questions.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from difflib import SequenceMatcher
import logging
import re
from typing import Any
import unicodedata

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
from app.services.ai.question_quality_validation import option_text_issue
from app.services.intervention.InterventionGenerationEvidenceScopeService import (
    resolve_generation_evidence_scope,
)
from app.services.intervention.InterventionRemediationMaterialContextService import (
    resolve_remediation_material_context,
)
from app.services.intervention.PracticeAssessmentService import _require_teacher_scope

logger = logging.getLogger(__name__)

_MAX_GENERATION_ATTEMPTS = 3


def _normalize_question_text(value: str) -> str:
    """Normalize presentation differences without erasing meaningful words."""
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w\s]", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def _question_tokens(value: str) -> set[str]:
    return set(_normalize_question_text(value).split())


def _correct_answer_text(question: dict[str, Any]) -> str:
    answers = [
        _normalize_question_text(str(option.get("option_text", "")))
        for option in question.get("options", [])
        if option.get("is_correct")
    ]
    return "|".join(sorted(answer for answer in answers if answer))


def _is_effective_duplicate(
    candidate: dict[str, Any],
    accepted: list[dict[str, Any]],
) -> bool:
    """Reject exact and strongly similar items while allowing the same topic."""
    candidate_text = _normalize_question_text(str(candidate.get("question_text", "")))
    candidate_tokens = _question_tokens(candidate_text)
    candidate_answer = _correct_answer_text(candidate)

    for existing in accepted:
        existing_text = _normalize_question_text(str(existing.get("question_text", "")))
        if candidate_text == existing_text:
            return True

        sequence_similarity = SequenceMatcher(None, candidate_text, existing_text).ratio()
        existing_tokens = _question_tokens(existing_text)
        union = candidate_tokens | existing_tokens
        token_similarity = len(candidate_tokens & existing_tokens) / len(union) if union else 1.0

        if sequence_similarity >= 0.94 or token_similarity >= 0.90:
            return True

        existing_answer = _correct_answer_text(existing)
        if (
            candidate_answer
            and candidate_answer == existing_answer
            and (sequence_similarity >= 0.82 or token_similarity >= 0.78)
        ):
            return True

    return False


def _is_usable_candidate(question: dict[str, Any]) -> bool:
    options = question.get("options") or []
    if not str(question.get("question_text", "")).strip():
        return False
    if len(options) < 2 or sum(bool(option.get("is_correct")) for option in options) != 1:
        return False
    return option_text_issue(options, "MULTIPLE_CHOICE") is None


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

    # 2. Resolve approved reading classwork IDs strictly from intervention plan/prerequisites
    plan = intervention.remediation_plan or {}
    approved_rids = {
        ref.get("id")
        for ref in (plan.get("selected_resources") or [])
        if isinstance(ref, dict) and ref.get("kind") == "CLASSWORK" and ref.get("id")
    }
    from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
    prereq_rids = {
        row[0]
        for row in (
            db.query(RemediationReadingPrerequisite.reading_classwork_id)
            .join(
                ClassworkAssignment,
                RemediationReadingPrerequisite.remediation_assignment_id == ClassworkAssignment.classwork_assignment_id,
            )
            .join(
                Classwork,
                RemediationReadingPrerequisite.reading_classwork_id == Classwork.classwork_id,
            )
            .filter(
                ClassworkAssignment.source_intervention_id == intervention.intervention_id,
                Classwork.is_locked.is_(False),
            )
            .distinct()
            .all()
        )
    }
    approved_rids.update(prereq_rids)

    # Unsaved selections are valid generation inputs. The context resolver below
    # still enforces the intervention subject/class/period reading scope.
    selected_rids = (
        list(payload.reading_classwork_ids)
        if payload.reading_classwork_ids is not None
        else list(approved_rids)
    )
    if not selected_rids:
        raise HTTPException(
            status_code=422,
            detail="Select supporting reading materials before generating practice questions.",
        )

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

    # 4. Call AI Generator (strictly MULTIPLE_CHOICE). Providers sometimes
    # return too few, too many, or repeated items. Keep a bounded retry loop and
    # never return a partial or inflated assessment to the teacher.
    raw_questions: list[dict[str, Any]] = []
    for attempt in range(1, _MAX_GENERATION_ATTEMPTS + 1):
        remaining = payload.target_count - len(raw_questions)
        if remaining <= 0:
            break

        generated_batch = await generate_quiz_questions(
            subject=subject_name,
            lessons=lesson_titles or ["Assigned Intervention Reading Materials"],
            content_text=combined_text,
            test_parts=[
                {
                    "type": "MULTIPLE_CHOICE",
                    "count": remaining,
                    "points_per_item": 1.0,
                }
            ],
        )

        for candidate in generated_batch:
            if not _is_usable_candidate(candidate):
                logger.info("Discarding unusable AI practice question on attempt %s", attempt)
                continue
            if _is_effective_duplicate(candidate, raw_questions):
                logger.info("Discarding duplicate AI practice question on attempt %s", attempt)
                continue
            raw_questions.append(candidate)
            if len(raw_questions) == payload.target_count:
                break

    if len(raw_questions) != payload.target_count:
        raise HTTPException(
            status_code=502,
            detail=(
                "AI could not produce the requested number of distinct, valid practice questions "
                f"after {_MAX_GENERATION_ATTEMPTS} attempts. No questions were added; try again "
                "or reduce the requested count."
            ),
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
