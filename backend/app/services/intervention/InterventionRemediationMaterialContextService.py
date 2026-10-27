"""Bounded, reusable learning material and reading context resolver for AI remediation.

Extracts, filters, and bounds relevant teacher-provided reading classworks, lesson content,
and attachments strictly aligned with verified student weaknesses and taught lessons.

Critical boundaries:
1. Supporting readings are supplementary context (SUPPORTING_READING_CONTEXT); they NEVER
   prove historical teaching and never expand the frozen taught-lesson list.
2. File contents are treated strictly as untrusted data, never as execution instructions.
3. Unsupported formats (e.g. legacy .doc/.ppt, images without OCR, or missing pypdf)
   are explicitly reported as gaps rather than invented.
4. Total extracted text is strictly capped to protect Groq free-tier context and token bounds.
"""

from __future__ import annotations

import logging
import os
import re
import zipfile
from pathlib import Path
from typing import Any, Literal
from xml.etree import ElementTree

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.intervention.Intervention import Intervention
from app.services.classwork.ClassworkShared import assignment_is_available, assignment_is_locked

logger = logging.getLogger("ai.remediation.material_context")

MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB per file
MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024  # 30 MB zip decompression guard

_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior)\s+instructions?", re.IGNORECASE),
    re.compile(r"system\s*prompt\s*:", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+a", re.IGNORECASE),
    re.compile(r"new\s+instruction\s*:", re.IGNORECASE),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ExtractedAttachment(StrictModel):
    """Safely extracted text and metadata for a reading classwork attachment."""

    attachment_id: int
    file_name: str
    file_type: str | None = None
    file_size: int
    status: Literal[
        "EXTRACTED",
        "UNSUPPORTED_FORMAT",
        "UNSUPPORTED_LEGACY_FORMAT",
        "MISSING_DEPENDENCY",
        "FILE_NOT_FOUND",
        "CORRUPTED_FILE",
        "EMPTY_CONTENT",
    ]
    detail: str | None = None
    text: str | None = None


class ResolvedReadingMaterial(StrictModel):
    """Teacher-approved Reading Classwork matched to student weaknesses."""

    classwork_id: int
    title: str
    description: str | None = None
    instructions: str | None = None
    evidence_tag: Literal["SUPPORTING_READING_CONTEXT"] = "SUPPORTING_READING_CONTEXT"
    relevance_reason: str
    matched_competency_ids: list[int] = Field(default_factory=list)
    matched_lesson_ids: list[int] = Field(default_factory=list)
    attachments: list[ExtractedAttachment] = Field(default_factory=list)


class RemediationMaterialContext(StrictModel):
    """Bounded, sanitized context payload for AI remediation generation."""

    intervention_id: int
    subject_id: int
    class_id: int
    academic_period_id: int
    evidence_cutoff_at: str
    reading_materials: list[ResolvedReadingMaterial] = Field(default_factory=list)
    lesson_materials: list[dict[str, Any]] = Field(default_factory=list)
    reported_gaps: list[str] = Field(default_factory=list)
    total_extracted_characters: int = 0


def sanitize_material_text(text: str) -> str:
    """Sanitize extracted text to prevent prompt injection and remove invalid characters."""
    if not text:
        return ""
    # Strip non-printable control characters except newline and tab
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    # Neutralize prompt injection phrases
    for pattern in _INJECTION_PATTERNS:
        cleaned = pattern.sub(r"[FILTERED_DIRECTIVE]", cleaned)
    # Collapse excess whitespace
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _extract_docx(file_path: str, max_chars: int) -> str:
    with zipfile.ZipFile(file_path) as archive:
        uncompressed = sum(info.file_size for info in archive.infolist())
        if uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("Oversized DOCX archive")
        if "word/document.xml" not in archive.namelist():
            raise ValueError("Invalid DOCX: missing word/document.xml")
        xml_content = archive.read("word/document.xml")

    root = ElementTree.fromstring(xml_content)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for p in root.iter(f"{namespace}p"):
        texts = [node.text or "" for node in p.iter(f"{namespace}t")]
        line = "".join(texts).strip()
        if line:
            paragraphs.append(line)
    return "\n".join(paragraphs)[:max_chars]


def _extract_pptx(file_path: str, max_chars: int) -> str:
    with zipfile.ZipFile(file_path) as archive:
        uncompressed = sum(info.file_size for info in archive.infolist())
        if uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("Oversized PPTX archive")

        slide_names = [
            name for name in archive.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        ]

        def _slide_num(s: str) -> int:
            m = re.search(r"slide(\d+)\.xml", s)
            return int(m.group(1)) if m else 0

        slide_names.sort(key=_slide_num)
        slides: list[str] = []
        drawing_ns = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
        for sname in slide_names:
            xml_content = archive.read(sname)
            root = ElementTree.fromstring(xml_content)
            texts = [node.text or "" for node in root.iter(f"{drawing_ns}t")]
            combined = " ".join(t.strip() for t in texts if t.strip())
            if combined:
                slides.append(f"[Slide {_slide_num(sname)}]: {combined}")
    return "\n".join(slides)[:max_chars]


def _extract_text_file(file_path: str, max_chars: int) -> str:
    with open(file_path, "rb") as f:
        content = f.read(max_chars * 4)
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            decoded = content.decode(encoding)
            printable_ratio = sum(1 for c in decoded if c.isprintable() or c.isspace()) / max(len(decoded), 1)
            if printable_ratio > 0.85:
                return decoded[:max_chars]
        except UnicodeDecodeError:
            continue
    raise ValueError("Unable to decode text file")


def _extract_pdf(file_path: str, max_chars: int) -> tuple[str | None, str, str | None]:
    try:
        from pypdf import PdfReader
    except ImportError:
        return (
            None,
            "MISSING_DEPENDENCY",
            "PDF text extraction requires pypdf dependency which is not installed",
        )

    try:
        reader = PdfReader(file_path)
        pages: list[str] = []
        total_len = 0
        for page in reader.pages:
            p_text = page.extract_text() or ""
            if p_text:
                pages.append(p_text)
                total_len += len(p_text)
                if total_len >= max_chars:
                    break
        text = "\n".join(pages)[:max_chars]
        if not text.strip():
            return None, "EMPTY_CONTENT", "No readable text found in PDF (scanned image or empty)"
        return text, "EXTRACTED", None
    except Exception as exc:
        return None, "CORRUPTED_FILE", f"Failed to extract PDF: {exc}"


def extract_attachment_text(
    file_path: str,
    file_name: str,
    max_chars: int = 1500,
) -> tuple[str | None, str, str | None]:
    """Safely extract and sanitize text from a learning material attachment file.

    Returns:
        tuple[text | None, status, detail | None]
    """
    path = Path(file_path)
    if not path.exists():
        return None, "FILE_NOT_FOUND", f"Attachment file '{file_name}' not found on disk"

    try:
        size = path.stat().st_size
    except OSError:
        return None, "FILE_NOT_FOUND", f"Could not access file '{file_name}'"

    if size > MAX_FILE_BYTES:
        return None, "UNSUPPORTED_FORMAT", f"File '{file_name}' exceeds 10 MB limit ({size} bytes)"

    suffix = path.suffix.lower()

    if suffix in (".doc", ".ppt"):
        return (
            None,
            "UNSUPPORTED_LEGACY_FORMAT",
            f"Legacy binary format '{suffix}' is not supported for automated text extraction",
        )

    if suffix in (".png", ".jpg", ".jpeg"):
        return (
            None,
            "UNSUPPORTED_FORMAT",
            f"Image format '{suffix}' requires OCR which is not configured",
        )

    if suffix in (".zip", ".mp3", ".mp4", ".wav"):
        return (
            None,
            "UNSUPPORTED_FORMAT",
            f"File format '{suffix}' is not supported for learning material text reading",
        )

    try:
        if suffix == ".docx":
            raw = _extract_docx(str(path), max_chars)
        elif suffix == ".pptx":
            raw = _extract_pptx(str(path), max_chars)
        elif suffix in (".txt", ".csv"):
            raw = _extract_text_file(str(path), max_chars)
        elif suffix == ".pdf":
            text, status, detail = _extract_pdf(str(path), max_chars)
            if status != "EXTRACTED":
                return None, status, detail
            raw = text or ""
        else:
            return (
                None,
                "UNSUPPORTED_FORMAT",
                f"Unsupported attachment file extension '{suffix}'",
            )
    except Exception as exc:
        logger.warning("Attachment extraction failed for %s: %s", file_name, exc)
        return None, "CORRUPTED_FILE", f"Could not parse attachment '{file_name}': {exc}"

    sanitized = sanitize_material_text(raw)
    if not sanitized:
        return None, "EMPTY_CONTENT", f"No readable text extracted from '{file_name}'"

    return sanitized, "EXTRACTED", None


def resolve_remediation_material_context(
    db: Session,
    intervention: Intervention,
    scope: dict[str, Any],
    *,
    selected_reading_ids: list[int] | None = None,
    max_total_chars: int = 4000,
    max_chars_per_item: int = 1500,
) -> RemediationMaterialContext:
    """Resolve and bound relevant learning materials and reading classworks for remediation.

    Distinguishes historical taught lessons from supporting reading materials.
    """
    academic_scope = scope.get("academic_scope") or {}
    cutoff_str = academic_scope.get("evidence_cutoff_at") or intervention.diagnosis_snapshot.get("evidence_cutoff_at", "")

    weak_competencies = {c["competency_id"]: c for c in scope.get("competencies") or []}
    taught_lessons = {l["lesson_id"]: l for l in scope.get("lessons") or [] if l.get("is_taught") is True}

    # 1. Lesson content for eligible taught lessons only
    lesson_materials: list[dict[str, Any]] = []
    for lid, l_info in sorted(taught_lessons.items()):
        lesson_row = db.get(app_models_lesson(), lid)
        if lesson_row is not None:
            text_body = lesson_row.content or lesson_row.description or ""
            if text_body.strip():
                lesson_materials.append({
                    "lesson_id": lid,
                    "title": lesson_row.title,
                    "evidence_tag": "TAUGHT_HISTORICAL_LESSON",
                    "content": sanitize_material_text(text_body)[:max_chars_per_item],
                })

    # 2. Query Reading classworks within the subject and class scope
    candidate_readings = (
        db.query(Classwork)
        .filter(
            Classwork.subject_id == intervention.subject_id,
            Classwork.classwork_type == "READING",
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(False),
        )
        .all()
    )

    # Filter by class and period assignments
    scoped_readings: list[Classwork] = []
    for cw in candidate_readings:
        assignments = db.query(ClassworkAssignment).filter_by(classwork_id=cw.classwork_id).all()
        if assignments:
            matches_scope = any(
                a.class_id == intervention.class_id
                and a.academic_period_id == intervention.academic_period_id
                and not assignment_is_locked(a)
                for a in assignments
            )
            if not matches_scope:
                continue
        scoped_readings.append(cw)

    scoped_reading_map = {cw.classwork_id: cw for cw in scoped_readings}

    # Handle teacher selection vs auto-discovery
    reported_gaps: list[str] = []
    target_cw_ids: list[int] = []

    if selected_reading_ids is not None:
        for cid in selected_reading_ids:
            if cid not in scoped_reading_map:
                raise HTTPException(
                    status_code=422,
                    detail=f"Selected reading classwork ID {cid} is outside the intervention subject/class scope",
                )
        target_cw_ids = list(selected_reading_ids)
    else:
        # Check plan selected resources
        plan = dict(intervention.remediation_plan or {})
        for ref in plan.get("selected_resources") or []:
            if isinstance(ref, dict) and ref.get("kind") == "CLASSWORK":
                rid = ref.get("id")
                if rid in scoped_reading_map and rid not in target_cw_ids:
                    target_cw_ids.append(rid)

        # Also auto-discover reading classworks linked to weak competencies or taught lessons
        for cw in scoped_readings:
            if cw.classwork_id in target_cw_ids:
                continue
            linked_lessons = {l.lesson_id for l in cw.lessons}
            linked_comps = {l.competency_id for l in cw.lessons if l.competency_id is not None}
            for cov in db.query(ClassworkCoverage).filter_by(classwork_id=cw.classwork_id, valid_until=None).all():
                if cov.competency_id is not None:
                    linked_comps.add(cov.competency_id)
                if cov.lesson_id is not None:
                    linked_lessons.add(cov.lesson_id)

            has_weak_comp = any(cid in weak_competencies for cid in linked_comps)
            has_taught_lesson = any(lid in taught_lessons for lid in linked_lessons)
            if has_weak_comp or has_taught_lesson:
                target_cw_ids.append(cw.classwork_id)

    # 3. Resolve, filter, and extract reading materials
    resolved_readings: list[ResolvedReadingMaterial] = []
    char_budget_remaining = max_total_chars

    for cid in target_cw_ids:
        cw = scoped_reading_map.get(cid)
        if cw is None:
            continue

        # Match relevance to weak competencies or taught lessons
        matched_comps: list[int] = []
        matched_lids: list[int] = []
        for l in cw.lessons:
            if l.lesson_id in taught_lessons:
                matched_lids.append(l.lesson_id)
            if l.competency_id in weak_competencies:
                matched_comps.append(l.competency_id)

        for cov in db.query(ClassworkCoverage).filter_by(classwork_id=cw.classwork_id, valid_until=None).all():
            if cov.competency_id in weak_competencies and cov.competency_id not in matched_comps:
                matched_comps.append(cov.competency_id)
            if cov.lesson_id in taught_lessons and cov.lesson_id not in matched_lids:
                matched_lids.append(cov.lesson_id)

        # Build relevance reason
        if matched_comps:
            relevance_reason = f"Aligned with weak competency {matched_comps[0]}"
        elif matched_lids:
            relevance_reason = f"Aligned with taught lesson {matched_lids[0]}"
        else:
            relevance_reason = "Teacher-selected supporting reading context"

        # Extract attachments
        extracted_attachments: list[ExtractedAttachment] = []
        attachments = (
            db.query(ClassworkAttachment)
            .filter_by(classwork_id=cw.classwork_id)
            .order_by(ClassworkAttachment.classwork_attachment_id)
            .all()
        )

        for att in attachments:
            if char_budget_remaining <= 0:
                reported_gaps.append(
                    f"Attachment '{att.file_name}' from reading '{cw.title}' omitted: text context budget exceeded"
                )
                continue

            item_budget = min(max_chars_per_item, char_budget_remaining)
            text, status, detail = extract_attachment_text(att.file_path, att.file_name, max_chars=item_budget)

            if status != "EXTRACTED":
                reported_gaps.append(
                    f"Reading '{cw.title}' attachment '{att.file_name}': {detail or status}"
                )
            else:
                extracted_len = len(text or "")
                char_budget_remaining -= extracted_len

            extracted_attachments.append(
                ExtractedAttachment(
                    attachment_id=att.classwork_attachment_id,
                    file_name=att.file_name,
                    file_type=att.file_type,
                    file_size=att.file_size,
                    status=status,
                    detail=detail,
                    text=text,
                )
            )

        resolved_readings.append(
            ResolvedReadingMaterial(
                classwork_id=cw.classwork_id,
                title=cw.title,
                description=sanitize_material_text(cw.description or "")[:max_chars_per_item] or None,
                instructions=sanitize_material_text(cw.instructions or "")[:max_chars_per_item] or None,
                evidence_tag="SUPPORTING_READING_CONTEXT",
                relevance_reason=relevance_reason,
                matched_competency_ids=sorted(matched_comps),
                matched_lesson_ids=sorted(matched_lids),
                attachments=extracted_attachments,
            )
        )

    total_chars = max_total_chars - char_budget_remaining

    return RemediationMaterialContext(
        intervention_id=intervention.intervention_id,
        subject_id=intervention.subject_id,
        class_id=intervention.class_id,
        academic_period_id=intervention.academic_period_id,
        evidence_cutoff_at=str(cutoff_str),
        reading_materials=resolved_readings,
        lesson_materials=lesson_materials,
        reported_gaps=reported_gaps,
        total_extracted_characters=total_chars,
    )


def app_models_lesson():
    """Deferred import to avoid circular imports."""
    from app.models.academic.Lesson import Lesson
    return Lesson
