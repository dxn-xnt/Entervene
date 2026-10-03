import re
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree

from fastapi import HTTPException, UploadFile

from app.schemas.Quiz import QuizImportPreviewResponse, QuizOptionIn, QuizQuestionIn


QUESTION_START_RE = re.compile(r"^\s*[_~–—\-\.\s]*\s*(\d+)[\)\.]\s*(.+)$")
DOC_HEADER_RE = re.compile(
    r"^\s*(?:name|student\s+name|grade(?:\s*&|\s+and)?\s*section|score|date|class|subject|teacher)\s*[:\-].*$",
    re.IGNORECASE,
)
SECTION_HEADER_RE = re.compile(
    r"^\s*(?:part\s+[ivxlcdm\d]+|section\s+\d+|chapter\s+\d+)\b.*$",
    re.IGNORECASE,
)
DIRECTIONS_START_RE = re.compile(
    r"^\s*(?:directions|instructions|general\s+instructions)\s*[:\-]?.*$",
    re.IGNORECASE,
)
PAGE_FOOTER_RE = re.compile(
    r"^\s*(?:page\s+\d+(?:\s*(?:of|/)\s*\d+)?|[-–—~*\[\(]+\s*page\s+\d+\s*[-–—~*\]\)]+|[-–—~*]+\s*\d+\s*[-–—~*]+|\d+\s*(?:of|/)\s*\d+)\s*$",
    re.IGNORECASE,
)
EXPLANATION_RE = re.compile(r"^\s*(?:explanation|rationale|reason|notes?)\s*[:\-].*$", re.IGNORECASE)
BLANK_ANSWER_RE = re.compile(r"^\s*(?:answer|ans)\s*[:\-]\s*[_.\s-]*$", re.IGNORECASE)
ANSWER_LINE_RE = re.compile(r"^\s*(?:answer|ans)\s*[:\-]\s*(.+)$", re.IGNORECASE)
INLINE_KEY_RE = re.compile(r"^\(([A-Da-d])\)\s*(.+)$")
TRAILING_KEY_HEADER_RE = re.compile(
    r"^\s*(?:quick\s+)?answer\s+keys?(?:\s*\(.*|\s*[:\-].*|\s*$)",
    re.IGNORECASE | re.MULTILINE,
)


def _extract_options_from_line(line: str) -> list[tuple[str, str]]:
    pattern = re.compile(r"(?:^|\s+|(?<=[^\s]))([A-Da-d])[\).]\s*")
    matches = list(pattern.finditer(line))
    if not matches:
        return []
    m0 = matches[0]
    if line[:m0.start()].strip() != "":
        return []
    first_label = m0.group(1).upper()
    results = []
    curr_label = first_label
    curr_start = m0.end()
    for m in matches[1:]:
        cand_label = m.group(1).upper()
        if ord(cand_label) == ord(curr_label) + 1:
            content = line[curr_start:m.start()].strip()
            results.append((curr_label, content))
            curr_label = cand_label
            curr_start = m.end()
    results.append((curr_label, line[curr_start:].strip()))
    return results


