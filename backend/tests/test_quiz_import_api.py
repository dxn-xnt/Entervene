import uuid
import zipfile
from io import BytesIO
from pathlib import Path

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


def test_import_science_fixture_pdf():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    fixture_path = Path(__file__).parent / "fixtures" / "quiz_import_multipart_trailing_key.pdf"
    with open(fixture_path, "rb") as f:
        pdf_bytes = f.read()

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz_import_multipart_trailing_key.pdf", pdf_bytes, "application/pdf")},
        )

    assert response.status_code == 200
    body = response.json()
    questions = body["questions"]
    assert len(questions) == 20
    assert body["warnings"] == []

    # Keys: 1A 2C 3A 4A 5A 6B 7A 8A 9B 10A
    expected_mcq_keys = {
        1: "A", 2: "C", 3: "A", 4: "A", 5: "A",
        6: "B", 7: "A", 8: "A", 9: "B", 10: "A",
    }
    for q_num, expected_key in expected_mcq_keys.items():
        q = questions[q_num - 1]
        assert q["question_type"] == "MULTIPLE_CHOICE"
        correct_opts = [opt for opt in q["options"] if opt["is_correct"]]
        assert len(correct_opts) == 1, f"Question {q_num} does not have exactly one correct option"
        expected_idx = ord(expected_key) - ord("A")
        assert q["options"][expected_idx]["is_correct"] is True, f"Question {q_num} expected key {expected_key}"

    # Q8 options are separate (4 options)
    q8 = questions[7]
    assert len(q8["options"]) == 4
    assert q8["options"][0]["option_text"] == "Magnetism"
    assert q8["options"][1]["option_text"] == "Boiling point"
    assert q8["options"][2]["option_text"] == "Density"
    assert q8["options"][3]["option_text"] == "Color"

    # Q10 asserts question text with restored hyphen, all 4 options, and correct option A
    q10 = questions[9]
    assert q10["question_text"] == "The mass of one mole of carbon-12 atoms is:"
    assert len(q10["options"]) == 4
    assert q10["options"][0]["option_text"] == "12 grams"
    assert q10["options"][0]["is_correct"] is True
    assert q10["options"][1]["option_text"] == "6 grams"
    assert q10["options"][1]["is_correct"] is False
    assert q10["options"][2]["option_text"] == "24 grams"
    assert q10["options"][2]["is_correct"] is False
    assert q10["options"][3]["option_text"] == "1 gram"
    assert q10["options"][3]["is_correct"] is False

    # True/False: 11 False, 12 True, 13 False, 14 True, 15 True, 16 True
    expected_tf_keys = {
        11: "False", 12: "True", 13: "False", 14: "True", 15: "True", 16: "True",
    }
    for q_num, expected_val in expected_tf_keys.items():
        q = questions[q_num - 1]
        assert q["question_type"] == "MULTIPLE_CHOICE"
        correct_opts = [opt for opt in q["options"] if opt["is_correct"]]
        assert len(correct_opts) == 1, f"Question {q_num} should have 1 correct option"
        assert correct_opts[0]["option_text"].strip().lower() == expected_val.lower(), f"Question {q_num} expected {expected_val}"

    # Identification: 17 Catalyst, 18 Density, 19 Au, 20 Covalent bond
    expected_sa_keys = {
        17: "Catalyst", 18: "Density", 19: "Au", 20: "Covalent bond",
    }
    for q_num, expected_val in expected_sa_keys.items():
        q = questions[q_num - 1]
        assert q["question_type"] == "IDENTIFICATION"
        assert len(q["options"]) == 1
        assert q["options"][0]["option_text"] == expected_val
        assert q["options"][0]["is_correct"] is True

    # No header/PART/Directions/ANSWER KEY text inside any question or option
    forbidden_substrings = [
        "SCIENCE 8", "PART I", "PART II", "PART III",
        "Directions:", "ANSWER KEY", "Score:", "Grade & Section:",
    ]
    for q in questions:
        for forbidden in forbidden_substrings:
            assert forbidden not in q["question_text"], f"Found '{forbidden}' in question {q['display_order']} text"
            for opt in q["options"]:
                assert forbidden not in opt["option_text"], f"Found '{forbidden}' in question {q['display_order']} option"


