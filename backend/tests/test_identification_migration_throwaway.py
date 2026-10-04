"""
tests/test_identification_migration_throwaway.py

Disposable migration test verifying:
1. Safety guard: Assert target database name starts with "test_" and refuse otherwise.
2. Single Alembic head assertion.
3. Clean upgrade of throwaway DB to 20261003a and 20261003b.
4. Correct promotion of keyed SHORT_ANSWER to IDENTIFICATION and retention of unkeyed SHORT_ANSWER.
5. Safe downgrade back to 20260928_remedial_exam_link even when IDENTIFICATION rows are present (20261003a safe downgrade).
6. Clean round-trip upgrade to head.
7. Explicit log proving only the throwaway DB was migrated.
"""
import os
import uuid
import pytest
from pathlib import Path
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine.url import make_url

from app.core.Config import settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


def verify_safe_test_db(dbname: str) -> None:
    if not dbname.startswith("test_"):
        raise ValueError(
            f"CRITICAL SAFETY VIOLATION: Database name '{dbname}' does not start with 'test_'! "
            "Refusing to execute migration against non-test database."
        )


def test_safety_guard_blocks_non_test_databases():
    # Must accept names starting with test_
    verify_safe_test_db("test_throwaway_123")
    verify_safe_test_db("test_quiz_migration")

    # Must reject any real database or arbitrary name
    with pytest.raises(ValueError, match="CRITICAL SAFETY VIOLATION"):
        verify_safe_test_db("activity_db")

    with pytest.raises(ValueError, match="CRITICAL SAFETY VIOLATION"):
        verify_safe_test_db("entervene_db")

    with pytest.raises(ValueError, match="CRITICAL SAFETY VIOLATION"):
        verify_safe_test_db("production_db")


def test_alembic_chain_has_single_head():
    alembic_ini_path = BACKEND_DIR / "alembic.ini"
    cfg = Config(str(alembic_ini_path))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, f"Expected single Alembic head, found multiple: {heads}"
    assert heads[0] == "20261003b_ident_type_data"


