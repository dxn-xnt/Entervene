"""
tests/test_identification_short_answer.py

Comprehensive tests for:
1. Normalization helper (Unicode NFKC, casefold, trim, collapse whitespace, strip punctuation)
2. AI Quiz Generator (IDENTIFICATION key required, unkeyed discarded, SHORT_ANSWER options=[], explanation rubric, dog/ball test)
3. QuizBuilderService (draft allowed with unkeyed IDENTIFICATION, publish blocked, blank options treated as missing, SHORT_ANSWER options ignored)
4. QuizAttemptService (IDENTIFICATION auto-graded, SHORT_ANSWER manual)
5. QuizImportService (keyed imports -> IDENTIFICATION, unkeyed -> SHORT_ANSWER)
"""
import json
import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission

from app.schemas.Quiz import (
    QuizBuilderUpsert,
    QuizOptionIn,
    QuizQuestionIn,
    QuizSettingIn,
    QuizAnswerIn,
    QuizSubmitRequest,
)
from app.services.ai.AIQuizGeneratorService import _extract_and_validate_json
from app.services.ai.AITOSGeneratorService import _extract_and_validate_tos_json
from app.services.quiz.QuizAttemptService import submit_student_quiz_attempt
from app.services.quiz.QuizBuilderService import (
    build_quiz_response,
    get_quiz_for_classwork,
    quiz_readiness,
    upsert_quiz_builder,
    validate_quiz_payload,
)
from app.services.quiz.QuizImportService import _parse_questions
from app.services.quiz.quiz_normalization import (
    is_identification_correct,
    normalize_answer,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    Class.__table__,
    StudentClass.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    Quiz.__table__,
    QuizSetting.__table__,
    Question.__table__,
    QuestionOption.__table__,
    QuizQuestion.__table__,
    QuizAnswer.__table__,
]


# ============================================================================
# 1. NORMALIZATION TESTS
# ============================================================================

def test_normalization_the_dog_vs_dog():
    norm_the_dog = normalize_answer("The Dog.")
    norm_dog = normalize_answer("dog")
    assert norm_the_dog == "the dog"
    assert norm_dog == "dog"
    assert norm_the_dog != norm_dog
    assert is_identification_correct("The Dog.", ["dog"]) is False
    assert is_identification_correct("the dog", ["The Dog."]) is True
    assert is_identification_correct("The Dog.", ["The Dog."]) is True
    assert is_identification_correct("The Dog.", ["dog", "the dog"]) is True


def test_normalization_double_spaces():
    raw = "  Multiple   spaces   between   words  "
    assert normalize_answer(raw) == "multiple spaces between words"
    assert is_identification_correct("  Multiple   spaces   ", ["multiple spaces"]) is True
    assert is_identification_correct("  Covalent   bond ", ["covalent bond"]) is True


def test_normalization_accents():
    decomposed = "cafe\u0301"  # e + combining acute
    precomposed = "caf\u00e9"  # precomposed é
    assert normalize_answer(decomposed) == normalize_answer(precomposed)
    assert is_identification_correct(decomposed, [precomposed]) is True


def test_normalization_trailing_punctuation_and_quotes():
    # Trailing sentence punctuation (. , ; : ! ?) and matching surrounding quotes stripped
    assert normalize_answer("Au.") == "au"
    assert is_identification_correct("Au.", ["au"]) is True
    assert is_identification_correct('"covalent bond"', ["covalent bond"]) is True
    assert is_identification_correct("'Au'", ["au"]) is True
    assert is_identification_correct("“covalent bond”", ["covalent bond"]) is True
    assert is_identification_correct("gravity!", ["gravity"]) is True
    assert is_identification_correct("gravity?", ["gravity"]) is True
    # Stray quotes like 5' must NOT be stripped and must not match 5
    assert normalize_answer("5'") == "5'"
    assert not is_identification_correct("5'", ["5"])


