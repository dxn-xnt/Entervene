"""Populate the isolated Entervene_Demo database with aligned Reading classworks.

The script is deliberately narrow and idempotent. It refuses any non-local or
non-Entervene_Demo database, validates the current teacher load and the existing
Lesson-to-Competency relationship, and never edits a pre-existing classwork.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(os.getenv("ENV_FILE", BACKEND_DIR / ".env.demo"), override=True)

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.services.classwork.ClassworkShared import (
    ensure_class_targets,
    ensure_lessons_owned,
    ensure_subject_owner,
)


DATABASE_NAME = "Entervene_Demo"
TEACHER_ID = "DEMO-T-001"
SUBJECT_ID = 1
CLASS_ID = 1
PERIOD_ID = 1


READINGS = (
    {
        "competency_code": "DEMO-LOCAL-G9M-EQ-01",
        "lesson_title": "DEMO - Equation Modeling with One-Variable Linear Equations",
        "title": "DEMO - Reading: Modeling Real Situations with Linear Equations",
        "description": (
            "A guided Grade 9 reading on translating real situations into one-variable "
            "linear equations, solving them, and checking whether an answer makes sense."
        ),
        "body": """Introduction

An equation is a mathematical sentence showing that two expressions have the same value. In a one-variable linear equation, the unknown has an exponent of 1. Equations help us describe everyday relationships such as fares, savings, and the cost of school supplies.

Learning objectives

After this reading, you should be able to identify an unknown quantity, translate words into a one-variable linear equation, solve the equation using inverse operations, and verify the solution in its original context.

Building the model

First decide what the variable represents and write its unit. Next separate the known quantities from the unknown. Words such as total, altogether, or is often signal the equal sign. A fixed amount is a constant; an amount repeated for every item is multiplied by the variable. Finally, solve while performing the same operation on both sides. This preserves equality.

Worked example 1: Tricycle fare

A tricycle charges a base fare of PHP 15 plus PHP 4 for each additional kilometer. A passenger paid PHP 35. Let k be the number of additional kilometers.

1. Translate the relationship: 15 + 4k = 35.
2. Subtract 15 from both sides: 4k = 20.
3. Divide both sides by 4: k = 5.
4. Check: 15 + 4(5) = 35. The passenger traveled 5 additional kilometers.

Worked example 2: Saving for a calculator

Mika already has PHP 180 and saves the same amount for 6 weeks. She then has PHP 600. Let w be her weekly saving.

1. Write the model: 180 + 6w = 600.
2. Subtract 180: 6w = 420.
3. Divide by 6: w = 70.
4. Check the meaning: PHP 180 + 6(PHP 70) = PHP 600, so the answer and unit are correct.

Common mistakes and good habits

Do not reverse quantities when translating phrases. Label the variable before writing the equation, keep units consistent, and substitute the result into the original equation. Reject answers that satisfy the symbols but are impossible in context, such as a negative number of notebooks.

Filipino-context applications

Linear equations can model jeepney or tricycle fares, prepaid-load spending, equal weekly savings, cooperative contributions, and the cost of identical items plus a delivery fee.

Ungraded self-check

1. A delivery costs PHP 40 plus PHP 12 per parcel. The bill is PHP 136. Write and solve an equation for the number of parcels.
2. You have PHP 250 and save PHP 50 each week. How many weeks are needed to reach PHP 750?
3. For each answer, substitute it back and explain whether it is reasonable.

Summary

Define the variable, translate the relationship, use inverse operations equally on both sides, and verify the result in the original situation. A complete solution includes both the numerical answer and its meaning.""",
    },
    {
        "competency_code": "DEMO-LOCAL-G9M-NS-01",
        "lesson_title": "DEMO - Number Systems: Integers and Rational Numbers",
        "title": "DEMO - Reading: Integers and Rational Numbers in Daily Life",
        "description": (
            "A guided Grade 9 reading on integer and rational-number operations, "
            "properties, estimation, and signed quantities in practical settings."
        ),
        "body": """Introduction

Integers include negative whole numbers, zero, and positive whole numbers. Rational numbers can be written as a fraction a/b where a and b are integers and b is not zero. Prices, temperatures, debts, elevations, and measurements often require both kinds of numbers.

Learning objectives

After this reading, you should be able to compare signed numbers, perform operations on integers and rational numbers, use operation properties correctly, and explain what a result means in a real situation.

Understanding signs and operations

On a number line, values farther right are greater. Adding a positive number moves right; adding a negative number moves left. For multiplication and division, equal signs produce a positive result and unlike signs produce a negative result. Fractions must have a common denominator before addition or subtraction. Multiplication and division do not require common denominators, but division means multiplying by the reciprocal.

Useful properties include commutativity for addition and multiplication, associativity for regrouping those operations, and distributivity: a(b + c) = ab + ac. Subtraction and division are not commutative.

