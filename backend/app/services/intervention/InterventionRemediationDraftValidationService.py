"""Validation service for AI remediation drafts against verified evidence and taught lessons.

Ensures remediation drafts strictly adhere to:
1. Student-specific frozen evidence scope and weakest component.
2. Verified teacher-delivered (taught) lessons as of the evidence cutoff.
3. Authorized competencies within the subject and academic period.
4. Complete structural mechanics, point totals, rubrics, and answer keys.
5. Strict separation between student-facing instructions and teacher-only keys.
"""

from __future__ import annotations

import re
from typing import Any
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.intervention.Intervention import Intervention
from app.schemas.RemediationDraft import (
    RemediationClassworkDraft,
    RemediationDraft,
    RemediationQuizDraft,
    parse_remediation_draft,
)
from app.services.intervention.InterventionGenerationEvidenceScopeService import (
    resolve_generation_evidence_scope,
)


_LEAK_PATTERNS = [
    re.compile(r"\bcorrect\s+answer\b", re.IGNORECASE),
    re.compile(r"\banswer\s+key\b", re.IGNORECASE),
    re.compile(r"\bsolution\s+key\b", re.IGNORECASE),
    re.compile(r"\bteacher\s+key\b", re.IGNORECASE),
]


def _check_no_answer_leak(text: str, label: str) -> None:
    for pattern in _LEAK_PATTERNS:
        if pattern.search(text):
            raise HTTPException(
                status_code=422,
                detail=f"Student-facing {label} contains leaked teacher answer key: '{pattern.pattern}'",
            )


def validate_draft_against_scope(
    scope: dict[str, Any],
    draft_input: RemediationDraft | dict[str, Any],
) -> RemediationDraft:
    """Validate a remediation draft against a resolved evidence scope dictionary."""
    # 1. Parse into typed draft if raw dict
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

    # 2. Check scope validity
    if scope.get("status") == "INSUFFICIENT_EVIDENCE":
        raise HTTPException(
            status_code=422,
            detail="Insufficient verified evidence for remediation generation",
        )

    # 3. Component & Format Compatibility
    weakest_components = set(scope.get("components") or [])
    if draft.target_component not in weakest_components:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Target component '{draft.target_component}' does not match "
                f"the student's verified weakest components {sorted(weakest_components)}"
            ),
        )

    # Format constraints by component:
    if draft.target_component == "PERFORMANCE_TASK" and draft.draft_format != "CLASSWORK":
        raise HTTPException(
            status_code=422,
            detail="PERFORMANCE_TASK remediation must be authored in CLASSWORK format",
        )

    if draft.target_component == "EXAMINATION" and draft.draft_format != "QUIZ":
        raise HTTPException(
            status_code=422,
            detail="EXAMINATION remediation must be authored in QUIZ/Summative format",
        )

    # Graded treatment compatibility:
    if draft.grade_treatment != "PRACTICE_ONLY":
        if draft.grade_treatment != draft.target_component:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Grade treatment '{draft.grade_treatment}' must match "
                    f"target component '{draft.target_component}'"
                ),
            )

    # 4. Taught Lessons & Eligibility Verification
    scope_lessons = {item["lesson_id"]: item for item in scope.get("lessons") or []}
    taught_lesson_ids = {
        item["lesson_id"]
        for item in scope.get("lessons") or []
        if item.get("is_taught") is True
    }

    referenced_lesson_ids: set[int] = set()
    referenced_competency_ids: set[int] = set()

    if isinstance(draft, RemediationQuizDraft):
        for q in draft.questions:
            referenced_lesson_ids.add(q.targeted_lesson_id)
            referenced_competency_ids.add(q.targeted_competency_id)
            # Check answer key leak in question text
            _check_no_answer_leak(q.question_text, f"question {q.display_order} text")
        _check_no_answer_leak(draft.instructions, "quiz instructions")

    elif isinstance(draft, RemediationClassworkDraft):
        for t in draft.tasks:
            referenced_lesson_ids.add(t.targeted_lesson_id)
            referenced_competency_ids.add(t.targeted_competency_id)
            _check_no_answer_leak(t.instructions, f"task {t.task_number} instructions")
        _check_no_answer_leak(draft.student_instructions, "student instructions")
        _check_no_answer_leak(draft.description, "classwork description")

    # Validate that every referenced lesson exists in scope and is TAUGHT
    if not referenced_lesson_ids:
        raise HTTPException(
            status_code=422,
            detail="Remediation draft must reference at least one lesson",
        )

    for lid in sorted(referenced_lesson_ids):
        if lid not in scope_lessons:
            raise HTTPException(
                status_code=422,
                detail=f"Lesson ID {lid} is outside the verified evidence scope",
            )
        if lid not in taught_lesson_ids:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Lesson ID {lid} ('{scope_lessons[lid].get('title', '')}') "
                    f"has not been verified as taught to this class as of the evidence cutoff"
                ),
            )

    # 5. Competency Verification
    scope_competencies = {
        item["competency_id"]: item for item in scope.get("competencies") or []
    }
    if not referenced_competency_ids:
        raise HTTPException(
            status_code=422,
            detail="Remediation draft must reference at least one competency",
        )

    for cid in sorted(referenced_competency_ids):
        if cid not in scope_competencies:
            raise HTTPException(
                status_code=422,
                detail=f"Competency ID {cid} is outside the verified evidence scope",
            )

    # 6. Question-level evidence mapping (if applicable)
    if isinstance(draft, RemediationQuizDraft):
        scope_questions = {
            item["quiz_question_id"]: item for item in scope.get("questions") or []
        }
        for q in draft.questions:
            if q.targeted_quiz_question_id is not None:
                if q.targeted_quiz_question_id not in scope_questions:
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"Referenced quiz question ID {q.targeted_quiz_question_id} "
                            f"is outside the verified question evidence"
                        ),
                    )

    return draft


def validate_remediation_draft(
    db: Session,
    intervention: Intervention,
    draft_input: RemediationDraft | dict[str, Any],
) -> RemediationDraft:
    """Validate a remediation draft against the intervention's verified evidence scope."""
    scope = resolve_generation_evidence_scope(db, intervention)
    return validate_draft_against_scope(scope, draft_input)