def test_normalization_superscripts_and_subscripts():
    # Runs of superscripts converted to ^... and subscripts converted to plain digits
    assert normalize_answer("10²") == "10^2"
    assert normalize_answer("10¹²") == "10^12"
    assert normalize_answer("x²") == "x^2"
    assert normalize_answer("m/s²") == "m/s^2"
    assert normalize_answer("H₂O") == "h2o"
    # Matches
    assert is_identification_correct("10²", ["10^2"]) is True
    assert is_identification_correct("H₂O", ["H2O"]) is True
    assert is_identification_correct("m/s²", ["m/s^2"]) is True
    # Must NOT match
    assert not is_identification_correct("10²", ["102"])
    assert not is_identification_correct("x²", ["x2"])
    assert not is_identification_correct("m/s²", ["m/s2"])
    assert normalize_answer("10²") != normalize_answer("102")
    assert normalize_answer("x²") != normalize_answer("x2")
    assert normalize_answer("m/s²") != normalize_answer("m/s2")


def test_normalization_preserves_meaningful_symbols_and_signs():
    # Signs, brackets, parentheses, %, ^, /, =, <, >, <=, >=, ∞, √, formulas must NOT match
    assert not is_identification_correct("-5", ["5"])
    assert not is_identification_correct("(4, ∞)", ["[4, ∞)"])
    assert not is_identification_correct("50%", ["50"])
    assert not is_identification_correct("x ≥ 3", ["x ≤ 3"])
    assert not is_identification_correct("H2O", ["H2O2"])
    # Also verify direct normalizations differ
    assert normalize_answer("-5") != normalize_answer("5")
    assert normalize_answer("(4, ∞)") != normalize_answer("[4, ∞)")
    assert normalize_answer("50%") != normalize_answer("50")
    assert normalize_answer("x ≥ 3") != normalize_answer("x ≤ 3")
    assert normalize_answer("H2O") != normalize_answer("H2O2")



def test_normalization_empty_strings():
    assert normalize_answer("") == ""
    assert normalize_answer("   ") == ""
    assert normalize_answer(None) == ""
    assert is_identification_correct("", ["dog"]) is False
    assert is_identification_correct("   ", ["dog"]) is False
    assert is_identification_correct(None, ["dog"]) is False
    assert is_identification_correct("dog", ["", "   "]) is False


def test_normalization_wrong_answers_fail():
    assert is_identification_correct("cat", ["dog"]) is False
    assert is_identification_correct("almost dog", ["dog"]) is False
    assert is_identification_correct("dogs", ["dog"]) is False



# ============================================================================
# 2. AI GENERATOR TESTS
# ============================================================================

def test_ai_generator_identification_with_key_accepted():
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "What is the chemical symbol for gold?",
                "question_type": "IDENTIFICATION",
                "options": [
                    {"option_text": "Au", "is_correct": True, "option_order": 1}
                ],
                "explanation": "Au comes from the Latin word aurum.",
            }
        ]
    })
    questions = _extract_and_validate_json(raw_response)
    assert len(questions) == 1
    assert questions[0]["question_type"] == "IDENTIFICATION"
    assert len(questions[0]["options"]) == 1
    assert questions[0]["options"][0]["option_text"] == "Au"
    assert questions[0]["options"][0]["is_correct"] is True


def test_ai_generator_identification_with_no_key_discarded():
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "What is the term for a substance's resistance to flow?",
                "question_type": "IDENTIFICATION",
                "options": [],
                "explanation": "Viscosity is the resistance to flow.",
            },
            {
                "question_text": "What is 2 + 2?",
                "question_type": "IDENTIFICATION",
                "options": [
                    {"option_text": "4", "is_correct": True, "option_order": 1}
                ],
            },
        ]
    })
    questions = _extract_and_validate_json(raw_response)
    # The first unkeyed IDENTIFICATION question must be discarded
    assert len(questions) == 1
    assert questions[0]["question_text"] == "What is 2 + 2?"


