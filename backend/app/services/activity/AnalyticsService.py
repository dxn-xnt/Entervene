from __future__ import annotations

import uuid
from app.services.grading.PassingThresholdReader import read_passing_threshold_context_or_422
from functools import wraps
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, distinct, or_
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.TeacherDashboard import DashboardGrade, DashboardGradeDetails, DashboardScopeLabel, DashboardSupportSummary
from app.services.activity.TeacherDashboardMetrics import (
    DashboardScope,
    build_dashboard_engagement,
    build_dashboard_performance_trend,
    dashboard_month_window,
    dashboard_term_progress,
    read_dashboard_current_grades,
    read_dashboard_lesson_evidence,
    read_dashboard_student_names,
    rank_dashboard_performers,
    resolve_dashboard_passing_threshold,
    summarize_dashboard_attendance,
    summarize_dashboard_submissions,
    summarize_dashboard_grades,
    summarize_dashboard_grade_distribution,
    summarize_dashboard_engagement,
    summarize_dashboard_lesson_performance,
    summarize_dashboard_support,
)
from app.services.academic.AcademicLifecycleService import resolve_active_academic_period
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService


def format_count(val: int | float | None) -> str:
    if val is None:
        return "0"
    if isinstance(val, float):
        if val.is_integer():
            return f"{int(val):,}"
        return f"{val:,.1f}"
    return f"{val:,}"


def get_target_period(
    db: Session,
    academic_period_id: int | None = None,
    academic_year_id: int | None = None,
) -> AcademicPeriod:
    """Resolve an explicit period or period within an academic year; otherwise require the canonical active period."""
    if academic_period_id is not None:
        period = db.get(AcademicPeriod, academic_period_id)
        if period is None:
            raise HTTPException(status_code=404, detail="Academic period not found")
        if academic_year_id is not None and period.academic_year_id != academic_year_id:
            raise HTTPException(status_code=400, detail="Academic period does not belong to specified academic year")
        return period
    if academic_year_id is not None:
        year = db.get(AcademicYear, academic_year_id)
        if year is None:
            raise HTTPException(status_code=404, detail="Academic year not found")
        period = (
            db.query(AcademicPeriod)
            .filter(AcademicPeriod.academic_year_id == academic_year_id, AcademicPeriod.is_active.is_(True))
            .first()
        )
        if period is None:
            period = (
                db.query(AcademicPeriod)
                .filter(AcademicPeriod.academic_year_id == academic_year_id)
                .order_by(AcademicPeriod.period_sequence.asc(), AcademicPeriod.academic_period_id.asc())
                .first()
            )
        if period is None:
            raise HTTPException(status_code=404, detail="No academic periods found for this academic year")
        return period
    return resolve_active_academic_period(db)


def _build_enrollment_engagement_trend(
    db: Session,
    target_period: AcademicPeriod | None,
    enrollments: list[StudentClass],
    active_class_ids: set[int],
    now_dt: datetime,
    *,
    max_weeks: int = 8,
) -> list[dict[str, Any]]:
    """Build school-year weekly cumulative enrollment vs. active learner participation up to today.

    Scoped to the selected academic year (not limited to one term) so selecting an
    upcoming term still preserves real historical weekly participation from earlier
    terms in the same academic year without fabricating future data.
    """
    if target_period is None or not enrollments or not active_class_ids:
        return []

    year_id = target_period.academic_year_id
    academic_year = target_period.academic_year or db.get(AcademicYear, year_id)
    if academic_year is None:
        return []

    year_periods = (
        db.query(AcademicPeriod)
        .filter(AcademicPeriod.academic_year_id == year_id)
        .order_by(AcademicPeriod.period_sequence.asc(), AcademicPeriod.academic_period_id.asc())
        .all()
    )
    period_starts = [p.start_date for p in year_periods if p.start_date is not None]
    period_ends = [p.end_date for p in year_periods if p.end_date is not None]

    year_start = min(
        [d for d in [academic_year.start_date, *period_starts] if d is not None],
        default=None,
    )
    year_end = max(
        [d for d in [academic_year.end_date, *period_ends] if d is not None],
        default=None,
    )
    if year_start is None or year_end is None or year_end < year_start:
        return []

    manila_tz = ZoneInfo("Asia/Manila")
    today = now_dt.astimezone(manila_tz).date()
    if today < year_start:
        return []

    window_end = min(today, year_end)

    # Earliest recorded enrollment date per distinct enrolled student in active classes
    enrolled_dates: dict[Any, Any] = {}
    for row in enrollments:
        enrolled_dt = row.enrolled_at
        if enrolled_dt is not None:
            enrolled_date = _dashboard_aware_datetime(enrolled_dt).astimezone(manila_tz).date()
        else:
            enrolled_date = year_start
        existing = enrolled_dates.get(row.student_id)
        if existing is None or enrolled_date < existing:
            enrolled_dates[row.student_id] = enrolled_date

    if not enrolled_dates:
        return []

    # Build chronological weekly buckets from year_start through window_end
    weeks: list[tuple[int, Any, Any]] = []
    week_start = year_start
    week_num = 1
    while week_start <= window_end:
        week_end = min(week_start + timedelta(days=6), window_end)
        weeks.append((week_num, week_start, week_end))
        week_start = week_start + timedelta(days=7)
        week_num += 1

    if len(weeks) > max_weeks:
        weeks = weeks[-max_weeks:]

    year_period_ids = [p.academic_period_id for p in year_periods]
    year_assignments_ids = [
        row[0]
        for row in (
            db.query(ClassworkAssignment.classwork_assignment_id)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .filter(
                ClassworkAssignment.academic_period_id.in_(year_period_ids),
                ClassworkAssignment.class_id.in_(active_class_ids),
                ClassworkAssignment.is_published.is_(True),
                Classwork.is_archived.is_(False),
            )
            .all()
        )
    ] if year_period_ids else []

    year_submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.classwork_assignment_id.in_(year_assignments_ids),
            StudentSubmission.student_id.in_(set(enrolled_dates)),
        )
        .all()
        if year_assignments_ids else []
    )

    year_attendance = (
        db.query(AttendanceRecord)
        .filter(
            AttendanceRecord.class_id.in_(active_class_ids),
            AttendanceRecord.student_id.in_(set(enrolled_dates)),
            AttendanceRecord.date >= year_start,
            AttendanceRecord.date <= window_end,
        )
        .all()
    )

    # Pre-collect participation dates per enrolled student (submissions + attendance)
    active_dates_by_student: dict[Any, list[Any]] = {}
    for sub in year_submissions:
        if sub.student_id not in enrolled_dates:
            continue
        status = (sub.status or "").strip().lower()
        if status not in {"submitted", "late", "graded"} and (sub.attempt_count or 0) <= 0:
            continue
        activity_dt = sub.submitted_at or sub.graded_at or sub.created_at
        if activity_dt is None:
            continue
        activity_date = _dashboard_aware_datetime(activity_dt).astimezone(manila_tz).date()
        if year_start <= activity_date <= window_end:
            active_dates_by_student.setdefault(sub.student_id, []).append(activity_date)

    for rec in year_attendance:
        if rec.student_id not in enrolled_dates or rec.date is None:
            continue
        if (rec.status or "").strip().lower() in {"present", "late"}:
            active_dates_by_student.setdefault(rec.student_id, []).append(rec.date)

    trend: list[dict[str, Any]] = []
    for num, w_start, w_end in weeks:
        enrolled_count = sum(1 for dt in enrolled_dates.values() if dt <= w_end)
        active_count = sum(
            1
            for sid, dates in active_dates_by_student.items()
            if enrolled_dates[sid] <= w_end and any(w_start <= d <= w_end for d in dates)
        )
        trend.append({
            "week": f"Wk {num}",
            "count": enrolled_count,
            "active": active_count,
            "start_date": w_start.isoformat(),
            "end_date": w_end.isoformat(),
        })
    return trend


