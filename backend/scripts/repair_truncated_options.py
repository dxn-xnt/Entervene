"""
scripts/repair_truncated_options.py
===================================
Idempotent repair script for quiz question options and student answers
that were truncated due to multiline text wrapping in uploaded quiz files.

Matches rows by:
- Question order (quiz_question.display_order)
- Option order (question_option.option_order)
- Truncated text suffix / pattern
Does NOT hardcode any quiz_id, making it safe and portable across databases.
If the quiz does not exist on the target database, this script is a safe no-op.

Corrections applied:
1. Q#22 Option A (order 1): "Define 'Mission Assurance.'"
2. Q#26 Option B (order 2): "What does 'Integrity' ensure, and why can false data be worse than system downtime?"
3. Q#29 Option B (order 2): "Define 'Accountability' and explain why it matters legally."
4. Q#51 Option B (order 2): "Scenario: Isolating a compromised server..."
5. Q#55 Option B (order 2): "What is 'Unity of Command' in cyber defense?"
6. Q#56 Option A (order 1): "What is 'Mission Command' as applied to cyber defenders?"
7. Q#59 Option B (order 2): "Reflection: What is the difference between protecting a computer network and protecting a mission?"
8. Q#60 Option B (order 2): "Scenario: The cybersecurity team detects unauthorized access..."
"""

import sys
from pathlib import Path

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv

load_dotenv(backend_dir.parent / ".env")
load_dotenv(backend_dir / ".env")

from sqlalchemy import text
from app.db.Session import SessionLocal

REPAIR_DEFINITIONS = [
    {
        "question_number": 22,
        "option": "A",
        "option_order": 1,
        "truncated_text": "A process to protect or ensure continued function/resilience of capabilities and assets critical to DoD",
        "restored_text": "A process to protect or ensure continued function/resilience of capabilities and assets critical to DoD mission-essential functions",
    },
    {
        "question_number": 26,
        "option": "B",
        "option_order": 2,
        "truncated_text": "It ensures data/systems aren't altered; false data can mislead decision-makers without them realizing it, unlike",
        "restored_text": "It ensures data/systems aren't altered; false data can mislead decision-makers without them realizing it, unlike obvious denial",
    },
    {
        "question_number": 29,
        "option": "B",
        "option_order": 2,
        "truncated_text": "It attributes actions to specific actors via logging/audit trails, enabling non-repudiation, forensics, and legal",
        "restored_text": "It attributes actions to specific actors via logging/audit trails, enabling non-repudiation, forensics, and legal process",
    },
    {
        "question_number": 51,
        "option": "B",
        "option_order": 2,
        "truncated_text": "Weigh mission impact of isolation vs. continued compromise, and inform command authority before the",
        "restored_text": "Weigh mission impact of isolation vs. continued compromise, and inform command authority before the mission-impacting decision",
    },
    {
        "question_number": 55,
        "option": "B",
        "option_order": 2,
        "truncated_text": "Clear lines of authority ensuring defensive cyber ops support the joint force commander without conflicting",
        "restored_text": "Clear lines of authority ensuring defensive cyber ops support the joint force commander without conflicting actions",
    },
    {
        "question_number": 56,
        "option": "A",
        "option_order": 1,
        "truncated_text": "Empowering subordinate defenders with commander's intent so they can act rapidly within authorized",
        "restored_text": "Empowering subordinate defenders with commander's intent so they can act rapidly within authorized parameters",
    },
    {
        "question_number": 59,
        "option": "B",
        "option_order": 2,
        "truncated_text": "Protecting a network focuses on technical infrastructure; protecting a mission focuses on the operational",
        "restored_text": "Protecting a network focuses on technical infrastructure; protecting a mission focuses on the operational objective being achievable despite degradation",
    },
    {
        "question_number": 60,
        "option": "B",
        "option_order": 2,
        "truncated_text": "Apply the full Detect→Analyze→Respond→Adapt cycle, prioritize mission-essential systems, weigh mission",
        "truncated_text_alt": "Apply the full Detect+'Analyze+'Respond+'Adapt cycle, prioritize mission-essential systems, weigh mission",
        "restored_text": "Apply the full Detect→Analyze→Respond→Adapt cycle, prioritize mission-essential systems, weigh mission impact before disruptive actions, keep command authority informed, and apply defense-in-depth/Zero Trust principles throughout",
    },
]


