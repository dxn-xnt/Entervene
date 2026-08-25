"""
app/services/ai/AITOSGeneratorService.py

Generates structured TOS exam questions using AI based on competency rows,
hard type counts, and soft Bloom taxonomy guidance.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, List

from fastapi import HTTPException

from app.core.Config import settings
from app.services.ai.AIQuizGeneratorService import _generate_with_gemini, _generate_with_groq

logger = logging.getLogger(__name__)

_TOS_SYSTEM_PROMPT = """You are an expert assessment specialist and exam writer for secondary and tertiary educational institutions.
Generate high-quality summative exam questions directly aligned with the provided competency and instructions.

OUTPUT FORMAT REQUIREMENTS:
1. Respond ONLY with a valid JSON object containing a "questions" array.
2. Structure of each question item:
{
  "question_text": "Clear and concise question prompt",
  "question_type": "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IDENTIFICATION" | "MATCHING" | "ESSAY",
  "difficulty_band": "EASY" | "AVERAGE" | "DIFFICULT",
  "cognitive_level": "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE",
  "points": 1.0,
  "explanation": "Brief answer key, model answer, or grading rubric",
  "options": [
    {"option_text": "Choice text", "is_correct": true, "option_order": 1}
  ]
}

RULES FOR QUESTION TYPES:
- MULTIPLE_CHOICE: Exactly 4 options, exactly 1 marked is_correct: true.
- TRUE_FALSE: Exactly 2 options: [{"option_text": "True", "is_correct": bool, "option_order": 1}, {"option_text": "False", "is_correct": bool, "option_order": 2}], exactly 1 marked is_correct: true.
- IDENTIFICATION: options MUST contain 1 option with {"option_text": "Exact Answer/Term", "is_correct": true, "option_order": 1}.
- MATCHING: question_text contains the Column A premise item. options contains the matching Column B options (e.g. 4-5 options), with exactly 1 marked is_correct: true corresponding to the premise.
- ESSAY: options MUST be [], explanation contains the key scoring rubrics and expected response elements.

TAGGING RULES:
- cognitive_level must be one of: REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE.
- difficulty_band must be one of: EASY, AVERAGE, DIFFICULT.
  (REMEMBER/UNDERSTAND -> EASY; APPLY/ANALYZE -> AVERAGE; EVALUATE/CREATE -> DIFFICULT).
"""


def _build_tos_row_prompt(
    competency_label: str,
    code: str | None,
    subject: str,
    type_counts: dict[str, int],
    bloom_targets: dict[str, int],
) -> str:
    type_lines = []
    for t, n in type_counts.items():
        if n > 0:
            type_lines.append(f"  • Exactly {n} × {t} question(s)")

    bloom_lines = []
    for level, n in bloom_targets.items():
        if n > 0:
            bloom_lines.append(f"  • Approximately {n} target item(s) at {level} level")

    types_str = "\n".join(type_lines) if type_lines else "  • 5 × MULTIPLE_CHOICE"
    bloom_str = "\n".join(bloom_lines) if bloom_lines else "  • Standard cognitive balance"

    return (
        f"Subject: {subject or 'General'}\n"
        f"Learning Competency: {competency_label} (Code: {code or 'N/A'})\n\n"
        f"MANDATORY QUESTION TYPE REQUIREMENTS (Generate EXACT counts per type):\n"
        f"{types_str}\n\n"
        f"BLOOM'S TAXONOMY GUIDANCE (Soft guidance - tag each generated question with appropriate cognitive_level):\n"
        f"{bloom_str}\n\n"
        f"Ensure every question is rigorous, clear, and accurately tagged with cognitive_level and difficulty_band. Return valid JSON."
    )


def _extract_and_validate_tos_json(raw_text: str) -> list[dict[str, Any]]:
    # 1. Check for markdown json block
    json_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
    candidate = json_block.group(1).strip() if json_block else raw_text.strip()

    # 2. Extract outermost JSON object/array
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", candidate)
    if match:
        candidate = match.group(1).strip()

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"AI returned malformed JSON for TOS: {exc}")

    raw_questions = data.get("questions", data) if isinstance(data, dict) else data
    if not isinstance(raw_questions, list):
        raise HTTPException(status_code=502, detail="AI output does not contain a valid questions list.")

    valid_questions: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue

        q_type = str(item.get("question_type", "MULTIPLE_CHOICE")).strip().upper()
        if q_type not in {"MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "MATCHING", "ESSAY"}:
            q_type = "MULTIPLE_CHOICE"

        cog_level = str(item.get("cognitive_level", "REMEMBER")).strip().upper()
        if cog_level not in {"REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"}:
            cog_level = "REMEMBER"

        diff_band = str(item.get("difficulty_band", "")).strip().upper()
        if diff_band not in {"EASY", "AVERAGE", "DIFFICULT"}:
            if cog_level in {"REMEMBER", "UNDERSTAND"}:
                diff_band = "EASY"
            elif cog_level in {"APPLY", "ANALYZE"}:
                diff_band = "AVERAGE"
            else:
                diff_band = "DIFFICULT"

        raw_options = item.get("options", [])
        validated_options = []
        if isinstance(raw_options, list):
            for o_idx, opt in enumerate(raw_options, start=1):
                if isinstance(opt, dict):
                    opt_text = str(opt.get("option_text", "")).strip()
                    if opt_text:
                        validated_options.append({
                            "option_text": opt_text,
                            "is_correct": bool(opt.get("is_correct", False)),
                            "option_order": int(opt.get("option_order", o_idx)),
                        })

        if q_type == "IDENTIFICATION" and validated_options:
            validated_options[0]["is_correct"] = True
        elif q_type in {"MULTIPLE_CHOICE", "TRUE_FALSE", "MATCHING"} and not any(o["is_correct"] for o in validated_options) and validated_options:
            validated_options[0]["is_correct"] = True

        valid_questions.append({
            "question_text": str(item.get("question_text", f"Question {idx}")).strip(),
            "question_type": q_type,
            "difficulty_band": diff_band,
            "cognitive_level": cog_level,
            "points": float(item.get("points", 1.0)),
            "explanation": item.get("explanation"),
            "options": validated_options,
        })

    return valid_questions


async def generate_tos_row_questions(
    competency_label: str,
    code: str | None,
    subject: str,
    type_counts: dict[str, int],
    bloom_targets: dict[str, int],
) -> list[dict[str, Any]]:
    groq_key = settings.groq_api_key
    gemini_key = settings.gemini_api_key

    prompt = _build_tos_row_prompt(
        competency_label=competency_label,
        code=code,
        subject=subject,
        type_counts=type_counts,
        bloom_targets=bloom_targets,
    )
    raw = None

    if groq_key:
        try:
            raw = await _generate_with_groq(groq_key, prompt)
        except Exception as exc:
            logger.warning(f"Groq TOS generation failed: {exc}. Trying Gemini fallback...")
            if gemini_key:
                raw = await _generate_with_gemini(gemini_key, prompt)
            else:
                raise exc
    elif gemini_key:
        raw = await _generate_with_gemini(gemini_key, prompt)
    else:
        raise HTTPException(
            status_code=503,
            detail="AI service is not configured. Please set GROQ_API_KEY or GEMINI_API_KEY in backend/.env.",
        )

    if not raw:
        raise HTTPException(status_code=502, detail="Empty response from AI providers for TOS.")

    return _extract_and_validate_tos_json(raw)
