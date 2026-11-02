"""Import adapter service for Intervention Practice Assessments.

Integrates with the platform's quiz document parser, enforcing that all
imported questions belong to automatically-scored types (MULTIPLE_CHOICE,
TRUE_FALSE, or IDENTIFICATION) to guarantee instant diagnostic feedback.
"""

from __future__ import annotations

from decimal import Decimal
from fastapi import HTTPException, UploadFile

from app.schemas.PracticeAssessment import (
    PracticeOptionIn,
    PracticeQuestionCreate,
    PracticeQuestionsImportPreviewResponse,
)
from app.services.quiz.QuizImportService import preview_quiz_import

ALLOWED_QUESTION_TYPES = {"MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION"}


async def preview_practice_quiz_import(file: UploadFile) -> PracticeQuestionsImportPreviewResponse:
    """Import and validate quiz questions from a file for practice assessment usage.

    Enforces that all parsed items belong to automatically-scored question types:
    MULTIPLE_CHOICE, TRUE_FALSE, or IDENTIFICATION.
    Rejects SHORT_ANSWER / ESSAY items with HTTP 422 to protect immediate feedback.
    """
    raw_preview = await preview_quiz_import(file)

    if not raw_preview.questions:
        raise HTTPException(
            status_code=422,
            detail="No valid questions could be extracted from the uploaded document.",
        )

    converted_questions: list[PracticeQuestionCreate] = []
    warnings = list(raw_preview.warnings)

    for idx, q in enumerate(raw_preview.questions, start=1):
        q_type = str(q.question_type or "").upper()
        if q_type in {"SHORT_ANSWER", "ESSAY"}:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Question #{idx} ('{q.question_text[:40]}...') is an open-ended/essay question. "
                    "Practice assessments require automatic scoring and do not support Short Answer or Essay items."
                ),
            )
        if q_type not in ALLOWED_QUESTION_TYPES:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Question #{idx} has unsupported type '{q_type}'. "
                    "Supported types: MULTIPLE_CHOICE, TRUE_FALSE, IDENTIFICATION."
                ),
            )

        options: list[PracticeOptionIn] = []
        for o_idx, o in enumerate(q.options, start=1):
            options.append(
                PracticeOptionIn(
                    option_text=o.option_text,
                    is_correct=o.is_correct if q_type != "IDENTIFICATION" else True,
                    option_order=o.option_order or o_idx,
                )
            )

        # For identification, if options are empty or no accepted key, ensure at least one option exists
        if q_type == "IDENTIFICATION" and not options:
            raise HTTPException(
                status_code=422,
                detail=f"Question #{idx} (Identification) does not have an answer key in the uploaded document.",
            )

        converted_questions.append(
            PracticeQuestionCreate(
                question_text=q.question_text,
                question_type=q_type,  # type: ignore
                points=Decimal(str(q.points or 1.0)),
                explanation=q.explanation,
                display_order=idx,
                is_ai_generated=False,
                options=options,
            )
        )

    return PracticeQuestionsImportPreviewResponse(
        source_filename=file.filename or "unknown",
        total_parsed=len(converted_questions),
        questions=converted_questions,
        warnings=warnings,
    )

