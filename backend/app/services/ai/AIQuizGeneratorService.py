"""
app/services/ai/AIQuizGeneratorService.py

Generates structured quiz questions using AI.
Primary provider: Groq API routed via standard OpenAI Python SDK with dynamic model discovery.
Fallback provider: Google Gemini API via httpx.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from fastapi import HTTPException
from openai import AsyncOpenAI, APIError, APIConnectionError, RateLimitError

from app.core.Config import settings

logger = logging.getLogger(__name__)

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_PREFERRED_MODELS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile",
    "groq/compound",
    "groq/compound-mini",
    "qwen/qwen3.6-27b",
    "allam-2-7b",
]

GEMINI_MODELS = [
    "gemini-1.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
]

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

    try:
        data = json.loads(candidate)
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
                        validated_options.append({
                            "option_text": opt_text,
                            "is_correct": True if q_type == "SHORT_ANSWER" else bool(opt.get("is_correct", False)),
                            "option_order": int(opt.get("option_order", o_idx)),
                        })
            if q_type == "MULTIPLE_CHOICE" and not any(o["is_correct"] for o in validated_options) and validated_options:
                validated_options[0]["is_correct"] = True

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


async def _generate_with_groq(
    groq_key: str,
    prompt: str,
    system_prompt: str = _SYSTEM_PROMPT,
) -> str:
    client = AsyncOpenAI(api_key=groq_key, base_url=GROQ_BASE_URL)

    # Discover active models dynamically
    candidate_models = list(GROQ_PREFERRED_MODELS)
    try:
        models_res = await client.models.list()
        active_ids = [
            m.id for m in models_res.data
            if "whisper" not in m.id and "guard" not in m.id and "safeguard" not in m.id
        ]
        # Put preferred active models first, then any other active models
        ordered = [m for m in candidate_models if m in active_ids]
        for m in active_ids:
            if m not in ordered:
                ordered.append(m)
        if ordered:
            candidate_models = ordered
    except Exception as list_err:
        logger.warning(f"Could not list Groq models dynamically: {list_err}")

    last_err: Exception | None = None
    for model_name in candidate_models:
        try:
            logger.info(f"Attempting AI Quiz generation with Groq model: {model_name}")
            response: Any = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=4000,
                response_format={"type": "json_object"},
                stream=False,
            )
            content = response.choices[0].message.content
            if content:
                return content
        except RateLimitError as exc:
            last_err = exc
            logger.warning(f"Groq rate limit on {model_name}: {exc}")
            continue
        except APIError as exc:
            last_err = exc
            logger.warning(f"Groq API error on {model_name}: {exc}")
            continue
        except Exception as exc:
            last_err = exc
            logger.warning(f"Groq error on {model_name}: {exc}")
            continue

    if last_err:
        raise last_err
    raise HTTPException(status_code=502, detail="Groq AI service failed across all candidate models.")


async def _generate_with_gemini(
    gemini_key: str,
    prompt: str,
    system_prompt: str = _SYSTEM_PROMPT,
) -> str:
    payload = {
        "contents": [{"role": "user", "parts": [{"text": f"{system_prompt}\n\nTask:\n{prompt}"}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 4000, "responseMimeType": "application/json"},
    }

    last_err: Exception | None = None
    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_key}"
        try:
            logger.info(f"Attempting AI Quiz generation with Gemini model: {model_name}")
            async with httpx.AsyncClient(timeout=35.0) as client:
                response = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
            if response.is_success:
                data = response.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                if text:
                    return text
            else:
                logger.warning(f"Gemini {model_name} returned status {response.status_code}: {response.text}")
        except Exception as exc:
            last_err = exc
            logger.warning(f"Gemini {model_name} exception: {exc}")
            continue

    if last_err:
        raise last_err
    raise HTTPException(status_code=502, detail="Gemini AI service failed on all candidate models.")


async def generate_quiz_questions(
    subject: str,
    lessons: list[str],
    content_text: str,
    test_parts: list[dict[str, Any]],
    difficulty: str = "EASY",  # kept for backward compat; difficulty is now per-part via difficulty_breakdown
) -> list[dict[str, Any]]:
    """
    Generate structured quiz questions using AI.
    Prefers Groq (with auto model discovery and rotation), falls back to Gemini if available.
    """
    groq_key = settings.groq_api_key
    gemini_key = settings.gemini_api_key

    prompt = _build_quiz_prompt(subject, lessons, content_text, test_parts)
    raw = None

    if groq_key:
        try:
            raw = await _generate_with_groq(groq_key, prompt)
        except Exception as exc:
            logger.warning(f"Groq generation failed: {exc}. Trying Gemini fallback...")
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
        raise HTTPException(status_code=502, detail="Empty response from AI providers.")

    return _extract_and_validate_json(raw, test_parts)