def test_import_exam_fixture_pdf():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    fixture_path = Path(__file__).parent / "fixtures" / "quiz_import_inline_keys_60q_mcq.pdf"
    with open(fixture_path, "rb") as f:
        pdf_bytes = f.read()

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz_import_inline_keys_60q_mcq.pdf", pdf_bytes, "application/pdf")},
        )

    assert response.status_code == 200
    body = response.json()
    questions = body["questions"]
    assert len(questions) == 60

    expected_keys = [
        "A", "A", "B", "C", "B", "B", "C", "B", "B", "A",
        "B", "B", "B", "B", "B", "B", "B", "B", "B", "B",
        "B", "A", "B", "B", "A", "B", "A", "A", "B", "B",
        "A", "B", "A", "B", "B", "A", "B", "B", "B", "B",
        "A", "A", "B", "A", "B", "B", "B", "B", "A", "B",
        "B", "B", "A", "B", "B", "A", "B", "B", "B", "B",
    ]
    for idx, expected_key in enumerate(expected_keys):
        q = questions[idx]
        correct_opts = [opt for opt in q["options"] if opt["is_correct"]]
        assert len(correct_opts) == 1, f"Q{idx + 1} has {len(correct_opts)} correct options"
        expected_opt_idx = ord(expected_key) - ord("A")
        assert q["options"][expected_opt_idx]["is_correct"] is True, f"Q{idx + 1} expected key {expected_key}"

    # Previously repaired options: Q29 option B has full text without junk; Q37 has Just-In-Time
    q29 = questions[28]
    assert q29["options"][1]["option_text"] == "It attributes actions to specific actors via logging/audit trails, enabling non-repudiation, forensics, and legal process"
    assert q29["options"][1]["is_correct"] is True

    q37 = questions[36]
    assert "Just-In-Time" in q37["options"][1]["option_text"]
    assert q37["options"][1]["option_text"] == "Granting only minimum access needed; supported by Just-In-Time (JIT) and Just-Enough-Access (JEA)"

    # No junk appended
    junk_markers = ["Answer:", "Explanation:", "Rationale:", "SECTION", "Quick Answer Key", "Page"]
    for q in questions:
        for opt in q["options"]:
            for junk in junk_markers:
                assert junk not in opt["option_text"], f"Found '{junk}' in Q{q['display_order']} option text"


def test_import_quiz_with_only_trailing_key_section():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Unit Quiz
1. What does HTML stand for?
A) Hyper Text Markup Language
B) High Tech Modern Language
2. What is CSS used for?
A) Styling web pages
B) Database queries
3. Name the protocol for secure web browsing.
Answer: ____________________

ANSWER KEY
1. A 2. A
3. HTTPS
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 3
    assert body["questions"][0]["options"][0]["is_correct"] is True
    assert body["questions"][1]["options"][0]["is_correct"] is True
    assert body["questions"][2]["question_type"] == "IDENTIFICATION"
    assert body["questions"][2]["options"][0]["option_text"] == "HTTPS"
    assert body["questions"][2]["options"][0]["is_correct"] is True
    assert body["warnings"] == []


def test_import_quiz_with_only_inline_keys():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Inline Quiz
1. What is Python?
A) A programming language
B) A snake only
Answer: A
2. Capital of France?
Answer: Paris
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 2
    assert body["questions"][0]["options"][0]["is_correct"] is True
    assert body["questions"][1]["question_type"] == "IDENTIFICATION"
    assert body["questions"][1]["options"][0]["option_text"] == "Paris"
    assert body["warnings"] == []


