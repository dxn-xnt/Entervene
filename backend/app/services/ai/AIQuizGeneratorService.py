"""
app/services/ai/AIQuizGeneratorService.py

Generates structured quiz questions using AI.
Primary provider: Groq API routed via standard OpenAI Python SDK.
Fallback provider: Google Gemini API via httpx.
"""
from __future__ import annotations

import json
import re
from typing import Any

import httpx
from fastapi import HTTPException
from openai import AsyncOpenAI, APIError, APIConnectionError, RateLimitError

from app.core.Config import settings

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"

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
  "explanation": "Brief rationale or model answer",
  "options": [
    {"option_text": "Choice A text", "is_correct": true, "option_order": 1},
    {"option_text": "Choice B text", "is_correct": false, "option_order": 2},
    {"option_text": "Choice C text", "is_correct": false, "option_order": 3},
    {"option_text": "Choice D text", "is_correct": false, "option_order": 4}
  ]
}
3. Rules:
- For MULTIPLE_CHOICE: Exactly 4 options, exactly 1 marked is_correct: true.
- For SHORT_ANSWER: options MUST be an empty list []. explanation should contain key grading criteria.
"""


def _build_quiz_prompt(
    subject: str,
    lessons: list[str],
    content_text: str,
    test_parts: list[dict[str, Any]],
    difficulty: str,
) -> str:
    parts_desc = [
        f"- {p.get('count', 5)} items of type {str(p.get('type', 'MULTIPLE_CHOICE')).upper()}"
        for p in test_parts
    ]
    lessons_str = ", ".join(lessons) if lessons else "General curriculum topics"
    trimmed_content = content_text.strip()[:4000] if content_text else "No additional text provided."

    return (
        f"Subject: {subject or 'General'}\n"
        f"Connected Lessons: {lessons_str}\n"
        f"Target Difficulty: {difficulty.upper()}\n"
        f"Required Test Parts:\n" + "\n".join(parts_desc) + "\n\n"
        f"Reference Content:\n\"\"\"\n{trimmed_content}\n\"\"\"\n\n"
        f"Generate exactly the requested questions and return valid JSON."
    )


def _extract_and_validate_json(raw_text: str) -> list[dict[str, Any]]:
    """Parse JSON from AI output and validate question items."""
    cleaned = re.sub(r"^```(?:json)?\n?", "", raw_text.strip())
    cleaned = re.sub(r"\n?```$", "", cleaned.strip())

    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", cleaned)
    if match:
        cleaned = match.group(1)

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"AI returned malformed JSON: {exc}")

    raw_questions = data.get("questions", data) if isinstance(data, dict) else data
    if not isinstance(raw_questions, list):
        raise HTTPException(status_code=502, detail="AI output does not contain a valid questions list.")

    valid_questions: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_questions, start=1):
        if not isinstance(item, dict):
            continue
        q_type = str(item.get("question_type", "MULTIPLE_CHOICE")).upper()
        if q_type not in {"MULTIPLE_CHOICE", "SHORT_ANSWER"}:
            q_type = "MULTIPLE_CHOICE"

        raw_options = item.get("options", [])
        validated_options = []
        if q_type == "MULTIPLE_CHOICE" and isinstance(raw_options, list):
            for o_idx, opt in enumerate(raw_options, start=1):
                if isinstance(opt, dict):
                    validated_options.append({
                        "option_text": str(opt.get("option_text", f"Option {o_idx}")).strip(),
                        "is_correct": bool(opt.get("is_correct", False)),
                        "option_order": int(opt.get("option_order", o_idx)),
                    })
            if not any(o["is_correct"] for o in validated_options) and validated_options:
                validated_options[0]["is_correct"] = True

        valid_questions.append({
            "question_text": str(item.get("question_text", f"Question {idx}")).strip(),
            "question_type": q_type,
            "points": float(item.get("points", 1.0)),
            "display_order": idx,
            "difficulty_level": str(item.get("difficulty_level", "MEDIUM")).upper(),
            "explanation": item.get("explanation"),
            "lesson_id": item.get("lesson_id"),
            "options": validated_options if q_type == "MULTIPLE_CHOICE" else [],
        })

    if not valid_questions:
        raise HTTPException(status_code=502, detail="AI service could not generate valid quiz questions.")

    return valid_questions


async def _generate_with_groq(groq_key: str, prompt: str) -> str:
    client = AsyncOpenAI(api_key=groq_key, base_url=GROQ_BASE_URL)
    try:
        response = await client.chat.completions.create(
            model=GROQ_DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=3000,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        if not content:
            raise HTTPException(status_code=502, detail="Empty response from Groq AI service.")
        return content
    except RateLimitError:
        raise HTTPException(status_code=429, detail="Groq API rate limit exceeded. Please try again.")
    except APIConnectionError:
        raise HTTPException(status_code=502, detail="Unable to connect to Groq AI service.")
    except APIError as exc:
        raise HTTPException(status_code=502, detail=f"Groq API error: {exc.message}")


async def _generate_with_gemini(gemini_key: str, prompt: str) -> str:
    payload = {
        "contents": [{"role": "user", "parts": [{"text": f"{_SYSTEM_PROMPT}\n\nTask:\n{prompt}"}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 3000, "responseMimeType": "application/json"},
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(f"{GEMINI_API_BASE}?key={gemini_key}", json=payload)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI service timed out. Please try again.")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"AI service unreachable: {exc}")

    if not response.is_success:
        raise HTTPException(status_code=502, detail="AI service returned an error. Please try again.")

    data = response.json()
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail="Unexpected response from Gemini AI service.")


async def generate_quiz_questions(
    subject: str,
    lessons: list[str],
    content_text: str,
    test_parts: list[dict[str, Any]],
    difficulty: str = "MEDIUM",
) -> list[dict[str, Any]]:
    """
    Generate structured quiz questions using AI.
    Prefers Groq (via OpenAI SDK), falls back to Gemini if GROQ_API_KEY is not set.
    """
    groq_key = settings.groq_api_key
    gemini_key = settings.gemini_api_key

    prompt = _build_quiz_prompt(subject, lessons, content_text, test_parts, difficulty)

    if groq_key:
        raw = await _generate_with_groq(groq_key, prompt)
    elif gemini_key:
        raw = await _generate_with_gemini(gemini_key, prompt)
    else:
        raise HTTPException(
            status_code=503,
            detail="AI service is not configured. Please set GROQ_API_KEY or GEMINI_API_KEY in backend/.env.",
        )

    return _extract_and_validate_json(raw)
