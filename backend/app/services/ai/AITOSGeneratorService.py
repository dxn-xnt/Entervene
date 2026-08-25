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

_TOS_SYSTEM_PROMPT = """You are an expert assessment specialist and exam creator for educational institutions following DepEd and international curriculum guidelines.
Your job is to generate rigorous, high-quality summative assessment questions that directly test the specified learning competencies.

CRITICAL QUANTITY REQUIREMENT:
You MUST generate the EXACT quantity of questions specified in the prompt. Every single question must be an individual item in the "questions" array.

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
- MULTIPLE_CHOICE: Provide EXACTLY 4 distinct multiple-choice options (A, B, C, D). Exactly 1 option must have is_correct: true. DO NOT use True/False options for Multiple Choice!
- TRUE_FALSE: Exactly 2 options: [{"option_text": "True", "is_correct": bool, "option_order": 1}, {"option_text": "False", "is_correct": bool, "option_order": 2}], with exactly 1 marked is_correct: true.
- IDENTIFICATION: options MUST contain 1 option with {"option_text": "Exact Answer/Term", "is_correct": true, "option_order": 1}.
- MATCHING: question_text contains the Column A premise item. options contains the matching Column B options (4-5 options), with exactly 1 marked is_correct: true.
- ESSAY: options MUST be [], explanation contains the key scoring rubrics and expected answer points.

TAXONOMY & DIFFICULTY ALIGNMENT:
- EASY questions correspond to cognitive levels REMEMBER or UNDERSTAND.
- AVERAGE questions correspond to cognitive levels APPLY or ANALYZE.
- DIFFICULT questions correspond to cognitive levels EVALUATE or CREATE.
"""


def _build_tos_row_prompt(
    competency_label: str,
    code: str | None,
    subject: str,
    type_counts: dict[str, int],
    bloom_targets: dict[str, int],
) -> str:
    total_requested = sum(type_counts.values()) if type_counts else 5

    type_lines = []
    for t, n in type_counts.items():
        if n > 0:
            type_lines.append(f"  • {n} × {t} question(s)")

    bloom_lines = []
    for level, n in bloom_targets.items():
        if n > 0:
            bloom_lines.append(f"  • {n} target item(s) at {level} level")

    types_str = "\n".join(type_lines) if type_lines else f"  • {total_requested} × MULTIPLE_CHOICE"
    bloom_str = "\n".join(bloom_lines) if bloom_lines else "  • Balanced cognitive distribution"

    return (
        f"Subject: {subject or 'General'}\n"
        f"Learning Competency: {competency_label} (Code: {code or 'N/A'})\n\n"
        f"CRITICAL REQUIREMENT: Generate EXACTLY {total_requested} question(s) in total for this competency.\n"
        f"Do NOT stop early. The 'questions' array MUST contain {total_requested} full question objects.\n\n"
        f"QUESTION TYPE COMPOSITION:\n"
        f"{types_str}\n\n"
        f"BLOOM'S TAXONOMY & DIFFICULTY TARGETS (Tag each question with appropriate cognitive_level & difficulty_band):\n"
        f"{bloom_str}\n\n"
        f"Ensure every question is fully written out, academically sound, and strictly formatted as JSON."
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
            raw = await _generate_with_groq(groq_key, prompt, system_prompt=_TOS_SYSTEM_PROMPT)
        except Exception as exc:
            logger.warning(f"Groq TOS generation failed: {exc}. Trying Gemini fallback...")
            if gemini_key:
                raw = await _generate_with_gemini(gemini_key, prompt, system_prompt=_TOS_SYSTEM_PROMPT)
            else:
                raise exc
    elif gemini_key:
        raw = await _generate_with_gemini(gemini_key, prompt, system_prompt=_TOS_SYSTEM_PROMPT)
    else:
        raise HTTPException(
            status_code=503,
            detail="AI service is not configured. Please set GROQ_API_KEY or GEMINI_API_KEY in backend/.env.",
        )

    if not raw:
        raise HTTPException(status_code=502, detail="Empty response from AI providers for TOS.")

    return _extract_and_validate_tos_json(raw)
