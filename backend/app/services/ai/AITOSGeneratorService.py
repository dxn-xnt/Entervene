"""
app/services/ai/AITOSGeneratorService.py

Generates structured TOS exam questions using AI based on competency rows,
hard type counts, and soft Bloom taxonomy guidance.
"""
from __future__ import annotations

import json
import logging
import random
import re
from collections import Counter
from typing import Any, List

from fastapi import HTTPException

from app.services.ai.Provider import generate_text
from app.services.ai.question_quality_validation import (
    identification_issue,
    option_text_issue,
    self_containment_issue,
    true_false_answers_are_mixed,
    validate_true_false,
)

logger = logging.getLogger(__name__)

_TOS_SYSTEM_PROMPT = """You are an expert assessment specialist and exam creator for educational institutions following DepEd and international curriculum guidelines.
Your job is to generate rigorous, high-quality summative assessment questions that directly test the specified learning competencies.

CRITICAL QUANTITY REQUIREMENT:
You MUST generate the EXACT quantity of questions specified in the prompt. Every single question must be an individual item in the "questions" array.

OUTPUT FORMAT REQUIREMENTS:
1. Respond ONLY with a valid JSON object containing a "questions" array.
2. Every item in the "questions" array MUST be an object enclosed in its own curly braces { ... }.
Example structure:
{
  "questions": [
    {
      "question_text": "Which organelle produces most of a cell's ATP?",
      "question_type": "MULTIPLE_CHOICE",
      "difficulty_band": "EASY",
      "cognitive_level": "REMEMBER",
      "points": 1.0,
      "explanation": "Answer rationale",
      "options": [
        {"option_text": "Nucleus", "is_correct": false, "option_order": 1},
        {"option_text": "Ribosome", "is_correct": false, "option_order": 2},
        {"option_text": "Mitochondrion", "is_correct": true, "option_order": 3},
        {"option_text": "Cell wall", "is_correct": false, "option_order": 4}
      ]
    },
    {
      "question_text": "Which value solves 2x + 3 = 11?",
      "question_type": "MULTIPLE_CHOICE",
      "difficulty_band": "AVERAGE",
      "cognitive_level": "APPLY",
      "points": 1.0,
      "explanation": "Answer rationale",
      "options": [
        {"option_text": "2", "is_correct": false, "option_order": 1},
        {"option_text": "4", "is_correct": true, "option_order": 2},
        {"option_text": "5", "is_correct": false, "option_order": 3},
        {"option_text": "7", "is_correct": false, "option_order": 4}
      ]
    },
    {
      "question_text": "Water boils at 100 degrees Celsius at sea level.",
      "question_type": "TRUE_FALSE",
      "difficulty_band": "EASY",
      "cognitive_level": "UNDERSTAND",
      "points": 1.0,
      "explanation": "Answer rationale",
      "options": [
        {"option_text": "True", "is_correct": true, "option_order": 1},
        {"option_text": "False", "is_correct": false, "option_order": 2}
      ]
    },
    {
      "question_text": "Sound travels faster in air than in steel.",
      "question_type": "TRUE_FALSE",
      "difficulty_band": "AVERAGE",
      "cognitive_level": "UNDERSTAND",
      "points": 1.0,
      "explanation": "Sound travels faster through solids such as steel.",
      "options": [
        {"option_text": "True", "is_correct": false, "option_order": 1},
        {"option_text": "False", "is_correct": true, "option_order": 2}
      ]
    },
    {
      "question_text": "What is the chemical symbol for gold?",
      "question_type": "IDENTIFICATION",
      "difficulty_band": "EASY",
      "cognitive_level": "REMEMBER",
      "points": 1.0,
      "explanation": "Au is the chemical symbol for gold.",
      "options": [
        {"option_text": "Au", "is_correct": true, "option_order": 1}
      ]
    }
  ]
}

RULES FOR QUESTION TYPES:
- MULTIPLE_CHOICE: Provide EXACTLY 4 distinct, meaningful options and exactly 1 correct option. Never use placeholder options. Distribute correct answers across all four positions.
- TRUE_FALSE: Write a declarative statement and provide exactly these 2 options in this order: [{"option_text": "True", "is_correct": bool, "option_order": 1}, {"option_text": "False", "is_correct": bool, "option_order": 2}], with exactly 1 correct. Never use a blank, question, or instruction such as "identify"; those belong in Identification. For 3 or more items, include both true and false answers, roughly half of each. False statements must be plausible misconceptions, not simple negations.
- IDENTIFICATION: options MUST contain 1 correct concise term or phrase, normally at most 5 words. The question must have exactly one objectively correct concept. Open-ended prompts such as explain, describe, main idea, name one, give an example, or list must not be Identification.
- MATCHING: question_text contains the Column A premise item. options contains the matching Column B options (4-5 options), with exactly 1 marked is_correct: true.
- ESSAY: options MUST be [], explanation contains the key scoring rubrics and expected answer points.

ANSWER POSITION RANDOMIZATION REQUIREMENT:
For MULTIPLE_CHOICE questions, vary the correct answer position across all four choices throughout the exam.

SELF-CONTAINED QUESTION REQUIREMENT:
Every question must be answerable using only its own text. Never refer to a story, passage, poem, text, article, graph, table, picture, or "the following/above" unless it is included in that question. If context is needed, include a short passage of 1-4 sentences inside question_text.

TAXONOMY & DIFFICULTY ALIGNMENT:
- EASY questions correspond to cognitive levels REMEMBER or UNDERSTAND.
- AVERAGE questions correspond to cognitive levels APPLY or ANALYZE.
- DIFFICULT questions correspond to cognitive levels EVALUATE or CREATE.
"""

