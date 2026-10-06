"""
app/services/ai/AIQuizGeneratorService.py

Generates structured quiz questions using AI.
Uses the shared metered provider gateway.
"""
from __future__ import annotations

import json
import logging
import re
from collections import Counter
from typing import Any

from fastapi import HTTPException

from app.services.ai.option_shuffle import shuffle_options
from app.services.ai.Provider import generate_text
from app.services.ai.question_quality_validation import (
    identification_issue,
    option_text_issue,
    self_containment_issue,
    true_false_answers_are_mixed,
    validate_true_false,
)

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are an expert assessment specialist. Generate high-quality quiz questions directly aligned with the curriculum and provided learning materials.

OUTPUT FORMAT REQUIREMENTS:
1. Respond ONLY with a valid JSON object containing a "questions" array.
2. Structure of each question item:
{
  "question_text": "Clear and concise question prompt",
  "question_type": "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IDENTIFICATION" | "SHORT_ANSWER",
  "points": 1.0,
  "display_order": 1,
  "difficulty_level": "EASY" | "MEDIUM" | "HARD",
  "explanation": "Brief rationale, model answer, or grading rubric",
  "options": [...]
}
3. Rules for Question Types:
- MULTIPLE_CHOICE: question_type="MULTIPLE_CHOICE", exactly 4 distinct, meaningful options and exactly 1 marked is_correct: true. Never use placeholder options. Vary the correct answer position across the four options.
- TRUE_FALSE: question_type="TRUE_FALSE", a declarative statement with exactly these 2 options in this order: [{"option_text": "True", "is_correct": bool, "option_order": 1}, {"option_text": "False", "is_correct": bool, "option_order": 2}], with exactly 1 correct. Never use a blank, question, or instruction such as "identify"; those belong in Identification. For a part with 3 or more items, include both true and false answers, roughly half of each. Write false statements as plausible misconceptions, not simple negations.
- IDENTIFICATION: question_type="IDENTIFICATION", options MUST contain exactly 1 accepted answer: {"option_text": "Exact Answer/Term", "is_correct": true, "option_order": 1}. The answer must be one concise term or phrase, normally at most 5 words, and the question must have one objectively correct concept. Open-ended prompts such as explain, describe, main idea, name one, give an example, or list are SHORT_ANSWER, not Identification. NEVER emit options: [] for IDENTIFICATION.
- SHORT_ANSWER: question_type="SHORT_ANSWER", options MUST be []. Use for open-ended questions requiring explanation, analysis, or opinion - questions where there is no single exact correct answer. Put a model answer or scoring rubric in "explanation".

SELF-CONTAINED QUESTION REQUIREMENT:
Every question must be answerable using only its own text. Never refer to a story, passage, poem, text, article, graph, table, picture, or "the following/above" unless it is included in that question. If context is needed, include a short passage of 1-4 sentences inside question_text.

ANSWER POSITION RANDOMIZATION REQUIREMENT:
For MULTIPLE_CHOICE questions, vary the correct answer position across all four choices throughout the quiz.
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
            label = (
                "True or False (question_type=\"TRUE_FALSE\"; declarative statement; exactly 2 options: "
                "True then False; exactly one correct; never a blank or Identification instruction)"
            )
        elif ptype == "ESSAY":
            # ESSAY from the UI maps to SHORT_ANSWER in the DB
            label = "Short Answer / Essay / Open-Ended Response (options=[], rubric / key points in explanation)"
            ptype = "SHORT_ANSWER"
        elif ptype == "IDENTIFICATION":
            label = (
                "Identification (question_type=\"IDENTIFICATION\"; exactly ONE accepted answer key in options; "
                "single concise term or phrase of about 5 words or fewer; one objectively correct concept; "
                "never an open-ended main-idea, name-one, example, list, explain, or describe prompt)"
            )
        elif ptype == "SHORT_ANSWER":
            label = (
                "Short Answer / Open-Ended (question_type=\"SHORT_ANSWER\"; options=[]; "
                "model answer or rubric in explanation; manual grading)"
            )
        else:
            label = "Multiple Choice (exactly 4 options, exactly 1 marked is_correct: true)"

        parts_desc.append(
            f"  - {count} x {label} ({ptype}) - Difficulty: {diff_str} - {points} pt(s) each"
        )

    lessons_str = ", ".join(lessons) if lessons else "General curriculum topics"
    trimmed_content = content_text.strip()[:4000] if content_text else "No additional text provided."

    return (
        f"Subject: {subject or 'General'}\n"
        f"Connected Lessons / Source Material: {lessons_str}\n"
        f"Required Test Parts:\n" + "\n".join(parts_desc) + "\n\n"
        f"IMPORTANT - For each difficulty bucket listed above, generate exactly that many questions "
        f"at that difficulty_level. Set the difficulty_level field accordingly: EASY, MEDIUM, or HARD.\n\n"
        f"Reference Content:\n\"\"\"\n{trimmed_content}\n\"\"\"\n\n"
        f"Every question must be self-contained. Include any needed 1-4 sentence passage inside question_text. "
        f"Generate exactly the requested questions and return valid JSON."
    )