Worked example 1: Temperature change

Baguio has a morning temperature of 16 degrees C. It rises by 5 degrees, then falls by 8 degrees.

1. Represent the changes: 16 + 5 + (-8).
2. Combine in order: 21 - 8 = 13.
3. Interpret: the final temperature is 13 degrees C. The negative sign on 8 describes the direction of change, not the final temperature.

Worked example 2: Sharing rice supplies

A family has 7 1/2 kilograms of rice and divides it equally into 3 containers.

1. Convert the mixed number: 7 1/2 = 15/2.
2. Divide by 3: (15/2) / 3 = (15/2)(1/3).
3. Simplify: 15/6 = 5/2 = 2 1/2.
4. Check: 3(2 1/2) = 7 1/2 kilograms.

Worked example 3: Small sari-sari store balance

A store begins with PHP 850, pays PHP 275 for supplies, receives PHP 420 in sales, then pays PHP 95 for delivery. The balance is 850 - 275 + 420 - 95 = PHP 900. Grouping income and expenses gives the same result: (850 + 420) - (275 + 95) = 1,270 - 370 = PHP 900.

Ungraded self-check

1. Evaluate -6 + 14 - 9 and describe the movement on a number line.
2. Compute 3/4 + 5/6 using a common denominator.
3. A mobile-load balance is PHP 120. A PHP 35 promo and two PHP 12 charges are deducted. What remains?
4. Explain why 8 - 3 is not equal to 3 - 8.

Summary

Signed numbers describe both amount and direction. Use sign rules, common denominators, reciprocals, and operation properties carefully. Estimate first and interpret the final value with its correct unit and context.""",
    },
    {
        "competency_code": "DEMO-LOCAL-G9M-BM-01",
        "lesson_title": "DEMO - Budget Mathematics and Financial Modeling",
        "title": "DEMO - Reading: Building a Balanced Household Budget",
        "description": (
            "A guided Grade 9 reading on income, fixed and variable expenses, "
            "percent allocations, savings ratios, and balanced-budget constraints."
        ),
        "body": """Introduction

A budget is a plan for using limited income. It helps a household meet needs, prepare for emergencies, and decide whether a goal is affordable. Budget mathematics combines arithmetic, ratios, percentages, and equations.

Learning objectives

After this reading, you should be able to identify income and expense categories, distinguish fixed and variable expenses, calculate percentage allocations and savings rates, and test whether a proposed budget is balanced.

Core ideas

Net available income is the amount that can actually be budgeted. Fixed expenses are usually stable, such as rent. Variable expenses can change, such as electricity, transport, or food. Savings should be treated as a planned allocation rather than whatever happens to remain.

A balanced plan follows: income = expenses + savings. The percentage for a category is category amount / income x 100%. All allocation percentages should total 100%, allowing only a small rounding difference.

Worked example 1: Monthly family plan

A household budgets PHP 30,000. It assigns PHP 10,500 to food, PHP 6,000 to housing, PHP 3,000 to transport, PHP 2,400 to utilities, and PHP 3,600 to savings.

1. Add listed allocations: 10,500 + 6,000 + 3,000 + 2,400 + 3,600 = PHP 25,500.
2. Find the amount for other needs: 30,000 - 25,500 = PHP 4,500.
3. Compute the savings rate: 3,600 / 30,000 x 100% = 12%.
4. Check: PHP 25,500 + PHP 4,500 = PHP 30,000, so the plan balances.

Worked example 2: School allowance adjustment

Paolo receives PHP 1,000 for five school days. He plans 45% for transport, 35% for meals, 10% for school supplies, and 10% for savings.

1. Transport: 0.45(1,000) = PHP 450.
2. Meals: 0.35(1,000) = PHP 350.
3. Supplies: 0.10(1,000) = PHP 100.
4. Savings: 0.10(1,000) = PHP 100.
5. Check: 450 + 350 + 100 + 100 = PHP 1,000.

If transport rises to PHP 500, Paolo must reduce another category by PHP 50 or increase income. Spending PHP 1,050 from PHP 1,000 without a stated source creates a deficit.

Making responsible comparisons

Separate needs from wants, but recognize that actual family priorities differ. Use exact amounts when possible, keep the same time period for every figure, and label estimates. A budget is a planning model, not a judgment about a household.

Ungraded self-check

1. From PHP 20,000 income, a family saves PHP 2,500. What is the savings rate?
2. A weekly allowance is PHP 750. Create a four-category allocation totaling exactly 100%.
3. If an electricity estimate rises by PHP 300, explain two valid ways to rebalance the plan.

Summary