def test_ai_generator_short_answer_options_empty_and_explanation():
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "Explain Newton's third law of motion.",
                "question_type": "SHORT_ANSWER",
                "options": [
                    {"option_text": "Action and reaction are equal and opposite", "is_correct": True, "option_order": 1}
                ],
                "explanation": "Student must explain action-reaction pairs.",
            }
        ]
    })
    questions = _extract_and_validate_json(raw_response)
    assert len(questions) == 1
    assert questions[0]["question_type"] == "SHORT_ANSWER"
    # Options must be forced to []
    assert questions[0]["options"] == []
    # Sample answer appended to explanation
    assert "Student must explain action-reaction pairs." in questions[0]["explanation"]
    assert "Sample answer: Action and reaction are equal and opposite" in questions[0]["explanation"]


def test_ai_generator_identification_accepts_explicit_answer_field():
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "Identify the noun in the sentence: 'The dog chased the ball.'",
                "question_type": "IDENTIFICATION",
                "answer": "dog",
                "options": [],
                "explanation": "Grammar concept.",
            }
        ]
    })
    questions = _extract_and_validate_json(raw_response)
    assert len(questions) == 1
    assert questions[0]["question_type"] == "IDENTIFICATION"
    assert len(questions[0]["options"]) == 1
    assert questions[0]["options"][0]["option_text"] == "dog"
    assert questions[0]["options"][0]["is_correct"] is True


def test_ai_generator_warnings_appended_for_discarded_questions():
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "Unkeyed identification question",
                "question_type": "IDENTIFICATION",
                "options": [],
                "explanation": "Answer trapped in explanation.",
            },
            {
                "question_text": "What is 1 + 1?",
                "question_type": "IDENTIFICATION",
                "options": [{"option_text": "2", "is_correct": True}],
            },
        ]
    })
    warnings = []
    questions = _extract_and_validate_json(raw_response, warnings=warnings)
    assert len(questions) == 1
    assert any("1 question(s) discarded: no answer key" in w for w in warnings)


def test_tos_generator_identification_accepts_short_answer_and_discards_explanation_only():
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "What force pulls masses together?",
                "question_type": "IDENTIFICATION",
                "answer": "gravity",
                "options": [],
            },
            {
                "question_text": "Explain friction.",
                "question_type": "IDENTIFICATION",
                "options": [],
                "explanation": "Friction opposes motion.",
            },
        ]
    })
    questions = _extract_and_validate_tos_json(raw_response)
    # The first question recovers "gravity", the second is discarded because it has no options or explicit answer
    assert len(questions) == 1
    assert questions[0]["question_text"] == "What force pulls masses together?"
    assert questions[0]["options"][0]["option_text"] == "gravity"


def test_ai_generator_dog_ball_mocked_llm_discarded():
    """
    Mocked LLM test for:
    "Identify the noun in the sentence: 'The dog chased the ball.'"
    where the answer is only in the explanation and options is [].
    Because there is no valid key in options or explicit answer field,
    and explanation is an explanatory sentence, this question is discarded.
    """
    raw_response = json.dumps({
        "questions": [
            {
                "question_text": "Identify the noun in the sentence: 'The dog chased the ball.'",
                "question_type": "IDENTIFICATION",
                "options": [],
                "explanation": "'dog' and 'ball' are nouns.",
            }
        ]
    })
    with pytest.raises(HTTPException) as exc_info:
        _extract_and_validate_json(raw_response)
    assert exc_info.value.status_code == 502  # All questions discarded -> 502



# ============================================================================
# 3. BUILDER SERVICE TESTS
# ============================================================================

