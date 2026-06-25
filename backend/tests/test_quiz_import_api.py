import uuid
import zipfile
from io import BytesIO

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.core.Dependencies import get_staff_id
from app.db.Session import get_db


def test_teacher_can_preview_imported_text_quiz():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Grammar Quiz
1. (B) ___ did you go yesterday?
A) What
B) Where
C) Who
D) How
2. What is a variable?
A) A reusable named value
B) A paint color
Answer: A
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Grammar Quiz"
    assert len(body["questions"]) == 2
    assert body["questions"][0]["question_type"] == "MULTIPLE_CHOICE"
    assert body["questions"][0]["options"][1]["is_correct"] is True
    assert body["questions"][1]["options"][0]["is_correct"] is True


def test_import_preview_rejects_unstructured_files():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("empty.txt", b"this has no numbered questions", "text/plain")},
        )

    assert response.status_code == 400
    assert "No quiz questions" in response.json()["detail"]


def test_teacher_can_preview_imported_docx_quiz():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>DOCX Quiz</w:t></w:r></w:p>
    <w:p><w:r><w:t>1. (A) What stores a value?</w:t></w:r></w:p>
    <w:p><w:r><w:t>A) Variable</w:t></w:r></w:p>
    <w:p><w:r><w:t>B) Paintbrush</w:t></w:r></w:p>
  </w:body>
</w:document>"""
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", document_xml)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={
                "file": (
                    "quiz.docx",
                    buffer.getvalue(),
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                )
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "DOCX Quiz"
    assert body["questions"][0]["options"][0]["is_correct"] is True