def _extract_and_validate_json(
    raw_text: str,
    test_parts: list[dict[str, Any]] | None = None,
    warnings: list[str] | None = None,
    *,
    allow_empty: bool = False,
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

    expected_items: list[dict[str, Any]] = []
    for part_index, part in enumerate(test_parts or []):
        requested_type = str(part.get("type", "MULTIPLE_CHOICE")).strip().upper()
        if requested_type == "ESSAY":
            requested_type = "SHORT_ANSWER"
        for _ in range(int(part.get("count", 1))):
            expected_items.append({
                "type": requested_type,
                "points": float(part.get("points_per_item", 1.0)),
                "part_index": part_index,
            })

    discard_reasons: Counter[str] = Counter()
    valid_questions: list[dict[str, Any]] = []

    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue

        expected = expected_items[idx - 1] if idx - 1 < len(expected_items) else None
        returned_type = str(item.get("question_type", "MULTIPLE_CHOICE")).strip().upper()
        if returned_type == "ESSAY":
            returned_type = "SHORT_ANSWER"
        requested_type = expected["type"] if expected else returned_type
        if requested_type not in {"MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "IDENTIFICATION"}:
            requested_type = "MULTIPLE_CHOICE"
        output_type = "MULTIPLE_CHOICE" if requested_type == "TRUE_FALSE" else requested_type
        question_text = str(item.get("question_text", f"Question {idx}")).strip()

        # Preserve the more specific Identification warning when a stem is both
        # open-ended and dependent on external material.
        if requested_type == "IDENTIFICATION":
            raw_identification_options = item.get("options", [])
            identification_key = str(item.get("answer", "")).strip()
            if isinstance(raw_identification_options, list):
                correct = next(
                    (option for option in raw_identification_options if option.get("is_correct")),
                    raw_identification_options[0] if raw_identification_options else None,
                )
                if correct is not None:
                    identification_key = str(correct.get("option_text", "")).strip()
            reason = identification_issue(question_text, identification_key)
            if reason:
                discard_reasons[reason] += 1
                logger.warning("Quiz question %r discarded: %s", question_text, reason)
                continue

        containment_reason = self_containment_issue(question_text)
        if containment_reason:
            discard_reasons[containment_reason] += 1
            logger.warning("Quiz question %r discarded: %s", question_text, containment_reason)
            continue

        raw_options = item.get("options", [])
        validated_options: list[dict[str, Any]] = []
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
                            "is_correct": is_corr,
                            "option_order": int(opt.get("option_order", o_idx)),
                        })

        option_issue = option_text_issue(validated_options, requested_type)
        if option_issue:
            discard_reasons[option_issue] += 1
            logger.warning("Quiz question %r discarded: %s", question_text, option_issue)
            continue

        if requested_type == "TRUE_FALSE":
            validated, reason = validate_true_false(question_text, validated_options)
            if reason:
                discard_reasons[reason] += 1
                logger.warning("Quiz question %r discarded: %s", question_text, reason)
                continue
            validated_options = validated or []

        elif requested_type == "MULTIPLE_CHOICE":
            if len(validated_options) < 4:
                reason = "multiple choice requires at least 4 distinct non-empty options"
                discard_reasons[reason] += 1
                logger.warning("Quiz question %r discarded: %s", question_text, reason)
                continue
            correct_count = sum(1 for option in validated_options if option["is_correct"])
            if correct_count != 1:
                reason = "multiple choice has multiple correct options" if correct_count > 1 else "multiple choice has no correct option"
                discard_reasons[reason] += 1
                logger.warning("Quiz question %r discarded: %s", question_text, reason)
                continue
            if len(validated_options) > 4:
                correct = next(option for option in validated_options if option["is_correct"])
                kept_ids = {id(correct)}
                for option in validated_options:
                    if not option["is_correct"] and len(kept_ids) < 4:
                        kept_ids.add(id(option))
                validated_options = [option for option in validated_options if id(option) in kept_ids]
            validated_options = shuffle_options(validated_options, output_type)

        elif requested_type == "SHORT_ANSWER":
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

        elif requested_type == "IDENTIFICATION":
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
                    discard_reasons["no answer key"] += 1
                    logger.warning(
                        "IDENTIFICATION question '%s' has no valid answer key in options or explicit answer field. Question discarded.",
                        item.get("question_text", f"Question {idx}"),
                    )
                    continue
            else:
                validated_options = [validated_options[0]]
                validated_options[0]["is_correct"] = True
                validated_options[0]["option_order"] = 1

            reason = identification_issue(question_text, validated_options[0]["option_text"])
            if reason:
                discard_reasons[reason] += 1
                logger.warning("Quiz question %r discarded: %s", question_text, reason)
                continue

        points = expected["points"] if expected else float(item.get("points", 1.0))

        explanation_val = item.get("explanation")
        if output_type == "SHORT_ANSWER" and not (explanation_val and str(explanation_val).strip()):
            explanation_val = "Sample answer / rubric to be provided by teacher."

        valid_questions.append({
            "question_text": question_text,
            "question_type": output_type,
            "points": max(0.5, points),
            "display_order": len(valid_questions) + 1,
            "difficulty_level": str(item.get("difficulty_level", "MEDIUM")).upper(),
            "explanation": explanation_val,
            "lesson_id": item.get("lesson_id"),
            "is_ai_generated": True,
            "options": validated_options,
            "_requested_part_index": expected["part_index"] if expected else None,
        })

    if warnings is not None:
        for reason, count in discard_reasons.items():
            warnings.append(f"{count} question(s) discarded: {reason}")

    if not valid_questions and not allow_empty:
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
    response_warnings = warnings if warnings is not None else []
    prompt = _build_quiz_prompt(subject, lessons, content_text, test_parts)
    raw = await generate_text(prompt, _SYSTEM_PROMPT, json_output=True)

    try:
        questions = _extract_and_validate_json(
            raw,
            test_parts,
            warnings=response_warnings,
            allow_empty=True,
        )

        for part_index, part in enumerate(test_parts):
            part_type = str(part.get("type", "MULTIPLE_CHOICE")).strip().upper()
            part_count = int(part.get("count", 0))
            if part_type != "TRUE_FALSE" or part_count < 3:
                continue
            group = [q for q in questions if q.get("_requested_part_index") == part_index]
            if len(group) != part_count or true_false_answers_are_mixed(group):
                continue

            missing_kind = "False" if any(
                option["option_text"] == "True" and option["is_correct"]
                for question in group
                for option in question["options"]
            ) else "True"
            retry_part = dict(part)
            retry_prompt = _build_quiz_prompt(subject, lessons, content_text, [retry_part])
            retry_prompt += (
                f"\n\nRETRY REQUIREMENT: The previous True/False part had identical answers. "
                f"Generate all {part_count} items again and include at least one {missing_kind} answer."
            )
            retry_raw = await generate_text(retry_prompt, _SYSTEM_PROMPT, json_output=True)
            retry_warnings: list[str] = []
            retry_questions = _extract_and_validate_json(
                retry_raw,
                [retry_part],
                warnings=retry_warnings,
                allow_empty=True,
            )
            if len(retry_questions) == part_count and true_false_answers_are_mixed(retry_questions):
                for question in retry_questions:
                    question["_requested_part_index"] = part_index
                replacement = iter(retry_questions)
                questions = [
                    next(replacement) if question.get("_requested_part_index") == part_index else question
                    for question in questions
                ]
            else:
                response_warnings.extend(retry_warnings)
                response_warnings.append("all True/False answers are the same")

        expected_count = sum(int(part["count"]) for part in test_parts)
        if len(questions) != expected_count:
            response_warnings.append(
                f"Requested {expected_count} question(s) but produced {len(questions)} valid question(s)."
            )

        for display_order, question in enumerate(questions, start=1):
            question["display_order"] = display_order
            question.pop("_requested_part_index", None)
        return questions
    except (ValueError, TypeError, KeyError, OverflowError):
        raise HTTPException(502, "AI returned invalid question data.") from None