@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    teacher_account = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test", password_hash="x")
    student_account = UserAccount(user_id=uuid.uuid4(), email="student@example.test", password_hash="x")
    db.add_all([teacher_account, student_account])
    db.flush()

    teacher = AcademicStaff(
        staff_id="T-001",
        first_name="Maria",
        last_name="Santos",
        user_id=teacher_account.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Dela Cruz",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    subject = Subject(subject_name="Science 7", academic_level_id=level.academic_level_id)
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([teacher, student, subject, class_])
    db.flush()

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    cw = Classwork(
        title="Sample Quiz",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    db.add(cw)
    db.flush()

    assignment = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=class_.class_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
        max_attempts=2,
    )
    db.add(assignment)
    db.flush()

    yield {
        "db": db,
        "classwork": cw,
        "assignment": assignment,
        "student": student,
        "teacher": teacher,
    }
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_builder_draft_save_allowed_when_unkeyed(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    payload = QuizBuilderUpsert(
        status="DRAFT",
        questions=[
            QuizQuestionIn(
                question_text="Name the capital of France.",
                question_type="IDENTIFICATION",
                points=10.0,
                display_order=1,
                options=[],  # Unkeyed IDENTIFICATION in DRAFT mode
            )
        ],
    )
    # Draft save must be allowed
    resp = upsert_quiz_builder(db, cw, payload)
    assert resp.status == "DRAFT"
    assert resp.total_items == 1
    assert resp.is_publish_ready is False
    assert any("Identification question with no answer key" in err for err in resp.readiness_errors)


def test_builder_publish_blocked_when_unkeyed(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    payload = QuizBuilderUpsert(
        status="PUBLISHED",
        questions=[
            QuizQuestionIn(
                question_text="Name the capital of France.",
                question_type="IDENTIFICATION",
                points=10.0,
                display_order=1,
                options=[],  # Keyless IDENTIFICATION
            )
        ],
    )
    # Publishing directly with unkeyed IDENTIFICATION must raise 400
    with pytest.raises(HTTPException) as exc_info:
        upsert_quiz_builder(db, cw, payload)
    assert exc_info.value.status_code == 400
    assert any("Identification question with no answer key" in err for err in exc_info.value.detail)


def test_builder_blank_options_treated_as_missing(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    payload = QuizBuilderUpsert(
        status="DRAFT",
        questions=[
            QuizQuestionIn(
                question_text="Name the capital of France.",
                question_type="IDENTIFICATION",
                points=10.0,
                display_order=1,
                options=[
                    QuizOptionIn(option_text="   ", is_correct=True, option_order=1)
                ],
            )
        ],
    )
    resp = upsert_quiz_builder(db, cw, payload)
    # Blank option must NOT be saved in database
    options_in_db = db.query(QuestionOption).all()
    assert len(options_in_db) == 0
    assert resp.is_publish_ready is False


def test_builder_short_answer_with_keys_coerced_save_draft(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    payload = QuizBuilderUpsert(
        status="DRAFT",
        questions=[
            QuizQuestionIn(
                question_text="What is the powerhouse of the cell?",
                question_type="SHORT_ANSWER",
                points=10.0,
                display_order=1,
                options=[
                    QuizOptionIn(option_text="Mitochondria", is_correct=True, option_order=1)
                ],
            )
        ],
    )
    resp = upsert_quiz_builder(db, cw, payload)
    assert resp.total_items == 1
    # Coerced to IDENTIFICATION so answer keys are not lost
    assert resp.questions[0].question_type == "IDENTIFICATION"
    q_in_db = db.query(Question).first()
    assert q_in_db.question_type == "IDENTIFICATION"
    options_in_db = db.query(QuestionOption).filter_by(question_id=q_in_db.question_id).all()
    assert len(options_in_db) == 1
    assert options_in_db[0].option_text == "Mitochondria"
    assert options_in_db[0].is_correct is True


def test_builder_short_answer_with_keys_coerced_publish(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    payload = QuizBuilderUpsert(
        status="PUBLISHED",
        questions=[
            QuizQuestionIn(
                question_text="What is the powerhouse of the cell?",
                question_type="SHORT_ANSWER",
                points=10.0,
                display_order=1,
                options=[
                    QuizOptionIn(option_text="Mitochondria", is_correct=True, option_order=1)
                ],
            )
        ],
    )
    resp = upsert_quiz_builder(db, cw, payload)
    # Coerced to IDENTIFICATION, passes publish readiness check, published successfully
    assert resp.status == "PUBLISHED"
    assert resp.is_publish_ready is True
    assert resp.questions[0].question_type == "IDENTIFICATION"
    q_in_db = db.query(Question).first()
    assert q_in_db.question_type == "IDENTIFICATION"


def test_builder_unkeyed_short_answer_remains_short_answer(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    payload = QuizBuilderUpsert(
        status="PUBLISHED",
        questions=[
            QuizQuestionIn(
                question_text="Explain cell division.",
                question_type="SHORT_ANSWER",
                points=10.0,
                display_order=1,
                explanation="Mitosis and meiosis comparison rubric.",
                options=[],
            )
        ],
    )
    resp = upsert_quiz_builder(db, cw, payload)
    assert resp.total_items == 1
    assert resp.status == "PUBLISHED"
    assert resp.is_publish_ready is True
    assert resp.questions[0].question_type == "SHORT_ANSWER"
    q_in_db = db.query(Question).first()
    assert q_in_db.question_type == "SHORT_ANSWER"
    options_in_db = db.query(QuestionOption).filter_by(question_id=q_in_db.question_id).all()
    assert len(options_in_db) == 0



# ============================================================================
# 4. ATTEMPT SERVICE TESTS
# ============================================================================

def test_attempt_identification_auto_graded(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    assignment = db_session["assignment"]
    student = db_session["student"]

    payload = QuizBuilderUpsert(
        status="PUBLISHED",
        questions=[
            QuizQuestionIn(
                question_text="What is the chemical symbol for gold?",
                question_type="IDENTIFICATION",
                points=10.0,
                display_order=1,
                options=[
                    QuizOptionIn(option_text="Au", is_correct=True, option_order=1),
                    QuizOptionIn(option_text="Gold", is_correct=True, option_order=2),
                ],
            )
        ],
    )
    upsert_quiz_builder(db, cw, payload)

    quiz = db.query(Quiz).filter(Quiz.classwork_id == cw.classwork_id).first()
    qq = quiz.questions[0]

    # Test correct student answer (normalized match: "  au.  " matches "Au")
    submit_payload = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=qq.quiz_question_id,
                answer_text="  au.  ",
            )
        ]
    )
    res = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, submit_payload)
    assert res.grade == 10.0
    assert res.status == "graded"


def test_attempt_short_answer_manual_graded(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    assignment = db_session["assignment"]
    student = db_session["student"]

    payload = QuizBuilderUpsert(
        status="PUBLISHED",
        questions=[
            QuizQuestionIn(
                question_text="Explain gravity.",
                question_type="SHORT_ANSWER",
                points=10.0,
                display_order=1,
                explanation="Rubric: explains attraction between masses.",
                options=[],
            )
        ],
    )
    upsert_quiz_builder(db, cw, payload)

    quiz = db.query(Quiz).filter(Quiz.classwork_id == cw.classwork_id).first()
    qq = quiz.questions[0]

    submit_payload = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=qq.quiz_question_id,
                answer_text="Gravity pulls masses together.",
            )
        ]
    )
    res = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, submit_payload)
    # Must require manual grading -> status="submitted", grade not yet finalized
    assert res.status == "submitted"

    ans = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans.is_correct is None
    assert ans.points_awarded is None


def test_attempt_identification_unkeyed_goes_to_manual_grading(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]
    assignment = db_session["assignment"]
    student = db_session["student"]

    # Create a quiz with an IDENTIFICATION question that has NO keys (zero options)
    quiz = Quiz(classwork_id=cw.classwork_id, total_items=1, status="PUBLISHED")
    db.add(quiz)
    db.flush()
    q = Question(
        question_text="Unkeyed identification question.",
        question_type="IDENTIFICATION",
        points=Decimal("10.0"),
        is_ai_generated=False,
    )
    db.add(q)
    db.flush()
    qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=1)
    db.add(qq)
    db.flush()

    submit_payload = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=qq.quiz_question_id,
                answer_text="Student wrote something valid",
            )
        ]
    )
    res = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, submit_payload)
    # Must route to manual grading (status="submitted"), never auto-fail every student
    assert res.status == "submitted"
    ans = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans.is_correct is None
    assert ans.points_awarded is None