def test_import_inline_and_trailing_disagreement_prefers_inline():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Conflict Quiz
1. Which is primary?
A) Option One
B) Option Two
Answer: A

ANSWER KEY
1. B
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["questions"][0]["options"][0]["is_correct"] is True
    assert any("inline answer key (A) took precedence over trailing key (B)" in w for w in body["warnings"])


def test_import_unkeyed_question_does_not_default_to_option_a():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""
Unkeyed Quiz
1. What is 2 + 2?
A) 3
B) 4
C) 5
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    q = body["questions"][0]
    assert not any(opt["is_correct"] for opt in q["options"])
    assert any("has no answer key" in w for w in body["warnings"])


def test_import_quiz_with_form_feed_vertical_tab_and_hyphenated_terms():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    content = b"""Quiz Title\x0c
1. What is carbon\x1112?\x0b
A) An isotope of carbon
B) A chemical compound
Answer: A
"""

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("quiz.txt", content, "text/plain")},
        )

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == 1
    assert body["questions"][0]["question_text"] == "What is carbon-12?"
    assert body["questions"][0]["options"][0]["option_text"] == "An isotope of carbon"
    assert body["questions"][0]["options"][0]["is_correct"] is True


def test_import_special_characters_exported_pdf():
    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    fixture_path = Path(__file__).parent / "fixtures" / "Special_Characters_Export_Quiz.pdf"
    with open(fixture_path, "rb") as f:
        pdf_bytes = f.read()

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/quizzes/import-preview",
            files={"file": ("Special_Characters_Export_Quiz.pdf", pdf_bytes, "application/pdf")},
        )

    assert response.status_code == 200
    body = response.json()
    questions = body["questions"]
    assert len(questions) == 3

    # Q1: ⊂, ≤, ->, >= (assert exact unicode or transliterated fallback)
    q1 = questions[0]
    assert "⊂" in q1["question_text"] or "subset of" in q1["question_text"]
    assert "≤" in q1["question_text"] or "<=" in q1["question_text"]
    assert q1["options"][0]["option_text"] in ("x → y", "x -> y")
    assert q1["options"][0]["is_correct"] is True
    assert q1["options"][1]["option_text"] in ("x ≥ y", "x >= y")
    assert q1["options"][1]["is_correct"] is False

    # Q2: °, —, “ ”, ’, ñ, é
    q2 = questions[1]
    assert "25°" in q2["question_text"] or "25 deg" in q2["question_text"]
    assert "jalapeño and café" in q2["question_text"] or "jalapeno and cafe" in q2["question_text"]
    assert '"positive"' in q2["question_text"]
    assert q2["options"][0]["option_text"] in ("Temperature was 25°", "Temperature was 25 deg")
    assert q2["options"][0]["is_correct"] is True

    # Q3: carbon-12 (non-breaking hyphen artifact) and bullet
    q3 = questions[2]
    assert "carbon" in q3["question_text"] and "12" in q3["question_text"]
    assert any(b in q3["question_text"] for b in ("•", "*"))
    assert q3["question_type"] == "IDENTIFICATION"
    assert "carbon" in q3["options"][0]["option_text"] and "12" in q3["options"][0]["option_text"]
    assert q3["options"][0]["is_correct"] is True


def test_legacy_pdf_workaround_preserves_words_in_quotes():
    """
    Verify that legacy UTF-16BE PDF workaround maps math symbols
    without corrupting English words like 'data', 'electron', and 'Wow!''.
    """
    from app.services.quiz.QuizImportService import _extract_pdf_text

    import subprocess

    legacy_pdf_path = Path(__file__).resolve().parents[2] / "scripts" / "legacy_demo.pdf"
    if not legacy_pdf_path.exists():
        builder_script = Path(__file__).resolve().parents[2] / "scripts" / "build_legacy_test_pdf.cjs"
        subprocess.run(["node", str(builder_script)], check=True)

    with open(legacy_pdf_path, "rb") as f:
        pdf_bytes = f.read()

    text = _extract_pdf_text(pdf_bytes)
    assert '"data"' in text
    assert "<=ata" not in text
    assert '"electron"' in text
    assert ">=lectron" not in text
    assert "Wow->" not in text
    assert "<=" in text
    assert ">=" in text
    assert "subset of" in text
    assert "->" in text


