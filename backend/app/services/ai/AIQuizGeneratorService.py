"""
app/services/ai/AIQuizGeneratorService.py

Generates structured quiz questions using AI.
Uses the shared metered provider gateway.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import HTTPException

from app.services.ai.Provider import generate_text

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are an expert assessment specialist. Generate high-quality quiz questions directly aligned with the curriculum and provided learning materials.

OUTPUT FORMAT REQUIREMENTS:
1. Respond ONLY with a valid JSON object containing a "questions" array.
2. Structure of each question item:
{
  "question_text": "Clear and concise question prompt",
  "question_type": "MULTIPLE_CHOICE" | "SHORT_ANSWER",
  "points": 1.0,
  "display_order": 1,
  "difficulty_level": "EASY" | "MEDIUM" | "HARD",
  "explanation": "Brief rationale, model answer, or grading rubric",
  "options": [
    {"option_text": "Choice text", "is_correct": true, "option_order": 1}
  ]
}
3. Rules for Question Types:
- MULTIPLE_CHOICE: question_type="MULTIPLE_CHOICE", exactly 4 options, exactly 1 marked is_correct: true.
- TRUE_FALSE: question_type="MULTIPLE_CHOICE", exactly 2 options: [{"option_text": "True", "is_correct": bool, "option_order": 1}, {"option_text": "False", "is_correct": bool, "option_order": 2}], exactly 1 marked is_correct: true.
- SHORT_ANSWER / Identification: question_type="SHORT_ANSWER", options MUST contain exactly 1 option with {"option_text": "Exact Answer/Term", "is_correct": true, "option_order": 1}.
- ESSAY / Open-Ended: question_type="SHORT_ANSWER", options MUST be [], explanation contains the key rubrics/expected analysis points.
"""


def _build_quiz_prompt(
    subject: str,
    lessons: list[str],
    content_text: str,
    test_parts: list[dict[str, Any]],
) -> str:
    parts_desc = []
    for p in test_parts:
        ptype = str(p.get("type", "MULTIPLE_CHOICE")).upper()
        count = p.get("count", 5)
        points = float(p.get("points_per_item", 1.0))
        breakdown: dict[str, int] = {k.upper(): v for k, v in p.get("difficulty_breakdown", {}).items() if v > 0}
        if not breakdown:
            breakdown = {"EASY": count}

        # Human-readable difficulty string
        if len(breakdown) == 1 and "EASY" in breakdown:
            diff_str = "ALL EASY"
        else:
            diff_parts = [f"{breakdown.get(d, 0)} {d}" for d in ("EASY", "MEDIUM", "HARD") if breakdown.get(d, 0) > 0]
            diff_str = " + ".join(diff_parts)

        if ptype == "TRUE_FALSE":
            label = "True or False (exactly 2 options: True / False)"
        elif ptype == "ESSAY":
            label = "Essay / Open-Ended Response (rubric / key points in explanation)"
        elif ptype == "SHORT_ANSWER":
            label = "Short Answer / Identification (single concise word or phrase; answer in explanation)"
        else:
            label = "Multiple Choice (exactly 4 options, exactly 1 marked is_correct: true)"

        parts_desc.append(
            f"  • {count} × {label} ({ptype}) — Difficulty: {diff_str} — {points} pt(s) each"
        )

    lessons_str = ", ".join(lessons) if lessons else "General curriculum topics"
    trimmed_content = content_text.strip()[:4000] if content_text else "No additional text provided."

    return (
        f"Subject: {subject or 'General'}\n"
        f"Connected Lessons / Source Material: {lessons_str}\n"
        f"Required Test Parts:\n" + "\n".join(parts_desc) + "\n\n"
        f"IMPORTANT — For each difficulty bucket listed above, generate exactly that many questions "
        f"at that difficulty_level. Set the difficulty_level field accordingly: EASY, MEDIUM, or HARD.\n\n"
        f"Reference Content:\n\"\"\"\n{trimmed_content}\n\"\"\"\n\n"
        f"Generate exactly the requested questions and return valid JSON."
    )