# ============================================================================
# 5. IMPORT SERVICE TESTS
# ============================================================================

def test_import_keyed_becomes_identification():
    content = """
    1. What is the chemical symbol for gold?
    Answer: Au
    """
    questions, warnings = _parse_questions(content)
    assert len(questions) == 1
    assert questions[0].question_type == "IDENTIFICATION"
    assert len(questions[0].options) == 1
    assert questions[0].options[0].option_text == "Au"
    assert questions[0].options[0].is_correct is True


def test_import_unkeyed_remains_short_answer():
    content = """
    1. Explain Newton's first law of motion.
    """
    questions, warnings = _parse_questions(content)
    assert len(questions) == 1
    assert questions[0].question_type == "SHORT_ANSWER"
    assert questions[0].options == []


def test_normalization_minus_and_fraction_slashes():
    # U+2212 mathematical minus sign folds to '-'
    assert normalize_answer("−5") == "-5"
    assert normalize_answer("-5") == "-5"
    assert is_identification_correct("−5", ["-5"]) is True
    assert is_identification_correct("-5", ["−5"]) is True
    # -5 vs 5 must NOT match
    assert is_identification_correct("−5", ["5"]) is False
    assert is_identification_correct("-5", ["5"]) is False

    # U+2044 fraction slash (produced by NFKC on ½) folds to '/'
    assert normalize_answer("½") == "1/2"
    assert normalize_answer("1/2") == "1/2"
    assert is_identification_correct("½", ["1/2"]) is True
    assert is_identification_correct("1/2", ["½"]) is True
    assert is_identification_correct("½", ["1"]) is False


