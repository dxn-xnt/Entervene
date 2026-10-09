"""Standalone, INSERT-only dashboard fixture for a disposable local preview DB.

Never import this module from the application. The CLI reads ONLY
DASHBOARD_PREVIEW_SEED_URL, never dotenv/settings/application sessions. Dry-run
performs SELECTs in a read-only transaction; it never inserts and rolls back.
All console output is allowlisted count-level data or static error codes.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_DOWN
from hashlib import sha256
import json
import os
from pathlib import Path
import random
import sys
from typing import Mapping
from zoneinfo import ZoneInfo

from sqlalchemy import and_, create_engine, event, insert, or_, select, text
from sqlalchemy.engine import Connection, Engine, URL, make_url

# Running a script by path puts scripts/, not backend/, on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectGroup import SubjectGroup
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.ComponentMapper import classify_template_component_name
from app.services.grading.CurrentThreeTermTransmutation import (
    CURRENT_THREE_TERM_BOUNDS, transmute_current_three_term_grade,
)

DATABASE = "entervene_preview"
URL_ENV = "DASHBOARD_PREVIEW_SEED_URL"
PREFIX = "dashboard-preview-v1:"
RANDOM_SEED = 20261010
MANILA = ZoneInfo("Asia/Manila")
LOCK_ID = 62703412261010
TABLES = {model.__table__.name: model.__table__ for model in (
    GradingTemplate, GradingTemplateComponent, Classwork, ClassworkAssignment,
    Quiz, Question, QuizQuestion, StudentSubmission, QuizAnswer, AttendanceRecord,
)}
# 36 available entries in the illustrative 19-learner/two-subject roster.
PROFILE = (97, 96, 95, 95, 92, 90, 85, 85, 86, 86, 87, 88, 89, 89,
           80, 80, 81, 81, 82, 82, 83, 84, 84, 75, 75, 76, 76, 77, 78,
           79, 79, 60, 65, 69, 70, 73)
ESSENTIAL = Counter((97, 96, 95, 95, 90, 89, 85, 86, 84, 84, 83, 82, 80, 79, 60))


class SeedError(Exception):
    """Only static, non-sensitive codes may reach the CLI."""


def validate_url(raw: str | None, environ: Mapping[str, str]) -> URL:
    if not raw:
        raise SeedError("preview_url_unset")
    # Reject libpq routing AND credential fallbacks; the dedicated URL is sole input.
    if any(key.startswith("PG") for key in environ):
        raise SeedError("libpq_environment_override_forbidden")
    try:
        url = make_url(raw)
        valid = (url.drivername in {"postgresql", "postgresql+psycopg2"}
                 and url.host in {"localhost", "127.0.0.1"}
                 and url.database == DATABASE and not url.query
                 and url.port is not None and 1 <= url.port <= 65535)
    except Exception:
        raise SeedError("invalid_preview_url") from None
    if not valid:
        raise SeedError("preview_target_guard_failed")
    return url


def guarded_engine(environ: Mapping[str, str]) -> Engine:
    url = validate_url(environ.get(URL_ENV), environ)
    return create_engine(url, connect_args={"hostaddr": "127.0.0.1"},
                         echo=False, hide_parameters=True, isolation_level="SERIALIZABLE")


def check_database(connection: Connection) -> None:
    if connection.execute(text("SELECT current_database()")).scalar_one() != DATABASE:
        raise SeedError("connected_database_guard_failed")


def install_statement_guard(connection: Connection, *, dry_run: bool):
    def guard(_conn, _cursor, statement, _parameters, _context, _many):
        command = statement.lstrip().upper()
        allowed = command.startswith("SELECT ")
        if not dry_run:
            allowed = allowed or command.startswith("INSERT INTO ")
        if dry_run and command.strip() == "SET TRANSACTION READ ONLY":
            allowed = True
        if not allowed:
            raise SeedError("non_insert_write_forbidden")
    event.listen(connection, "before_cursor_execute", guard)
    return guard


@dataclass(frozen=True)
class Ref:
    key: str


@dataclass
class Row:
    key: str
    table: str
    identity: tuple[str, ...]
    values: dict


@dataclass
class Plan:
    rows: list[Row]
    counts: dict[str, int]
    grades: dict[tuple[int, int, object], int]
    prefix: str
    fingerprint: str


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), MANILA).astimezone(timezone.utc)


def attendance_dates(now: datetime, start: date, end: date) -> list[date]:
    today = now.astimezone(MANILA).date()
    count = min(10, today.day)
    if count < 5:
        raise SeedError("attendance_requires_at_least_5_elapsed_dates")
    dates = [today.replace(day=1) + timedelta(days=i) for i in range(count)]
    if not all(start <= day <= min(end, today) for day in dates):
        raise SeedError("selected_period_does_not_cover_attendance_slots")
    return dates


def attendance_statuses(count: int) -> list[str]:
    # At least one of each status is required. For 5-10 slots this is the
    # closest 70/10/10/10 mix subject to that coverage constraint.
    if not 5 <= count <= 10:
        raise SeedError("invalid_attendance_slot_count")
    result = ["present"] * count
    result[1:4] = ["late", "absent", "excused"]
    return result


def weekday_dates(now: datetime, start: date, end: date) -> list[date]:
    today = now.astimezone(MANILA).date()
    first = max(start, today.replace(day=1))
    if first + timedelta(days=6) > min(end, today - timedelta(days=1)):
        first = min(end, today - timedelta(days=1)) - timedelta(days=6)
    if first < start:
        raise SeedError("seven_elapsed_submission_weekdays_required")
    return [first + timedelta(days=i) for i in range(7)]


def raw_score(term_grade: int) -> Decimal:
    bounds = [(Decimal(value), grade) for value, grade in CURRENT_THREE_TERM_BOUNDS]
    for index, (low, grade) in enumerate(bounds):
        if grade == term_grade:
            high = bounds[index - 1][0] if index else Decimal(100)
            score = ((low + high) / 2).quantize(Decimal("0.01"))
            if transmute_current_three_term_grade(score) != term_grade:
                break
            return score
    raise SeedError("invalid_fixture_grade")


def grade_profile(size: int) -> list[int]:
    if size < sum(ESSENTIAL.values()):
        raise SeedError("insufficient_entries_for_grade_scenarios")
    result = list(PROFILE)
    while len(result) > size:
        counts = Counter(result)
        index = next(i for i in range(len(result) - 1, -1, -1)
                     if counts[result[i]] > ESSENTIAL[result[i]])
        result.pop(index)
    extras = (74, 73, 75, 80, 82, 86)
    while len(result) < size:
        result.append(extras[(len(result) - len(PROFILE)) % len(extras)])
    return result


def _resolve_template(conn: Connection, subject: Mapping, level_id: int):
    table = GradingTemplate.__table__
    active = list(conn.execute(select(table).where(table.c.status == "active")).mappings())
    ref = (subject["default_grading_template"] or "").strip()
    tiers = []
    if ref.isdigit():
        tiers.append([row for row in active if row["grading_template_id"] == int(ref)])
    if ref:
        tiers.append([row for row in active if row["template_name"].lower() == ref.casefold()])
    tiers.extend((
        [row for row in active if row["subject_id"] == subject["subject_id"]],
        [row for row in active if row["academic_level_id"] == level_id and row["subject_id"] is None],
        [row for row in active if row["template_name"].lower() == "core subjects"],
    ))
    template = next((tier for tier in tiers if tier), [])
    if len(template) > 1:
        raise SeedError("ambiguous_grading_template")
    if not template:
        return None, (Decimal("0.3"), Decimal("0.5"), Decimal("0.2"))
    components = conn.execute(select(GradingTemplateComponent.__table__).where(
        GradingTemplateComponent.grading_template_id == template[0]["grading_template_id"])).mappings()
    totals = {key: Decimal(0) for key in ("WW", "PT", "QA")}
    for component in components:
        category = classify_template_component_name(component["component_name"])
        value = Decimal(str(component["weight"]))
        if not value.is_finite() or value <= 0:
            raise SeedError("invalid_existing_grading_weights")
        if category:
            totals[category] += value
    total = sum(totals.values())
    if total <= 0:
        raise SeedError("existing_template_has_no_usable_components")
    weights = tuple(Decimal(str(round(float(totals[key] / total), 4))) for key in ("WW", "PT", "QA"))
    return template[0]["grading_template_id"], weights


def build_plan(conn: Connection, staff_id: str, period_id: int, now: datetime) -> Plan:
    """Read existing structure and produce plain dictionaries, never ORM writes."""
    if not staff_id or period_id <= 0 or now.tzinfo is None:
        raise SeedError("invalid_seed_scope")
    staff = conn.execute(select(AcademicStaff.staff_id).where(AcademicStaff.staff_id == staff_id)).first()
    period = conn.execute(select(AcademicPeriod.__table__).where(
        AcademicPeriod.academic_period_id == period_id)).mappings().first()
    if not staff or not period:
        raise SeedError("teacher_or_period_missing")
    slots = attendance_dates(now, period["start_date"], period["end_date"])
    weeks = weekday_dates(now, period["start_date"], period["end_date"])
    late_date = slots[3]
    normal_date = max(weeks[-1], late_date) + timedelta(days=1)
    if normal_date > period["end_date"]:
        raise SeedError("selected_period_cannot_fit_distinct_deadlines")
    loads = list(conn.execute(select(SubjectLoad.__table__).where(
        SubjectLoad.academic_period_id == period_id, SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(("active", "published")))).mappings())
    classes = {row["class_id"]: row for row in conn.execute(select(Class.__table__).where(
        Class.academic_year_id == period["academic_year_id"], Class.class_status == "active")).mappings()}
    scopes = sorted({(row["class_id"], row["subject_id"]) for row in loads
                     if row["staff_id"] == staff_id and row["class_id"] in classes})
    if not scopes:
        raise SeedError("no_assigned_active_loads")
    for scope in scopes:
        matching = [row for row in loads if (row["class_id"], row["subject_id"]) == scope]
        if len(matching) != 1 or matching[0]["staff_id"] != staff_id:
            raise SeedError("ambiguous_shared_load_authorization")
    class_ids = {cid for cid, _ in scopes}
    rosters = {cid: [] for cid in class_ids}
    for row in conn.execute(select(StudentClass.class_id, StudentClass.student_id).where(
        StudentClass.class_id.in_(class_ids), StudentClass.academic_year_id == period["academic_year_id"],
        StudentClass.enrollment_status == "enrolled")):
        rosters[row.class_id].append(row.student_id)
    for values in rosters.values():
        values.sort(key=str)
        if not values:
            raise SeedError("empty_active_roster")
    subjects = {row["subject_id"]: row for row in conn.execute(select(Subject.__table__).where(
        Subject.subject_id.in_({sid for _, sid in scopes}))).mappings()}
    groups = {row["subject_group_id"]: row for row in conn.execute(select(SubjectGroup.__table__)).mappings()}
    thresholds = {}
    templates = {}
    weights = {}
    for cid, sid in scopes:
        group = groups.get(subjects[sid]["subject_group_id"])
        if not group or not group["is_active"]:
            raise SeedError("invalid_subject_group_configuration")
        value = Decimal(str(group["passing_threshold"]))
        if not value.is_finite() or not 0 <= value <= 100:
            raise SeedError("invalid_subject_group_configuration")
        thresholds[sid] = value
        template, resolved = _resolve_template(conn, subjects[sid], classes[cid]["academic_level_id"])
        templates[(cid, sid)] = template
        weights[(cid, sid)] = resolved
    entries = [(cid, sid, student) for cid, sid in scopes for student in rosters[cid]]
    missing = None
    for candidate in sorted({row[2] for row in entries}, key=str, reverse=True):
        remaining = [row for row in entries if row[2] != candidate]
        counts = Counter(thresholds[row[1]] for row in remaining)
        multi = Counter(row[2] for row in remaining)
        if len(remaining) >= 15 and counts[Decimal(85)] >= 3 and counts[Decimal(83)] >= 3 and max(multi.values()) >= 2:
            missing = candidate
            break
    if missing is None:
        raise SeedError("insufficient_roster_or_85_83_multi_subject_scenarios")
    available = [row for row in entries if row[2] != missing]
    pool = grade_profile(len(available))
    grades = {}
    for threshold, targets in ((Decimal(85), (84, 85, 86)), (Decimal(83), (83, 84, 82))):
        selected = [row for row in available if thresholds[row[1]] == threshold][:3]
        for entry, grade in zip(selected, targets):
            grades[entry] = grade
            pool.remove(grade)
    for entry, grade in zip((row for row in available if row not in grades), pool):
        grades[entry] = grade
    for (cid, sid, _), grade in grades.items():
        initial = round(sum(float(raw_score(grade)) * float(weight) for weight in weights[(cid, sid)]), 2)
        if transmute_current_three_term_grade(initial) != grade:
            raise SeedError("weights_cannot_reproduce_fixture_grades")
    extra_scope = next(scope for scope in scopes if sum(row[:2] == scope for row in available) >= 2)
    extra_students = [row[2] for row in available if row[:2] == extra_scope]
    excused_student, late_student = extra_students[:2]
    prefix = PREFIX + sha256(f"{staff_id}|{period_id}".encode()).hexdigest()[:16]
    fingerprint = sha256(json.dumps({
        "slots": [day.isoformat() for day in slots], "week": [day.isoformat() for day in weeks],
        "grades": [(cid, sid, str(student), grade) for (cid, sid, student), grade in grades.items()],
        "thresholds": sorted((sid, str(value)) for sid, value in thresholds.items()),
        "weights": sorted((cid, sid, [str(value) for value in values]) for (cid, sid), values in weights.items()),
        "missing": str(missing), "seed": RANDOM_SEED,
    }, sort_keys=True).encode()).hexdigest()
    # Every existing activity row in this target must belong to this exact plan.
    work = Classwork.__table__
    assignment = ClassworkAssignment.__table__
    conditions = [(assignment.c.class_id == cid) & (work.c.subject_id == sid) for cid, sid in scopes]
    existing_work = conn.execute(select(work.c.description).join(assignment,
        assignment.c.classwork_id == work.c.classwork_id).where(
        assignment.c.academic_period_id == period_id, or_(*conditions))).scalars()
    for marker in existing_work:
        if not marker or not marker.startswith(prefix + "|"):
            raise SeedError("preexisting_scope_activity_conflict")
        if not marker.endswith("|" + fingerprint):
            raise SeedError("seed_inputs_changed_start_with_fresh_preview")
    if conn.execute(select(StudentPeriodGrade.period_grade_id).where(
        StudentPeriodGrade.academic_period_id == period_id,
        or_(*[(StudentPeriodGrade.class_id == cid) & (StudentPeriodGrade.subject_id == sid) for cid, sid in scopes]))).first():
        raise SeedError("preexisting_saved_grades_conflict")
    for record in conn.execute(select(AttendanceRecord.__table__).where(
        AttendanceRecord.class_id.in_(class_ids), AttendanceRecord.date >= slots[0],
        AttendanceRecord.date <= min(now.astimezone(MANILA).date(), period["end_date"])) ).mappings():
        if record["student_id"] in rosters[record["class_id"]] and record["remarks"] != prefix + "|" + fingerprint:
            raise SeedError("preexisting_attendance_conflict")
    rows = []
    def add(key, table, identity, **values):
        rows.append(Row(key, table, tuple(identity), values))
        return Ref(key)
    created = at(weeks[0], 0)
    new_templates = {}
    for cid, sid in scopes:
        owned_template = conn.execute(select(GradingTemplate.grading_template_id).where(
            GradingTemplate.template_name == f"{prefix}:subject:{sid}")).first()
        if (templates[(cid, sid)] is None or owned_template) and sid not in new_templates:
            template = add(f"template:{sid}", "grading_template", ("template_name",),
                template_name=f"{prefix}:subject:{sid}", description=prefix + "|" + fingerprint,
                academic_level_id=None, subject_id=sid, status="active", created_at=created, updated_at=created)
            new_templates[sid] = template
            for order, (name, weight) in enumerate((("Written Work", 30), ("Performance Task", 50), ("Examinations", 20)), 1):
                add(f"component:{sid}:{order}", "grading_template_component", ("grading_template_id", "display_order"),
                    grading_template_id=template, component_name=name, weight=Decimal(weight),
                    display_order=order, created_at=created, updated_at=created)
    rng = random.Random(RANDOM_SEED)
    shuffled_week = list(weeks)
    rng.shuffle(shuffled_week)
    bins = [0] * 7
    completed = 0
    kinds = (("written", "QUIZ", "WRITTEN_WORK", None),
             ("performance", "ACTIVITY", "PERFORMANCE_TASK", None),
             ("exam1", "ASSIGNMENT", "EXAMS", "SUMMATIVE_1"),
             ("exam2", "ASSIGNMENT", "EXAMS", "SUMMATIVE_2"),
             ("term", "ASSIGNMENT", "EXAMS", "TERM_EXAM"))
    question_texts = (
        "There are 12 red cards and 8 blue cards. How many cards are there altogether?",
        "The rain fell all day. Tom stayed indoors. State where Tom spent the day.",
        "A seedling grew from 4 cm to 9 cm. State the increase in height.",
        "A learner checks a result twice before reporting it. Give one reason to check a result.",
        "A class sorts materials into reusable and disposable groups. Explain the distinction.",
    )
    for cid, sid in scopes:
        scope_kinds = list(kinds) + ([("late_task", "ACTIVITY", "PERFORMANCE_TASK", None)] if (cid, sid) == extra_scope else [])
        for kind, cw_type, category, subtype in scope_kinds:
            key = f"work:{cid}:{sid}:{kind}"
            cw = add(key, "classwork", ("description",), title=f"Preview dashboard - {kind}",
                description=f"{prefix}|{cid}|{sid}|{kind}|{fingerprint}", instructions="Synthetic preview fixture only.",
                classwork_type=cw_type, classwork_category=category, exam_subtype=subtype,
                activity_mode="ONLINE" if kind == "written" else "MANUAL", is_graded=True,
                total_points=Decimal(100), is_locked=False, is_published=True, show_scores=True,
                is_archived=False, subject_id=sid, created_by_staff_id=staff_id, created_at=created, updated_at=created)
            assigned = add(key + ":assignment", "classwork_assignment", ("classwork_id", "class_id"),
                classwork_id=cw, class_id=cid, academic_period_id=period_id, recipient_student_id=None,
                source_intervention_id=None, remediation_request_id=None, original_exam_assignment_id=None,
                assigned_by_staff_id=staff_id, publish_date=created, assigned_at=created,
                due_date=at(late_date, 16) if kind == "late_task" else at(normal_date, 23),
                lock_date=None, is_published=True, is_locked=False, allow_late_submissions=True, max_attempts=1)
            links = []
            if kind == "written":
                quiz = add(key + ":quiz", "quiz", ("classwork_id",), classwork_id=cw,
                    total_items=5, duration_minutes=30, accessible_at=created, status="PUBLISHED", created_at=created)
                for order, stem in enumerate(question_texts, 1):
                    question = add(key + f":question:{order}", "question", ("explanation",),
                        question_text=stem, question_type="SHORT_ANSWER", difficulty_level="EASY", points=Decimal(20),
                        explanation=f"{prefix}|{cid}|{sid}|question:{order}|{fingerprint}",
                        is_ai_generated=False, expected_answer_type="TEXT", created_at=created)
                    links.append(add(key + f":link:{order}", "quiz_question", ("quiz_id", "display_order"),
                        quiz_id=quiz, question_id=question, display_order=order))
            for student in rosters[cid]:
                if student == missing:
                    continue
                score = raw_score(grades[(cid, sid, student)])
                submitted = at(shuffled_week[completed % 7], 9)
                status = "graded"
                if kind == "late_task":
                    submitted = at(late_date, 9)
                    if student in (excused_student, late_student):
                        submitted = at(late_date, 18 if student == excused_student else 17)
                        status = "late"
                if submitted + timedelta(minutes=15) > now.astimezone(timezone.utc):
                    raise SeedError("fixture_submission_would_be_future")
                submission = add(key + f":submission:{student}", "student_submission", ("classwork_assignment_id", "student_id"),
                    student_id=student, classwork_assignment_id=assigned, submitted_at=submitted, status=status,
                    grade=score, feedback="Synthetic preview fixture.", attempt_count=1,
                    graded_at=submitted + timedelta(minutes=15), graded_by_staff_id=staff_id, created_at=submitted)
                bins[submitted.astimezone(MANILA).weekday()] += 1
                completed += 1
                if links:
                    part = (score / 5).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
                    for order, link in enumerate(links):
                        add(key + f":answer:{student}:{order}", "quiz_answer", ("submission_id", "quiz_question_id"),
                            quiz_question_id=link, submission_id=submission, answer_text="Synthetic practice response.",
                            is_correct=None, points_awarded=part if order < 4 else score - part * 4)
    statuses = attendance_statuses(len(slots))
    for cid in sorted(class_ids):
        sid = next(subject for cls, subject in scopes if cls == cid)
        learners = list(rosters[cid])
        rng.shuffle(learners)
        for index, (day, status) in enumerate(zip(slots, statuses)):
            student = learners[index % len(learners)]
            if cid == extra_scope[0] and status == "excused":
                student = excused_student
            add(f"attendance:{cid}:{index}", "attendance_record", ("student_id", "class_id", "subject_id", "date"),
                student_id=student, class_id=cid, subject_id=sid, date=day, status=status,
                remarks=prefix + "|" + fingerprint, recorded_by_staff_id=staff_id,
                created_at=created, updated_at=created)
    band_counts = [sum((grade >= low and (upper is None or grade < upper)) for grade in grades.values())
                   for low, upper in ((90, None), (85, 90), (80, 85), (75, 80), (0, 75))]
    counts = {
        "student_subject_entries": len(entries), "available_grades": len(grades),
        "unavailable_grades": len(entries) - len(grades), "passing_grades": sum(
            Decimal(grade) >= thresholds[sid] for (_, sid, _), grade in grades.items()),
        "grade_sum": sum(grades.values()), "top_cutoff_ties_omitted": 1,
        "completed_submissions": completed, "expected_submissions": 5 * len(entries) + len(rosters[extra_scope[0]]),
        "counted_late_submissions": 1, "excused_excluded_submissions": 1,
        "late_eligible_submissions": completed - 1, "pending_grading": 0,
        "attendance_slots_per_class": len(slots), "attendance_rows": len(slots) * len(class_ids),
        "attendance_present_per_class": statuses.count("present"), "attendance_late_per_class": 1,
        "attendance_excused_per_class": 1, "attendance_absent_per_class": 1,
    }
    counts.update(zip(("band_90_100", "band_85_89", "band_80_84", "band_75_79", "band_below_75"), band_counts))
    counts.update(zip(("weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"), bins))
    return Plan(rows, counts, grades, prefix, fingerprint)


def _resolved(values: Mapping, ids: Mapping[str, object]) -> dict | None:
    if any(isinstance(value, Ref) and value.key not in ids for value in values.values()):
        return None
    return {key: ids[value.key] if isinstance(value, Ref) else value for key, value in values.items()}


def _equal(actual, expected) -> bool:
    if isinstance(actual, datetime) and isinstance(expected, datetime):
        actual = actual if actual.tzinfo else actual.replace(tzinfo=timezone.utc)
        return actual.astimezone(timezone.utc) == expected.astimezone(timezone.utc)
    return actual == expected


def inspect_plan(conn: Connection, plan: Plan) -> tuple[dict[str, object], Counter, Counter]:
    ids = {}
    existing, missing = Counter(), Counter()
    for row in plan.rows:
        table = TABLES[row.table]
        identity = _resolved({field: row.values[field] for field in row.identity}, ids)
        found = [] if identity is None else list(conn.execute(select(table).where(
            and_(*(table.c[field] == value for field, value in identity.items())))).mappings())
        if len(found) > 1:
            raise SeedError("duplicate_seed_natural_key")
        if found:
            values = _resolved(row.values, ids)
            if values is None or any(not _equal(found[0][field], value) for field, value in values.items()):
                raise SeedError("existing_row_conflicts_with_seed_plan")
            ids[row.key] = found[0][next(iter(table.primary_key.columns)).name]
            existing[row.table] += 1
        else:
            missing[row.table] += 1
    # Refuse unexpected descendants, including a score for the deliberately
    # ungraded learner. Natural-key checks alone would miss those extra rows.
    children = (
        ("classwork_assignment", "classwork_id", "classwork"),
        ("quiz", "classwork_id", "classwork"),
        ("student_submission", "classwork_assignment_id", "classwork_assignment"),
        ("quiz_question", "quiz_id", "quiz"),
        ("quiz_answer", "submission_id", "student_submission"),
        ("grading_template_component", "grading_template_id", "grading_template"),
    )
    for child, foreign_key, parent in children:
        parent_ids = [ids[row.key] for row in plan.rows if row.table == parent and row.key in ids]
        if not parent_ids:
            continue
        table = TABLES[child]
        primary = next(iter(table.primary_key.columns))
        actual = set(conn.execute(select(primary).where(table.c[foreign_key].in_(parent_ids))).scalars())
        expected = {ids[row.key] for row in plan.rows if row.table == child and row.key in ids}
        if actual != expected:
            raise SeedError("unexpected_existing_seed_children")
    owned_attendance = set(conn.execute(select(AttendanceRecord.attendance_id).where(
        AttendanceRecord.remarks == plan.prefix + "|" + plan.fingerprint)).scalars())
    expected_attendance = {ids[row.key] for row in plan.rows
                           if row.table == "attendance_record" and row.key in ids}
    if owned_attendance != expected_attendance:
        raise SeedError("unexpected_existing_seed_attendance")
    return ids, existing, missing


def seed_connection(conn: Connection, staff_id: str, period_id: int, now: datetime, *, apply: bool):
    """Shared SQLite-testable core; CLI connection/target guards cannot be bypassed."""
    plan = build_plan(conn, staff_id, period_id, now)
    ids, existing, missing = inspect_plan(conn, plan)  # ALL checks before first INSERT.
    if apply:
        for row in plan.rows:
            if row.key in ids:
                continue
            table = TABLES[row.table]
            values = _resolved(row.values, ids)
            if values is None:
                raise SeedError("invalid_seed_dependency")
            result = conn.execute(insert(table).values(**values))
            ids[row.key] = result.inserted_primary_key[0]
    return plan, existing, missing


def print_counts(plan: Plan, existing: Counter, additions: Counter, *, apply: bool) -> None:
    print("Category Existing " + ("Inserted" if apply else "Would_insert") + " Conflicts")
    for name in sorted(TABLES):
        print(f"{name} {existing[name]} {additions[name]} 0")
    print("Metric Count")
    for name, count in plan.counts.items():
        print(f"{name} {count}")


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise SeedError("invalid_arguments")


def main(argv=None, *, environ=None) -> int:
    engine = None
    try:
        parser = SafeParser(description="Count-only, INSERT-only local preview dashboard fixture")
        parser.add_argument("--teacher-staff-id", required=True)
        parser.add_argument("--academic-period-id", required=True, type=int)
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument("--dry-run", action="store_true")
        mode.add_argument("--apply", action="store_true")
        args = parser.parse_args(argv)
        engine = guarded_engine(os.environ if environ is None else environ)
        with engine.connect() as conn:
            guard = install_statement_guard(conn, dry_run=not args.apply)
            try:
                with conn.begin():
                    if not args.apply:
                        conn.execute(text("SET TRANSACTION READ ONLY"))
                    check_database(conn)
                    if args.apply:
                        conn.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                    result = seed_connection(conn, args.teacher_staff_id, args.academic_period_id,
                                             datetime.now(timezone.utc), apply=args.apply)
            finally:
                event.remove(conn, "before_cursor_execute", guard)
        print_counts(*result, apply=args.apply)
        return 0
    except SeedError as error:
        print("ERROR " + str(error))
        return 2
    except KeyboardInterrupt:
        print("ERROR cancelled")
        return 2
    except Exception:
        # Deliberately do not expose exception text, SQL, URL, or traceback.
        print("ERROR preview_seed_failed")
        return 2
    finally:
        if engine is not None:
            try:
                engine.dispose()
            except Exception:
                # Disposal errors must not leak driver connection details.
                pass


if __name__ == "__main__":
    raise SystemExit(main())
