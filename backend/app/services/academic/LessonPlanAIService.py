"""
app/services/academic/LessonPlanAIService.py

Generates lesson planning content using AI.
Uses the shared metered provider gateway.
"""
from __future__ import annotations

import logging
import re
from typing import Literal, Any

from fastapi import HTTPException

from app.services.ai.Provider import generate_text

logger = logging.getLogger(__name__)

AISuggestField = Literal[
    "objectives",
    "competencies",
    "content_standard",
    "performance_standard",
    "learner_context",
    "pre_lesson",
    "flow_before",
    "flow_during",
    "flow_after",
    "resources",
    "integration",
    "formative",
    "evaluation_tasks",
    "extended_opportunities",
    "reflections",
]

_SYSTEM_PROMPT = (
    "You are a strict educational curriculum assistant that generates direct lesson plan content.\n"
    "CRITICAL OUTPUT FORMATTING RULES:\n"
    "1. Output ONLY plain, unformatted text. Do NOT use markdown bolding (e.g. **word**), italics, or markdown code blocks.\n"
    "2. Never output conversational intros (e.g. 'Here are some...', 'Here are 3-5...', 'Below is...', 'Flow', 'Introduction (Engage)').\n"
    "3. Never output section labels or headers (e.g. 'Extended Learning Activities:', 'Enrichment Activity:', 'Remediation Activity:', 'Accommodations:').\n"
    "4. Never output concluding paragraphs or summaries (e.g. 'By incorporating these...', 'Hope this helps!', 'Note:...').\n"
    "5. Keep the text clean, concise, professional, and directly usable in a lesson plan form input field."
)

_PROMPTS: dict[AISuggestField, str] = {
    "objectives": (
        "Generate 3 clear, measurable SMART learning objectives for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Each objective should begin with an action verb (Bloom's taxonomy). "
        "List each objective on a new line without markdown formatting, intros, or bold text."
    ),
    "competencies": (
        "List 3-5 learning competencies aligned to the curriculum for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "List each competency on a new line without markdown bolding, conversational headers, intros, or notes."
    ),
    "content_standard": (
        "Write a single content standard statement for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Start with 'The learner demonstrates understanding of...'."
    ),
    "performance_standard": (
        "Write a single performance standard statement for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Start with 'The learner is able to...'."
    ),
    "learner_context": (
        "Compose a cohesive 3-4 sentence Learner Context observation paragraph for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Synthesize teacher observations regarding student strengths, interests, and potential barriers into a professional DepEd lesson plan paragraph. "
        "Do not use markdown bolding, intros, or bullet points."
    ),
    "pre_lesson": (
        "Suggest an engaging 5-10 minute pre-lesson warm-up or prior knowledge activation activity for a {learning_area} lesson titled '{title}' for {grade_section}."
    ),
    "flow_before": (
        "List 2-3 concrete 'before the lesson' teacher activities for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Each activity on a new line without markdown bold text or section headers."
    ),
    "flow_during": (
        "List 3-4 engaging 'during the lesson' instructional activities for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Each activity on a new line without markdown bold text or section headers."
    ),
    "flow_after": (
        "List 2-3 'after the lesson' consolidation or closure activities for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Each activity on a new line without markdown bold text or section headers."
    ),
    "resources": (
        "List 5-8 appropriate learning resources, materials, and tools for a {learning_area} lesson titled '{title}' for {grade_section}."
    ),
    "integration": (
        "Suggest 2-3 cross-curricular integration or real-world connection opportunities for a {learning_area} lesson titled '{title}' for {grade_section}."
    ),
    "formative": (
        "Describe a specific formative assessment strategy for a {learning_area} lesson titled '{title}' for {grade_section}."
    ),
    "evaluation_tasks": (
        "Suggest 2-3 summative evaluation tasks or performance outputs for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Each task on a new line."
    ),
    "extended_opportunities": (
        "List differentiated extended learning activities (core, enrichment for advanced, remediation for struggling, accommodations) for a {learning_area} lesson titled '{title}' for {grade_section}. "
        "Do NOT include intro lines ('Here are some...'), section headers ('Extended Learning Activities:', 'Enrichment Activity:'), or concluding paragraphs ('By incorporating...')."
    ),
    "reflections": (
        "Provide a structured reflection template with 3-4 guiding questions for a teacher to reflect on after teaching a {learning_area} lesson titled '{title}' for {grade_section}."
    ),
}


def clean_ai_output(raw_text: str) -> str:
    """Sanitize AI output to strip markdown bolding, italics, code blocks, intros, section headers, and outros."""
    if not raw_text:
        return ""

    # Remove markdown code block markers
    text = re.sub(r"^```[a-zA-Z]*\n?", "", raw_text.strip())
    text = re.sub(r"\n?```$", "", text.strip())

    # Strip markdown bolding (**text** -> text) and italics (*text* -> text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)

    # Strip markdown header markers
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)

    lines = text.splitlines()
    cleaned_lines = []

    intro_patterns = re.compile(
        r"^(here (is|are|are some|are the)|below (is|are)|sure|certainly|as requested|for the lesson|in this lesson|flow|introduction|development|deepening|integration|opportunities for integration|extended learning activities|enrichment activity|remediation activity|accommodations and modifications)[^:\n]*:?$",
        re.IGNORECASE,
    )
    
    header_label_patterns = re.compile(
        r"^(extended learning activities|enrichment activity|enrichment activities|remediation activity|remediation activities|accommodations and modifications|accommodations|remediation|enrichment|learning activities)[^:\n]*:?$",
        re.IGNORECASE,
    )

    outro_patterns = re.compile(
        r"^(by (incorporating|using|following|implementing|utilizing)|in conclusion|overall,|this will|ensuring that|note:|disclaimer:|please note:|hope this helps|esc refers to|shs refers to)",
        re.IGNORECASE,
    )

    for line in lines:
        # Strip leading bullets or numbers
        stripped = re.sub(r"^[\*\-\d\.\s]+", "", line).strip()
        if not stripped:
            continue
        if intro_patterns.match(stripped):
            continue
        if header_label_patterns.match(stripped):
            continue
        if outro_patterns.match(stripped):
            continue
        cleaned_lines.append(stripped)

    return "\n\n".join(cleaned_lines).strip()


def _build_prompt(field: AISuggestField, title: str, learning_area: str, grade_section: str) -> str:
    template = _PROMPTS[field]
    return template.format(
        title=title or "this lesson",
        learning_area=learning_area or "the subject",
        grade_section=grade_section or "the class",
    )


async def generate_lesson_plan_suggestion(
    field: AISuggestField,
    title: str,
    learning_area: str,
    grade_section: str,
) -> str:
    """
    Generate AI suggestion for a lesson plan field.
    Uses one configured provider with no automatic retry.
    """
    prompt = _build_prompt(field, title, learning_area, grade_section)
    return clean_ai_output(await generate_text(prompt, _SYSTEM_PROMPT, max_tokens=768))