def test_quiz_builder_is_ai_generated_round_trip(db_session):
    db = db_session["db"]
    cw = db_session["classwork"]

    payload = QuizBuilderUpsert(
        duration_minutes=30,
        status="DRAFT",
        settings=QuizSettingIn(),
        questions=[
            QuizQuestionIn(
                question_text="AI Generated Question",
                question_type="IDENTIFICATION",
                points=2.0,
                display_order=1,
                is_ai_generated=True,
                options=[QuizOptionIn(option_text="Answer A", is_correct=True, option_order=1)],
            ),
            QuizQuestionIn(
                question_text="Manual Teacher Question",
                question_type="IDENTIFICATION",
                points=2.0,
                display_order=2,
                is_ai_generated=False,
                options=[QuizOptionIn(option_text="Answer B", is_correct=True, option_order=1)],
            ),
        ],
    )
    # Upsert quiz
    upserted = upsert_quiz_builder(db, cw, payload)
    assert len(upserted.questions) == 2
    assert upserted.questions[0].is_ai_generated is True
    assert upserted.questions[1].is_ai_generated is False

    # Fetch quiz via build_quiz_response (used by GET /quizzes/classwork/{id})
    quiz = get_quiz_for_classwork(db, cw.classwork_id)
    fetched = build_quiz_response(db, cw, quiz)
    assert len(fetched.questions) == 2
    assert fetched.questions[0].is_ai_generated is True
    assert fetched.questions[1].is_ai_generated is False

    # Check database rows directly
    quiz = db.query(Quiz).filter(Quiz.classwork_id == cw.classwork_id).first()
    links = sorted(quiz.questions, key=lambda l: l.display_order)
    assert links[0].question.is_ai_generated is True
    assert links[1].question.is_ai_generated is False


