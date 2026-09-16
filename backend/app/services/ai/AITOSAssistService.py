"""
app/services/ai/AITOSAssistService.py

AI assistance for Table of Specifications (TOS) field suggestions.
Provides suggestions for competencies & days taught, exam titles, and test parts.
Metered and bounded via Provider.generate_text.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, List, Optional

from fastapi import HTTPException

from app.schemas.AITOS import (
    AITOSAssistRequest,
    AITOSAssistResponse,
    AITOSSuggestedCompetency,
    AITOSSuggestedTestPart,
)
from app.services.ai.Provider import generate_text

logger = logging.getLogger(__name__)

_TOS_ASSIST_SYSTEM_PROMPT = (
    "You are a Philippine Department of Education (DepEd) curriculum expert and assessment specialist.\n"
    "Generate structured, academically rigorous Table of Specifications (TOS) suggestions.\n"
    "CRITICAL OUTPUT FORMATTING RULES:\n"
    "1. Respond ONLY with a valid JSON object matching the requested schema.\n"
    "2. Do NOT use markdown code blocks, conversational intros, or notes.\n"
    "3. Keep all labels, statements, and descriptions concise, clear, and professional."
)


def _extract_json(raw_text: str) -> dict[str, Any]:
    # 1. Strip markdown fence if present
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", raw_text)
    candidate = match.group(1).strip() if match else raw_text.strip()

    # 2. Match outermost JSON object
    match_obj = re.search(r"(\{[\s\S]*\})", candidate)
    if match_obj:
        candidate = match_obj.group(1).strip()

    try:
        data = json.loads(candidate)
        if isinstance(data, dict):
            return data
    except Exception as exc:
        logger.warning(f"Failed to parse TOS AI assist JSON: {exc}. Raw text: {raw_text[:200]}")
    raise HTTPException(status_code=502, detail="AI service returned invalid suggestion data.")


async def suggest_tos_competencies(
    subject_name: str,
    term: str,
    language: str = "English",
    context_text: Optional[str] = None,
) -> List[AITOSSuggestedCompetency]:
    lang_instruction = "strictly in Filipino (Tagalog)" if language.lower() == "filipino" else "in English"
    prompt = (
        f"Subject Curriculum: {subject_name or 'General Education'}\n"
        f"Academic Term: {term}\n"
        f"Language of Instruction: {language} (Generate all competency statements {lang_instruction})\n"
        f"{f'Teacher Notes / Context: {context_text}' if context_text else ''}\n\n"
        "Generate EXACTLY 3 to 4 core learning competencies or assessment topics for this term.\n"
        "For each competency, specify:\n"
        "- 'code': Short curriculum code (e.g. 'LC-01', 'COMP-02')\n"
        "- 'label': Clear, actionable learning competency statement aligned to Bloom's Taxonomy\n"
        "- 'days': Estimated teaching days spent on this topic (integer between 2 and 8)\n\n"
        "REQUIRED JSON STRUCTURE:\n"
        "{\n"
        '  "competencies": [\n'
        '    {"code": "LC-01", "label": "Competency statement...", "days": 4}\n'
        "  ]\n"
        "}"
    )

    raw = await generate_text(prompt, _TOS_ASSIST_SYSTEM_PROMPT, json_output=True, max_tokens=1000)
    data = _extract_json(raw)
    raw_list = data.get("competencies", [])
    if not isinstance(raw_list, list):
        raise HTTPException(status_code=502, detail="AI output missing competencies list.")

    competencies: List[AITOSSuggestedCompetency] = []
    for idx, item in enumerate(raw_list, start=1):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "")).strip()
        if not label:
            continue
        code = str(item.get("code", f"LC-{idx:02d}")).strip() or f"LC-{idx:02d}"
        days = max(1, min(20, int(item.get("days", 3))))
        competencies.append(AITOSSuggestedCompetency(code=code, label=label, days=days))

    if not competencies:
        raise HTTPException(status_code=502, detail="AI could not generate valid curriculum competencies.")

    return competencies[:5]


async def suggest_tos_title(
    subject_name: str,
    term: str,
    language: str = "English",
) -> str:
    lang_instruction = "in Filipino (Tagalog)" if language.lower() == "filipino" else "in English"
    prompt = (
        f"Subject Curriculum: {subject_name or 'General'}\n"
        f"Academic Term: {term}\n"
        f"Language: {language}\n\n"
        f"Suggest a single standard, professional Philippine DepEd assessment title ({lang_instruction}), "
        "such as '1st Periodic Examination in Science 8' or 'Unang Panahunang Pagsusulit sa Filipino 7'.\n\n"
        "REQUIRED JSON STRUCTURE:\n"
        '{"title": "Suggested Exam Title"}'
    )

    raw = await generate_text(prompt, _TOS_ASSIST_SYSTEM_PROMPT, json_output=True, max_tokens=200)
    data = _extract_json(raw)
    title = str(data.get("title", "")).strip()
    if not title:
        title = f"{term} Summative Assessment in {subject_name or 'Subject'}"
    return title


async def suggest_tos_test_parts(
    total_items: int = 30,
    subject_name: str = "",
) -> List[AITOSSuggestedTestPart]:
    prompt = (
        f"Subject Curriculum: {subject_name or 'General'}\n"
        f"Total Exam Items Target: {total_items}\n\n"
        "Recommend a standard DepEd test part item distribution combining question types that SUM EXACTLY to the target total items.\n"
        "Supported question types: 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'IDENTIFICATION', 'MATCHING', 'ESSAY'.\n"
        "Rules:\n"
        "- MULTIPLE_CHOICE should be the majority (e.g. 50-70% of items).\n"
        "- The sum of 'count' across all parts MUST equal EXACTLY the total items target.\n\n"
        "REQUIRED JSON STRUCTURE:\n"
        "{\n"
        '  "test_parts": [\n'
        '    {"type": "MULTIPLE_CHOICE", "count": 20},\n'
        '    {"type": "TRUE_FALSE", "count": 5},\n'
        '    {"type": "IDENTIFICATION", "count": 5}\n'
        "  ]\n"
        "}"
    )

    raw = await generate_text(prompt, _TOS_ASSIST_SYSTEM_PROMPT, json_output=True, max_tokens=500)
    data = _extract_json(raw)
    raw_parts = data.get("test_parts", [])

    valid_types = {"MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "MATCHING", "ESSAY"}
    parts: List[AITOSSuggestedTestPart] = []
    running_total = 0

    if isinstance(raw_parts, list):
        for item in raw_parts:
            if not isinstance(item, dict):
                continue
            p_type = str(item.get("type", "")).strip().upper()
            if p_type not in valid_types:
                continue
            count = max(0, int(item.get("count", 0)))
            if count > 0:
                parts.append(AITOSSuggestedTestPart(type=p_type, count=count))
                running_total += count

    # Fallback or adjust to exactly total_items if AI is slightly off
    if running_total != total_items or not parts:
        if total_items <= 20:
            parts = [AITOSSuggestedTestPart(type="MULTIPLE_CHOICE", count=total_items)]
        elif total_items <= 40:
            mc = total_items - 10
            parts = [
                AITOSSuggestedTestPart(type="MULTIPLE_CHOICE", count=mc),
                AITOSSuggestedTestPart(type="TRUE_FALSE", count=5),
                AITOSSuggestedTestPart(type="IDENTIFICATION", count=5),
            ]
        else:
            mc = total_items - 20
            parts = [
                AITOSSuggestedTestPart(type="MULTIPLE_CHOICE", count=mc),
                AITOSSuggestedTestPart(type="TRUE_FALSE", count=10),
                AITOSSuggestedTestPart(type="IDENTIFICATION", count=10),
            ]

    return parts


async def handle_tos_assist(body: AITOSAssistRequest) -> AITOSAssistResponse:
    if body.field == "suggest_competencies":
        comps = await suggest_tos_competencies(
            subject_name=body.subject_name,
            term=body.term,
            language=body.language,
            context_text=body.context_text,
        )
        return AITOSAssistResponse(field=body.field, competencies=comps)

    elif body.field == "suggest_title":
        title = await suggest_tos_title(
            subject_name=body.subject_name,
            term=body.term,
            language=body.language,
        )
        return AITOSAssistResponse(field=body.field, title=title)

    elif body.field == "suggest_test_parts":
        parts = await suggest_tos_test_parts(
            total_items=body.total_items or 30,
            subject_name=body.subject_name,
        )
        return AITOSAssistResponse(field=body.field, test_parts=parts)

    raise HTTPException(status_code=400, detail=f"Unsupported TOS assistance field: {body.field}")