A sound budget identifies available income, classifies expenses, allocates amounts or percentages, plans savings, and checks the equality income = expenses + savings. Recalculate when a constraint changes.""",
    },
    {
        "competency_code": "DEMO-LOCAL-G9M-DI-01",
        "lesson_title": "DEMO - Statistical Data Investigation and Interpretation",
        "title": "DEMO - Reading: Investigating and Interpreting Statistical Data",
        "description": (
            "A guided Grade 9 reading on collecting and organizing data, computing "
            "summary measures, reading graphs, and drawing evidence-based conclusions."
        ),
        "body": """Introduction

Statistics helps us learn from data rather than from isolated impressions. A useful investigation begins with a clear question, collects relevant observations, organizes them, summarizes important patterns, and states a conclusion that the evidence supports.

Learning objectives

After this reading, you should be able to distinguish types of numerical data, organize observations in tables or graphs, calculate and interpret the mean, median, mode, and range, and explain limitations in a conclusion.

From question to evidence

Define the population you want to understand and the sample you can observe. A biased sample systematically favors some members. Numerical data may be discrete, such as number of siblings, or continuous, such as travel time. Choose a display that matches the question: bar graphs compare categories, line graphs show change over time, and histograms show numerical distributions across intervals.

The mean is the sum divided by the number of values. The median is the middle ordered value. The mode is the most frequent value. The range is maximum minus minimum. No single measure tells the entire story; an unusual extreme value can strongly affect the mean.

Worked example 1: Travel time to school

Five students report travel times of 15, 20, 20, 25, and 40 minutes.

1. Mean: (15 + 20 + 20 + 25 + 40) / 5 = 120 / 5 = 24 minutes.
2. Median: the ordered middle value is 20 minutes.
3. Mode: 20 minutes occurs most often.
4. Range: 40 - 15 = 25 minutes.
5. Interpret: the 40-minute trip raises the mean above the median, so reporting both gives a clearer picture.

Worked example 2: Barangay recycling survey

A class records kilograms of recyclable material collected over four weeks: 18, 24, 21, and 29.

1. Mean: (18 + 24 + 21 + 29) / 4 = 92 / 4 = 23 kg.
2. Range: 29 - 18 = 11 kg.
3. Change from week 1 to week 4: 29 - 18 = 11 kg, about 61.1% of week 1 because 11 / 18 x 100% is about 61.1%.
4. Interpret carefully: collection increased overall, but four weeks are not enough to prove a permanent trend.

Reading graphs critically

Check the title, labels, units, scale intervals, and source. A vertical axis that does not start at zero can exaggerate visual differences. Association between two variables does not by itself prove that one caused the other.

Ungraded self-check

1. For 6, 7, 7, 9, 11, find the mean, median, mode, and range.
2. Which graph would best show daily rainfall across two weeks? Explain.
3. A survey about internet access includes only students in an online club. Identify the likely bias.
4. Write one conclusion the data supports and one claim it cannot support.

Summary