def test_keyed_legacy_short_answer_auto_graded_before_and_after_migration(db_session):
    """Grading must not depend on deploy order:
    A SHORT_ANSWER question with answer keys in options must auto-grade before migration,
    and give the exact same auto-grading result after migration promotes it to IDENTIFICATION.
    """
    db = db_session["db"]
    cw = db_session["classwork"]
    assignment = db_session["assignment"]
    student = db_session["student"]

    # 1. Simulate legacy state before 20261003b:
    # question_type is "SHORT_ANSWER" in DB, but has correct-marked options.
    quiz = Quiz(classwork_id=cw.classwork_id, total_items=1, status="PUBLISHED")
    db.add(quiz)
    db.flush()

    legacy_q = Question(
        question_text="What is the powerhouse of the cell?",
        question_type="SHORT_ANSWER",
        points=Decimal("5.0"),
        is_ai_generated=False,
    )
    db.add(legacy_q)
    db.flush()

    opt = QuestionOption(
        question_id=legacy_q.question_id,
        option_text="Mitochondria",
        is_correct=True,
        option_order=1,
    )
    db.add(opt)
    qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=legacy_q.question_id, display_order=1)
    db.add(qq)
    db.commit()

    # Before migration: Submit correct answer -> auto-graded to 5.0
    payload_correct = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=qq.quiz_question_id,
                answer_text="  mitochondria.  ",
            )
        ]
    )
    res_before_correct = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, payload_correct)
    assert res_before_correct.status == "graded"
    assert res_before_correct.grade == 5.0
    ans_row = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans_row.is_correct is True
    assert ans_row.points_awarded == Decimal("5.0")

    # Before migration: Submit wrong answer -> auto-graded to 0.0
    payload_wrong = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=qq.quiz_question_id,
                answer_text="Ribosome",
            )
        ]
    )
    res_before_wrong = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, payload_wrong)
    assert res_before_wrong.status == "graded"
    assert res_before_wrong.grade == 0.0
    ans_row = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans_row.is_correct is False
    assert ans_row.points_awarded == Decimal("0.0")

    # 2. Simulate 20261003b data migration running:
    # question_type is updated to "IDENTIFICATION"
    legacy_q.question_type = "IDENTIFICATION"
    sub = db.query(StudentSubmission).filter_by(student_id=student.student_id).first()
    if sub:
        sub.attempt_count = 0
    db.commit()

    # After migration: Submit correct answer -> auto-graded identically
    res_after_correct = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, payload_correct)
    assert res_after_correct.status == "graded"
    assert res_after_correct.grade == 5.0
    ans_row = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans_row.is_correct is True
    assert ans_row.points_awarded == Decimal("5.0")

    # Reset attempt count to test wrong answer after migration
    sub.attempt_count = 0
    db.commit()

    # After migration: Submit wrong answer -> auto-graded identically
    res_after_wrong = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, payload_wrong)
    assert res_after_wrong.status == "graded"
    assert res_after_wrong.grade == 0.0
    ans_row = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans_row.is_correct is False
    assert ans_row.points_awarded == Decimal("0.0")


def test_unkeyed_legacy_short_answer_stays_manual(db_session):
    """An unkeyed SHORT_ANSWER question must always route to manual grading."""
    db = db_session["db"]
    cw = db_session["classwork"]
    assignment = db_session["assignment"]
    student = db_session["student"]

    quiz = Quiz(classwork_id=cw.classwork_id, total_items=1, status="PUBLISHED")
    db.add(quiz)
    db.flush()

    unkeyed_q = Question(
        question_text="Discuss the economic impact of the industrial revolution.",
        question_type="SHORT_ANSWER",
        points=Decimal("10.0"),
        is_ai_generated=False,
    )
    db.add(unkeyed_q)
    db.flush()

    qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=unkeyed_q.question_id, display_order=1)
    db.add(qq)
    db.commit()

    payload = QuizSubmitRequest(
        answers=[
            QuizAnswerIn(
                quiz_question_id=qq.quiz_question_id,
                answer_text="The industrial revolution led to rapid urbanization and mechanized production.",
            )
        ]
    )
    res = submit_student_quiz_attempt(db, student, assignment.classwork_assignment_id, payload)
    assert res.status == "submitted"
    ans_row = db.query(QuizAnswer).filter_by(quiz_question_id=qq.quiz_question_id).first()
    assert ans_row.is_correct is None
    assert ans_row.points_awarded is None



