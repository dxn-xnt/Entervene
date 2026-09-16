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

from app.services.ai.Provider import generate_text

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
      "question_text": "Sample question 1 prompt",
      "question_type": "MULTIPLE_CHOICE",
      "difficulty_band": "EASY",
      "cognitive_level": "REMEMBER",
      "points": 1.0,
      "explanation": "Answer rationale",
      "options": [
        {"option_text": "Option A", "is_correct": true, "option_order": 1},
        {"option_text": "Option B", "is_correct": false, "option_order": 2},
        {"option_text": "Option C", "is_correct": false, "option_order": 3},
        {"option_text": "Option D", "is_correct": false, "option_order": 4}
      ]
    },
    {
      "question_text": "Sample question 2 prompt",
      "question_type": "TRUE_FALSE",
      "difficulty_band": "AVERAGE",
      "cognitive_level": "UNDERSTAND",
      "points": 1.0,
      "explanation": "Answer rationale",
      "options": [
        {"option_text": "True", "is_correct": true, "option_order": 1},
        {"option_text": "False", "is_correct": false, "option_order": 2}
      ]
    }
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
    language: str = "English",
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
        f"Ensure every question is fully written out {lang_instruction}, academically sound, and strictly formatted as JSON."
    )


def _extract_and_validate_tos_json(raw_text: str) -> list[dict[str, Any]]:
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

        if q_type == "ESSAY":
            validated_options = []
        elif q_type == "IDENTIFICATION":
            if not validated_options:
                answer_text = str(item.get("explanation") or item.get("answer") or "Answer").strip()
                validated_options = [{"option_text": answer_text, "is_correct": True, "option_order": 1}]
            else:
                validated_options = [validated_options[0]]
                validated_options[0]["is_correct"] = True
                validated_options[0]["option_order"] = 1
        elif q_type == "TRUE_FALSE":
            is_true_correct = True
            for o in validated_options:
                if o["option_text"].strip().lower() == "false" and o["is_correct"]:
                    is_true_correct = False
            validated_options = [
                {"option_text": "True", "is_correct": is_true_correct, "option_order": 1},
                {"option_text": "False", "is_correct": not is_true_correct, "option_order": 2},
            ]
        elif q_type in {"MULTIPLE_CHOICE", "MATCHING"}:
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

            for o_idx, o in enumerate(validated_options, start=1):
                o["option_order"] = o_idx

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
    language: str = "English",
) -> list[dict[str, Any]]:
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
        questions = _extract_and_validate_tos_json(raw)
        from collections import Counter
        expected_counts = {kind: count for kind, count in type_counts.items() if count}
        total_expected = sum(expected_counts.values())
        if len(questions) < total_expected:
            raise HTTPException(502, f"AI returned {len(questions)} of {total_expected} questions. Please retry.")

        if len(questions) > total_expected:
            questions = questions[:total_expected]

        counts = Counter(q["question_type"] for q in questions)
        if dict(counts) != expected_counts:
            expected_pool = []
            for kind, count in expected_counts.items():
                expected_pool.extend([kind] * count)
            for i, expected_kind in enumerate(expected_pool):
                if i < len(questions):
                    questions[i]["question_type"] = expected_kind

        return questions
    except HTTPException:
        raise
    except (ValueError, TypeError, KeyError, OverflowError):
        raise HTTPException(502, "AI returned invalid question data.") from None
