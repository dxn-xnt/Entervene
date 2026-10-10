"""Standalone, INSERT-only dashboard fixture for a disposable local preview DB.

Never import this module from the application. The CLI reads ONLY
DASHBOARD_PREVIEW_SEED_URL, never dotenv/settings/application sessions. Dry-run
performs SELECTs in a read-only transaction; it never inserts and rolls back.
Console output is allowlisted IDs, aggregate metrics, static reason codes, and
sanitized failure metadata. Exception messages, SQL, and parameters never print.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_DOWN
from hashlib import sha256
import json
import os
from pathlib import Path
import random
import re
import sys
from typing import Mapping
from zoneinfo import ZoneInfo

from sqlalchemy import and_, create_engine, event, insert, or_, select, text
from sqlalchemy import exc as sa_exc
from sqlalchemy.engine import Connection, Engine, URL, make_url
from sqlalchemy.schema import ForeignKeyConstraint, PrimaryKeyConstraint, UniqueConstraint

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
FAILURE_STAGES = frozenset({
    "arguments", "engine", "connect", "statement_guard", "transaction",
    "read_only", "database_check", "advisory_lock", "seed", "discover_scope",
    "build_plan", "inspect_plan", "guard_cleanup", "output",
} | {f"insert:{name}" for name in TABLES})
# Match classes, not arbitrary exception class names supplied by a driver.
FAILURE_TYPES = {kind: kind.__name__ for kind in (
    RuntimeError, ValueError, TypeError, KeyError, AttributeError, OSError,
    sa_exc.ArgumentError, sa_exc.InvalidRequestError, sa_exc.NoReferencedTableError,
    sa_exc.NoReferencedColumnError, sa_exc.IntegrityError, sa_exc.OperationalError,
    sa_exc.ProgrammingError, sa_exc.DataError, sa_exc.InterfaceError,
    sa_exc.InternalError, sa_exc.DatabaseError, sa_exc.DBAPIError,
    sa_exc.StatementError, sa_exc.TimeoutError,
)}


def approved_constraint_names() -> frozenset[str]:
    """Only local model identifiers, never arbitrary server metadata, may print."""
    names = set()
    for table in TABLES.values():
        for constraint in table.constraints:
            if isinstance(constraint.name, str):
                names.add(constraint.name)
            elif isinstance(constraint, PrimaryKeyConstraint):
                names.add(f"{table.name}_pkey")
            elif isinstance(constraint, ForeignKeyConstraint):
                # column_keys does not resolve/import the referenced model.
                names.add(f"{table.name}_{'_'.join(constraint.column_keys)}_fkey")
            elif isinstance(constraint, UniqueConstraint):
                names.add(f"{table.name}_{'_'.join(constraint.columns.keys())}_key")
    return frozenset(names)


APPROVED_CONSTRAINT_NAMES = approved_constraint_names()


def _safe_attribute(value, name):
    try:
        return getattr(value, name, None)
    except Exception:
        return None


@contextmanager
def failure_stage(stage: str):
    """Annotate without changing exception types, propagation, or rollback."""
    try:
        yield
    except Exception as error:
        if _safe_attribute(error, "_preview_seed_stage") is None:
            try:
                error._preview_seed_stage = stage
            except Exception:
                pass
        raise


def print_failure_diagnostics(error: Exception) -> None:
    """Never stringify exceptions or print SQL, parameters, URLs, or messages."""
    stage = _safe_attribute(error, "_preview_seed_stage")
    stage = stage if type(stage) is str and stage in FAILURE_STAGES else "unavailable"
    kind = FAILURE_TYPES.get(type(error), "unavailable")
    original = _safe_attribute(error, "orig")
    if original is None:
        original = error
    sqlstate = "unavailable"
    for field in ("pgcode", "sqlstate"):
        value = _safe_attribute(original, field)
        if type(value) is str and re.fullmatch(r"[0-9A-Z]{5}", value):
            sqlstate = value
            break
    raw_constraint = _safe_attribute(_safe_attribute(original, "diag"), "constraint_name")
    constraint = "unavailable" if raw_constraint is None else "redacted"
    if type(raw_constraint) is str and raw_constraint in APPROVED_CONSTRAINT_NAMES:
        constraint = raw_constraint
    print(f"DIAGNOSTIC stage={stage} exception_type={kind} sqlstate={sqlstate} constraint={constraint}")


# Background grades only; scenario allocation, not this list, determines size.
PROFILE = (97, 96, 95, 95, 92, 90, 85, 85, 86, 86, 87, 88, 89, 89,
           80, 80, 81, 81, 82, 82, 83, 84, 84, 75, 75, 76, 76, 77, 78,
           79, 79, 60, 65, 69, 70, 73)
SCENARIOS = (
    "top_3_cutoff_tie", "threshold_85_boundary_pair", "threshold_83_boundary_pair",
    "threshold_85_above", "threshold_83_above", "band_90_boundary_pair",
    "band_85_boundary_pair", "band_80_boundary_pair", "band_75_boundary_pair",
    "multi_subject_learner", "all_attendance_statuses", "excused_late_submission",
)
REASONS = {
    "preview_url_unset": "Set the dedicated preview URL in the process environment.",
    "libpq_environment_override_forbidden": "Remove libpq process overrides before seeding.",
    "invalid_preview_url": "The dedicated preview URL is malformed.",
    "preview_target_guard_failed": "Only a loopback PostgreSQL preview target with an explicit port and no query parameters is allowed.",
    "connected_database_guard_failed": "The connected database must be exactly entervene_preview.",
    "non_insert_write_forbidden": "A statement outside the approved read/insert policy was refused.",
    "invalid_seed_scope": "Provide valid IDs and a timezone-aware clock.",
    "teacher_or_period_missing": "The selected teacher or academic period does not exist.",
    "no_teacher_period_candidate": "No assigned teacher/period pair covers this Manila month through today.",
    "no_teacher_period_candidate_for_class": "No assigned teacher/period pair for the requested class covers this Manila month through today.",
    "no_assigned_active_loads": "The selected teacher has no eligible assigned loads in this period.",
    "class_not_active_in_period": "The requested class must exist, be active, and belong to the selected period's academic year.",
    "class_not_assigned_to_teacher_in_period": "The requested class has no eligible load assigned to this teacher in the selected period.",
    "ambiguous_shared_load_authorization": "An active class-subject load has ambiguous teacher ownership.",
    "empty_active_roster": "An assigned class has no enrolled learners in the selected academic year.",
    "insufficient_enrolled_learners": "At least three enrolled learners are needed, including one ungraded learner.",
    "no_shared_graded_scope": "After reserving one ungraded learner, two graded learners must share a class-subject scope.",
    "no_subject_at_threshold_85": "No subject at threshold 85 is among this teacher's loads.",
    "no_subject_at_threshold_83": "No subject at threshold 83 is among this teacher's loads.",
    "insufficient_matching_grade_entries": "Too few unused or reusable grade entries fit this scenario.",
    "no_multi_subject_learner": "No remaining graded learner has two subjects.",
    "invalid_subject_group_configuration": "A referenced subject group or its threshold is missing or invalid.",
    "ambiguous_grading_template": "More than one active grading template matches the same priority.",
    "invalid_existing_grading_weights": "Existing grading weights are invalid.",
    "existing_template_has_no_usable_components": "The existing template has no usable grading components.",
    "weights_cannot_reproduce_fixture_grades": "Existing weights cannot reproduce the planned current grades.",
    "attendance_requires_at_least_5_elapsed_dates": "At least five calendar dates must have elapsed in this Manila month.",
    "selected_period_does_not_cover_attendance_slots": "The selected period does not cover all required attendance dates.",
    "invalid_attendance_slot_count": "Attendance requires five to ten date slots.",
    "seven_elapsed_submission_weekdays_required": "The period must cover seven elapsed dates for weekday examples.",
    "selected_period_cannot_fit_distinct_deadlines": "The selected period cannot fit the planned deadlines.",
    "fixture_submission_would_be_future": "A planned submission would occur in the future.",
    "invalid_fixture_grade": "A planned grade cannot be represented by the current transmutation table.",
    "preexisting_scope_activity_conflict": "Existing activity in the target scope is not owned by this seed.",
    "seed_inputs_changed_start_with_fresh_preview": "Existing seed activity was made with a different plan; it will not be overwritten.",
    "preexisting_saved_grades_conflict": "Existing saved period grades will not be overwritten.",
    "preexisting_attendance_conflict": "Existing attendance conflicts with the planned preview records.",
    "duplicate_seed_natural_key": "More than one existing row matches a planned seed identity.",
    "existing_row_conflicts_with_seed_plan": "An existing row differs from the planned seed values.",
    "unexpected_existing_seed_children": "Unexpected rows are attached to existing seed activity.",
    "unexpected_existing_seed_attendance": "Unexpected attendance is attached to the existing seed plan.",
    "invalid_seed_dependency": "A planned row has an unresolved dependency.",
    "invalid_arguments": "Use dry-run or apply with optional teacher, period, and class IDs.",
    "cancelled": "The operation was cancelled.",
    "preview_seed_failed": "The operation failed; connection and database details were suppressed.",
}


class SeedError(Exception):
    """Only static, non-sensitive codes may reach the CLI."""

    def __init__(self, code, **counts):
        super().__init__(code)
        self.code = code
        self.counts = counts
        self.chosen_ids = None


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
    staff_id: str
    period_id: int
    scenarios: tuple[str, ...]
    skipped: tuple["SkippedScenario", ...]
    class_id: int | None = None


@dataclass(frozen=True)
class SkippedScenario:
    code: str
    reason: str
    available: int
    required: int


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


def validate_class_filter(class_id: int | None) -> None:
    if class_id is not None and (type(class_id) is not int or class_id <= 0):
        raise SeedError("invalid_seed_scope")


def discover_scope(conn: Connection, staff_id: str | None, period_id: int | None,
                   now: datetime, *, class_id: int | None = None) -> tuple[str, int]:
    """SELECT IDs only; rank distinct enrolled learners in Python, not load rows.

    Supplying either ID constrains discovery of the other. Supplying both uses
    exactly that pair and leaves all existing preflight validation in place.
    A chosen pair's failed safety checks never cause silent teacher fallback.
    A class filter constrains eligible loads and the enrolled-learner ranking.
    """
    validate_class_filter(class_id)
    if staff_id is not None and period_id is not None:
        return staff_id, period_id
    today = now.astimezone(MANILA).date()
    query = select(SubjectLoad.staff_id, SubjectLoad.academic_period_id,
                   SubjectLoad.class_id, AcademicPeriod.academic_year_id).join(
        AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id
    ).join(Class, Class.class_id == SubjectLoad.class_id).join(
        AcademicStaff, AcademicStaff.staff_id == SubjectLoad.staff_id
    ).where(
        SubjectLoad.is_active_version.is_(True), SubjectLoad.status.in_(("active", "published")),
        Class.class_status == "active", Class.academic_year_id == AcademicPeriod.academic_year_id,
        AcademicPeriod.start_date <= today.replace(day=1), AcademicPeriod.end_date >= today,
    )
    if staff_id is not None:
        query = query.where(SubjectLoad.staff_id == staff_id)
    if period_id is not None:
        query = query.where(SubjectLoad.academic_period_id == period_id)
    if class_id is not None:
        query = query.where(SubjectLoad.class_id == class_id)
    choices = {}
    for row in conn.execute(query):
        choices.setdefault((row.staff_id, row.academic_period_id), set()).add(
            (row.class_id, row.academic_year_id))
    if not choices:
        code = "no_teacher_period_candidate_for_class" if class_id is not None else "no_teacher_period_candidate"
        raise SeedError(code, candidate_pairs=0)
    class_ids = {cid for scopes in choices.values() for cid, _ in scopes}
    rosters = {}
    for row in conn.execute(select(StudentClass.class_id, StudentClass.academic_year_id,
                                   StudentClass.student_id).where(
            StudentClass.class_id.in_(class_ids), StudentClass.enrollment_status == "enrolled")):
        rosters.setdefault((row.class_id, row.academic_year_id), set()).add(row.student_id)
    ranked = []
    for pair, scopes in choices.items():
        learners = set().union(*(rosters.get(scope, set()) for scope in scopes))
        ranked.append((-len(learners), str(pair[0]), pair[1], pair))
    # Staff ID then period ID break equal-roster ties deterministically.
    return min(ranked)[3]


def plan_scenarios(entries, thresholds):
    """Allocate compatible grade examples by priority; never fabricate a roster.

    A boundary pair is below/equal. Above-threshold examples are optional next
    priorities. Later band pairs reuse earlier compatible entries where possible.
    """
    grades, included, skipped = {}, [], []
    positions = {entry: index for index, entry in enumerate(entries)}
    specifications = (
        ("top_3_cutoff_tie", (97, 96, 95, 95), None),
        ("threshold_85_boundary_pair", (84, 85), Decimal(85)),
        ("threshold_83_boundary_pair", (82, 83), Decimal(83)),
        ("threshold_85_above", (86,), Decimal(85)),
        ("threshold_83_above", (84,), Decimal(83)),
        ("band_90_boundary_pair", (89, 90), None),
        ("band_85_boundary_pair", (84, 85), None),
        ("band_80_boundary_pair", (79, 80), None),
        ("band_75_boundary_pair", (74, 75), None),
    )
    for code, targets, threshold in specifications:
        eligible = [entry for entry in entries if threshold is None or thresholds[entry[1]] == threshold]
        if not eligible and threshold is not None:
            reason = (f"no_subject_at_threshold_{int(threshold)}" if threshold not in thresholds.values()
                      else "insufficient_matching_grade_entries")
            skipped.append(SkippedScenario(code, reason, 0, len(targets)))
            continue
        proposed, used, matched = dict(grades), set(), 0
        for target in targets:
            reusable = next((entry for entry in eligible if entry not in used and proposed.get(entry) == target), None)
            free = [entry for entry in eligible if entry not in proposed]
            if reusable is None and not free:
                break
            if reusable is None:
                counts = Counter(thresholds[entry[1]] for entry in free)
                # Preserve scarce 85/83 slots when assigning unconstrained grades.
                reusable = max(free, key=lambda entry: (
                    thresholds[entry[1]] not in (Decimal(85), Decimal(83)),
                    counts[thresholds[entry[1]]], -positions[entry]))
                proposed[reusable] = target
            used.add(reusable)
            matched += 1
        if matched != len(targets):
            skipped.append(SkippedScenario(code, "insufficient_matching_grade_entries", matched, len(targets)))
        else:
            grades = proposed
            included.append(code)
    distinct_subjects = {(entry[2], entry[1]) for entry in entries}
    multi = sum(count >= 2 for count in Counter(student for student, _ in distinct_subjects).values())
    if multi:
        included.append("multi_subject_learner")
    else:
        skipped.append(SkippedScenario("multi_subject_learner", "no_multi_subject_learner", 0, 1))
    # These are guaranteed by the existing date guard and the shared-scope floor.
    included.extend(("all_attendance_statuses", "excused_late_submission"))
    background = [grade for grade in PROFILE if grade < 95]
    for index, entry in enumerate(entry for entry in entries if entry not in grades):
        grades[entry] = background[index % len(background)]
    return grades, tuple(included), tuple(skipped)


def choose_ungraded(entries, thresholds):
    learners = sorted({entry[2] for entry in entries}, key=str, reverse=True)
    if len(learners) < 3:
        raise SeedError("insufficient_enrolled_learners", enrolled_learners=len(learners), required_learners=3)
    best = None
    for candidate in learners:
        available = [entry for entry in entries if entry[2] != candidate]
        scope_counts = Counter(entry[:2] for entry in available)
        shared = sorted(scope for scope, count in scope_counts.items() if count >= 2)
        if not shared:
            continue
        grades, included, skipped = plan_scenarios(available, thresholds)
        priority = tuple(int(code in included) for code in SCENARIOS) + (len(available),)
        if best is None or priority > best[0]:
            best = (priority, candidate, shared[0], grades, included, skipped)
    if best is None:
        raise SeedError("no_shared_graded_scope", enrolled_learners=len(learners), required_shared_learners=2)
    _, missing, extra_scope, grades, included, skipped = best
    return missing, extra_scope, grades, included, skipped


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


def build_plan(conn: Connection, staff_id: str, period_id: int, now: datetime,
               *, class_id: int | None = None) -> Plan:
    """Read existing structure and produce plain dictionaries, never ORM writes."""
    validate_class_filter(class_id)
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
    load_query = select(SubjectLoad.__table__).where(
        SubjectLoad.academic_period_id == period_id, SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(("active", "published")))
    class_query = select(Class.__table__).where(
        Class.academic_year_id == period["academic_year_id"], Class.class_status == "active")
    if class_id is not None:
        # Keep other teachers' loads within this class for the ambiguity guard.
        load_query = load_query.where(SubjectLoad.class_id == class_id)
        class_query = class_query.where(Class.class_id == class_id)
    loads = list(conn.execute(load_query).mappings())
    classes = {row["class_id"]: row for row in conn.execute(class_query).mappings()}
    if class_id is not None and class_id not in classes:
        raise SeedError("class_not_active_in_period")
    scopes = sorted({(row["class_id"], row["subject_id"]) for row in loads
                     if row["staff_id"] == staff_id and row["class_id"] in classes})
    if not scopes:
        code = "class_not_assigned_to_teacher_in_period" if class_id is not None else "no_assigned_active_loads"
        raise SeedError(code)
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
    missing, extra_scope, grades, scenarios, skipped = choose_ungraded(entries, thresholds)
    available = [row for row in entries if row[2] != missing]
    for (cid, sid, _), grade in grades.items():
        initial = round(sum(float(raw_score(grade)) * float(weight) for weight in weights[(cid, sid)]), 2)
        if transmute_current_three_term_grade(initial) != grade:
            raise SeedError("weights_cannot_reproduce_fixture_grades")
    extra_students = [row[2] for row in available if row[:2] == extra_scope]
    excused_student, late_student = extra_students[:2]
    identity = f"{staff_id}|{period_id}"
    if class_id is not None:
        # Separate filtered plans without altering the existing unfiltered IDs.
        identity += f"|class:{class_id}"
    prefix = PREFIX + sha256(identity.encode()).hexdigest()[:16]
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
             ("exam1", "ASSIGNMENT", "QUARTERLY_ASSESSMENT", "SUMMATIVE_1"),
             ("exam2", "ASSIGNMENT", "QUARTERLY_ASSESSMENT", "SUMMATIVE_2"),
             ("term", "ASSIGNMENT", "QUARTERLY_ASSESSMENT", "TERM_EXAM"))
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
    assignments = {row.key: row for row in rows if row.table == "classwork_assignment"}
    submissions = [row for row in rows if row.table == "student_submission"]
    attendance = [row for row in rows if row.table == "attendance_record"]
    excuses = {(row.values["student_id"], row.values["class_id"], row.values["date"])
               for row in attendance if row.values["status"] == "excused"}
    excluded, counted_late = 0, 0
    for row in submissions:
        assignment = assignments[row.values["classwork_assignment_id"].key].values
        covered = (row.values["student_id"], assignment["class_id"],
                   assignment["due_date"].astimezone(MANILA).date()) in excuses
        excluded += int(covered)
        counted_late += int(not covered and row.values["submitted_at"] > assignment["due_date"])
    ranked = sorted(grades.values(), reverse=True)
    omitted_ties = sum(grade == ranked[2] for grade in ranked[3:]) if len(ranked) > 3 else 0
    counts = {
        "enrolled_learners": len({entry[2] for entry in entries}), "ungraded_learners": 1,
        "student_subject_entries": len(entries), "available_grades": len(grades),
        "unavailable_grades": len(entries) - len(grades), "passing_grades": sum(
            Decimal(grade) >= thresholds[sid] for (_, sid, _), grade in grades.items()),
        "grade_sum": sum(grades.values()), "top_cutoff_ties_omitted": omitted_ties,
        "top_performer_entries": min(3, len(grades)),
        "learners_with_multiple_graded_subjects": sum(count >= 2 for count in Counter(
            student for student, _ in {(entry[2], entry[1]) for entry in grades}).values()),
        "completed_submissions": len(submissions),
        "expected_submissions": sum(len(rosters[row.values["class_id"]]) for row in assignments.values()),
        "counted_late_submissions": counted_late, "excused_excluded_submissions": excluded,
        "late_eligible_submissions": len(submissions) - excluded,
        "pending_grading": sum(row.values["grade"] is None for row in submissions),
        "attendance_slots_per_class": len(slots), "attendance_rows": len(attendance),
        "attendance_attended_rows": sum(row.values["status"] in ("present", "late") for row in attendance),
        "attendance_present_per_class": statuses.count("present"), "attendance_late_per_class": statuses.count("late"),
        "attendance_excused_per_class": statuses.count("excused"), "attendance_absent_per_class": statuses.count("absent"),
    }
    counts.update(zip(("band_90_100", "band_85_89", "band_80_84", "band_75_79", "band_below_75"), band_counts))
    counts.update(zip(("weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"), bins))
    return Plan(rows, counts, grades, prefix, fingerprint, staff_id, period_id, scenarios, skipped, class_id)


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


def seed_connection(conn: Connection, staff_id: str | None, period_id: int | None, now: datetime,
                    *, apply: bool, class_id: int | None = None):
    """Shared SQLite-testable core; CLI connection/target guards cannot be bypassed."""
    validate_class_filter(class_id)
    if now.tzinfo is None or (period_id is not None and period_id <= 0) or staff_id == "":
        raise SeedError("invalid_seed_scope")
    with failure_stage("discover_scope"):
        staff_id, period_id = discover_scope(conn, staff_id, period_id, now, class_id=class_id)
    try:
        with failure_stage("build_plan"):
            plan = build_plan(conn, staff_id, period_id, now, class_id=class_id)
        with failure_stage("inspect_plan"):
            ids, existing, missing = inspect_plan(conn, plan)  # ALL checks before first INSERT.
    except SeedError as error:
        # Never echo unverified explicit arguments; these other refusals happen
        # only after build_plan verified both existing teacher and period IDs.
        if error.code not in {"invalid_seed_scope", "teacher_or_period_missing"}:
            error.chosen_ids = (staff_id, period_id)
        raise
    if apply:
        for row in plan.rows:
            if row.key in ids:
                continue
            with failure_stage(f"insert:{row.table}"):
                table = TABLES[row.table]
                values = _resolved(row.values, ids)
                if values is None:
                    raise SeedError("invalid_seed_dependency")
                result = conn.execute(insert(table).values(**values))
                ids[row.key] = result.inserted_primary_key[0]
    return plan, existing, missing


def print_chosen_ids(staff_id: str, period_id: int, class_id: int | None = None) -> None:
    # JSON-escape the staff ID: an ID may not inject lines into count-only output.
    print("Chosen IDs")
    print("teacher_staff_id " + json.dumps(staff_id, ensure_ascii=True))
    print(f"academic_period_id {period_id}")
    if class_id is not None:
        print(f"class_id {class_id}")


def print_counts(plan: Plan, existing: Counter, additions: Counter, *, apply: bool) -> None:
    print_chosen_ids(plan.staff_id, plan.period_id, plan.class_id)
    print("Category Existing " + ("Inserted" if apply else "Would_insert") + " Conflicts")
    for name in sorted(TABLES):
        print(f"{name} {existing[name]} {additions[name]} 0")
    print("Metric Count")
    for name, count in plan.counts.items():
        print(f"{name} {count}")
    print("Included scenarios")
    for code in plan.scenarios:
        print(f"{code} 1")
    print("Skipped scenarios")
    for scenario in plan.skipped:
        print(f"{scenario.code} {scenario.reason} available={scenario.available} required={scenario.required}: {REASONS[scenario.reason]}")
    print("Expected results (aggregates only)")
    counts = plan.counts
    print(f"grade_coverage {counts['available_grades']}/{counts['student_subject_entries']}")
    print(f"current_grade_average {counts['grade_sum'] / counts['available_grades']:.1f}")
    for label, numerator, denominator in (
        ("passing", "passing_grades", "available_grades"),
        ("completion", "completed_submissions", "expected_submissions"),
        ("this_month_attendance", "attendance_attended_rows", "attendance_rows"),
        ("late_submissions", "counted_late_submissions", "late_eligible_submissions"),
    ):
        total = counts[denominator]
        value = f"{100.0 * counts[numerator] / total:.1f}%" if total else "unavailable"
        print(f"{label} {counts[numerator]}/{total} {value}")


def print_refusal(error: SeedError) -> None:
    code = error.code if error.code in REASONS else "preview_seed_failed"
    if code == error.code and error.chosen_ids is not None:
        print_chosen_ids(*error.chosen_ids)
    print(f"ERROR {code}: {REASONS[code]}")
    # Only these locally generated count fields are allowed; never driver details.
    for key in ("candidate_pairs", "enrolled_learners", "required_learners", "required_shared_learners"):
        value = error.counts.get(key)
        if type(value) is int and value >= 0:
            print(f"{key} {value}")


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise SeedError("invalid_arguments")


def main(argv=None, *, environ=None) -> int:
    engine = None
    try:
        parser = SafeParser(description="Count-only, INSERT-only local preview dashboard fixture")
        parser.add_argument("--teacher-staff-id")
        parser.add_argument("--academic-period-id", type=int)
        parser.add_argument("--class-id", type=int,
                            help="Limit activity to this teacher's assigned subjects in one active class.")
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument("--dry-run", action="store_true")
        mode.add_argument("--apply", action="store_true")
        args = parser.parse_args(argv)
        validate_class_filter(args.class_id)
        with failure_stage("engine"):
            engine = guarded_engine(os.environ if environ is None else environ)
        with failure_stage("connect"), engine.connect() as conn:
            with failure_stage("statement_guard"):
                guard = install_statement_guard(conn, dry_run=not args.apply)
            try:
                with failure_stage("transaction"), conn.begin():
                    if not args.apply:
                        with failure_stage("read_only"):
                            conn.execute(text("SET TRANSACTION READ ONLY"))
                    with failure_stage("database_check"):
                        check_database(conn)
                    if args.apply:
                        with failure_stage("advisory_lock"):
                            conn.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_ID})
                    with failure_stage("seed"):
                        result = seed_connection(conn, args.teacher_staff_id, args.academic_period_id,
                                                 datetime.now(timezone.utc), apply=args.apply, class_id=args.class_id)
            finally:
                with failure_stage("guard_cleanup"):
                    event.remove(conn, "before_cursor_execute", guard)
        with failure_stage("output"):
            print_counts(*result, apply=args.apply)
        return 0
    except SeedError as error:
        print_refusal(error)
        return 2
    except KeyboardInterrupt:
        print_refusal(SeedError("cancelled"))
        return 2
    except Exception as error:
        # Deliberately do not expose exception text, SQL, URL, or traceback.
        print_failure_diagnostics(error)
        print_refusal(SeedError("preview_seed_failed"))
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
