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


def test_import_preview_preserves_multiline_wrapped_options():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Cybersecurity Assessment
29. Define 'Accountability' and explain why it matters legally.
A) It hides user identities to protect privacy
B) It attributes actions to specific actors via logging/audit trails, enabling non-repudiation, forensics, and legal
process
C) It ensures systems never go offline
D) It verifies hardware authenticity only
Answer: B) It attributes actions to specific actors via logging/audit trails, enabling non-repudiation,
forensics, and legal process
SECTION 8 - Defense-in-Depth
30. What is Defense-in-Depth?
A) Relying on one firewall
B) Layered security so failure of any single control does not compromise the whole system
Answer: B
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 2
    q29 = body["questions"][0]
    opt_b = q29["options"][1]
    assert opt_b["option_text"] == "It attributes actions to specific actors via logging/audit trails, enabling non-repudiation, forensics, and legal process"
    assert opt_b["is_correct"] is True
    assert "SECTION 8" not in opt_b["option_text"]
    assert "SECTION 8" not in q29["question_text"]


def test_import_preview_does_not_append_junk_lines_to_options():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Networking & Security Exam
1. What is the role of a border router in network topology?
A) Distributes power to rack equipment
B) Acts as the single point of entry connecting the enterprise network to external networks
C) Hosts database replication services
D) Performs end-user desktop authentication
   and policy enforcement across local workstations
Answer: B
Explanation: Border routers operate at the network boundary to filter traffic and route between AS domains.
This ensures external traffic is scrutinized before entering internal subnets.
Page 1 of 5
- 1 -

2. (C) Explain why multi-factor authentication strengthens access control.
A) Eliminates the need for passwords completely
B) Reduces CPU overhead on authentication servers
C) Requires two or more independent credentials, preventing unauthorized access if one factor
   is compromised
D) Guarantees 100% protection against physical theft
Rationale: Compromising a single factor (e.g. stolen password) is insufficient for attacker access.
Even if passwords leak, hardware tokens remain secure.
Page 2 of 5
-- 2 --
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 2

    # Question 1: Answer line, multi-line explanation, and footers after option D
    q1 = body["questions"][0]
    opt1_d = q1["options"][3]
    # Check that legitimate multi-line continuation was preserved
    assert opt1_d["option_text"] == "Performs end-user desktop authentication and policy enforcement across local workstations"
    # Verify no junk was appended
    assert "Answer" not in opt1_d["option_text"]
    assert "Explanation" not in opt1_d["option_text"]
    assert "Border routers" not in opt1_d["option_text"]
    assert "Page" not in opt1_d["option_text"]
    assert "- 1 -" not in opt1_d["option_text"]
    assert q1["options"][1]["is_correct"] is True

    # Question 2: Inline answer key, multi-line option C, explanation/rationale without Answer: line, and footers after option D
    q2 = body["questions"][1]
    opt2_c = q2["options"][2]
    assert opt2_c["option_text"] == "Requires two or more independent credentials, preventing unauthorized access if one factor is compromised"
    assert opt2_c["is_correct"] is True

    opt2_d = q2["options"][3]
    assert opt2_d["option_text"] == "Guarantees 100% protection against physical theft"
    assert "Rationale" not in opt2_d["option_text"]
    assert "Compromising" not in opt2_d["option_text"]
    assert "Page" not in opt2_d["option_text"]
    assert "2" not in opt2_d["option_text"]


def test_import_preview_preserves_plain_number_continuation_lines():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Network Ports & Protocols
1. Which port is the standard default for secure HTTPS traffic?
A) TCP port
   80
B) TCP port
   443
C) UDP port
   53
D) TCP port
   1024
Answer: B
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 1
    q1 = body["questions"][0]

    assert q1["options"][0]["option_text"] == "TCP port 80"
    assert q1["options"][1]["option_text"] == "TCP port 443"
    assert q1["options"][1]["is_correct"] is True
    assert q1["options"][2]["option_text"] == "UDP port 53"
    assert q1["options"][3]["option_text"] == "TCP port 1024"



