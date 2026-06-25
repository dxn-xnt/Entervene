import re
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

from fastapi import HTTPException, UploadFile

from app.schemas.Quiz import QuizImportPreviewResponse, QuizOptionIn, QuizQuestionIn


QUESTION_RE = re.compile(r"^\s*(\d+)[\).]\s*(.+)$")
OPTION_RE = re.compile(r"^\s*([A-Da-d])[\).]\s*(.+)$")
ANSWER_RE = re.compile(r"^\s*(?:answer|ans)\s*[:\-]\s*([A-Da-d])(?:[\).]\s*.*)?\s*$", re.IGNORECASE)
ANSWER_KEY_HEADER_RE = re.compile(r"^\s*answer\s+key\s*$", re.IGNORECASE)
ANSWER_KEY_ITEM_RE = re.compile(r"^\s*(\d+)[\).]\s*([A-Da-d])(?:[\).]\s*.*)?\s*$")
INLINE_KEY_RE = re.compile(r"^\(([A-Da-d])\)\s*(.+)$")


async def preview_quiz_import(file: UploadFile) -> QuizImportPreviewResponse:
    """Parse a structured text quiz into editable manual-builder questions."""
    filename = file.filename or "quiz"
    suffix = Path(filename).suffix.lower()
    content = await file.read()
    text = _extract_text(content, suffix)
    title = _title_from_text(text, filename)
    questions, warnings = _parse_questions(text)
    if not questions:
        raise HTTPException(
            status_code=400,
            detail=(
                "No quiz questions were detected. Use numbered questions with A-D options, "
                "or export the file as plain text before importing."
            ),
        )
    return QuizImportPreviewResponse(
        title=title,
        instructions=None,
        questions=questions,
        warnings=warnings,
    )


def _extract_text(content: bytes, suffix: str) -> str:
    if suffix == ".pdf":
        return _extract_pdf_text(content)
    if suffix == ".docx":
        return _extract_docx_text(content)
    if suffix == ".doc":
        raise HTTPException(
            status_code=400,
            detail="Legacy .doc import is not supported. Save the quiz as DOCX or plain text first.",
        )
    return _decode_text(content, suffix)


def _extract_pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise HTTPException(
            status_code=400,
            detail="PDF import requires the pypdf dependency. Install backend requirements and retry.",
        ) from exc

    try:
        reader = PdfReader(BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unable to extract text from this PDF") from exc
    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="No readable text was found in this PDF. Scanned PDFs require OCR, which is deferred.",
        )
    return text


def _extract_docx_text(content: bytes) -> str:
    try:
        from docx import Document
    except ImportError:
        return _extract_docx_text_with_zip(content)

    try:
        document = Document(BytesIO(content))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
    except Exception:
        return _extract_docx_text_with_zip(content)
    if not text.strip():
        raise HTTPException(status_code=400, detail="No readable text was found in this DOCX file")
    return text


def _extract_docx_text_with_zip(content: bytes) -> str:
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            xml = archive.read("word/document.xml")
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail="DOCX import requires python-docx or a valid DOCX file.",
        ) from exc

    root = ElementTree.fromstring(xml)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{namespace}p"):
        parts = [node.text or "" for node in paragraph.iter(f"{namespace}t")]
        if parts:
            paragraphs.append("".join(parts))
    text = "\n".join(paragraphs)
    if not text.strip():
        raise HTTPException(status_code=400, detail="No readable text was found in this DOCX file")
    return text


def _decode_text(content: bytes, suffix: str) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            text = content.decode(encoding)
        except UnicodeDecodeError:
            continue
        printable_ratio = sum(1 for char in text if char.isprintable() or char.isspace()) / max(len(text), 1)
        if printable_ratio > 0.85 and "\x00" not in text[:200]:
            return text
    raise HTTPException(status_code=400, detail="Unable to read this quiz file as text")


def _title_from_text(text: str, filename: str) -> str:
    for line in text.splitlines():
        cleaned = line.strip()
        if cleaned and not QUESTION_RE.match(cleaned) and not OPTION_RE.match(cleaned):
            if len(cleaned) <= 80:
                return cleaned
    return Path(filename).stem.replace("_", " ").replace("-", " ").title()


def _parse_questions(text: str) -> tuple[list[QuizQuestionIn], list[str]]:
    parsed: list[dict] = []
    current: dict | None = None
    warnings: list[str] = []
    answer_key_map: dict[int, str] = {}
    in_answer_key = False

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ANSWER_KEY_HEADER_RE.match(line):
            if current:
                parsed.append(current)
                current = None
            in_answer_key = True
            continue
        if in_answer_key:
            key_match = ANSWER_KEY_ITEM_RE.match(line)
            if key_match:
                answer_key_map[int(key_match.group(1))] = key_match.group(2).upper()
            continue
        question_match = QUESTION_RE.match(line)
        option_match = OPTION_RE.match(line)
        answer_match = ANSWER_RE.match(line)

        if question_match:
            if current:
                parsed.append(current)
            body = question_match.group(2).strip()
            inline_answer = INLINE_KEY_RE.match(body)
            inline_answer_key = inline_answer.group(1).upper() if inline_answer else None
            question_text = inline_answer.group(2).strip() if inline_answer else body
            current = {
                "number": int(question_match.group(1)),
                "question_text": question_text,
                "options": [],
                "answer_key": inline_answer_key,
            }
            continue

        if option_match and current:
            label = option_match.group(1).upper()
            option_text = option_match.group(2).strip()
            inline_answer = INLINE_KEY_RE.match(option_text)
            if inline_answer:
                current["answer_key"] = inline_answer.group(1).upper()
                option_text = inline_answer.group(2).strip()
            current["options"].append({"label": label, "text": option_text})
            continue

        if answer_match and current:
            current["answer_key"] = answer_match.group(1).upper()
            continue

        if current and not current["options"]:
            current["question_text"] = f"{current['question_text']} {line}".strip()

    if current:
        parsed.append(current)

    questions: list[QuizQuestionIn] = []
    for index, item in enumerate(parsed, start=1):
        options = item["options"]
        if len(options) >= 2:
            correct_label = item["answer_key"] or answer_key_map.get(item["number"]) or options[0]["label"]
            if not item["answer_key"] and item["number"] not in answer_key_map:
                warnings.append(f"Question {index} had no answer key; first option was marked correct.")
            questions.append(QuizQuestionIn(
                question_text=item["question_text"],
                question_type="MULTIPLE_CHOICE",
                points=1,
                display_order=len(questions) + 1,
                difficulty_level="MEDIUM",
                options=[
                    QuizOptionIn(
                        option_text=option["text"],
                        is_correct=option["label"] == correct_label,
                        option_order=option_index,
                    )
                    for option_index, option in enumerate(options, start=1)
                ],
            ))
        else:
            warnings.append(f"Question {index} was imported as short answer because it has fewer than two options.")
            questions.append(QuizQuestionIn(
                question_text=item["question_text"],
                question_type="SHORT_ANSWER",
                points=1,
                display_order=len(questions) + 1,
                difficulty_level="MEDIUM",
                options=[],
            ))
    return questions, warnings
