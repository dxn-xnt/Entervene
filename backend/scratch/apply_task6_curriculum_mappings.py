"""Apply Task 6 Class-Wide Lesson and Competency Mappings to Entervene_Demo.

Idempotent, non-destructive, strictly scoped to Entervene_Demo.
Does not alter student scores, grades, predictions, or intervention cycles.
"""

from datetime import datetime, timezone
import os
import sys

sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkLesson import ClassworkLesson


def main():
    demo_env = dotenv_values("backend/.env.demo")
    db_url = demo_env.get("DATABASE_URL")
    if not db_url or "Entervene_Demo" not in db_url:
        raise RuntimeError(f"Safety abort: Expected Entervene_Demo, got {db_url}")

    engine = create_engine(db_url)
    with Session(engine) as db:
        print("Connected to:", db.execute(text("SELECT current_database(), current_user")).fetchone())

        # 1. Verify or create Competencies
        # Competency 1 (Existing)
        c_eq = db.query(Competency).filter_by(competency_code="DEMO-LOCAL-G9M-EQ-01").one()
        print(f"Verified Existing Competency: ID {c_eq.competency_id} - {c_eq.competency_code}")

        # Competency 2 (New)
        c_ns = db.query(Competency).filter_by(competency_code="DEMO-LOCAL-G9M-NS-01").first()
        if not c_ns:
            c_ns = Competency(
                competency_code="DEMO-LOCAL-G9M-NS-01",
                statement="Demonstrate number sense by applying operational properties to integers and rational numbers in real-world contexts.",
                description="Local Grade 9 Mathematics demonstration objective for number sense and signed operations; not an official curriculum competency code.",
                order_index=2,
                target_hours=1,
                is_archived=False,
                subject_id=1,
                academic_period_id=1,
                created_by_staff_id="DEMO-T-001",
            )
            db.add(c_ns)
            db.flush()
            print(f"Created Competency: ID {c_ns.competency_id} - {c_ns.competency_code}")
        else:
            print(f"Reusing Competency: ID {c_ns.competency_id} - {c_ns.competency_code}")

        # Competency 3 (New)
        c_bm = db.query(Competency).filter_by(competency_code="DEMO-LOCAL-G9M-BM-01").first()
        if not c_bm:
            c_bm = Competency(
                competency_code="DEMO-LOCAL-G9M-BM-01",
                statement="Formulate and analyze personal and household budget allocations using arithmetic ratios, percentages, and financial constraints.",
                description="Local Grade 9 Mathematics demonstration objective for personal financial modeling and budget mathematics; not an official curriculum competency code.",
                order_index=3,
                target_hours=1,
                is_archived=False,
                subject_id=1,
                academic_period_id=1,
                created_by_staff_id="DEMO-T-001",
            )
            db.add(c_bm)
            db.flush()
            print(f"Created Competency: ID {c_bm.competency_id} - {c_bm.competency_code}")
        else:
            print(f"Reusing Competency: ID {c_bm.competency_id} - {c_bm.competency_code}")

        # Competency 4 (New)
        c_di = db.query(Competency).filter_by(competency_code="DEMO-LOCAL-G9M-DI-01").first()
        if not c_di:
            c_di = Competency(
                competency_code="DEMO-LOCAL-G9M-DI-01",
                statement="Collect, organize, summarize, and interpret bivariate or univariate numerical data using statistical measures and graphical representations.",
                description="Local Grade 9 Mathematics demonstration objective for statistical data investigation; not an official curriculum competency code.",
                order_index=4,
                target_hours=1,
                is_archived=False,
                subject_id=1,
                academic_period_id=1,
                created_by_staff_id="DEMO-T-001",
            )
            db.add(c_di)
            db.flush()
            print(f"Created Competency: ID {c_di.competency_id} - {c_di.competency_code}")
        else:
            print(f"Reusing Competency: ID {c_di.competency_id} - {c_di.competency_code}")

        # 2. Verify or create Lessons
        # Lesson 1 (Existing)
        l_eq = db.get(Lesson, 1)
        print(f"Verified Existing Lesson: ID {l_eq.lesson_id} - {l_eq.title}")

        # Lesson 2 (Number Systems)
        l_ns = db.query(Lesson).filter_by(competency_id=c_ns.competency_id).first()
        if not l_ns:
            l_ns = Lesson(
                title="DEMO - Number Systems: Integers and Rational Numbers",
                description="Teacher-created Grade 9 Mathematics review material for understanding operational rules on integers, operations on rational numbers, and applied signed values. This is a local demonstration objective, not an official curriculum-code claim.",
                content="""Learning objective
Demonstrate number sense by applying operational properties to integers and rational numbers in real-world contexts.

Key idea
Integers and rational numbers represent directed values and fractions/decimals. When adding integers with like signs, sum the magnitudes and keep the sign; with unlike signs, subtract the smaller magnitude from the larger and keep the sign of the larger. Multiplying or dividing two numbers with identical signs yields a positive result, while differing signs yield a negative result. For rational numbers, find a common denominator for addition/subtraction, and multiply across for multiplication.

Worked example
A submarine starts at sea level (0 m), dives 150 meters below sea level (-150 m), ascends 45 meters, and then descends another 20.5 meters. What is the submarine's final position relative to sea level?

Position = 0 + (-150) + 45 + (-20.5)
Step 1: -150 + 45 = -105 m
Step 2: -105 + (-20.5) = -125.5 m

Check: The submarine is 125.5 meters below sea level (-125.5 m).

Short practice
1. Compute: (-18) + 27 - (-12).
2. Evaluate: (-3/4) * (8/9).
3. A bank account had a balance of PHP 500. A withdrawal of PHP 750 was made, followed by a deposit of PHP 300. What is the new balance?

Answer check
1. (-18) + 27 + 12 = 9 + 12 = 21.
2. (-3 * 8) / (4 * 9) = -24/36 = -2/3.
3. 500 - 750 + 300 = -250 + 300 = PHP 50.""",
                order_index=2,
                is_published=True,
                is_draft=False,
                is_locked=False,
                is_archived=False,
                created_by_staff_id="DEMO-T-001",
                subject_id=1,
                competency_id=c_ns.competency_id,
            )
            db.add(l_ns)
            db.flush()
            print(f"Created Lesson: ID {l_ns.lesson_id} - {l_ns.title}")
        else:
            print(f"Reusing Lesson: ID {l_ns.lesson_id} - {l_ns.title}")

        # Lesson 3 (Budget Mathematics)
        l_bm = db.query(Lesson).filter_by(competency_id=c_bm.competency_id).first()
        if not l_bm:
            l_bm = Lesson(
                title="DEMO - Budget Mathematics and Financial Modeling",
                description="Teacher-created Grade 9 Mathematics review material for calculating income streams, classifying fixed and variable expenses, computing savings ratios, and modeling balanced budgets. This is a local demonstration objective, not an official curriculum-code claim.",
                content="""Learning objective
Formulate and analyze personal and household budget allocations using arithmetic ratios, percentages, and financial constraints.

Key idea
A personal budget balances income against expenses and savings. Net income is total earnings minus mandatory deductions. Total expenditures are categorized into fixed expenses (constant monthly costs) and variable expenses (fluctuating costs). The savings rate is calculated as (Total Savings / Net Income) * 100%. A balanced budget adheres to the constraint: Net Income = Fixed Expenses + Variable Expenses + Savings.

Worked example
Maria receives a monthly net allowance of PHP 8,000. She allocates 40% for food and transportation, 25% for school project supplies, and 15% for emergency savings. How much money remains for discretionary spending?

Allocations:
- Food and transportation: 0.40 * 8,000 = PHP 3,200
- Project supplies: 0.25 * 8,000 = PHP 2,000
- Emergency savings: 0.15 * 8,000 = PHP 1,200
Total committed = 3,200 + 2,000 + 1,200 = PHP 6,400
Remaining discretionary = 8,000 - 6,400 = PHP 1,600 (or 20%).

Check: 3,200 + 2,000 + 1,200 + 1,600 = PHP 8,000.

Short practice
1. If a family earns PHP 30,000 net monthly and spends PHP 18,000 on necessities and PHP 6,000 on utilities, what percentage is left for savings?
2. A student saves PHP 1,500 from a PHP 6,000 monthly stipend. Compute the savings rate.
3. If fixed expenses increase by PHP 1,200 in a balanced budget, what two adjustments can keep the budget balanced?

Answer check
1. Total spent = 24,000. Remaining = PHP 6,000. Savings rate = (6,000 / 30,000) * 100% = 20%.
2. Savings rate = (1,500 / 6,000) * 100% = 25%.
3. Either reduce variable/discretionary expenses by PHP 1,200 or increase net income by PHP 1,200 (or a combination of both).""",
                order_index=3,
                is_published=True,
                is_draft=False,
                is_locked=False,
                is_archived=False,
                created_by_staff_id="DEMO-T-001",
                subject_id=1,
                competency_id=c_bm.competency_id,
            )
            db.add(l_bm)
            db.flush()
            print(f"Created Lesson: ID {l_bm.lesson_id} - {l_bm.title}")
        else:
            print(f"Reusing Lesson: ID {l_bm.lesson_id} - {l_bm.title}")

        # Lesson 4 (Data Investigation)
        l_di = db.query(Lesson).filter_by(competency_id=c_di.competency_id).first()
        if not l_di:
            l_di = Lesson(
                title="DEMO - Statistical Data Investigation and Interpretation",
                description="Teacher-created Grade 9 Mathematics review material for organizing data distributions, computing measures of central tendency and variability, and deriving contextual conclusions. This is a local demonstration objective, not an official curriculum-code claim.",
                content="""Learning objective
Collect, organize, summarize, and interpret bivariate or univariate numerical data using statistical measures and graphical representations.

Key idea
Statistical investigation begins with data collection and tabulation. Numerical data are summarized through measures of central tendency: Mean (arithmetic average), Median (middle value of an ordered set), and Mode (most frequent observation). Measures of variability, such as Range (maximum - minimum), indicate data spread. When significant outliers exist, the median provides a more robust representation of central tendency than the mean.

Worked example
A mathematics study group records their weekly practice test scores (out of 20): [14, 16, 16, 17, 19, 20, 20]. Find the mean, median, mode, and range.

Ordered data: 14, 16, 16, 17, 19, 20, 20 (n = 7).
- Mean = (14 + 16 + 16 + 17 + 19 + 20 + 20) / 7 = 122 / 7 ≈ 17.43.
- Median = 4th value = 17.
- Mode = 16 and 20 (bimodal).
- Range = 20 - 14 = 6.

Conclusion: The typical performance center is approximately 17, with a narrow dispersion of 6 points.

Short practice
1. Find the median of the dataset: [82, 75, 90, 88, 79, 94].
2. Identify which measure of central tendency is most affected by an extreme score of 10 in a class where other scores are around 85.
3. Calculate the range of the test scores: [65, 78, 82, 85, 91, 98].

Answer check
1. Ordered set: [75, 79, 82, 88, 90, 94]. Median = (82 + 88) / 2 = 85.
2. The mean is most sensitive to extreme values/outliers.
3. Range = 98 - 65 = 33.""",
                order_index=4,
                is_published=True,
                is_draft=False,
                is_locked=False,
                is_archived=False,
                created_by_staff_id="DEMO-T-001",
                subject_id=1,
                competency_id=c_di.competency_id,
            )
            db.add(l_di)
            db.flush()
            print(f"Created Lesson: ID {l_di.lesson_id} - {l_di.title}")
        else:
            print(f"Reusing Lesson: ID {l_di.lesson_id} - {l_di.title}")

        # 3. Classwork Lesson and Coverage Mappings
        now = datetime.now(timezone.utc)
        print(f"Mapping valid_from timestamp: {now.isoformat()}")

        # Verified mappings specification:
        # (classwork_id, lesson, competency, is_manual_coverage)
        mappings = [
            (1, l_ns, c_ns, True),   # WW 1 - Number Sense
            (2, l_ns, c_ns, True),   # WW 2 - Integer Operations (shared topic; Jordan's quiz questions remain EQ-01)
            (3, l_ns, c_ns, True),   # WW 3 - Rational Numbers
            (4, l_eq, c_eq, True),   # WW 4 - Algebraic Expressions
            (5, l_bm, c_bm, True),   # PT 1 - Budget Mathematics
            (6, l_eq, c_eq, True),   # PT 2 - Equation Modeling
            (7, l_di, c_di, True),   # PT 3 - Data Investigation
            (12, l_eq, c_eq, False), # I5I-A Targeted Practice (ONLINE; ClassworkLesson only)
        ]

        # Apply ClassworkLesson
        for cw_id, lesson, _, _ in mappings:
            cl = db.query(ClassworkLesson).filter_by(classwork_id=cw_id, lesson_id=lesson.lesson_id).first()
            if not cl:
                db.add(ClassworkLesson(classwork_id=cw_id, lesson_id=lesson.lesson_id))
                print(f"Added ClassworkLesson: CW {cw_id} -> Lesson {lesson.lesson_id}")
            else:
                print(f"ClassworkLesson exists: CW {cw_id} -> Lesson {lesson.lesson_id}")

        # Apply ClassworkCoverage for manual activities
        for cw_id, lesson, comp, is_manual in mappings:
            if not is_manual:
                continue
            cov = db.query(ClassworkCoverage).filter_by(
                classwork_id=cw_id, lesson_id=lesson.lesson_id, valid_until=None
            ).first()
            if not cov:
                db.add(ClassworkCoverage(
                    classwork_id=cw_id,
                    lesson_id=lesson.lesson_id,
                    competency_id=comp.competency_id,
                    valid_from=now,
                    linked_by_staff_id="DEMO-T-001",
                ))
                print(f"Added ClassworkCoverage: CW {cw_id} -> Lesson {lesson.lesson_id}, Comp {comp.competency_id}")
            else:
                print(f"ClassworkCoverage exists: CW {cw_id} -> Lesson {lesson.lesson_id}, Comp {comp.competency_id}")

        db.commit()
        print("Database commit successful.")


if __name__ == "__main__":
    main()