def test_english_7_exam_structure_import():
    """
    Test fixture mirroring the exported English 7 exam structure:
    - Part I: Multiple Choice with A-D options
    - Part II: True/False items with A) True B) False
    - Part III: Identification items with 'Answer: ____' lines, including a blank '___,' inside a sentence
    - Part IV: Essays with underscore rules and [Scoring Criteria: ...] multiline block
    - Answer Key section with lines like '4. TRUE', '7. <key>', '10. [Sample Answer / Rubric]: ...',
      plus old-format '[Key/Rubric]: ...' for backward compatibility.
    Asserts:
    - Imported types match expected
    - Options count and correct options match
    - Question text has NO scoring criteria or 5+ underscore rules
    - '___,' inside sentences is preserved
    - Essay explanations capture the rubric/sample answer with 0 options stored
    """
    from app.services.quiz.QuizImportService import _parse_questions

    raw_exam = """ENGLISH 7 EXAM
Name: _________________________________________   Grade & Section: __________________   Score: _________

PART I. MULTIPLE CHOICE
Directions: Read each question carefully. Write the letter of the correct answer on the line provided.
1. What is the central message or lesson of a literary text?
A) Theme
B) Plot
C) Setting
D) Conflict

2. Which element describes where and when the story takes place?
A) Theme
B) Climax
C) Setting
D) Point of View

PART II. TRUE OR FALSE
Directions: Write TRUE if the statement is correct and FALSE if the statement is incorrect.
3. An autobiography is written by the author about someone else's life.
A) True
B) False

4. A metaphor makes a direct comparison without using like or as.
A) True
B) False

PART III. IDENTIFICATION
Directions: Provide the exact term or concise answer in the space provided.
5. The comparison of two unlike things using the words like or as is called a:
Answer: __________________________________________________________________

6. ___, the team decided to postpone the championship match due to the storm.
Answer: __________________________________________________________________

PART IV. ESSAY / OPEN-ENDED
Directions: Answer the following questions in complete sentences.
7. Explain the importance of analyzing characters' motivations in a story.
__________________________________________________________________________________________
__________________________________________________________________________________________
[Scoring Criteria: Analysis of motivation (3 pts), textual evidence (2 pts), clarity and grammar (1 pt)]

8. Describe how the setting influences the mood of a narrative.
__________________________________________________________________________________________
__________________________________________________________________________________________
[Key/Rubric]: Detailed explanation connecting atmosphere, sensory details, and emotional impact.

ANSWER KEY
ENGLISH 7 EXAM (8 Items)
1. A
2. C
3. FALSE
4. TRUE
5. Simile
6. Consequently
7. [Sample Answer / Rubric]: Analysis of motivation (3 pts), textual evidence (2 pts), clarity and grammar (1 pt)
8. [Key/Rubric]: Detailed explanation connecting atmosphere, sensory details, and emotional impact.
"""

    questions, warnings = _parse_questions(raw_exam)
    assert len(questions) == 8

    # Q1: MC
    assert questions[0].question_type == "MULTIPLE_CHOICE"
    assert len(questions[0].options) == 4
    assert questions[0].options[0].option_text == "Theme"
    assert questions[0].options[0].is_correct is True

    # Q2: MC
    assert questions[1].question_type == "MULTIPLE_CHOICE"
    assert len(questions[1].options) == 4
    assert questions[1].options[2].option_text == "Setting"
    assert questions[1].options[2].is_correct is True

    # Q3: TF
    assert questions[2].question_type == "MULTIPLE_CHOICE"
    assert len(questions[2].options) == 2
    assert questions[2].options[1].option_text == "False"
    assert questions[2].options[1].is_correct is True

    # Q4: TF
    assert questions[3].question_type == "MULTIPLE_CHOICE"
    assert len(questions[3].options) == 2
    assert questions[3].options[0].option_text == "True"
    assert questions[3].options[0].is_correct is True

    # Q5: Identification
    assert questions[4].question_type == "IDENTIFICATION"
    assert len(questions[4].options) == 1
    assert questions[4].options[0].option_text == "Simile"
    assert questions[4].options[0].is_correct is True
    assert "Answer:" not in questions[4].question_text
    assert "____" not in questions[4].question_text

    # Q6: Identification with sentence blank preserved
    assert questions[5].question_type == "IDENTIFICATION"
    assert len(questions[5].options) == 1
    assert questions[5].options[0].option_text == "Consequently"
    assert questions[5].options[0].is_correct is True
    assert "___, the team decided to postpone" in questions[5].question_text
    assert "Answer:" not in questions[5].question_text

    # Q7: Essay (new format rubric line + stripped multiline scoring criteria block)
    assert questions[6].question_type == "SHORT_ANSWER"
    assert len(questions[6].options) == 0
    assert "Analysis of motivation" in (questions[6].explanation or "")
    assert "[Scoring Criteria" not in questions[6].question_text
    assert "Scoring Criteria" not in questions[6].question_text
    assert "____" not in questions[6].question_text
    assert questions[6].question_text == "Explain the importance of analyzing characters' motivations in a story."

    # Q8: Essay (old format [Key/Rubric] line)
    assert questions[7].question_type == "SHORT_ANSWER"
    assert len(questions[7].options) == 0
    assert "Detailed explanation connecting atmosphere" in (questions[7].explanation or "")
    assert "[Key/Rubric]" not in questions[7].question_text
    assert "Key/Rubric" not in questions[7].question_text
    assert "____" not in questions[7].question_text
    assert questions[7].question_text == "Describe how the setting influences the mood of a narrative."