def test_throwaway_database_upgrade_and_safe_downgrade():
    base_url = make_url(settings.database_url)
    if base_url.get_backend_name() != "postgresql":
        pytest.skip("PostgreSQL required for migration test")

    throwaway_name = f"test_throwaway_{uuid.uuid4().hex[:8]}"
    verify_safe_test_db(throwaway_name)

    admin_url = base_url.set(database="postgres")
    try:
        admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
        with admin_engine.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{throwaway_name}"'))
    except Exception as exc:
        pytest.skip(f"PostgreSQL unreachable or user cannot CREATE DATABASE: {exc}")

    target_url = base_url.set(database=throwaway_name)
    target_engine = None

    try:
        # Log line proving which DB is being migrated
        print(f"\n[MIGRATION TEST] MIGRATING THROWAWAY DATABASE: {throwaway_name} (URL: {target_url.render_as_string(hide_password=True)})")


        alembic_ini_path = BACKEND_DIR / "alembic.ini"
        cfg = Config(str(alembic_ini_path))
        cfg.set_main_option("sqlalchemy.url", target_url.render_as_string(hide_password=False))

        # 1. Upgrade throwaway DB to base migration
        command.upgrade(cfg, "20260928_remedial_exam_link")

        target_engine = create_engine(target_url)
        with target_engine.connect() as conn:
            # Verify ck_question_type allows only 2 types
            ck = conn.execute(text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_question_type'"
            )).scalar()
            assert "MULTIPLE_CHOICE" in ck
            assert "SHORT_ANSWER" in ck
            assert "IDENTIFICATION" not in ck

            # Seed a MULTIPLE_CHOICE, a keyed SHORT_ANSWER, and an unkeyed SHORT_ANSWER
            conn.execute(text("""
                INSERT INTO question (question_text, question_type, points, is_ai_generated)
                VALUES ('MC Question', 'MULTIPLE_CHOICE', 1.0, FALSE)
            """))
            mc_id = conn.execute(text("SELECT question_id FROM question WHERE question_text = 'MC Question'")).scalar()
            conn.execute(text(f"""
                INSERT INTO question_option (question_id, option_text, is_correct, option_order)
                VALUES ({mc_id}, 'Choice A', TRUE, 1), ({mc_id}, 'Choice B', FALSE, 2)
            """))

            conn.execute(text("""
                INSERT INTO question (question_text, question_type, points, is_ai_generated)
                VALUES ('Keyed Short Answer', 'SHORT_ANSWER', 1.0, FALSE)
            """))
            keyed_id = conn.execute(text("SELECT question_id FROM question WHERE question_text = 'Keyed Short Answer'")).scalar()
            conn.execute(text(f"""
                INSERT INTO question_option (question_id, option_text, is_correct, option_order)
                VALUES ({keyed_id}, 'Accepted Key', TRUE, 1)
            """))

            conn.execute(text("""
                INSERT INTO question (question_text, question_type, points, is_ai_generated)
                VALUES ('Unkeyed Short Answer', 'SHORT_ANSWER', 1.0, FALSE)
            """))
            conn.commit()

        # 2. Upgrade throwaway DB to head (20261003a + 20261003b)
        command.upgrade(cfg, "head")

        with target_engine.connect() as conn:
            # Verify constraint now allows IDENTIFICATION
            ck = conn.execute(text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_question_type'"
            )).scalar()
            assert "IDENTIFICATION" in ck

            # Verify keyed was promoted to IDENTIFICATION
            promoted_type = conn.execute(text(f"SELECT question_type FROM question WHERE question_id = {keyed_id}")).scalar()
            assert promoted_type == "IDENTIFICATION"

            # Verify unkeyed remained SHORT_ANSWER
            unkeyed_type = conn.execute(text("SELECT question_type FROM question WHERE question_text = 'Unkeyed Short Answer'")).scalar()
            assert unkeyed_type == "SHORT_ANSWER"

            # 3. Test safe downgrade with IDENTIFICATION rows present
            # Insert a raw IDENTIFICATION question to guarantee IDENTIFICATION rows exist prior to downgrade
            conn.execute(text("""
                INSERT INTO question (question_text, question_type, points, is_ai_generated)
                VALUES ('Newly Created Identification', 'IDENTIFICATION', 2.0, FALSE)
            """))
            conn.commit()

        # Downgrade back to 20260928_remedial_exam_link
        command.downgrade(cfg, "20260928_remedial_exam_link")

        with target_engine.connect() as conn:
            # Verify 0 IDENTIFICATION rows remain
            ident_count = conn.execute(text("SELECT COUNT(*) FROM question WHERE question_type = 'IDENTIFICATION'")).scalar()
            assert ident_count == 0

            # Verify the converted row is now SHORT_ANSWER
            converted_type = conn.execute(text("SELECT question_type FROM question WHERE question_text = 'Newly Created Identification'")).scalar()
            assert converted_type == "SHORT_ANSWER"

            # Verify constraint restored to 2-type check
            ck = conn.execute(text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_question_type'"
            )).scalar()
            assert "IDENTIFICATION" not in ck

            # Verify alembic_version
            ver = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            assert ver == "20260928_remedial_exam_link"

        # 4. Upgrade back to head to confirm clean round-trip
        command.upgrade(cfg, "head")

        with target_engine.connect() as conn:
            ver = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            assert ver == "20261003b_ident_type_data"

    finally:
        if target_engine:
            target_engine.dispose()
        # Drop throwaway database
        with admin_engine.connect() as conn:
            conn.execute(text(f"""
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = '{throwaway_name}' AND pid <> pg_backend_pid()
            """))
            conn.execute(text(f'DROP DATABASE IF EXISTS "{throwaway_name}"'))
        admin_engine.dispose()