def build_system_overview(db: Session, target_period: AcademicPeriod | None) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    now_dt = _dashboard_aware_datetime(_teacher_dashboard_now())
    today_manila = now_dt.astimezone(ZoneInfo("Asia/Manila")).date()
    period_state = (
        SubjectLoadAuthorizationService.classify_academic_period(
            db, target_period, as_of=today_manila,
        ).value
        if target_period is not None else "CURRENT"
    )
    is_upcoming_period = period_state == "FUTURE"
    year_label_display = academic_year_label or period_name

    period_id = target_period.academic_period_id if target_period else None
    year_id = target_period.academic_year_id if target_period else None
    enrolled_students = db.query(func.count(distinct(StudentClass.student_id))).filter(
        StudentClass.enrollment_status == "enrolled",
        *((StudentClass.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    total_students = enrolled_students
    base_load_filters = [SubjectLoad.is_active_version.is_(True), SubjectLoad.status.in_(["active", "published"])]
    load_filters = list(base_load_filters)
    if period_id is not None:
        load_filters.append(SubjectLoad.academic_period_id == period_id)
    active_staff_loads = db.query(func.count(distinct(SubjectLoad.staff_id))).join(
        Class, Class.class_id == SubjectLoad.class_id,
    ).filter(
        *load_filters,
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    year_active_staff = db.query(func.count(distinct(SubjectLoad.staff_id))).join(
        Class, Class.class_id == SubjectLoad.class_id,
    ).filter(
        *base_load_filters,
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    total_staff = year_active_staff
    total_classes = db.query(Class).filter(*((Class.academic_year_id == year_id,) if year_id is not None else ())).count()
    active_classes = db.query(Class).filter(
        Class.class_status == "active", *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).count()
    active_subjects = db.query(func.count(distinct(SubjectLoad.subject_id))).join(
        Class, Class.class_id == SubjectLoad.class_id,
    ).filter(
        *load_filters,
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    year_load_subject_ids = {
        row[0]
        for row in db.query(distinct(SubjectLoad.subject_id)).join(
            Class, Class.class_id == SubjectLoad.class_id,
        ).filter(
            *base_load_filters,
            *((Class.academic_year_id == year_id,) if year_id is not None else ()),
        ).all()
    }
    year_offering_subject_ids = {
        row[0]
        for row in db.query(distinct(SubjectOffering.subject_id)).filter(
            *((SubjectOffering.academic_year_id == year_id,) if year_id is not None else ()),
        ).all()
    } if year_id is not None else set()
    year_subjects = len(year_load_subject_ids | year_offering_subject_ids)
    period_offered_subjects = (
        db.query(func.count(distinct(SubjectOffering.subject_id))).filter(
            SubjectOffering.academic_period_id == period_id,
            *((SubjectOffering.academic_year_id == year_id,) if year_id is not None else ()),
        ).scalar() or 0
    ) if period_id is not None else 0
    total_subjects = year_subjects

    # One selected-period roster drives every grade-level denominator. This
    # prevents withdrawn learners and records from another year from leaking
    # into otherwise plausible-looking dashboard percentages.
    active_class_rows = (
        db.query(Class)
        .options(joinedload(Class.academic_level))
        .filter(Class.academic_year_id == year_id, Class.class_status == "active")
        .order_by(Class.academic_level_id, Class.class_id)
        .all()
        if year_id is not None else []
    )
    active_class_ids = {row.class_id for row in active_class_rows}
    enrolled_by_class: dict[int, set[Any]] = {
        class_id: set() for class_id in active_class_ids
    }
    enrollments: list[StudentClass] = []
    if active_class_ids:
        enrollments = db.query(StudentClass).filter(
            StudentClass.class_id.in_(active_class_ids),
            StudentClass.academic_year_id == year_id,
            StudentClass.enrollment_status == "enrolled",
        ).all()
        for enrollment in enrollments:
            enrolled_by_class[enrollment.class_id].add(enrollment.student_id)

    active_load_rows = db.query(SubjectLoad).filter(
        *load_filters,
        SubjectLoad.class_id.in_(active_class_ids),
    ).all() if active_class_ids else []
    active_scope = {(row.class_id, row.subject_id) for row in active_load_rows}
    scoped_subject_ids = {subject_id for _, subject_id in active_scope}

    assignments: list[ClassworkAssignment] = []
    if active_scope and period_id is not None:
        assignments = (
            db.query(ClassworkAssignment)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .options(joinedload(ClassworkAssignment.classwork))
            .filter(
                ClassworkAssignment.academic_period_id == period_id,
                ClassworkAssignment.is_published.is_(True),
                Classwork.is_archived.is_(False),
                or_(*(
                    and_(ClassworkAssignment.class_id == class_id, Classwork.subject_id == subject_id)
                    for class_id, subject_id in sorted(active_scope)
                )),
            )
            .all()
        )
    assignments_by_id = {row.classwork_assignment_id: row for row in assignments}
    submissions = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id.in_(assignments_by_id),
    ).all() if assignments_by_id else []
    engagement = build_dashboard_engagement(
        assignments_by_id,
        enrolled_by_class,
        submissions,
        _dashboard_aware_datetime(_teacher_dashboard_now()),
    )

    attendance_by_class: dict[int, list[AttendanceRecord]] = {
        class_id: [] for class_id in active_class_ids
    }
    if active_class_ids and target_period is not None:
        attendance_rows = db.query(AttendanceRecord).filter(
            AttendanceRecord.class_id.in_(active_class_ids),
            AttendanceRecord.date >= target_period.start_date,
            AttendanceRecord.date <= target_period.end_date,
        ).all()
        for record in attendance_rows:
            if record.student_id in enrolled_by_class.get(record.class_id, set()):
                attendance_by_class[record.class_id].append(record)

    threshold_subjects = db.query(Subject).filter(
        Subject.subject_id.in_(scoped_subject_ids),
    ).all() if scoped_subject_ids else []
    policy_context = read_passing_threshold_context_or_422(
        db,
        academic_year_id=year_id,
        subject_ids=scoped_subject_ids,
        academic_period_id=period_id,
    ) if year_id is not None and scoped_subject_ids else None
    thresholds = {
        subject.subject_id: resolve_dashboard_passing_threshold(subject, context=policy_context)
        for subject in threshold_subjects
    }
    grade_rows = db.query(StudentPeriodGrade).filter(
        StudentPeriodGrade.academic_period_id == period_id,
        StudentPeriodGrade.class_id.in_(active_class_ids),
        StudentPeriodGrade.subject_id.in_(scoped_subject_ids),
    ).all() if period_id is not None and active_class_ids and scoped_subject_ids else []
    scoped_grades = [
        DashboardGrade(
            student_id=str(row.student_id),
            class_id=row.class_id,
            subject_id=row.subject_id,
            academic_period_id=row.academic_period_id,
            current_grade=float(row.final_period_grade) if row.final_period_grade is not None else None,
        )
        for row in grade_rows
        if row.student_id in enrolled_by_class.get(row.class_id, set())
        and (row.class_id, row.subject_id) in active_scope
    ]

    grade_health: list[dict[str, Any]] = []
    levels_and_classes: dict[int, list[Class]] = {}
    for class_row in active_class_rows:
        levels_and_classes.setdefault(class_row.academic_level_id, []).append(class_row)
    ordered_levels = sorted(
        levels_and_classes.values(),
        key=lambda rows: (rows[0].academic_level.grade_level, rows[0].academic_level_id),
    )
    for level_classes in ordered_levels:
        level = level_classes[0].academic_level
        level_class_ids = {row.class_id for row in level_classes}
        level_students = set().union(*(
            enrolled_by_class[row.class_id] for row in level_classes
        ))
        level_assignment_ids = [
            assignment_id for assignment_id, assignment in assignments_by_id.items()
            if assignment.class_id in level_class_ids
        ]
        completion = summarize_dashboard_engagement(engagement, level_assignment_ids)
        attendance = summarize_dashboard_attendance([
            record for class_id in level_class_ids for record in attendance_by_class[class_id]
        ])
        level_grades = [grade for grade in scoped_grades if grade.class_id in level_class_ids]
        grade_summary = summarize_dashboard_grades(level_grades, thresholds)
        grade_health.append({
            "academic_level_id": level.academic_level_id,
            "grade": level.level_name,
            "category": "Senior High" if level.grade_level >= 11 else "Junior High",
            "students": len(level_students),
            "active_classes": len(level_class_ids),
            "attendance_rate": attendance.rate,
            "attendance_record_count": attendance.record_count,
            "completion_rate": completion.completion_rate_percent if level_assignment_ids else None,
            "expected_submission_count": completion.expected_count,
            "completed_submission_count": completion.completed_count,
            "passing_rate": grade_summary.passing_rate_percent,
            "available_grade_count": grade_summary.available_grade_count,
        })

    overall_attendance = summarize_dashboard_attendance([
        record for records in attendance_by_class.values() for record in records
    ])
    overall_grade_summary = summarize_dashboard_grades(scoped_grades, thresholds)

    # Ungraded submissions count
    ungraded_count = (
        db.query(StudentSubmission)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Class, Class.class_id == ClassworkAssignment.class_id)
        .filter(
            StudentSubmission.status == "submitted",
            StudentSubmission.grade.is_(None),
            *((ClassworkAssignment.academic_period_id == period_id,) if period_id is not None else ()),
            *((Class.academic_year_id == year_id,) if year_id is not None else ()),
        )
        .count()
    )

    # Assessments published
    assessment_query = db.query(Classwork).join(
        ClassworkAssignment, ClassworkAssignment.classwork_id == Classwork.classwork_id,
    ).join(Class, Class.class_id == ClassworkAssignment.class_id).filter(
        Classwork.is_archived.is_(False), ClassworkAssignment.is_published.is_(True),
        *((ClassworkAssignment.academic_period_id == period_id,) if period_id is not None else ()),
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    )
    cw_count = assessment_query.filter(func.upper(Classwork.classwork_type) != "QUIZ").distinct().count()
    quiz_count = assessment_query.filter(func.upper(Classwork.classwork_type) == "QUIZ").distinct().count()
    total_assessments = cw_count + quiz_count

    ratio_str = f"{total_students / total_staff:.1f} : 1" if total_staff else "—"
    subjects_term_stat = (
        str(active_subjects)
        if active_subjects > 0
        else str(period_offered_subjects)
        if period_offered_subjects > 0
        else "0"
    )
    subjects_term_desc = (
        f"assigned in {period_name}"
        if active_subjects > 0
        else f"offered in {period_name}"
        if period_offered_subjects > 0
        else f"assigned in {period_name}"
    )
    unrecorded_term_stat = "Upcoming" if is_upcoming_period else "Not calculated"

    cards = [
        {
            "title": "Students",
            "count": format_count(total_students),
            "stat": str(enrolled_students),
            "statDescription": f"enrolled in {year_label_display}",
            "rawCount": total_students,
        },
        {
            "title": "Teachers",
            "count": format_count(total_staff),
            "stat": str(active_staff_loads),
            "statDescription": f"assigned in {period_name}",
            "rawCount": total_staff,
        },
        {
            "title": "Classes",
            "count": format_count(total_classes),
            "stat": str(active_classes),
            "statDescription": f"active in {year_label_display}",
            "rawCount": total_classes,
        },
        {
            "title": "Subjects",
            "count": format_count(total_subjects),
            "stat": subjects_term_stat,
            "statDescription": subjects_term_desc,
            "rawCount": total_subjects,
        },
        {
            "title": "School Passing Rate",
            "count": (
                f"{overall_grade_summary.passing_rate_percent}%"
                if overall_grade_summary.passing_rate_percent is not None else "—"
            ),
            "stat": (
                f"{overall_grade_summary.passing_count} of "
                f"{overall_grade_summary.available_grade_count} recorded grades passing"
                if overall_grade_summary.passing_count is not None else unrecorded_term_stat
            ),
            "statDescription": period_name,
        },
        {
            "title": "School Attendance",
            "count": f"{overall_attendance.rate}%" if overall_attendance.rate is not None else "—",
            "stat": (
                f"{overall_attendance.present_count + overall_attendance.late_count} of "
                f"{overall_attendance.record_count} recorded entries"
                if overall_attendance.record_count else unrecorded_term_stat
            ),
            "statDescription": period_name,
        },
        {
            "title": "Student-Teacher Ratio",
            "count": ratio_str,
            "stat": f"{total_students} students",
            "statDescription": f"per {total_staff} active teachers ({year_label_display})",
        },
        {
            "title": "New Enrollments",
            "count": "—", "stat": unrecorded_term_stat, "statDescription": period_name,
        },
        {
            "title": "Ungraded Backlog",
            "count": str(ungraded_count),
            "stat": f"{ungraded_count} submissions",
            "statDescription": "waiting more than 3 days",
        },
        {
            "title": "Assessments Published",
            "count": str(total_assessments),
            "stat": f"{cw_count} classworks · {quiz_count} quizzes",
            "statDescription": period_name,
        },
        {
            "title": "Submission Completion",
            "count": "—", "stat": unrecorded_term_stat, "statDescription": period_name,
        },
        {
            "title": "Term Progress",
            "count": "—", "stat": "Upcoming" if is_upcoming_period else "Calendar period", "statDescription": period_name, "progressValue": 0,
        },
    ]

    enrollment_trend = _build_enrollment_engagement_trend(
        db,
        target_period,
        enrollments,
        active_class_ids,
        now_dt,
    )

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "academic_year_id": target_period.academic_year_id if target_period else None,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "period_state": period_state,
            "enrollment_trend_scope": "academic_year",
            "students": {"total": total_students, "enrolled": enrolled_students},
            "teachers": {"total": total_staff, "active_loads": active_staff_loads},
            "classes": {"total": total_classes, "active": active_classes},
            "subjects": {
                "total": total_subjects,
                "active": active_subjects,
                "offered_in_period": period_offered_subjects,
            },
            "enrollment_trend": enrollment_trend,
            "students_per_grade": [
                {"grade": row["grade"], "count": row["students"]}
                for row in grade_health
            ],
            "attendance_by_grade": [
                {"grade": row["grade"], "rate": row["attendance_rate"]}
                for row in grade_health if row["attendance_rate"] is not None
            ],
            "completion_by_grade": [
                {"grade": row["grade"], "rate": row["completion_rate"]}
                for row in grade_health if row["completion_rate"] is not None
            ],
            "grade_health": grade_health,
            "active_users_weekly": [],
            "teacher_workload": [],
            "classes_needing_attention": [],
            "teachers_no_work": [],
            "top_performing_subjects": [],
        },
    }


def build_teacher_overview(
    db: Session,
    staff_id_or_user_id: str | uuid.UUID | None,
    target_period: AcademicPeriod | None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    staff = None
    if staff_id_or_user_id:
        # Check if staff_id_or_user_id is a UUID or UUID string
        if isinstance(staff_id_or_user_id, uuid.UUID) or (
            isinstance(staff_id_or_user_id, str) and len(staff_id_or_user_id) == 36 and "-" in staff_id_or_user_id
        ):
            try:
                uid = uuid.UUID(str(staff_id_or_user_id))
                staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == uid).first()
            except ValueError:
                staff = None
        if not staff and isinstance(staff_id_or_user_id, str):
            staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == staff_id_or_user_id).first()

    if not staff:
        raise HTTPException(status_code=404, detail="Teacher staff profile not found")

    staff_id = staff.staff_id

    # Loads assigned to teacher
    load_query = db.query(SubjectLoad).join(Class, Class.class_id == SubjectLoad.class_id).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
        *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    )
    loads_for_period = load_query.filter(
        SubjectLoad.academic_period_id == target_period.academic_period_id,
    ).all() if target_period else []

    subject_ids = {l.subject_id for l in loads_for_period if l.subject_id}
    class_ids = {l.class_id for l in loads_for_period if l.class_id}
    authorized_combos = {(l.class_id, l.subject_id) for l in loads_for_period if l.class_id and l.subject_id}

    # Advised classes
    advised_classes = db.query(Class).filter(
        Class.adviser_staff_id == staff_id,
        Class.class_status == "active",
        *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    ).all()
    for ac in advised_classes:
        class_ids.add(ac.class_id)

    # Total distinct students in teacher's classes
    total_students = (
        db.query(func.count(distinct(StudentClass.student_id))).filter(
            StudentClass.class_id.in_(class_ids),
            StudentClass.enrollment_status == "enrolled",
            *((StudentClass.academic_year_id == target_period.academic_year_id,) if target_period else ()),
        ).scalar()
        if class_ids
        else 0
    )

    # Ungraded classworks
    ungraded_count = (
        db.query(StudentSubmission)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
            *((ClassworkAssignment.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            ClassworkAssignment.class_id.in_(class_ids) if class_ids else False,
            or_(*(
                and_(ClassworkAssignment.class_id == class_id, Classwork.subject_id == subject_id)
                for class_id, subject_id in sorted(authorized_combos)
            )) if authorized_combos else False,
            StudentSubmission.status == "submitted",
            StudentSubmission.grade.is_(None),
        )
        .count()
    )

    cards = [
        {
            "title": "Subjects",
            "count": format_count(len(subject_ids)),
            "stat": str(len(loads_for_period)),
            "statDescription": f"assigned loads in {period_name}",
            "rawCount": len(subject_ids),
        },
        {
            "title": "Classes",
            "count": format_count(len(class_ids)),
            "stat": str(len(class_ids)),
            "statDescription": f"active sections in {period_name}",
            "rawCount": len(class_ids),
        },
        {
            "title": "Students",
            "count": format_count(total_students),
            "stat": str(total_students),
            "statDescription": f"enrolled in {period_name}",
            "rawCount": total_students,
        },
        {
            "title": "Ungraded Classwork",
            "count": format_count(ungraded_count),
            "stat": str(ungraded_count),
            "statDescription": f"pending review in {period_name}",
            "rawCount": ungraded_count,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "academic_year_id": target_period.academic_year_id if target_period else None,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "staff_id": staff_id,
            "staff_name": f"{staff.first_name} {staff.last_name}" if staff else None,
            "subjects_count": len(subject_ids),
            "classes_count": len(class_ids),
            "students_count": total_students,
            "ungraded_count": ungraded_count,
        },
    }


def build_class_overview(
    db: Session,
    class_id: int,
    target_period: AcademicPeriod | None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    cls = db.query(Class).filter(Class.class_id == class_id).first()
    if cls is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if target_period and cls.academic_year_id != target_period.academic_year_id:
        raise HTTPException(status_code=400, detail="Class does not belong to the selected academic year")
    section_name = cls.section_name

    total_students = db.query(StudentClass).filter(
        StudentClass.class_id == class_id,
        StudentClass.enrollment_status == "enrolled",
        *((StudentClass.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    ).count()

    total_subjects = (
        db.query(func.count(distinct(SubjectLoad.subject_id)))
        .filter(
            SubjectLoad.class_id == class_id,
            *((SubjectLoad.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    grade_q = db.query(func.avg(StudentPeriodGrade.final_period_grade)).filter(StudentPeriodGrade.class_id == class_id)
    if target_period:
        grade_q = grade_q.filter(StudentPeriodGrade.academic_period_id == target_period.academic_period_id)
    avg_grade_val = grade_q.scalar()
    avg_grade_str = f"{round(float(avg_grade_val), 1)}%" if avg_grade_val is not None else "N/A"

    period_rows = (
        db.query(AcademicPeriod.academic_period_id, AcademicPeriod.period_name,
                 func.avg(StudentPeriodGrade.final_period_grade).label("average"))
        .outerjoin(StudentPeriodGrade, and_(
            StudentPeriodGrade.academic_period_id == AcademicPeriod.academic_period_id,
            StudentPeriodGrade.class_id == class_id,
        ))
        .filter(AcademicPeriod.academic_year_id == cls.academic_year_id)
        .group_by(AcademicPeriod.academic_period_id, AcademicPeriod.period_name,
                  AcademicPeriod.period_sequence, AcademicPeriod.start_date)
        .order_by(AcademicPeriod.period_sequence, AcademicPeriod.start_date)
        .all()
    )
    subject_rows = (
        db.query(Subject.subject_id, Subject.subject_name,
                 func.avg(StudentPeriodGrade.final_period_grade).label("average"))
        .join(StudentPeriodGrade, StudentPeriodGrade.subject_id == Subject.subject_id)
        .filter(StudentPeriodGrade.class_id == class_id,
                *((StudentPeriodGrade.academic_period_id == target_period.academic_period_id,) if target_period else ()))
        .group_by(Subject.subject_id, Subject.subject_name)
        .order_by(Subject.subject_name)
        .all()
    )

    cards = [
        {
            "title": "Total Students",
            "count": format_count(total_students),
            "stat": str(total_students),
            "statDescription": f"enrolled in {section_name} ({period_name})",
            "rawCount": total_students,
        },
        {
            "title": "Total Subjects",
            "count": format_count(total_subjects),
            "stat": str(total_subjects),
            "statDescription": f"active subjects in {period_name}",
            "rawCount": total_subjects,
        },
        {
            "title": "Avg. Class Score",
            "count": avg_grade_str,
            "stat": avg_grade_str if avg_grade_val is not None else "--",
            "statDescription": f"grade average in {period_name}",
            "rawCount": float(avg_grade_val) if avg_grade_val is not None else None,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "academic_year_id": target_period.academic_year_id if target_period else None,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "class_id": class_id,
            "section_name": section_name,
            "total_students": total_students,
            "total_subjects": total_subjects,
            "avg_grade": avg_grade_val,
            "performance_trend": [
                {"period_id": row.academic_period_id, "period_name": row.period_name,
                 "average": round(float(row.average), 1) if row.average is not None else None}
                for row in period_rows
            ],
            "subject_breakdown": [
                {"subject_id": row.subject_id, "subject_name": row.subject_name,
                 "average": round(float(row.average), 1) if row.average is not None else None}
                for row in subject_rows
            ],
        },
    }


def build_subject_overview(
    db: Session,
    subject_id: int,
    target_period: AcademicPeriod | None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    subj = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subj is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    subject_name = subj.subject_name

    subj_classes = (
        db.query(func.count(distinct(SubjectLoad.class_id))).join(Class, Class.class_id == SubjectLoad.class_id)
        .filter(
            SubjectLoad.subject_id == subject_id,
            *((SubjectLoad.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    subj_teachers = (
        db.query(func.count(distinct(SubjectLoad.staff_id))).join(Class, Class.class_id == SubjectLoad.class_id)
        .filter(
            SubjectLoad.subject_id == subject_id,
            *((SubjectLoad.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    classworks_query = db.query(Classwork.classwork_id).join(
        ClassworkAssignment, ClassworkAssignment.classwork_id == Classwork.classwork_id,
    ).join(Class, Class.class_id == ClassworkAssignment.class_id).filter(
        Classwork.subject_id == subject_id,
        Classwork.is_archived.is_(False),
        *((ClassworkAssignment.academic_period_id == target_period.academic_period_id,) if target_period else ()),
        *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    )
    classworks_count = classworks_query.distinct().count()
    scoped_classwork_ids = classworks_query.subquery()
    lessons_count = db.query(func.count(distinct(ClassworkLesson.lesson_id))).filter(
        ClassworkLesson.classwork_id.in_(db.query(scoped_classwork_ids.c.classwork_id)),
    ).scalar() or 0

    # Calculate Students Average Grade from finalized period grades or graded submissions
    grade_q = db.query(func.avg(StudentPeriodGrade.final_period_grade)).filter(
        StudentPeriodGrade.subject_id == subject_id,
        *((StudentPeriodGrade.academic_period_id == target_period.academic_period_id,) if target_period else ()),
    )
    avg_grade_val = grade_q.scalar()

    if avg_grade_val is None:
        sub_grade_q = (
            db.query(
                func.sum(StudentSubmission.grade),
                func.sum(Classwork.total_points),
            )
            .join(ClassworkAssignment, ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id)
            .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
            .join(Class, Class.class_id == ClassworkAssignment.class_id)
            .filter(
                Classwork.subject_id == subject_id,
                Classwork.is_archived.is_(False),
                StudentSubmission.status == "graded",
                StudentSubmission.grade.isnot(None),
                Classwork.total_points > 0,
                *((ClassworkAssignment.academic_period_id == target_period.academic_period_id,) if target_period else ()),
                *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
            )
        )
        earned_sum, total_sum = sub_grade_q.first() or (None, None)
        if earned_sum is not None and total_sum and float(total_sum) > 0:
            avg_grade_val = round((float(earned_sum) / float(total_sum)) * 100, 1)

    avg_grade_num = round(float(avg_grade_val), 1) if avg_grade_val is not None else None
    avg_grade_str = f"{avg_grade_num}%" if avg_grade_num is not None else "--"

    # Calculate Overall Class Mastery from graded submissions
    mastery_q = (
        db.query(
            func.sum(StudentSubmission.grade),
            func.sum(Classwork.total_points),
        )
        .join(ClassworkAssignment, ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Class, Class.class_id == ClassworkAssignment.class_id)
        .filter(
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            StudentSubmission.status == "graded",
            StudentSubmission.grade.isnot(None),
            Classwork.total_points > 0,
            *((ClassworkAssignment.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
        )
    )
    m_earned, m_possible = mastery_q.first() or (None, None)
    if m_earned is not None and m_possible and float(m_possible) > 0:
        mastery_pct = round((float(m_earned) / float(m_possible)) * 100)
        mastery_str = f"{mastery_pct}%"
    elif avg_grade_num is not None:
        mastery_pct = round(avg_grade_num)
        mastery_str = f"{mastery_pct}%"
    else:
        mastery_pct = None
        mastery_str = "--"

    cards = [
        {
            "title": "Total Classes",
            "count": format_count(subj_classes),
            "stat": str(subj_classes),
            "statDescription": f"assigned sections in {period_name}",
            "rawCount": subj_classes,
        },
        {
            "title": "Active Classes",
            "count": format_count(subj_classes),
            "stat": str(subj_classes),
            "statDescription": f"active sections in {period_name}",
            "rawCount": subj_classes,
        },
        {
            "title": "Overall Class Mastery",
            "count": mastery_str,
            "stat": mastery_str,
            "statDescription": "Average performance across lessons",
            "rawCount": mastery_pct,
        },
        {
            "title": "Students Average Grade",
            "count": avg_grade_str,
            "stat": avg_grade_str,
            "statDescription": "Average recorded student grade",
            "rawCount": avg_grade_num,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "academic_year_id": target_period.academic_year_id if target_period else None,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "subject_id": subject_id,
            "subject_name": subject_name,
            "classes_count": subj_classes,
            "teachers_count": subj_teachers,
            "lessons_count": lessons_count,
            "classworks_count": classworks_count,
            "overall_class_mastery": mastery_pct,
            "students_average_grade": avg_grade_num,
        },
    }


def _teacher_dashboard_now() -> datetime:
    return datetime.now(timezone.utc)


def _dashboard_aware_datetime(value: datetime) -> datetime:
    # Legacy naive timestamps follow the same UTC convention as student metrics.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _read_only_dashboard(function):
    @wraps(function)
    def read(db, *args, **kwargs):
        with db.no_autoflush:
            return function(db, *args, **kwargs)
    return read


@_read_only_dashboard
def build_teacher_dashboard_health(
    db: Session,
    staff_id_or_user_id: str | uuid.UUID | None,
    target_period: AcademicPeriod | None,
    class_id: int | None = None,
    subject_id: int | None = None,
    dashboard_class_id: int | None = None,
    dashboard_subject_id: int | None = None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    staff = None
    if staff_id_or_user_id:
        if isinstance(staff_id_or_user_id, uuid.UUID) or (
            isinstance(staff_id_or_user_id, str) and len(staff_id_or_user_id) == 36 and "-" in staff_id_or_user_id
        ):
            try:
                uid = uuid.UUID(str(staff_id_or_user_id))
                staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == uid).first()
            except ValueError:
                staff = None
        if not staff and isinstance(staff_id_or_user_id, str):
            staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == staff_id_or_user_id).first()

    if not staff:
        raise HTTPException(status_code=403, detail="Teacher identity could not be resolved")

    staff_id = staff.staff_id

    # One clock snapshot keeps all Manila date/window boundaries consistent.
    now = _dashboard_aware_datetime(_teacher_dashboard_now())
    school_now = now.astimezone(ZoneInfo("Asia/Manila"))

    # An explicitly selected period never includes legacy or other-period loads.
    load_query = db.query(SubjectLoad).join(Class, SubjectLoad.class_id == Class.class_id).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
        Class.class_status == "active",
    )
    if target_period:
        loads = load_query.filter(
            SubjectLoad.academic_period_id == target_period.academic_period_id,
            Class.academic_year_id == target_period.academic_year_id,
        ).order_by(SubjectLoad.class_id, SubjectLoad.subject_id).all()
    else:
        loads = []

    # Fixed-size metadata reads, not one relationship query per load.
    class_ids = {load.class_id for load in loads if load.class_id}
    scoped_subject_ids = {load.subject_id for load in loads if load.subject_id}
    classes_by_id = {
        item.class_id: item for item in db.query(Class).options(joinedload(Class.academic_level)).filter(
            Class.class_id.in_(class_ids),
        ).all()
    } if class_ids else {}
    threshold_subjects = db.query(Subject).options(joinedload(Subject.grading_template)).filter(
        Subject.subject_id.in_(scoped_subject_ids),
    ).all() if scoped_subject_ids else []
    subjects_by_id = {item.subject_id: item for item in threshold_subjects}
    available_filters: list[dict[str, Any]] = []
    seen_combos = set()
    for l in loads:
        if l.class_id and l.subject_id and (l.class_id, l.subject_id) not in seen_combos:
            seen_combos.add((l.class_id, l.subject_id))
            c = classes_by_id.get(l.class_id)
            s = subjects_by_id.get(l.subject_id)
            available_filters.append({
                "class_id": l.class_id,
                "section_name": c.section_name if c else f"Class {l.class_id}",
                "subject_id": l.subject_id,
                "subject_name": s.subject_name if s else f"Subject {l.subject_id}",
            })

    # Keep authorized options available when narrowing the analytics scope.
    # The legacy class_id/subject_id parameters remain trend-only selectors.
    dashboard_filters = list(available_filters)
    available_filters = [
        item for item in available_filters
        if (dashboard_class_id is None or item["class_id"] == dashboard_class_id)
        and (dashboard_subject_id is None or item["subject_id"] == dashboard_subject_id)
    ]
    seen_combos = {(item["class_id"], item["subject_id"]) for item in available_filters}
    scoped_subject_ids = {item["subject_id"] for item in available_filters}
    threshold_subjects = [item for item in threshold_subjects if item.subject_id in scoped_subject_ids]
    unique_class_ids = {f["class_id"] for f in available_filters}

    # Cache only canonical active enrollments for every denominator and numerator.
    enrolled_by_class = {cid: set() for cid in unique_class_ids}
    if unique_class_ids:
        enrollments = db.query(StudentClass).filter(
            StudentClass.class_id.in_(unique_class_ids),
            StudentClass.academic_year_id == target_period.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        ).all()
        for enrollment in enrollments:
            enrolled_by_class[enrollment.class_id].add(enrollment.student_id)
    total_students = len(set().union(*enrolled_by_class.values())) if enrolled_by_class else 0

    # Use the same teacher, load tuple and exact period scope for all dashboard data.
    all_assignments = []
    if seen_combos and target_period:
        all_assignments = (
            db.query(ClassworkAssignment)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .options(joinedload(ClassworkAssignment.classwork))
            .filter(
                (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
                ClassworkAssignment.is_published.is_(True),
                Classwork.is_archived.is_(False),
                ClassworkAssignment.academic_period_id == target_period.academic_period_id,
                or_(*(
                    and_(ClassworkAssignment.class_id == cid, Classwork.subject_id == sid)
                    for cid, sid in sorted(seen_combos)
                )),
            )
            .all()
        )

    assignments_by_combo = {combo: [] for combo in seen_combos}
    assignments_by_id = {}
    for assignment in all_assignments:
        assignments_by_combo[(assignment.class_id, assignment.classwork.subject_id)].append(assignment)
        assignments_by_id[assignment.classwork_assignment_id] = assignment
    submissions = []
    if assignments_by_id:
        submissions = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id.in_(assignments_by_id),
        ).all()
    engagement = build_dashboard_engagement(assignments_by_id, enrolled_by_class, submissions, now)
    engagement_summary = summarize_dashboard_engagement(engagement)
    lesson_subjects = {
        sid: (subjects_by_id[sid].subject_name if sid in subjects_by_id else "Subject name unavailable",
              tuple(sorted({item["class_id"] for item in available_filters if item["subject_id"] == sid})))
        for sid in scoped_subject_ids
    }
    lesson_performance = summarize_dashboard_lesson_performance(
        read_dashboard_lesson_evidence(db, engagement, subjects=lesson_subjects),
    )
    # One explicit-year policy context for every authorized subject; never active-year inference.
    policy_context = read_passing_threshold_context_or_422(
        db, academic_year_id=target_period.academic_year_id,
        subject_ids=scoped_subject_ids,
    ) if target_period and scoped_subject_ids else None
    thresholds = {
        subject.subject_id: resolve_dashboard_passing_threshold(subject, context=policy_context)
        for subject in threshold_subjects
    }
    current_grades = read_dashboard_current_grades(db, staff_id, [
        DashboardScope(
            f["class_id"], f["subject_id"], target_period.academic_period_id,
            frozenset(str(student_id) for student_id in enrolled_by_class[f["class_id"]]),
        )
        for f in available_filters
    ])
    grade_summary = summarize_dashboard_grades(current_grades, thresholds)
    student_names = read_dashboard_student_names(db, {
        grade.student_id for grade in current_grades
    })
    scope_labels = {
        (item["class_id"], item["subject_id"]): DashboardScopeLabel(
            section_name=item["section_name"], subject_name=item["subject_name"],
        )
        for item in available_filters
    }
    performers = rank_dashboard_performers(current_grades, student_names, scope_labels)
    distribution = summarize_dashboard_grade_distribution(current_grades)
    grade_details = DashboardGradeDetails(
        total_grade_count=distribution.total_grade_count,
        available_grade_count=distribution.available_grade_count,
        unavailable_grade_count=distribution.unavailable_grade_count,
        top_performer_limit=performers.limit,
        cutoff_tie_omitted_count=performers.cutoff_tie_omitted_count,
        warnings=[*grade_summary.warnings, *performers.warnings],
    )
    attendance_by_class = {cid: [] for cid in unique_class_ids}
    if unique_class_ids:
        for record in db.query(AttendanceRecord).filter(
            AttendanceRecord.class_id.in_(unique_class_ids),
            AttendanceRecord.date >= target_period.start_date,
            AttendanceRecord.date <= target_period.end_date,
        ).all():
            if record.student_id in enrolled_by_class[record.class_id]:
                attendance_by_class[record.class_id].append(record)
    month_window = dashboard_month_window(
        now, target_period.start_date, target_period.end_date,
    ) if target_period else None
    month_attendance = [
        {
            "class_id": cid,
            "section": next(f["section_name"] for f in available_filters if f["class_id"] == cid),
            **summarize_dashboard_attendance([
                record for record in attendance_by_class[cid]
                if month_window and month_window.start_date <= record.date <= month_window.end_date
            ]).model_dump(mode="json"),
        }
        for cid in sorted(unique_class_ids)
    ]
    attendance_today = summarize_dashboard_attendance([
        record for records in attendance_by_class.values() for record in records
        if record.date == school_now.date()
    ])
    # Excuses match the DEADLINE date, not the submission date or monthly window.
    # Fetch all relevant deadline dates even when they precede this month.
    deadline_dates = {
        _dashboard_aware_datetime(a.due_date).astimezone(ZoneInfo("Asia/Manila")).date()
        for a in all_assignments if a.due_date is not None
    }
    excuses = []
    if unique_class_ids and deadline_dates:
        excuses = [
            record for record in db.query(AttendanceRecord).filter(
                AttendanceRecord.class_id.in_(unique_class_ids),
                AttendanceRecord.date.in_(deadline_dates),
                AttendanceRecord.status == "excused",
            ).all()
            if record.student_id in enrolled_by_class[record.class_id]
        ]
    late_summary, weekdays = summarize_dashboard_submissions(
        assignments_by_id,
        engagement.eligible_submissions,
        excuses, now,
        target_period.start_date if target_period else school_now.date(),
        target_period.end_date if target_period else school_now.date(),
        require_subject_match=False,
    )
    support = summarize_dashboard_support(
        current_grades, thresholds, engagement,
        [record for records in attendance_by_class.values() for record in records],
        excuses, now, month_window, target_period.start_date, target_period.end_date,
        student_names, scope_labels, require_subject_match=False,
    ) if target_period is not None and month_window is not None else DashboardSupportSummary()
    term_progress = dashboard_term_progress(
        target_period.start_date, target_period.end_date, school_now.date(),
    ) if target_period else None

    total_expected = engagement_summary.expected_count
    total_submitted = engagement_summary.completed_count
    overall_completion_rate = engagement_summary.completion_rate_percent

    # Ungraded count
    pending_subs = [
        s for subs in engagement.selected_by_assignment.values() for s in subs
        if s.status in {"submitted", "late"} and s.grade is None
    ]
    ungraded_count = engagement_summary.pending_grading_count

    # Determine selected class & subject for the trend chart
    sel_class_id = None
    sel_subj_id = None
    sel_section_name = ""
    sel_subject_name = ""

    if (class_id is None) != (subject_id is None):
        raise HTTPException(status_code=400, detail="class_id and subject_id must be provided together")
    if class_id is not None and subject_id is not None:
        matching = next((f for f in available_filters if f["class_id"] == class_id and f["subject_id"] == subject_id), None)
        if matching is None:
            raise HTTPException(status_code=403, detail="You are not authorized for the selected class and subject")
        sel_class_id = class_id
        sel_subj_id = subject_id
        sel_section_name = matching["section_name"]
        sel_subject_name = matching["subject_name"]

    if sel_class_id is None and available_filters:
        first_f = available_filters[0]
        sel_class_id = first_f["class_id"]
        sel_subj_id = first_f["subject_id"]
        sel_section_name = first_f["section_name"]
        sel_subject_name = first_f["subject_name"]

    trend_points: list[dict[str, Any]] = []
    selected_assignment_ids = []
    if sel_class_id is not None and sel_subj_id is not None:
        class_asgns = assignments_by_combo[(sel_class_id, sel_subj_id)]
        selected_assignment_ids = [a.classwork_assignment_id for a in class_asgns]
        trend_points = [point.model_dump(mode="json") for point in
                        build_dashboard_performance_trend(engagement, class_asgns)]
    trend_summary = summarize_dashboard_engagement(engagement, selected_assignment_ids)
    # Sufficiency means three scored tasks, not three date groups. One/two actual
    # date groups remain renderable; metadata distinguishes tasks from groups.
    has_sufficient_data = trend_summary.graded_task_count >= 3

    # Section-by-Section Health Matrix
    section_matrix: list[dict[str, Any]] = []
    for f in available_filters:
        cid = f["class_id"]
        sid = f["subject_id"]
        cls_obj = classes_by_id.get(cid)
        student_count = len(enrolled_by_class[cid])

        grade_level_label = ""
        if cls_obj and cls_obj.academic_level:
            grade_level_label = cls_obj.academic_level.level_name

        asgns_for_sec = assignments_by_combo[(cid, sid)]

        section_engagement = summarize_dashboard_engagement(
            engagement, [a.classwork_assignment_id for a in asgns_for_sec],
        )
        sec_completion_rate = section_engagement.completion_rate_percent
        sec_avg_score = section_engagement.avg_score_percent
        section_grades = summarize_dashboard_grades(
            [grade for grade in current_grades if grade.class_id == cid and grade.subject_id == sid],
            {sid: thresholds[sid]},
        )
        sec_passing_rate = section_grades.passing_rate_percent

        # Attendance calculation
        section_attendance = summarize_dashboard_attendance(attendance_by_class[cid])
        sec_attendance_rate = section_attendance.rate

        section_matrix.append({
            "class_id": cid,
            "section_name": f["section_name"],
            "grade_level": grade_level_label,
            "subject_id": sid,
            "subject_name": f["subject_name"],
            "student_count": student_count,
            "published_classworks": len(asgns_for_sec),
            "avg_score_percent": sec_avg_score,
            "passing_rate_percent": sec_passing_rate,
            "completion_rate_percent": sec_completion_rate,
            "attendance_rate_percent": sec_attendance_rate,
            "attendance_record_count": section_attendance.record_count,
            "engagement": section_engagement.model_dump(mode="json"),
            **section_grades.model_dump(mode="json"),
        })

    # Live Action Queue: pending_grading
    pending_subs = sorted(
        pending_subs,
        key=lambda s: (
            _dashboard_aware_datetime(s.submitted_at) if s.submitted_at else datetime.min.replace(tzinfo=timezone.utc),
            s.submission_id,
        ),
        reverse=True,
    )[:5]

    # One name-only SELECT, preserving the existing first/last queue format.
    pending_student_ids = {row.student_id for row in pending_subs}
    pending_names = {
        str(row.student_id): f"{row.first_name} {row.last_name}"
        for row in db.query(Student.student_id, Student.first_name, Student.last_name).filter(
            Student.student_id.in_(pending_student_ids),
        ).all()
    } if pending_student_ids else {}
    pending_grading_list = []
    for ps in pending_subs:
        assignment = assignments_by_id[ps.classwork_assignment_id]
        cw_obj = assignment.classwork
        cls_obj = classes_by_id.get(assignment.class_id)
        pending_grading_list.append({
            "submission_id": ps.submission_id,
            "student_id": str(ps.student_id),
            "student_name": pending_names.get(str(ps.student_id), "Name unavailable"),
            "classwork_id": cw_obj.classwork_id if cw_obj else None,
            "classwork_title": cw_obj.title if cw_obj else "Classwork",
            "section_name": cls_obj.section_name if cls_obj else "",
            "submitted_at": ps.submitted_at.isoformat() if ps.submitted_at else None,
        })

    # Live Action Queue: upcoming_deadlines
    next_monday = (school_now + timedelta(days=7 - school_now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    upcoming_asgns = sorted(
        [a for a in all_assignments if a.due_date and now <= _dashboard_aware_datetime(a.due_date) < next_monday],
        key=lambda a: (_dashboard_aware_datetime(a.due_date), a.classwork_assignment_id),
    )[:5]

    upcoming_deadlines_list = []
    for ua in upcoming_asgns:
        cw_obj = ua.classwork
        cls_obj = classes_by_id.get(ua.class_id)
        deadline_engagement = summarize_dashboard_engagement(engagement, [ua.classwork_assignment_id])
        upcoming_deadlines_list.append({
            "classwork_id": cw_obj.classwork_id if cw_obj else None,
            "title": cw_obj.title if cw_obj else "Assignment",
            "section_name": cls_obj.section_name if cls_obj else "",
            "due_date": ua.due_date.isoformat() if ua.due_date else None,
            "assignment_id": ua.classwork_assignment_id,
            "submitted_count": deadline_engagement.completed_count,
            "total_students": deadline_engagement.expected_count,
            "eligible_count": deadline_engagement.expected_count,
            "warnings": [warning.model_dump(mode="json") for warning in deadline_engagement.warnings],
        })

    cw_count = len([a for a in all_assignments if a.classwork and (a.classwork.classwork_type or "").upper() != "QUIZ"])
    quiz_count = len([a for a in all_assignments if a.classwork and (a.classwork.classwork_type or "").upper() == "QUIZ"])
    total_published = len(all_assignments)

    cards = [
        {
            "title": "Active Classes",
            "count": str(len(unique_class_ids)),
            "stat": f"{len(unique_class_ids)} sections",
            "statDescription": f"in {period_name}",
        },
        {
            "title": "Enrolled Students",
            "count": str(total_students),
            "stat": f"{total_students} learners",
            "statDescription": "total across sections",
        },
        {
            "title": "Overall Completion",
            "count": f"{int(overall_completion_rate)}%" if overall_completion_rate is not None else "—",
            "stat": (f"{total_submitted} of {total_expected} submitted" if total_submitted is not None else
                     f"{engagement_summary.resolved_completed_count} resolved of {total_expected} expected"),
            "statDescription": "Selected-period eligible student-task requirements; unique latest completed attempts.",
        },
        {
            "title": "Ungraded Queue",
            "count": str(ungraded_count) if ungraded_count is not None else "—",
            "stat": (f"{ungraded_count} submissions" if ungraded_count is not None else
                     f"{engagement_summary.resolved_pending_grading_count} resolved submissions"),
            "statDescription": "Latest completed attempts pending teacher grading.",
        },
        {
            "title": "Current grade",
            "count": str(grade_summary.current_grade) if grade_summary.current_grade is not None else "—",
            "stat": f"{grade_summary.available_grade_count} of {grade_summary.total_grade_count} student-subject grades available",
            "statDescription": "Weighted and transmuted, as in the class record.",
        },
        {
            "title": "Passing Rate",
            "count": f"{grade_summary.passing_rate_percent}%" if grade_summary.passing_rate_percent is not None else "—",
            "stat": (
                f"{grade_summary.passing_count} of {grade_summary.available_grade_count} available grades"
                if grade_summary.passing_count is not None else
                f"{grade_summary.available_grade_count} of {grade_summary.total_grade_count} student-subject grades available"
            ),
            "statDescription": (
                grade_summary.warnings[0].message if grade_summary.warnings else
                "Against each subject's grading template passing grade."
            ),
        },
        {
            "title": "Late Submissions",
            "count": f"{late_summary.late_rate_percent}%" if late_summary.late_rate_percent is not None else "—",
            "stat": f"{late_summary.late_count} of {late_summary.eligible_count} assessed submissions · {late_summary.excused_excluded_count} excused excluded",
            "statDescription": (
                late_summary.warnings[0].message if late_summary.warnings else
                "Late submissions, excluding excused submissions."
            ),
        },
        {
            "title": "Grading Turnaround",
            "count": "—",
            "statDescription": "Not calculated",
        },
        {
            "title": "Attendance Today",
            "count": (
                f"{attendance_today.present_count + attendance_today.late_count} / {attendance_today.record_count}"
                if attendance_today.record_count else "—"
            ),
            "stat": f"{attendance_today.late_count} late · {attendance_today.absent_count} absent · {attendance_today.excused_count} excused",
            "statDescription": "Present + late / recorded entries today.",
        },
        {
            "title": "Feedback Coverage",
            "count": "—",
            "stat": "Not calculated",
            "statDescription": "No aggregate available",
        },
        {
            "title": "Term Progress",
            "count": (
                "—" if term_progress and term_progress.warnings else
                "Not started" if term_progress and school_now.date() < target_period.start_date else
                "Ended" if term_progress and school_now.date() > target_period.end_date else
                f"Week {term_progress.week_number}" if term_progress else "—"
            ),
            "stat": f"of {term_progress.total_weeks}" if term_progress else "",
            "statDescription": (
                term_progress.warnings[0].message if term_progress and term_progress.warnings else
                f"Calendar progress in {period_name}."
            ),
            "progressValue": term_progress.progress_percent if term_progress and term_progress.progress_percent is not None else 0,
        },
        {
            "title": "Published Work",
            "count": str(total_published),
            "stat": f"{cw_count} classworks · {quiz_count} quizzes",
            "statDescription": "published in the selected period",
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "academic_year_id": target_period.academic_year_id if target_period else None,
            "is_active": target_period.is_active if target_period else False,
        },
        "dashboard_filters": dashboard_filters,
        "cards": cards,
        "kpis": {
            "active_classes": len(unique_class_ids),
            "enrolled_students": total_students,
            "overall_completion_rate": overall_completion_rate,
            "ungraded_count": ungraded_count,
        },
        "engagement": engagement_summary.model_dump(mode="json"),
        "trend_chart": {
            "available_filters": available_filters,
            "selected_class_id": sel_class_id,
            "selected_subject_id": sel_subj_id,
            "selected_section_name": sel_section_name,
            "selected_subject_name": sel_subject_name,
            "has_sufficient_data": has_sufficient_data,
            "graded_task_count": trend_summary.graded_task_count,
            "date_group_count": len(trend_points),
            "warnings": [warning.model_dump(mode="json") for warning in trend_summary.warnings],
            "points": trend_points,
        },
        "section_matrix": section_matrix,
        "phase_two": {
            "grades": grade_summary.model_dump(mode="json"),
            "attendance_today": attendance_today.model_dump(mode="json"),
            "month_window": month_window.model_dump(mode="json") if month_window else None,
            "late_submissions": late_summary.model_dump(mode="json"),
            "weekdays": weekdays.model_dump(mode="json"),
            "term_progress": term_progress.model_dump(mode="json") if term_progress else None,
            "require_subject_match": False,
        },
        "action_queue": {
            "pending_grading": pending_grading_list,
            "upcoming_deadlines": upcoming_deadlines_list,
        },
        "details": {
            "students_to_check_in_with": support.model_dump(mode="json"),
            "top_performers": [item.model_dump(mode="json") for item in performers.items],
            "grade_details": grade_details.model_dump(mode="json"),
            "due_this_week": [],
            "lesson_performance": lesson_performance.model_dump(mode="json"),
            "submissions_by_weekday": [
                {"day": day.label, "count": day.count}
                for day in weekdays.days
            ],
            "hardest_questions": [],
            "grade_distribution": [item.model_dump(mode="json") for item in distribution.bands],
            "attendance_by_section": month_attendance,
        },
    }