def _parse_trailing_keys(text: str) -> dict[int, str]:
    if not text.strip():
        return {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    joined = " ".join(lines)
    pattern = re.compile(
        r"(?:^|\s+)(\d+)\s*[\.\-\)]\s*(.*?)(?=(?:\s+\d+\s*[\.\-\)]\s*)|$)",
        re.DOTALL,
    )
    keys: dict[int, str] = {}
    for match in pattern.finditer(joined):
        num = int(match.group(1))
        val = match.group(2).strip()
        val = re.sub(
            r"^(?:\[(?:key/rubric|key|rubric)\]|key|rubric)\s*[:\-]?\s*",
            "",
            val,
            flags=re.IGNORECASE,
        ).strip()
        keys[num] = val
    return keys


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
        raw_text = "\n".join(page.extract_text() or "" for page in reader.pages)
        # Handle legacy UTF-16BE lines where jsPDF exported without ToUnicode:
        # pypdf extracted 0x21 0x92 (→) as "!\x92", 0x22 0x64 (≤) as '"d', 0x22 0x65 (≥) as '"e', 0x22 0x82 (⊂) as '"\x82'
        # Crucially: In UTF-16BE, ASCII characters have \x00 before them (e.g. \x00" \x00d in "data", \x00! \x00' in Wow!').
        # Non-ASCII 2-byte characters have a non-zero high byte, so the high byte is NOT preceded by \x00.
        # We perform these substitutions strictly per-line on lines containing null bytes using lookbehind to prevent
        # corrupting normal English words like "data", "electron", or "Wow!'".
        cleaned_lines = []
        for line in raw_text.splitlines():
            if "\x00" in line:
                line = re.sub(r'(?<!\x00)"d', "<=", line)
                line = re.sub(r'(?<!\x00)"e', ">=", line)
                line = re.sub(r'(?<!\x00)"[\x82\u201a]', "subset of", line)
                line = re.sub(r'(?<!\x00)![\x92\u2019]', "->", line)
                line = line.replace("\x00", "")
            cleaned_lines.append(line)
        text = "\n".join(cleaned_lines)

        # Restore non-breaking hyphen glyph artifact: \u2011 is encoded in UTF-16BE as 0x20 0x11.
        # In PDFs lacking ToUnicode mapping, pypdf extracts 0x20 as ' ' and 0x11 as DC1.
        # Collapsing preceding space and \x11 into a hyphen reconstructs the original hyphenated word without stray spaces.
        text = re.sub(r"[ \t]*\x11[ \t]*", "-", text)
        # Treat \x0b (vertical tab) and \x0c (form feed) as whitespace (newlines), not deletions
        text = re.sub(r"[\x0b\x0c]", "\n", text)
        text = re.sub(r"[\x01-\x08\x0e-\x1f\x7f]", "", text)
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
            return re.sub(r"[\x0b\x0c]", "\n", text)
    raise HTTPException(status_code=400, detail="Unable to read this quiz file as text")


def _title_from_text(text: str, filename: str) -> str:
    for line in text.splitlines():
        cleaned = line.strip()
        if (
            cleaned
            and not QUESTION_START_RE.match(cleaned)
            and not _extract_options_from_line(cleaned)
            and not DOC_HEADER_RE.match(cleaned)
            and not SECTION_HEADER_RE.match(cleaned)
            and not DIRECTIONS_START_RE.match(cleaned)
            and not TRAILING_KEY_HEADER_RE.match(cleaned)
        ):
            if len(cleaned) <= 80:
                return cleaned
    return Path(filename).stem.replace("_", " ").replace("-", " ").title()


def _parse_questions(text: str) -> tuple[list[QuizQuestionIn], list[str]]:
    """Two-pass quiz parser: parse structure first, then resolve answer keys."""
    clean_text = text.replace("\x00", "")
    clean_text = re.sub(r"[ \t]*\x11[ \t]*", "-", clean_text)
    clean_text = re.sub(r"[\x0b\x0c]", "\n", clean_text)
    clean_text = re.sub(r"[\x01-\x08\x0e-\x1f\x7f]", "", clean_text)

    # Separate trailing answer key section if present
    tk_match = TRAILING_KEY_HEADER_RE.search(clean_text)
    if tk_match:
        body_text = clean_text[: tk_match.start()]
        trailing_key_raw = clean_text[tk_match.end() :]
        answer_key_map = _parse_trailing_keys(trailing_key_raw)
    else:
        body_text = clean_text
        answer_key_map = {}

    # Pass 1: Parse questions and options from body text
    parsed: list[dict] = []
    current: dict | None = None
    in_directions = False

    for raw_line in body_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if DOC_HEADER_RE.match(line):
            continue

        if SECTION_HEADER_RE.match(line):
            if current:
                parsed.append(current)
                current = None
            in_directions = False
            continue

        if DIRECTIONS_START_RE.match(line):
            if current:
                parsed.append(current)
                current = None
            in_directions = True
            continue

        if PAGE_FOOTER_RE.match(line):
            continue

        q_match = QUESTION_START_RE.match(line)
        if q_match:
            in_directions = False
            if current:
                parsed.append(current)
            q_num = int(q_match.group(1))
            body = q_match.group(2).strip()
            inline_ans_match = INLINE_KEY_RE.match(body)
            if inline_ans_match:
                inline_key = inline_ans_match.group(1).upper()
                q_text = inline_ans_match.group(2).strip()
            else:
                inline_key = None
                q_text = body
            current = {
                "number": q_num,
                "question_text": q_text,
                "options": [],
                "inline_key": inline_key,
                "has_answer_line": False,
                "has_explanation_line": False,
            }
            continue

        if in_directions:
            continue

        if current and not current.get("has_answer_line") and not current.get("has_explanation_line"):
            opt_list = _extract_options_from_line(line)
            if opt_list:
                for lbl, txt in opt_list:
                    inline_opt_match = INLINE_KEY_RE.match(txt)
                    if inline_opt_match:
                        current["inline_key"] = inline_opt_match.group(1).upper()
                        txt = inline_opt_match.group(2).strip()
                    current["options"].append({"label": lbl, "text": txt})
                continue

        if current and BLANK_ANSWER_RE.match(line):
            # A blank "Answer: ____" line is NOT an answer key; ignore it
            current["has_answer_line"] = True
            continue

        if current and ANSWER_LINE_RE.match(line):
            ans_val = ANSWER_LINE_RE.match(line).group(1).strip()
            m_letter = re.match(r"^([A-Da-d])(?:[\).]\s*.*)?$", ans_val)
            if m_letter:
                current["inline_key"] = m_letter.group(1).upper()
            else:
                current["inline_key"] = ans_val
            current["has_answer_line"] = True
            continue

        if current and EXPLANATION_RE.match(line):
            current["has_explanation_line"] = True
            continue

        if current:
            if current.get("has_answer_line") or current.get("has_explanation_line"):
                continue
            if current["options"]:
                current["options"][-1]["text"] = f"{current['options'][-1]['text']} {line}".strip()
            else:
                current["question_text"] = f"{current['question_text']} {line}".strip()

    if current:
        parsed.append(current)

    # Pass 2: Resolve keys with precedence: inline > trailing > none
    questions: list[QuizQuestionIn] = []
    warnings: list[str] = []

    for index, item in enumerate(parsed, start=1):
        num = item["number"]
        options = item["options"]
        inline_key = item.get("inline_key")
        trailing_key = answer_key_map.get(num)

        resolved_key = None
        if inline_key and trailing_key:
            if inline_key.strip().upper() == trailing_key.strip().upper():
                resolved_key = inline_key
            else:
                matching_inline_opt = next(
                    (o for o in options if o["label"].upper() == inline_key.upper()),
                    None,
                )
                matching_trailing_opt = next(
                    (
                        o
                        for o in options
                        if o["label"].upper() == trailing_key.upper()
                        or o["text"].strip().lower() == trailing_key.strip().lower()
                    ),
                    None,
                )
                if (
                    matching_inline_opt
                    and matching_trailing_opt
                    and matching_inline_opt == matching_trailing_opt
                ):
                    resolved_key = inline_key
                else:
                    resolved_key = inline_key
                    warnings.append(
                        f"Question {num}: inline answer key ({inline_key}) took precedence over trailing key ({trailing_key})."
                    )
        elif inline_key:
            resolved_key = inline_key
        elif trailing_key:
            resolved_key = trailing_key
        else:
            warnings.append(
                f"Question {num} has no answer key. Please select the correct answer in the builder."
            )

        if len(options) >= 2:
            correct_label = None
            if resolved_key:
                rk_upper = resolved_key.strip().upper()
                rk_lower = resolved_key.strip().lower()
                for opt in options:
                    if opt["label"].upper() == rk_upper:
                        correct_label = opt["label"]
                        break
                if not correct_label:
                    for opt in options:
                        opt_text_lower = opt["text"].strip().lower()
                        if opt_text_lower == rk_lower:
                            correct_label = opt["label"]
                            break
                        if rk_upper in ("T", "TRUE") and opt_text_lower in ("true", "t"):
                            correct_label = opt["label"]
                            break
                        if rk_upper in ("F", "FALSE") and opt_text_lower in ("false", "f"):
                            correct_label = opt["label"]
                            break

            questions.append(
                QuizQuestionIn(
                    question_text=item["question_text"],
                    question_type="MULTIPLE_CHOICE",
                    points=1,
                    display_order=len(questions) + 1,
                    difficulty_level="MEDIUM",
                    options=[
                        QuizOptionIn(
                            option_text=option["text"],
                            is_correct=(option["label"] == correct_label) if correct_label else False,
                            option_order=option_index,
                        )
                        for option_index, option in enumerate(options, start=1)
                    ],
                )
            )
        else:
            # Determine type based on whether an answer key was resolved
            if resolved_key and resolved_key.strip():
                # Has a key → Identification (auto-gradeable)
                questions.append(
                    QuizQuestionIn(
                        question_text=item["question_text"],
                        question_type="IDENTIFICATION",
                        points=1,
                        display_order=len(questions) + 1,
                        difficulty_level="MEDIUM",
                        options=[
                            QuizOptionIn(
                                option_text=resolved_key.strip(),
                                is_correct=True,
                                option_order=1,
                            )
                        ],
                    )
                )
            else:
                # No key → Short Answer (manual grading, no options stored)
                questions.append(
                    QuizQuestionIn(
                        question_text=item["question_text"],
                        question_type="SHORT_ANSWER",
                        points=1,
                        display_order=len(questions) + 1,
                        difficulty_level="MEDIUM",
                        options=[],
                    )
                )

    return questions, warnings