def repair():
    db = SessionLocal()
    try:
        print("=== Repairing Truncated Quiz Options (Idempotent, Matched by Order & Text) ===")
        total_options_updated = 0
        total_answers_updated = 0

        for item in REPAIR_DEFINITIONS:
            q_num = item["question_number"]
            opt = item["option"]
            opt_order = item["option_order"]
            old_text = item["truncated_text"]
            new_text = item["restored_text"]
            old_alt = item.get("truncated_text_alt")
            prefix_pattern = old_text[:40] + "%"

            # 1. Update question_option matching by question display_order, option_order, and truncated text
            res_opt = db.execute(
                text("""
                    UPDATE question_option
                    SET option_text = :new_text
                    WHERE option_id IN (
                        SELECT qo.option_id
                        FROM question_option qo
                        JOIN quiz_question qq ON qo.question_id = qq.question_id
                        WHERE qq.display_order = :q_num
                          AND qo.option_order = :opt_order
                          AND qo.option_text != :new_text
                          AND (
                              qo.option_text = :old_text
                              OR (:old_alt IS NOT NULL AND qo.option_text = :old_alt)
                              OR qo.option_text LIKE :prefix_pattern
                          )
                    )
                """),
                {
                    "new_text": new_text,
                    "q_num": q_num,
                    "opt_order": opt_order,
                    "old_text": old_text,
                    "old_alt": old_alt,
                    "prefix_pattern": prefix_pattern,
                },
            )
            total_options_updated += res_opt.rowcount

            # 2. Update quiz_answer where students submitted the truncated answer
            res_ans = db.execute(
                text("""
                    UPDATE quiz_answer
                    SET answer_text = :new_text
                    WHERE answer_id IN (
                        SELECT qa.answer_id
                        FROM quiz_answer qa
                        JOIN quiz_question qq ON qa.quiz_question_id = qq.quiz_question_id
                        WHERE qq.display_order = :q_num
                          AND qa.answer_text != :new_text
                          AND (
                              qa.answer_text = :old_text
                              OR (:old_alt IS NOT NULL AND qa.answer_text = :old_alt)
                              OR qa.answer_text LIKE :prefix_pattern
                          )
                    )
                """),
                {
                    "new_text": new_text,
                    "q_num": q_num,
                    "old_text": old_text,
                    "old_alt": old_alt,
                    "prefix_pattern": prefix_pattern,
                },
            )
            total_answers_updated += res_ans.rowcount

            # Check matching rows already restored
            current_options = db.execute(
                text("""
                    SELECT COUNT(*)
                    FROM question_option qo
                    JOIN quiz_question qq ON qo.question_id = qq.question_id
                    WHERE qq.display_order = :q_num
                      AND qo.option_order = :opt_order
                      AND qo.option_text = :new_text
                """),
                {"q_num": q_num, "opt_order": opt_order, "new_text": new_text},
            ).scalar()

            status = (
                "UP-TO-DATE"
                if res_opt.rowcount == 0 and current_options > 0
                else f"UPDATED ({res_opt.rowcount} options, {res_ans.rowcount} answers)"
                if res_opt.rowcount > 0
                else "NO-OP (quiz/question not present)"
            )
            print(f"  Q#{q_num} Option {opt} (order {opt_order}): {status} ({current_options} rows restored)")

        db.commit()
        print("\n--- Summary ---")
        print(f"Total options updated: {total_options_updated}")
        print(f"Total answers updated: {total_answers_updated}")
        print("Database repair completed successfully.")

    except Exception as exc:
        db.rollback()
        print(f"Error during repair: {exc}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    repair()
