"""
backend/tests/test_tos_migration.py

Tests for reshuffle_tos_exam.py migration script using an in-memory SQLite database.
Verifies:
1. Script refuses --commit unless --confirm-db matches target database.
2. Dry-run inspection leaves the database completely untouched.
3. Passing the same --seed produces 100% identical shuffled results twice.
4. Opt-in commit with matching --confirm-db commits valid permutations, preserving correct option text.
5. Questions with position-dependent options are safely skipped.
"""
import json
import pytest
from sqlalchemy import create_engine, text
from scripts.reshuffle_tos_exam import reshuffle_exam_questions


@pytest.fixture
def in_memory_db():
    # Use unique in-memory SQLite URI per test
    import uuid
    db_name = f"test_db_{uuid.uuid4().hex}"
    db_url = f"sqlite:///file:{db_name}?mode=memory&cache=shared&uri=true"
    engine = create_engine(db_url)

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE tos_exam (
                tos_exam_id INTEGER PRIMARY KEY,
                title TEXT
            );
        """))
        conn.execute(text("""
            CREATE TABLE tos_question (
                tos_question_id INTEGER PRIMARY KEY,
                tos_exam_id INTEGER,
                display_order INTEGER,
                question_text TEXT,
                question_type TEXT,
                options_json TEXT
            );
        """))

        conn.execute(text("INSERT INTO tos_exam (tos_exam_id, title) VALUES (1, 'Sample Assessment')"))

        # Q1: All-A bias (Option A correct)
        opts1 = [
            {"option_text": "Correct Answer A", "is_correct": True, "option_order": 1},
            {"option_text": "Wrong B", "is_correct": False, "option_order": 2},
            {"option_text": "Wrong C", "is_correct": False, "option_order": 3},
            {"option_text": "Wrong D", "is_correct": False, "option_order": 4},
        ]
        # Q2: Lowercase math variables (should shuffle)
        opts2 = [
            {"option_text": "a and b are real numbers", "is_correct": True, "option_order": 1},
            {"option_text": "a or b", "is_correct": False, "option_order": 2},
            {"option_text": "c and d are constants", "is_correct": False, "option_order": 3},
            {"option_text": "none", "is_correct": False, "option_order": 4},
        ]
        # Q3: Relative option (should NOT shuffle)
        opts3 = [
            {"option_text": "Option 1", "is_correct": False, "option_order": 1},
            {"option_text": "Option 2", "is_correct": False, "option_order": 2},
            {"option_text": "Option 3", "is_correct": False, "option_order": 3},
            {"option_text": "All of the above", "is_correct": True, "option_order": 4},
        ]

        conn.execute(text("""
            INSERT INTO tos_question (tos_question_id, tos_exam_id, display_order, question_text, question_type, options_json)
            VALUES (1, 1, 1, 'Q1', 'MULTIPLE_CHOICE', :opts1),
                   (2, 1, 2, 'Q2', 'MULTIPLE_CHOICE', :opts2),
                   (3, 1, 3, 'Q3', 'MULTIPLE_CHOICE', :opts3)
        """), {"opts1": json.dumps(opts1), "opts2": json.dumps(opts2), "opts3": json.dumps(opts3)})

    yield {"db_url": db_url, "engine": engine}
    engine.dispose()


def test_commit_requires_confirm_db(in_memory_db):
    db_url = in_memory_db["db_url"]
    # Missing confirm_db must raise ValueError
    with pytest.raises(ValueError, match="SAFETY REFUSAL"):
        reshuffle_exam_questions(target_db=db_url, commit=True, confirm_db=None)

    # Mismatched confirm_db must raise ValueError
    with pytest.raises(ValueError, match="SAFETY REFUSAL"):
        reshuffle_exam_questions(target_db=db_url, commit=True, confirm_db="wrong_db_name")


def test_dry_run_leaves_database_untouched(in_memory_db):
    db_url = in_memory_db["db_url"]
    engine = in_memory_db["engine"]

    modified = reshuffle_exam_questions(target_db=db_url, commit=False, seed=42)
    assert modified == 2  # Q1 and Q2 are candidate MC questions; Q3 is skipped

    with engine.connect() as conn:
        row = conn.execute(text("SELECT options_json FROM tos_question WHERE tos_question_id = 1")).fetchone()
        opts = json.loads(row[0])
        assert opts[0]["option_text"] == "Correct Answer A"
        assert opts[0]["option_order"] == 1


def test_deterministic_seed_produces_identical_results_twice(in_memory_db):
    db_url = in_memory_db["db_url"]
    engine = in_memory_db["engine"]

    # First dry run with seed 12345
    reshuffle_exam_questions(target_db=db_url, commit=False, seed=12345)

    # Reset/repopulate database to identical initial state and run commit with seed 12345
    opts1 = [
        {"option_text": "Correct Answer A", "is_correct": True, "option_order": 1},
        {"option_text": "Wrong B", "is_correct": False, "option_order": 2},
        {"option_text": "Wrong C", "is_correct": False, "option_order": 3},
        {"option_text": "Wrong D", "is_correct": False, "option_order": 4},
    ]
    with engine.begin() as conn:
        conn.execute(text("UPDATE tos_question SET options_json = :opts WHERE tos_question_id = 1"), {"opts": json.dumps(opts1)})

    reshuffle_exam_questions(target_db=db_url, commit=True, seed=12345, confirm_db=db_url)

    with engine.connect() as conn:
        row1 = conn.execute(text("SELECT options_json FROM tos_question WHERE tos_question_id = 1")).fetchone()
        first_commit_opts = json.loads(row1[0])

    # Now reset again and run commit with the EXACT same seed 12345
    with engine.begin() as conn:
        conn.execute(text("UPDATE tos_question SET options_json = :opts WHERE tos_question_id = 1"), {"opts": json.dumps(opts1)})

    reshuffle_exam_questions(target_db=db_url, commit=True, seed=12345, confirm_db=db_url)

    with engine.connect() as conn:
        row2 = conn.execute(text("SELECT options_json FROM tos_question WHERE tos_question_id = 1")).fetchone()
        second_commit_opts = json.loads(row2[0])

    # Verify orders and text positions are 100% identical between both runs
    assert first_commit_opts == second_commit_opts
    assert [o["option_text"] for o in first_commit_opts] == [o["option_text"] for o in second_commit_opts]
    assert [o["option_order"] for o in first_commit_opts] == [o["option_order"] for o in second_commit_opts]


def test_commit_integrity_and_skips_relative_options(in_memory_db):
    db_url = in_memory_db["db_url"]
    engine = in_memory_db["engine"]

    modified = reshuffle_exam_questions(target_db=db_url, commit=True, seed=99, confirm_db=db_url)
    assert modified == 2

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT tos_question_id, options_json FROM tos_question ORDER BY tos_question_id")).fetchall()

        # Q1 verified
        q1_opts = json.loads(rows[0][1])
        q1_correct = [o for o in q1_opts if o["is_correct"]]
        assert len(q1_correct) == 1
        assert q1_correct[0]["option_text"] == "Correct Answer A"
        assert [o["option_order"] for o in q1_opts] == [1, 2, 3, 4]

        # Q2 verified
        q2_opts = json.loads(rows[1][1])
        q2_correct = [o for o in q2_opts if o["is_correct"]]
        assert len(q2_correct) == 1
        assert q2_correct[0]["option_text"] == "a and b are real numbers"
        assert [o["option_order"] for o in q2_opts] == [1, 2, 3, 4]

        # Q3 (relative option) skipped and completely untouched
        q3_opts = json.loads(rows[2][1])
        assert q3_opts[3]["option_text"] == "All of the above"
        assert q3_opts[3]["option_order"] == 4
