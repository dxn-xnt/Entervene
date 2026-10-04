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

from app.services.ai.option_shuffle import shuffle_options
from app.services.ai.Provider import generate_text

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are an expert assessment specialist. Generate high-quality quiz questions directly aligned with the curriculum and provided learning materials.

OUTPUT FORMAT REQUIREMENTS:
1. Respond ONLY with a valid JSON object containing a "questions" array.
2. Structure of each question item:
{
  "question_text": "Clear and concise question prompt",
  "question_type": "MULTIPLE_CHOICE" | "IDENTIFICATION" | "SHORT_ANSWER",
  "points": 1.0,
  "display_order": 1,
  "difficulty_level": "EASY" | "MEDIUM" | "HARD",
  "explanation": "Brief rationale, model answer, or grading rubric",
  "options": [...]
}
3. Rules for Question Types:
- MULTIPLE_CHOICE: question_type="MULTIPLE_CHOICE", exactly 4 options, exactly 1 marked is_correct: true. The position of the correct answer MUST be evenly and unpredictably distributed (vary across options A, B, C, and D) across questions. NEVER default to always placing the correct answer in Option A.
- TRUE_FALSE: question_type="MULTIPLE_CHOICE", exactly 2 options: [{"option_text": "True", "is_correct": bool, "option_order": 1}, {"option_text": "False", "is_correct": bool, "option_order": 2}], exactly 1 marked is_correct: true.
- IDENTIFICATION: question_type="IDENTIFICATION", options MUST contain exactly 1 option with the accepted answer: {"option_text": "Exact Answer/Term", "is_correct": true, "option_order": 1}. Use this for questions that have ONE definite correct concept (e.g. "What is the term for…?" or "Name the process…"). IMPORTANT: Each IDENTIFICATION question must have exactly ONE correct concept as its answer. If a question naturally has multiple distinct valid answers (for example "Identify the nouns in: 'The dog chased the ball'" has two nouns), you MUST rewrite the question so that only ONE noun is the target OR omit it entirely. NEVER emit options: [] for IDENTIFICATION. If you cannot determine a single unambiguous answer, change the question type to SHORT_ANSWER instead.
- SHORT_ANSWER: question_type="SHORT_ANSWER", options MUST be []. Use for open-ended questions requiring explanation, analysis, or opinion — questions where there is no single exact correct answer. Put a model answer or scoring rubric in "explanation".