from app.services.ai.option_shuffle import (
    _has_positional_or_relative_options,
    has_positional_or_relative_options,
    shuffle_options,
)



def _build_tos_row_prompt(
    competency_label: str,
    code: str | None,
    subject: str,
    type_counts: dict[str, int],
    bloom_targets: dict[str, int],
    language: str = "English",
) -> str:
    total_requested = sum(type_counts.values()) if type_counts else 5

    type_lines = []
    for t, n in type_counts.items():
        if n > 0:
            type_lines.append(f"  - {n} x {t} question(s)")

    bloom_lines = []
    for level, n in bloom_targets.items():
        if n > 0:
            bloom_lines.append(f"  - {n} target item(s) at {level} level")

    types_str = "\n".join(type_lines) if type_lines else f"  - {total_requested} x MULTIPLE_CHOICE"
    bloom_str = "\n".join(bloom_lines) if bloom_lines else "  - Balanced cognitive distribution"

    lang_instruction = "strictly in Filipino (Tagalog)" if (language and language.lower() == "filipino") else "strictly in English"

    return (
        f"Subject: {subject or 'General'}\n"
        f"Learning Competency: {competency_label} (Code: {code or 'N/A'})\n"
        f"Language of Examination: {language} (You MUST generate all question text, options, correct answers, and explanations {lang_instruction})\n\n"
        f"CRITICAL REQUIREMENT: Generate EXACTLY {total_requested} question(s) in total for this competency.\n"
        f"Do NOT stop early. The 'questions' array MUST contain {total_requested} full question objects.\n\n"
        f"QUESTION TYPE COMPOSITION:\n"
        f"{types_str}\n\n"
        f"BLOOM'S TAXONOMY & DIFFICULTY TARGETS (Tag each question with appropriate cognitive_level & difficulty_band):\n"
        f"{bloom_str}\n\n"
        f"Every question must be self-contained. Include any needed 1-4 sentence passage inside question_text. "
        f"Ensure every question is fully written out {lang_instruction}, academically sound, and strictly formatted as JSON."
    )