A statistical investigation connects a focused question to suitable data, an honest display, accurate summary measures, and a cautious interpretation. Always consider sample quality, scale, unusual values, and the limits of the evidence.""",
    },
)


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "")
    url = make_url(value)
    if (
        url.drivername.split("+")[0] != "postgresql"
        or url.host not in {"localhost", "127.0.0.1"}
        or (url.database or "").casefold() != DATABASE_NAME.casefold()
    ):
        raise RuntimeError("Refusing to target a non-local or non-Entervene_Demo database")
    return value


def _existing_is_valid(
    db: Session, classwork: Classwork, lesson: Lesson, *, class_id: int, period_id: int
) -> bool:
    lesson_link = db.query(ClassworkLesson).filter_by(
        classwork_id=classwork.classwork_id, lesson_id=lesson.lesson_id
    ).one_or_none()
    assignment = db.query(ClassworkAssignment).filter_by(
        classwork_id=classwork.classwork_id, class_id=class_id
    ).one_or_none()
    return bool(
        classwork.classwork_type == "READING"
        and classwork.is_graded is False
        and classwork.total_points is None
        and classwork.is_published is True
        and classwork.is_archived is False
        and classwork.subject_id == lesson.subject_id
        and classwork.created_by_staff_id == lesson.created_by_staff_id
        and classwork.instructions
        and lesson_link
        and assignment
        and assignment.academic_period_id == period_id
        and assignment.assigned_by_staff_id == lesson.created_by_staff_id
        and assignment.is_published is True
        and assignment.is_locked is False
        and assignment.max_attempts is None
    )


def populate() -> dict:
    engine = create_engine(_database_url(), pool_pre_ping=True)
    report = {"database": None, "created": [], "reused": [], "skipped": []}
    try:
        with engine.connect() as connection:
            report["database"] = connection.execute(text("select current_database()")).scalar_one()
        if str(report["database"]).casefold() != DATABASE_NAME.casefold():
            raise RuntimeError("Connected database identity does not match Entervene_Demo")

        with Session(engine) as db, db.begin():
            load = db.query(SubjectLoad).filter(
                SubjectLoad.staff_id == TEACHER_ID,
                SubjectLoad.subject_id == SUBJECT_ID,
                SubjectLoad.class_id == CLASS_ID,
                SubjectLoad.academic_period_id == PERIOD_ID,
                SubjectLoad.status.in_(["active", "published"]),
                SubjectLoad.is_active_version.is_(True),
            ).one()
            ensure_subject_owner(db, TEACHER_ID, SUBJECT_ID)
            ensure_class_targets(db, TEACHER_ID, SUBJECT_ID, [CLASS_ID], PERIOD_ID)

            for spec in READINGS:
                lesson = (
                    db.query(Lesson)
                    .join(Competency, Competency.competency_id == Lesson.competency_id)
                    .filter(
                        Lesson.title == spec["lesson_title"],
                        Lesson.subject_id == SUBJECT_ID,
                        Lesson.created_by_staff_id == TEACHER_ID,
                        Lesson.is_archived.is_(False),
                        Lesson.is_published.is_(True),
                        Competency.competency_code == spec["competency_code"],
                        Competency.subject_id == SUBJECT_ID,
                        Competency.academic_period_id == PERIOD_ID,
                        Competency.is_archived.is_(False),
                    )
                    .one_or_none()
                )
                if lesson is None:
                    report["skipped"].append(
                        {"title": spec["title"], "reason": "verified Lesson-Competency mapping not found"}
                    )
                    continue

                ensure_lessons_owned(db, TEACHER_ID, SUBJECT_ID, [lesson.lesson_id])
                existing = db.query(Classwork).filter(
                    Classwork.title == spec["title"],
                    Classwork.created_by_staff_id == TEACHER_ID,
                    Classwork.subject_id == SUBJECT_ID,
                ).one_or_none()
                if existing is not None:
                    assignment = db.query(ClassworkAssignment).filter_by(
                        classwork_id=existing.classwork_id, class_id=CLASS_ID
                    ).one_or_none()
                    generated_by_this_script = bool(
                        existing.description == spec["description"]
                        and existing.instructions == spec["body"]
                        and existing.classwork_type == "READING"
                        and existing.is_graded is False
                        and existing.subject_id == SUBJECT_ID
                        and existing.created_by_staff_id == TEACHER_ID
                        and assignment is not None
                    )
                    normalized_fields = []
                    if generated_by_this_script and existing.total_points is not None:
                        existing.total_points = None
                        normalized_fields.append("total_points")
                    if generated_by_this_script and assignment.max_attempts is not None:
                        assignment.max_attempts = None
                        normalized_fields.append("max_attempts")
                    if normalized_fields:
                        db.flush()
                    if not _existing_is_valid(db, existing, lesson, class_id=CLASS_ID, period_id=PERIOD_ID):
                        raise RuntimeError(
                            f"Existing classwork '{spec['title']}' is not a valid aligned Reading; refusing to overwrite it"
                        )
                    report["reused"].append(
                        {
                            "classwork_id": existing.classwork_id,
                            "title": existing.title,
                            "lesson_id": lesson.lesson_id,
                            "normalized_fields": normalized_fields,
                        }
                    )
                    continue

                classwork = Classwork(
                    title=spec["title"],
                    description=spec["description"],
                    instructions=spec["body"],
                    classwork_type="READING",
                    classwork_category=None,
                    exam_subtype=None,
                    activity_mode="ONLINE",
                    is_graded=False,
                    total_points=None,
                    is_locked=False,
                    is_published=True,
                    show_scores=False,
                    is_archived=False,
                    subject_id=SUBJECT_ID,
                    created_by_staff_id=TEACHER_ID,
                )
                db.add(classwork)
                db.flush()
                # Match the production Reading workflow, which clears the
                # legacy scoring default after the initial insert flush.
                classwork.total_points = None
                db.add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=lesson.lesson_id))
                assignment = ClassworkAssignment(
                    classwork_id=classwork.classwork_id,
                    class_id=CLASS_ID,
                    academic_period_id=PERIOD_ID,
                    assigned_by_staff_id=TEACHER_ID,
                    publish_date=None,
                    due_date=None,
                    lock_date=None,
                    is_published=True,
                    is_locked=False,
                    allow_late_submissions=False,
                    max_attempts=None,
                )
                db.add(assignment)
                db.flush()
                assignment.max_attempts = None
                report["created"].append(
                    {
                        "classwork_id": classwork.classwork_id,
                        "title": classwork.title,
                        "lesson_id": lesson.lesson_id,
                        "competency_id": lesson.competency_id,
                        "competency_code": spec["competency_code"],
                        "subject_load_id": load.subject_load_id,
                    }
                )
        return report
    finally:
        engine.dispose()


if __name__ == "__main__":
    print(json.dumps(populate(), indent=2))