def _extract_and_validate_json(
    raw_text: str,
    test_parts: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Parse JSON from AI output and validate question items, applying teacher configured points."""
    # 1. Check for markdown json block
    json_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
    candidate = json_block.group(1).strip() if json_block else raw_text.strip()

    # 2. Extract outermost JSON object/array
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", candidate)
    if match:
        candidate = match.group(1).strip()

    # 3. Pre-repair common minor JSON syntax deviations:
    candidate = re.sub(r"([,\[])\s*(?=\"question_text\"\s*:)", r"\1{", candidate)
    candidate = re.sub(r",\s*([\]\}])", r"\1", candidate)
    candidate = re.sub(r'\\(?!["\\/nrt]|u[0-9a-fA-F]{4})', r'\\\\', candidate)

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        sanitized = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", candidate)
        try:
            data = json.loads(sanitized)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail=f"AI returned malformed JSON: {exc}")

    raw_questions = data.get("questions", data) if isinstance(data, dict) else data
    if not isinstance(raw_questions, list):
        raise HTTPException(status_code=502, detail="AI output does not contain a valid questions list.")

    # Build sequence of expected points per item from test_parts
    expected_points_sequence: list[float] = []
    if test_parts:
        for p in test_parts:
            count = int(p.get("count", 1))
            pts = float(p.get("points_per_item", 1.0))
            expected_points_sequence.extend([pts] * count)

    valid_questions: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue
        q_type = str(item.get("question_type", "MULTIPLE_CHOICE")).upper()
        if q_type not in {"MULTIPLE_CHOICE", "SHORT_ANSWER"}:
            q_type = "MULTIPLE_CHOICE"

        raw_options = item.get("options", [])
        validated_options = []
        if isinstance(raw_options, list):
            for o_idx, opt in enumerate(raw_options, start=1):
                if isinstance(opt, dict):
                    opt_text = str(opt.get("option_text", "")).strip()
                    if opt_text:
                        raw_correct = opt.get("is_correct", False)
                        if isinstance(raw_correct, str):
                            is_corr = raw_correct.strip().lower() in {"true", "1", "yes", "correct"}
                        elif isinstance(raw_correct, (int, float)):
                            is_corr = raw_correct == 1
                        else:
                            is_corr = bool(raw_correct)
                        validated_options.append({
                            "option_text": opt_text,
                            "is_correct": True if q_type == "SHORT_ANSWER" else is_corr,
                            "option_order": int(opt.get("option_order", o_idx)),
                        })
            if q_type == "MULTIPLE_CHOICE":
                while len(validated_options) < 4:
                    order = len(validated_options) + 1
                    fallback_label = "None of the above" if order == 4 else f"Option {chr(64 + order)}"
                    validated_options.append({
                        "option_text": fallback_label,
                        "is_correct": False,
                        "option_order": order,
                    })
                if len(validated_options) > 4:
                    correct_idx = next((i for i, o in enumerate(validated_options) if o["is_correct"]), 0)
                    if correct_idx >= 4:
                        validated_options[0] = validated_options[correct_idx]
                    validated_options = validated_options[:4]

                correct_count = sum(1 for o in validated_options if o["is_correct"])
                if correct_count == 0:
                    hint = str(item.get("correct_answer") or item.get("answer") or "").strip().upper()
                    matched = False
                    if hint:
                        for o in validated_options:
                            if o["option_text"].strip().upper().startswith(hint):
                                o["is_correct"] = True
                                matched = True
                                break
                    if not matched and validated_options:
                        validated_options[0]["is_correct"] = True
                elif correct_count > 1:
                    found_first = False
                    for o in validated_options:
                        if o["is_correct"]:
                            if not found_first:
                                found_first = True
                            else:
                                o["is_correct"] = False

        if idx - 1 < len(expected_points_sequence):
            points = expected_points_sequence[idx - 1]
        else:
            points = float(item.get("points", 1.0))

        valid_questions.append({
            "question_text": str(item.get("question_text", f"Question {idx}")).strip(),
            "question_type": q_type,
            "points": max(0.5, points),
            "display_order": idx,
            "difficulty_level": str(item.get("difficulty_level", "MEDIUM")).upper(),
            "explanation": item.get("explanation"),
            "lesson_id": item.get("lesson_id"),
            "options": validated_options,
        })

    if not valid_questions:
        raise HTTPException(status_code=502, detail="AI service could not generate valid quiz questions.")

    return valid_questions


async def generate_quiz_questions(
    subject: str,
    lessons: list[str],
    content_text: str,
    test_parts: list[dict[str, Any]],
    difficulty: str = "EASY",  # kept for backward compat; difficulty is now per-part via difficulty_breakdown
) -> list[dict[str, Any]]:
    """
    Generate structured quiz questions using AI.
    Uses one configured provider with durable usage reservations.
    """
    prompt = _build_quiz_prompt(subject, lessons, content_text, test_parts)
    raw = await generate_text(prompt, _SYSTEM_PROMPT, json_output=True)

    try:
        questions = _extract_and_validate_json(raw, test_parts)
        if len(questions) != sum(part["count"] for part in test_parts):
            raise HTTPException(502, "AI returned an incomplete question set. Try a smaller set.")
        return questions
    except (ValueError, TypeError, KeyError, OverflowError):
        raise HTTPException(502, "AI returned invalid question data.") from None