ANSWER POSITION RANDOMIZATION REQUIREMENT:
For MULTIPLE_CHOICE questions, the correct answer must NOT always be in the first option (Option A). You MUST vary the correct answer position across options A, B, C, and D throughout the quiz items.
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
            # ESSAY from the UI maps to SHORT_ANSWER in the DB
            label = "Short Answer / Essay / Open-Ended Response (options=[], rubric / key points in explanation)"
            ptype = "SHORT_ANSWER"
        elif ptype == "IDENTIFICATION":
            label = (
                "Identification (question_type=\"IDENTIFICATION\"; exactly ONE accepted answer key in options; "
                "single concise word or phrase; the question must have ONE definite correct concept)"
            )
        elif ptype == "SHORT_ANSWER":
            label = (
                "Short Answer / Open-Ended (question_type=\"SHORT_ANSWER\"; options=[]; "
                "model answer or rubric in explanation; manual grading)"
            )
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
    warnings: list[str] | None = None,
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
    candidate = re.sub(r'\\(?!["\\\/nrt]|u[0-9a-fA-F]{4})', r'\\\\', candidate)

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

    # Normalize ESSAY → SHORT_ANSWER from the test_parts UI mapping
    _essay_as_short = {"ESSAY", "SHORT_ANSWER"}

    discarded_no_key_count = 0
    valid_questions: list[dict[str, Any]] = []

    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue
        q_type = str(item.get("question_type", "MULTIPLE_CHOICE")).upper()
        # ESSAY from older AI responses maps to SHORT_ANSWER
        if q_type == "ESSAY":
            q_type = "SHORT_ANSWER"
        if q_type not in {"MULTIPLE_CHOICE", "SHORT_ANSWER", "IDENTIFICATION"}:
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
                            "is_correct": True if q_type == "IDENTIFICATION" else is_corr,
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
                    correct_idx = next((i for i, o in enumerate(validated_options) if o["is_correct"]), -1)
                    if correct_idx >= 4:
                        validated_options[3] = validated_options[correct_idx]
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
                    if not matched:
                        logger.warning(
                            "Quiz question '%s' has no correct option marked by AI and hint '%s' did not resolve. Question discarded.",
                            item.get("question_text", f"Question {idx}"),
                            hint,
                        )
                        continue
                elif correct_count > 1:
                    found_first = False
                    for o in validated_options:
                        if o["is_correct"]:
                            if not found_first:
                                found_first = True
                            else:
                                o["is_correct"] = False

                # Server-side shuffle for MULTIPLE_CHOICE if options do not reference positions or each other
                validated_options = shuffle_options(validated_options, q_type)

            elif q_type == "SHORT_ANSWER":
                # SHORT_ANSWER is always manual grading and stores no options (decision #6)
                recovered_sample = ""
                if validated_options:
                    opt_texts = [o["option_text"].strip() for o in validated_options if o.get("option_text")]
                    if opt_texts:
                        recovered_sample = ", ".join(opt_texts)
                if not recovered_sample:
                    fallback_ans = str(item.get("answer") or item.get("correct_answer") or "").strip()
                    if fallback_ans:
                        recovered_sample = fallback_ans

                if recovered_sample:
                    logger.warning(
                        "AI generator returned SHORT_ANSWER question '%s' with an answer key/options (%s). "
                        "Because SHORT_ANSWER is designated for open-ended manual grading, options are discarded and preserved in explanation. "
                        "The model prompt instructs the AI to use IDENTIFICATION when an exact answer key is required.",
                        item.get("question_text", f"Question {idx}"),
                        recovered_sample,
                    )
                    curr_exp = str(item.get("explanation") or "").strip()
                    if not curr_exp:
                        item["explanation"] = f"Sample answer: {recovered_sample}"
                    else:
                        item["explanation"] = f"{curr_exp}\n\nSample answer: {recovered_sample}"
                validated_options = []

            elif q_type == "IDENTIFICATION":
                # IDENTIFICATION MUST have an answer key (decision #1, #5).
                # If options is empty, accept an explicit short 'answer' field as the key (single line, up to about 100 characters).
                # Never derive a key from explanation.
                if not validated_options:
                    fallback_key = str(item.get("answer") or item.get("correct_answer") or "").strip()
                    if fallback_key and len(fallback_key) <= 100 and "\n" not in fallback_key:
                        validated_options = [{
                            "option_text": fallback_key,
                            "is_correct": True,
                            "option_order": 1,
                        }]
                        logger.warning(
                            "IDENTIFICATION question '%s' had no options array; recovered key from 'answer' field: %r",
                            item.get("question_text", f"Question {idx}"),
                            fallback_key,
                        )
                    else:
                        discarded_no_key_count += 1
                        logger.warning(
                            "IDENTIFICATION question '%s' has no valid answer key in options or explicit answer field. Question discarded.",
                            item.get("question_text", f"Question {idx}"),
                        )
                        continue  # Discard — unkeyed IDENTIFICATION is not accepted

        if idx - 1 < len(expected_points_sequence):
            points = expected_points_sequence[idx - 1]
        else:
            points = float(item.get("points", 1.0))

        explanation_val = item.get("explanation")
        if q_type == "SHORT_ANSWER" and not (explanation_val and str(explanation_val).strip()):
            explanation_val = "Sample answer / rubric to be provided by teacher."

        valid_questions.append({
            "question_text": str(item.get("question_text", f"Question {idx}")).strip(),
            "question_type": q_type,
            "points": max(0.5, points),
            "display_order": len(valid_questions) + 1,
            "difficulty_level": str(item.get("difficulty_level", "MEDIUM")).upper(),
            "explanation": explanation_val,
            "lesson_id": item.get("lesson_id"),
            "is_ai_generated": True,
            "options": validated_options,
        })

    if discarded_no_key_count > 0 and warnings is not None:
        warnings.append(f"{discarded_no_key_count} question(s) discarded: no answer key")

    if not valid_questions:
        raise HTTPException(status_code=502, detail="AI service could not generate valid quiz questions.")

    return valid_questions



async def generate_quiz_questions(
    subject: str,
    lessons: list[str],
    content_text: str,
    test_parts: list[dict[str, Any]],
    difficulty: str = "EASY",  # kept for backward compat; difficulty is now per-part via difficulty_breakdown
    warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Generate structured quiz questions using AI.
    Uses one configured provider with durable usage reservations.
    """
    prompt = _build_quiz_prompt(subject, lessons, content_text, test_parts)
    raw = await generate_text(prompt, _SYSTEM_PROMPT, json_output=True)

    try:
        questions = _extract_and_validate_json(raw, test_parts, warnings=warnings)
        if len(questions) != sum(part["count"] for part in test_parts):
            raise HTTPException(502, "AI returned an incomplete question set. Try a smaller set.")
        return questions
    except (ValueError, TypeError, KeyError, OverflowError):
        raise HTTPException(502, "AI returned invalid question data.") from None

