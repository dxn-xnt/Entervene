"""
backend/scripts/reshuffle_tos_exam.py

Opt-in migration script to safely reshuffle options for existing TOS exams
whose MULTIPLE_CHOICE questions suffer from answer-position bias (e.g. all Option A).

Usage:
  # Dry-run inspection (default, no DB changes):
  python scripts/reshuffle_tos_exam.py --db entervene_db

  # Dry-run with explicit seed:
  python scripts/reshuffle_tos_exam.py --db entervene_db --seed 42

  # To actually apply and commit changes (opt-in safety confirmation required):
  python scripts/reshuffle_tos_exam.py --db entervene_db --seed 42 --commit --confirm-db entervene_db
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from pathlib import Path

# Ensure backend root is on sys.path
backend_root = Path(__file__).resolve().parent.parent
if str(backend_root) not in sys.path:
    sys.path.insert(0, str(backend_root))

from sqlalchemy import create_engine, text
from app.core.Config import settings
from app.services.ai.option_shuffle import has_positional_or_relative_options

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

WARNING_BANNER = """
================================================================================
WARNING: Reshuffling exam questions changes their answer key!
Do NOT commit (--commit) reshuffle changes for exams that have already been
printed, administered, or distributed to students.
================================================================================
"""


def _order_to_letter(order: int | None) -> str:
    if order is not None and 1 <= order <= 26:
        return chr(64 + order)
    return str(order) if order is not None else "?"


def reshuffle_exam_questions(
    target_db: str,
    commit: bool = False,
    exam_id: int | None = None,
    seed: int | None = None,
    confirm_db: str | None = None,
) -> int:
    # 1. Print target database name before doing anything
    print(f"Target Database: {target_db}")
    logger.info("Target Database: %s", target_db)

    # 2. Refuse --commit unless --confirm-db matches target
    if commit:
        if not confirm_db or confirm_db.strip() != target_db.strip():
            msg = (
                f"SAFETY REFUSAL: --commit was requested, but --confirm-db '{confirm_db}' "
                f"does not match target database '{target_db}'. Commit aborted."
            )
            print(msg)
            logger.error(msg)
            raise ValueError(msg)

    # 3. Seed initialization and reporting
    if seed is None:
        seed = random.randint(1, 2**31 - 1)
    random.seed(seed)
    print(f"Reshuffle Seed: {seed}")
    logger.info("Reshuffle Seed: %s", seed)

    print(WARNING_BANNER)

    if "://" in target_db or target_db.startswith("sqlite"):
        db_url = target_db
    else:
        prefix = settings.database_url.rsplit("/", 1)[0]
        db_url = f"{prefix}/{target_db}"

    logger.info("Connecting to target database URL: %s", db_url.split("@")[-1] if "@" in db_url else db_url)
    engine = create_engine(db_url)

    total_modified = 0

    conn = engine.connect()
    trans = conn.begin()
    try:
        query = "SELECT tos_exam_id, title FROM tos_exam"
        params = {}
        if exam_id:
            query += " WHERE tos_exam_id = :exam_id"
            params["exam_id"] = exam_id

        exams = conn.execute(text(query), params).fetchall()
        if not exams:
            logger.info("No TOS exams found in %s.", target_db)
            trans.rollback()
            return 0

        updated_questions: dict[int, dict] = {}

        for exam_row in exams:
            e_id, title = exam_row[0], exam_row[1]
            logger.info("Exam ID %s: '%s'", e_id, title)

            questions = conn.execute(
                text(
                    "SELECT tos_question_id, display_order, question_text, question_type, options_json "
                    "FROM tos_question WHERE tos_exam_id = :exam_id ORDER BY display_order"
                ),
                {"exam_id": e_id},
            ).fetchall()

            logger.info("  Found %d questions", len(questions))

            for q_row in questions:
                q_id, disp_order, q_text, q_type, opts_json = q_row
                if not opts_json:
                    continue

                try:
                    options = json.loads(opts_json)
                except Exception:
                    continue

                if q_type != "MULTIPLE_CHOICE" or not isinstance(options, list) or len(options) < 2:
                    continue

                # Check position-dependent options
                if has_positional_or_relative_options(options):
                    logger.info("  Q#%d (ID %d): Skipped (contains position-dependent options)", disp_order, q_id)
                    continue

                old_correct_opts = [o for o in options if o.get("is_correct")]
                if len(old_correct_opts) != 1:
                    logger.warning("  Q#%d (ID %d): Skipped (expected 1 correct option, found %d)", disp_order, q_id, len(old_correct_opts))
                    continue

                old_correct_order = old_correct_opts[0].get("option_order")
                old_correct_text = old_correct_opts[0].get("option_text")
                old_letter = _order_to_letter(old_correct_order)

                # Reshuffle
                shuffled = list(options)
                random.shuffle(shuffled)
                for o_idx, opt in enumerate(shuffled, start=1):
                    opt["option_order"] = o_idx

                # In-memory integrity check prior to DB update
                new_correct_opts = [o for o in shuffled if o.get("is_correct")]
                if len(new_correct_opts) != 1:
                    raise ValueError(f"Integrity check failed on Q#{disp_order} (ID {q_id}): expected exactly 1 correct option, found {len(new_correct_opts)}")

                if new_correct_opts[0].get("option_text") != old_correct_text:
                    raise ValueError(f"Integrity check failed on Q#{disp_order} (ID {q_id}): correct option text changed from '{old_correct_text}' to '{new_correct_opts[0].get('option_text')}'")

                orders = [o.get("option_order") for o in shuffled]
                if orders != list(range(1, len(shuffled) + 1)):
                    raise ValueError(f"Integrity check failed on Q#{disp_order} (ID {q_id}): option_order values {orders} do not strictly run 1..{len(shuffled)}")

                new_correct_order = new_correct_opts[0].get("option_order")
                new_letter = _order_to_letter(new_correct_order)

                logger.info(
                    "  Q#%d (ID %d): Correct answer moved from Option %s (order %s) -> Option %s (order %s)",
                    disp_order,
                    q_id,
                    old_letter,
                    old_correct_order,
                    new_letter,
                    new_correct_order,
                )

                if commit:
                    conn.execute(
                        text(
                            "UPDATE tos_question SET options_json = :opts_json WHERE tos_question_id = :q_id"
                        ),
                        {"opts_json": json.dumps(shuffled), "q_id": q_id},
                    )
                    updated_questions[q_id] = {
                        "expected_text": old_correct_text,
                        "expected_count": len(shuffled),
                    }

                total_modified += 1

        if commit and updated_questions:
            # Post-update verification directly querying the database within the transaction
            logger.info("Verifying %d updated questions in database transaction...", len(updated_questions))
            for q_id, expected in updated_questions.items():
                row = conn.execute(
                    text("SELECT options_json FROM tos_question WHERE tos_question_id = :q_id"),
                    {"q_id": q_id},
                ).fetchone()
                if not row or not row[0]:
                    raise ValueError(f"Verification failed: question ID {q_id} not found in database")
                db_opts = json.loads(row[0])
                db_correct = [o for o in db_opts if o.get("is_correct")]
                if len(db_correct) != 1:
                    raise ValueError(f"DB verification failed on question ID {q_id}: expected 1 correct option, got {len(db_correct)}")
                if db_correct[0].get("option_text") != expected["expected_text"]:
                    raise ValueError(f"DB verification failed on question ID {q_id}: correct option text mismatch")
                db_orders = [o.get("option_order") for o in db_opts]
                if db_orders != list(range(1, expected["expected_count"] + 1)):
                    raise ValueError(f"DB verification failed on question ID {q_id}: option_order values {db_orders} invalid")

            trans.commit()
            logger.info("Committed reshuffle updates for %d questions in %s after all integrity checks passed.", total_modified, target_db)
        else:
            trans.rollback()
            logger.info("DRY-RUN completed. %d questions would be reshuffled. Pass --commit with --confirm-db to apply.", total_modified)

        return total_modified

    except Exception as exc:
        trans.rollback()
        logger.error("Error during reshuffle; transaction ROLLED BACK. Reason: %s", exc)
        raise
    finally:
        conn.close()
        engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Safely reshuffle TOS exam questions.")
    parser.add_argument("--db", default="entervene_db", help="Target database name (default: entervene_db)")
    parser.add_argument("--confirm-db", default=None, help="Safety confirmation required with --commit (must match --db)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for deterministic option reshuffling")
    parser.add_argument("--exam-id", type=int, default=None, help="Specific exam ID to reshuffle (optional)")
    parser.add_argument("--commit", action="store_true", help="Apply and commit changes to the database")
    args = parser.parse_args()

    try:
        reshuffle_exam_questions(
            target_db=args.db,
            commit=args.commit,
            exam_id=args.exam_id,
            seed=args.seed,
            confirm_db=args.confirm_db,
        )
    except ValueError:
        sys.exit(1)