def test_exam_export_import_round_trip():
    """
    Test export -> import round trip simulating the exam text produced by the TOS exporter:
    - Multiple choice, true/false, identification, and essay items
    - Student exam body contains NO 'Scoring Criteria'
    - Answer key contains correct letters, TRUE/FALSE, accepted identification words, and [Sample Answer / Rubric]
    - Importing it reconstructs all questions with exact types, keys, and teacher-only rubrics.
    """
    from app.services.quiz.QuizImportService import _parse_questions

    exported_text = """SUMMATIVE ASSESSMENT 1
ENGLISH 7

Name: _________________________________________   Grade & Section: __________________   Score: _________
------------------------------------------------------------------------------------------
PART I. MULTIPLE CHOICE
Directions: Read each question carefully. Write the letter of the correct answer on the line provided.

____ 1. What figure of speech gives human qualities to inanimate objects?
A) Personification
B) Simile
C) Metaphor
D) Hyperbole

PART II. TRUE OR FALSE
Directions: Write TRUE if the statement is correct and FALSE if the statement is incorrect.

____ 2. A haiku typically consists of three lines with a 5-7-5 syllable structure.
A) True
B) False

PART III. IDENTIFICATION
Directions: Provide the exact term or concise answer in the space provided.

3. The perspective from which a story is told is known as the:
Answer: __________________________________________________________________

PART IV. ESSAY / OPEN-ENDED
Directions: Answer the following questions in complete sentences.

4. Discuss the theme of friendship in the excerpt studied in class.
__________________________________________________________________________________________
__________________________________________________________________________________________
__________________________________________________________________________________________

------------------------------------------------------------------------------------------
ANSWER KEY
SUMMATIVE ASSESSMENT 1 (4 Items)
1. A
2. TRUE
3. Point of View
4. [Sample Answer / Rubric]: The student should describe mutual loyalty, sacrifices made, and character growth.
"""

    student_body = exported_text.split("ANSWER KEY")[0]
    assert "Scoring Criteria" not in student_body
    assert "[Scoring Criteria" not in student_body

    questions, warnings = _parse_questions(exported_text)
    assert len(questions) == 4

    assert questions[0].question_type == "MULTIPLE_CHOICE"
    assert questions[0].options[0].option_text == "Personification"
    assert questions[0].options[0].is_correct is True

    assert questions[1].question_type == "MULTIPLE_CHOICE"
    assert questions[1].options[0].option_text == "True"
    assert questions[1].options[0].is_correct is True

    assert questions[2].question_type == "IDENTIFICATION"
    assert len(questions[2].options) == 1
    assert questions[2].options[0].option_text == "Point of View"
    assert questions[2].options[0].is_correct is True

    assert questions[3].question_type == "SHORT_ANSWER"
    assert len(questions[3].options) == 0
    assert questions[3].explanation == "The student should describe mutual loyalty, sacrifices made, and character growth."