def _extract_and_validate_tos_json(
    raw_text: str,
    warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    # 1. Check for markdown json block
    json_block = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
    candidate = json_block.group(1).strip() if json_block else raw_text.strip()

    # 2. Extract outermost JSON object/array
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", candidate)
    if match:
        candidate = match.group(1).strip()

    # 3. Pre-repair common minor JSON syntax deviations:
    # Auto-repair missing opening brace '{' before question_text in array: e.g. [,]\s*"question_text":
    candidate = re.sub(r"([,\[])\s*(?=\"question_text\"\s*:)", r"\1{", candidate)
    # Strip trailing commas before closing braces/brackets
    candidate = re.sub(r",\s*([\]\}])", r"\1", candidate)
    # Auto-escape unescaped backslashes in math/LaTeX expressions (e.g. \pi, \cdot, \frac, \times)
    candidate = re.sub(r'\\(?!["\\/nrt]|u[0-9a-fA-F]{4})', r'\\\\', candidate)

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        # Fallback: attempt further cleanup of unescaped control chars
        sanitized = re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", candidate)
        try:
            data = json.loads(sanitized)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail=f"AI returned malformed JSON for TOS: {exc}")

    raw_questions = data.get("questions", data) if isinstance(data, dict) else data
    if not isinstance(raw_questions, list):
        raise HTTPException(status_code=502, detail="AI output does not contain a valid questions list.")

    discard_reasons: Counter[str] = Counter()
    valid_questions: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue

        q_type = str(item.get("question_type", "MULTIPLE_CHOICE")).strip().upper()
        if q_type not in {"MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "MATCHING", "ESSAY"}:
            discard_reasons["unsupported question type"] += 1
            logger.warning("TOS question %r discarded: unsupported question type %r", item.get("question_text"), q_type)
            continue

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

        question_text = str(item.get("question_text", f"Question {idx}")).strip()
        if q_type == "IDENTIFICATION":
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
                logger.warning("TOS question %r discarded: %s", question_text, reason)
                continue

        containment_reason = self_containment_issue(question_text)
        if containment_reason:
            discard_reasons[containment_reason] += 1
            logger.warning("TOS question %r discarded: %s", question_text, containment_reason)
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

        option_issue = option_text_issue(validated_options)
        if option_issue:
            discard_reasons[option_issue] += 1
            logger.warning("TOS question %r discarded: %s", question_text, option_issue)
            continue

        if q_type == "ESSAY":
            validated_options = []
        elif q_type == "IDENTIFICATION":
            if not validated_options:
                fallback_key = str(item.get("answer") or item.get("correct_answer") or "").strip()
                if fallback_key and len(fallback_key) <= 100 and "\n" not in fallback_key:
                    validated_options = [{
                        "option_text": fallback_key,
                        "is_correct": True,
                        "option_order": 1,
                    }]
                    logger.warning(
                        "TOS IDENTIFICATION question '%s' had no options array; recovered key from 'answer' field: %r",
                        item.get("question_text", f"Question {idx}"),
                        fallback_key,
                    )
                else:
                    discard_reasons["no answer key"] += 1
                    logger.warning(
                        "TOS IDENTIFICATION question '%s' has no valid answer key in options or explicit answer field. Question discarded.",
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
                logger.warning("TOS question %r discarded: %s", question_text, reason)
                continue

        elif q_type == "TRUE_FALSE":
            validated, reason = validate_true_false(question_text, validated_options)
            if reason:
                discard_reasons[reason] += 1
                logger.warning("TOS question %r discarded: %s", question_text, reason)
                continue
            validated_options = validated or []
        elif q_type in {"MULTIPLE_CHOICE", "MATCHING"}:
            if q_type == "MULTIPLE_CHOICE":
                if len(validated_options) < 4:
                    reason = "multiple choice requires at least 4 distinct non-empty options"
                    discard_reasons[reason] += 1
                    logger.warning("TOS question %r discarded: %s", question_text, reason)
                    continue
                if len(validated_options) > 4:
                    correct_options = [option for option in validated_options if option["is_correct"]]
                    if len(correct_options) == 1:
                        correct = correct_options[0]
                        kept_ids = {id(correct)}
                        for option in validated_options:
                            if not option["is_correct"] and len(kept_ids) < 4:
                                kept_ids.add(id(option))
                        validated_options = [option for option in validated_options if id(option) in kept_ids]

            correct_count = sum(1 for o in validated_options if o["is_correct"])
            if correct_count == 0:
                reason = f"{q_type.replace('_', ' ').lower()} has no correct option"
                discard_reasons[reason] += 1
                logger.warning("TOS question %r discarded: %s", question_text, reason)
                continue
            elif correct_count > 1:
                reason = f"{q_type.replace('_', ' ').lower()} has multiple correct options"
                discard_reasons[reason] += 1
                logger.warning("TOS question %r discarded: %s", question_text, reason)
                continue

            # Server-side shuffle for MULTIPLE_CHOICE if options do not reference positions or each other
            validated_options = shuffle_options(validated_options, q_type)

        valid_questions.append({
            "question_text": question_text,
            "question_type": q_type,
            "difficulty_band": diff_band,
            "cognitive_level": cog_level,
            "points": float(item.get("points", 1.0)),
            "explanation": item.get("explanation"),
            "options": validated_options,
        })

    if warnings is not None:
        for reason, count in discard_reasons.items():
            warnings.append(f"{count} question(s) discarded: {reason}")

    return valid_questions


async def generate_tos_row_questions(
    competency_label: str,
    code: str | None,
    subject: str,
    type_counts: dict[str, int],
    bloom_targets: dict[str, int],
    language: str = "English",
    warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    response_warnings = warnings if warnings is not None else []
    prompt = _build_tos_row_prompt(
        competency_label=competency_label,
        code=code,
        subject=subject,
        type_counts=type_counts,
        bloom_targets=bloom_targets,
        language=language,
    )
    raw = await generate_text(prompt, _TOS_SYSTEM_PROMPT, json_output=True)

    try:
        expected_counts = {kind: int(count) for kind, count in type_counts.items() if count}
        questions = _extract_and_validate_tos_json(raw, warnings=response_warnings)
        questions = _limit_to_requested_counts(questions, expected_counts, response_warnings)

        produced_counts = Counter(question["question_type"] for question in questions)
        shortfalls = {
            kind: count - produced_counts.get(kind, 0)
            for kind, count in expected_counts.items()
            if produced_counts.get(kind, 0) < count
        }
        if shortfalls:
            retry_prompt = _build_tos_row_prompt(
                competency_label=competency_label,
                code=code,
                subject=subject,
                type_counts=shortfalls,
                bloom_targets=bloom_targets,
                language=language,
            )
            retry_prompt += (
                "\n\nRETRY REQUIREMENT: The previous response was short after validation. "
                "Generate only the listed missing question types and quantities."
            )
            retry_raw = await generate_text(retry_prompt, _TOS_SYSTEM_PROMPT, json_output=True)
            retry_questions = _extract_and_validate_tos_json(retry_raw, warnings=response_warnings)
            questions.extend(_limit_to_requested_counts(retry_questions, shortfalls, response_warnings))

        tf_count = expected_counts.get("TRUE_FALSE", 0)
        tf_questions = [question for question in questions if question["question_type"] == "TRUE_FALSE"]
        if tf_count >= 3 and len(tf_questions) == tf_count and not true_false_answers_are_mixed(tf_questions):
            missing_kind = "False" if any(
                option["option_text"] == "True" and option["is_correct"]
                for question in tf_questions
                for option in question["options"]
            ) else "True"
            retry_prompt = _build_tos_row_prompt(
                competency_label=competency_label,
                code=code,
                subject=subject,
                type_counts={"TRUE_FALSE": tf_count},
                bloom_targets=bloom_targets,
                language=language,
            )
            retry_prompt += (
                f"\n\nRETRY REQUIREMENT: The previous True/False part had identical answers. "
                f"Generate all {tf_count} items again and include at least one {missing_kind} answer."
            )
            retry_raw = await generate_text(retry_prompt, _TOS_SYSTEM_PROMPT, json_output=True)
            retry_warnings: list[str] = []
            retry_questions = _extract_and_validate_tos_json(retry_raw, warnings=retry_warnings)
            retry_tf = _limit_to_requested_counts(
                retry_questions,
                {"TRUE_FALSE": tf_count},
                retry_warnings,
            )
            if len(retry_tf) == tf_count and true_false_answers_are_mixed(retry_tf):
                replacement = iter(retry_tf)
                questions = [
                    next(replacement) if question["question_type"] == "TRUE_FALSE" else question
                    for question in questions
                ]
            else:
                response_warnings.extend(retry_warnings)
                response_warnings.append("all True/False answers are the same")

        produced_counts = Counter(question["question_type"] for question in questions)
        if any(produced_counts.get(kind, 0) != count for kind, count in expected_counts.items()):
            requested_text = ", ".join(f"{kind}={count}" for kind, count in expected_counts.items())
            produced_text = ", ".join(
                f"{kind}={produced_counts.get(kind, 0)}" for kind in expected_counts
            )
            response_warnings.append(
                f"TOS question count mismatch: requested {requested_text}; produced {produced_text}."
            )

        return questions
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, OverflowError):
        raise HTTPException(502, "AI returned invalid question data.") from None


def _limit_to_requested_counts(
    questions: list[dict[str, Any]],
    requested_counts: dict[str, int],
    warnings: list[str],
) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    kept_counts: Counter[str] = Counter()
    discarded: Counter[str] = Counter()
    for question in questions:
        question_type = question["question_type"]
        if question_type not in requested_counts:
            discarded[f"unexpected question type {question_type}"] += 1
            continue
        if kept_counts[question_type] >= requested_counts[question_type]:
            discarded[f"excess question type {question_type}"] += 1
            continue
        kept.append(question)
        kept_counts[question_type] += 1
    for reason, count in discarded.items():
        warnings.append(f"{count} question(s) discarded: {reason}")
    return kept