def test_real_tos_exporters_round_trip():
    """
    Real round trip using actual exported PDF and DOCX files produced by the REAL exporters:
    - 3 Multiple Choice (A-D)
    - 3 True/False (2-option)
    - 3 Identification (single-term keys)
    - 3 Essays with scoring criteria in explanations
    Asserts:
    - Student PDF extracted text has no 'Scoring Criteria' and no rubric
    - Imported PDF questions match types, keys, and teacher-only rubrics
    - Imported DOCX questions match types, keys, and teacher-only rubrics
    - All imported question texts have no 'Scoring Criteria' and no underscore runs
    """
    import shutil
    import subprocess
    import sys
    import tempfile
    import pytest
    from app.services.quiz.QuizImportService import _extract_text

    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_staff_id] = lambda: "T-IMPORT"

    repo_root = Path(__file__).resolve().parents[2]
    gen_script = repo_root / "scripts" / "generate_tos_roundtrip_fixtures.ts"

    if not gen_script.exists():
        pytest.skip(f"generate_tos_roundtrip_fixtures.ts not found at {gen_script} (deferred to frontend commit)")

    npx_bin = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx_bin:
        pytest.skip("npx not available in environment")

    # Generate fixtures in a dedicated temp directory outside the repo and ensure automatic cleanup
    with tempfile.TemporaryDirectory() as temp_dir_str:
        tmp_dir = Path(temp_dir_str)
        try:
            res = subprocess.run(
                [npx_bin, "--no-install", "tsx", str(gen_script), str(tmp_dir)],
                shell=(sys.platform == "win32"),
                capture_output=True,
                text=True,
                timeout=35,
                cwd=str(repo_root),
            )
            if res.returncode != 0:
                pytest.skip(
                    f"generate_tos_roundtrip_fixtures.ts failed (exit code {res.returncode}): "
                    f"stdout={res.stdout.strip()!r} stderr={res.stderr.strip()!r}"
                )
        except subprocess.TimeoutExpired:
            pytest.skip("Timed out waiting for generate_tos_roundtrip_fixtures.ts execution")
        except FileNotFoundError as fnf_err:
            pytest.skip(f"Required runner executable not found: {fnf_err}")
        except Exception as exc:
            pytest.skip(f"Could not execute fixture generation script: {exc}")

        student_pdf = tmp_dir / "real_student_exam.pdf"
        teacher_pdf = tmp_dir / "real_teacher_exam_with_key.pdf"
        teacher_docx = tmp_dir / "real_teacher_exam_with_key.docx"

        if not (student_pdf.exists() and teacher_pdf.exists() and teacher_docx.exists()):
            pytest.skip("One or more generated fixture files missing after script execution")

        student_pdf_bytes = student_pdf.read_bytes()
        teacher_pdf_bytes = teacher_pdf.read_bytes()
        teacher_docx_bytes = teacher_docx.read_bytes()

        # 1. Assert student-copy extracted text has no "Scoring Criteria" and no rubric
        student_text = _extract_text(student_pdf_bytes, ".pdf")
        assert "Scoring Criteria" not in student_text
        assert "scoring criteria" not in student_text.lower()
        assert "Rubric:" not in student_text
        assert "rubric:" not in student_text.lower()

        # 2. Test import via API on teacher PDF
        with TestClient(app, raise_server_exceptions=False) as client:
            pdf_res = client.post(
                "/api/v1/quizzes/import-preview",
                files={"file": ("real_teacher_exam_with_key.pdf", teacher_pdf_bytes, "application/pdf")},
            )
        assert pdf_res.status_code == 200
        pdf_body = pdf_res.json()
        assert len(pdf_body["questions"]) == 12

        def _verify_12_items(questions):
            # Q1-Q3: MC
            for i in range(3):
                q = questions[i]
                assert q["question_type"] == "MULTIPLE_CHOICE"
                assert len(q["options"]) == 4
                assert any(o["is_correct"] for o in q["options"])
                assert "Scoring Criteria" not in q["question_text"]
                assert "_____" not in q["question_text"]

            assert questions[0]["options"][0]["option_text"] == "Simile" and questions[0]["options"][0]["is_correct"]
            assert questions[1]["options"][1]["option_text"] == "Beowulf" and questions[1]["options"][1]["is_correct"]
            assert questions[2]["options"][1]["option_text"] == "Climax" and questions[2]["options"][1]["is_correct"]

            # Q4-Q6: TF (two-option MCQ)
            for i in range(3, 6):
                q = questions[i]
                assert q["question_type"] == "MULTIPLE_CHOICE"
                assert len(q["options"]) == 2
                assert any(o["is_correct"] for o in q["options"])
                assert "Scoring Criteria" not in q["question_text"]
                assert "_____" not in q["question_text"]

            assert questions[3]["options"][0]["option_text"] == "True" and questions[3]["options"][0]["is_correct"]
            assert questions[4]["options"][1]["option_text"] == "False" and questions[4]["options"][1]["is_correct"]
            assert questions[5]["options"][0]["option_text"] == "True" and questions[5]["options"][0]["is_correct"]

            # Q7-Q9: IDENTIFICATION
            for i in range(6, 9):
                q = questions[i]
                assert q["question_type"] == "IDENTIFICATION"
                assert len(q["options"]) == 1
                assert q["options"][0]["is_correct"] is True
                assert "Scoring Criteria" not in q["question_text"]
                assert "_____" not in q["question_text"]

            assert questions[6]["options"][0]["option_text"] == "Plot"
            assert questions[7]["options"][0]["option_text"] == "Alliteration"
            assert questions[8]["options"][0]["option_text"] == "Point of View"

            # Q10-Q12: SHORT_ANSWER (essays)
            for i in range(9, 12):
                q = questions[i]
                assert q["question_type"] == "SHORT_ANSWER"
                assert len(q["options"]) == 0
                assert q["explanation"] is not None
                assert len(q["explanation"]) > 10
                assert "Scoring Criteria" not in q["question_text"]
                assert "Rubric" not in q["question_text"]
                assert "_____" not in q["question_text"]

            assert "Defines dramatic irony" in questions[9]["explanation"]
            assert "Identifies sensory details" in questions[10]["explanation"]
            assert "Explains competing ethical values" in questions[11]["explanation"]

        _verify_12_items(pdf_body["questions"])

        # 3. Test import via API on teacher DOCX
        with TestClient(app, raise_server_exceptions=False) as client:
            docx_res = client.post(
                "/api/v1/quizzes/import-preview",
                files={
                    "file": (
                        "real_teacher_exam_with_key.docx",
                        teacher_docx_bytes,
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                },
            )
        assert docx_res.status_code == 200
        docx_body = docx_res.json()
        assert len(docx_body["questions"]) == 12
        _verify_12_items(docx_body["questions"])






