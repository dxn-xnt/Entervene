import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.db.Session import get_db
from app.api.v1.routes.Auth import get_current_user
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Class_ import Class
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.Classwork import Classwork
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.attendance.Attendance import AttendanceRecord
from app.models.quiz.QuizAnswer import QuizAnswer

router = APIRouter()


def _manila_date(value: datetime):
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(ZoneInfo("Asia/Manila")).date()


@router.get("/me/studyboard-metrics")
def get_my_studyboard_metrics(
    academic_period_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Actual, student-scoped records for the Studyboard (no inferred study sessions)."""
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])
    today = datetime.now(ZoneInfo("Asia/Manila")).date()
    monday = today - timedelta(days=today.weekday())
    friday = monday + timedelta(days=4)
    six_weeks_ago = monday - timedelta(weeks=5)

    try:
        _, current_class, _, _, _ = _current_class_row(db, student)
        class_id = current_class.class_id
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        class_id = None

    attendance_rows = (
        db.query(AttendanceRecord)
        .filter(AttendanceRecord.student_id == student.student_id)
        .filter(AttendanceRecord.class_id == class_id)
        .filter(AttendanceRecord.date >= monday, AttendanceRecord.date <= friday)
        .all()
    ) if class_id is not None else []
    by_day: dict = {}
    for record in attendance_rows:
        by_day.setdefault(record.date, []).append(record)
    attendance = []
    for offset in range(5):
        day = monday + timedelta(days=offset)
        records = by_day.get(day, [])
        advisory = [record for record in records if record.subject_id is None]
        statuses = [(record.status or "").lower() for record in (advisory or records)]
        status = (
            "absent" if "absent" in statuses else
            "late" if "late" in statuses else
            "excused" if "excused" in statuses else
            "present" if "present" in statuses else "no_record"
        )
        attendance.append({"date": day.isoformat(), "status": status})
    recorded = [day for day in attendance if day["status"] != "no_record"]
    attended = sum(day["status"] in {"present", "late", "excused"} for day in recorded)
    attendance_rate = round(attended / len(recorded) * 100) if recorded else None

    submission_query = (
        db.query(StudentSubmission, ClassworkAssignment, Classwork, Subject)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .join(Subject, Classwork.subject_id == Subject.subject_id)
        .filter(StudentSubmission.student_id == student.student_id)
        .filter(ClassworkAssignment.class_id == class_id)
    )
    if academic_period_id is not None:
        submission_query = submission_query.filter(ClassworkAssignment.academic_period_id == academic_period_id)
    submission_rows = submission_query.all() if class_id is not None else []
    daily_seconds = {i: 0 for i in range(7)}
    subject_seconds: dict[int, dict] = {}
    trend_buckets: dict[int, list[float]] = {i: [] for i in range(6)}
    on_time = late = 0
    visible_quiz_submission_ids = []
    for submission, assignment, classwork, subject in submission_rows:
        activity_at = submission.submitted_at or submission.created_at
        if activity_at and monday <= _manila_date(activity_at) < monday + timedelta(days=7):
            seconds = max(0, submission.reading_focused_seconds or 0)
            daily_seconds[_manila_date(activity_at).weekday()] += seconds
            if seconds:
                bucket = subject_seconds.setdefault(subject.subject_id, {"subject": subject.subject_name, "seconds": 0})
                bucket["seconds"] += seconds
        if submission.submitted_at and assignment.due_date:
            submitted_at = submission.submitted_at if submission.submitted_at.tzinfo else submission.submitted_at.replace(tzinfo=timezone.utc)
            due_at = assignment.due_date if assignment.due_date.tzinfo else assignment.due_date.replace(tzinfo=timezone.utc)
            if submitted_at <= due_at:
                on_time += 1
            else:
                late += 1
        if (submission.grade is not None and classwork.total_points and classwork.show_scores
                and submission.graded_at and _manila_date(submission.graded_at) >= six_weeks_ago):
            week = (_manila_date(submission.graded_at) - six_weeks_ago).days // 7
            if week in trend_buckets:
                trend_buckets[week].append(float(submission.grade / classwork.total_points * 100))
        if classwork.classwork_type.upper() == "QUIZ" and classwork.show_scores and submission.status == "graded":
            visible_quiz_submission_ids.append(submission.submission_id)

    quiz_answers = (
        db.query(QuizAnswer.is_correct)
        .filter(QuizAnswer.submission_id.in_(visible_quiz_submission_ids))
        .filter(QuizAnswer.is_correct.isnot(None))
        .all()
    ) if visible_quiz_submission_ids else []
    quiz_correct = sum(answer.is_correct is True for answer in quiz_answers)
    quiz_wrong = len(quiz_answers) - quiz_correct
    return {
        "week_start": monday.isoformat(),
        "attendance": attendance,
        "attendance_rate": attendance_rate,
        "daily_reading_seconds": [daily_seconds[i] for i in range(7)],
        "subject_reading_seconds": sorted(subject_seconds.values(), key=lambda item: -item["seconds"]),
        "grade_trend": [
            {"week_start": (six_weeks_ago + timedelta(weeks=i)).isoformat(),
             "average": round(sum(values) / len(values)) if values else None}
            for i, values in trend_buckets.items()
        ],
        "on_time_count": on_time,
        "late_submission_count": late,
        "quiz_correct": quiz_correct,
        "quiz_wrong": quiz_wrong,
    }


def _require_student(current_user: dict) -> None:
    if current_user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Only students can access this resource")


def _student_full_name(student: Student) -> str:
    first_name = (student.first_name or "").strip()
    middle_name = (student.middle_name or "").strip()
    last_name = (student.last_name or "").strip()
    suffix = (student.suffix or "").strip()
    middle_initial = f"{middle_name[:1].upper()}." if middle_name else ""
    given_name = " ".join(part for part in [first_name, middle_initial] if part)
    family_name = " ".join(part for part in [last_name, suffix] if part)
    if family_name and given_name:
        return f"{family_name}, {given_name}"
    return family_name or given_name or "Student"


def _staff_full_name(staff: AcademicStaff | None) -> str:
    if staff is None:
        return "Not assigned"
    return " ".join(
        part
        for part in [
            (staff.first_name or "").strip(),
            (staff.middle_name or "").strip(),
            (staff.last_name or "").strip(),
            (staff.suffix or "").strip(),
        ]
        if part
    ) or "Not assigned"


def _resolve_student(db: Session, user_id: str) -> Student:
    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid user session")

    student = db.query(Student).filter(Student.user_id == parsed_user_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student


def _current_class_row(db: Session, student: Student):
    row = (
        db.query(StudentClass, Class, AcademicLevel, AcademicYear, AcademicStaff)
        .join(Class, Class.class_id == StudentClass.class_id)
        .join(AcademicLevel, AcademicLevel.academic_level_id == Class.academic_level_id)
        .join(AcademicYear, AcademicYear.academic_year_id == StudentClass.academic_year_id)
        .outerjoin(AcademicStaff, AcademicStaff.staff_id == Class.adviser_staff_id)
        .filter(
            StudentClass.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
            Class.class_status != "archived",
        )
        .order_by(AcademicYear.is_active.desc(), StudentClass.enrolled_at.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Student class not found")
    return row


def _classmate_count(db: Session, student: Student, class_: Class, assignment: StudentClass) -> int:
    return (
        db.query(func.count(StudentClass.student_class_id))
        .filter(
            StudentClass.class_id == class_.class_id,
            StudentClass.academic_year_id == assignment.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
            StudentClass.student_id != student.student_id,
        )
        .scalar()
        or 0
    )


@router.get("/me/profile")
def get_my_profile(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])

    grade_level = None
    section_name = None
    try:
        assignment, class_, level, year, adviser = _current_class_row(db, student)
        grade_level = level.level_name or (f"Grade {level.grade_level}" if level.grade_level else None)
        section_name = class_.section_name
    except HTTPException:
        grade_level = None
        section_name = None

    return {
        "student_id": str(student.student_id),
        "user_id": str(student.user_id),
        "student_name": _student_full_name(student),
        "first_name": student.first_name,
        "last_name": student.last_name,
        "student_lrn": student.student_lrn,
        "gender": student.gender,
        "grade_level": grade_level,
        "section_name": section_name,
    }


@router.get("/me/class")
def get_my_class(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])
    assignment, class_, level, year, adviser = _current_class_row(db, student)

    return {
        "class_id": class_.class_id,
        "grade_level": level.level_name or f"Grade {level.grade_level}",
        "section_name": class_.section_name,
        "academic_year": year.year_label,
        "adviser_name": _staff_full_name(adviser),
        "classmate_count": _classmate_count(db, student, class_, assignment),
    }


@router.get("/me/classmates")
def get_my_classmates(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])
    assignment, class_, _, _, _ = _current_class_row(db, student)

    rows = (
        db.query(Student, UserAccount.avatar_path)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .outerjoin(UserAccount, Student.user_id == UserAccount.user_id)
        .filter(
            StudentClass.class_id == class_.class_id,
            StudentClass.academic_year_id == assignment.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
            Student.student_id != student.student_id,
        )
        .all()
    )
    classmates = [
        {
            "student_id": str(classmate.student_id),
            "full_name": _student_full_name(classmate),
            "gender": classmate.gender,
            "avatar_initial": ((classmate.first_name or "").strip()[:1] or "?").upper(),
            "avatar": avatar,
        }
        for classmate, avatar in rows
    ]
    classmates.sort(key=lambda item: item["full_name"].casefold())

    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "classmates": classmates,
    }


@router.get("/me/subjects")
def get_my_subjects(
    academic_period_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns all subjects enrolled by the currently authenticated student,
    including the assigned teacher and active period for each subject load.

    Reusable for both mobile and web clients.
    """
    user_id = current_user["sub"]

    # Resolve student from user account
    student = (
        db.query(Student)
        .filter(Student.user_id == user_id)
        .first()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")

    # select_from(Student) makes the left-most table explicit so SQLAlchemy
    # doesn't get confused by the multiple column sources in db.query().
    rows = (
        db.query(
            SubjectLoad.subject_load_id,
            SubjectLoad.class_id,
            Subject.subject_id,
            Subject.subject_name,
            Subject.subject_codename,
            AcademicStaff.first_name.label("teacher_first_name"),
            AcademicStaff.last_name.label("teacher_last_name"),
            UserAccount.avatar_path.label("teacher_avatar"),
            AcademicPeriod.academic_period_id,
            AcademicPeriod.period_name,
            AcademicPeriod.is_active.label("is_current_period"),
            Class.section_name,
            AcademicYear.year_label,
        )
        .select_from(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .join(Class, Class.class_id == StudentClass.class_id)
        .join(SubjectLoad, SubjectLoad.class_id == Class.class_id)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(AcademicStaff, AcademicStaff.staff_id == SubjectLoad.staff_id)
        .outerjoin(UserAccount, UserAccount.user_id == AcademicStaff.user_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
        .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        .filter(
            Student.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
            SubjectLoad.status.in_(["active", "published"]),
        )
    )

    if academic_period_id is not None:
        rows = rows.filter(SubjectLoad.academic_period_id == academic_period_id)

    rows = rows.all()

    return [
        {
            "subject_load_id":    row.subject_load_id,
            "class_id":           row.class_id,
            "subject_id":         row.subject_id,
            "subject_name":       row.subject_name,
            "subject_codename":   row.subject_codename,
            "teacher_name":       " ".join(part for part in [row.teacher_first_name, row.teacher_last_name] if part),
            "teacher_avatar":     row.teacher_avatar,
            "period_id":          row.academic_period_id,
            "period_name":        row.period_name,
            "is_current_period":  row.is_current_period,
            "is_current_quarter": row.is_current_period,
            "section_name":       row.section_name,
            "year_label":         row.year_label,
        }
        for row in rows
    ]


@router.get("/me/active-period")
@router.get("/me/active-quarter")
def get_active_period(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["sub"]
    try:
        parsed_user_id = uuid.UUID(str(user_id))
    except (TypeError, ValueError):
        parsed_user_id = None

    student = None
    if parsed_user_id is not None:
        student = (
            db.query(Student)
            .filter(Student.user_id == parsed_user_id)
            .first()
        )

    row = None

    # Only attempt the class-specific lookup for students
    if student:
        row = (
            db.query(
                AcademicPeriod.academic_period_id,
                AcademicPeriod.period_name,
                AcademicPeriod.period_type,
                AcademicPeriod.period_sequence,
                AcademicPeriod.total_periods_in_year,
                AcademicPeriod.period_progress_ratio,
                AcademicPeriod.is_active,
                AcademicYear.year_label,
            )
            .select_from(Student)
            .join(StudentClass, StudentClass.student_id == Student.student_id)
            .join(Class, Class.class_id == StudentClass.class_id)
            .join(SubjectLoad, SubjectLoad.class_id == Class.class_id)
            .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
            .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
            .filter(
                Student.student_id == student.student_id,
                StudentClass.enrollment_status == "enrolled",
                AcademicPeriod.is_active == True,
            )
            .first()
        )

    # Global fallback — used for teachers, or students with no active class period
    if not row:
        row = (
            db.query(
                AcademicPeriod.academic_period_id,
                AcademicPeriod.period_name,
                AcademicPeriod.period_type,
                AcademicPeriod.period_sequence,
                AcademicPeriod.total_periods_in_year,
                AcademicPeriod.period_progress_ratio,
                AcademicPeriod.is_active,
                AcademicYear.year_label,
            )
            .select_from(AcademicPeriod)
            .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
            .filter(AcademicPeriod.is_active == True)
            .first()
        )

    if not row:
        return {
            "period_id": None,
            "period_name": "No active period",
            "period_type": None,
            "period_sequence": None,
            "total_periods_in_year": None,
            "period_progress_ratio": None,
            "is_active": False,
            "year_label": "",
        }

    return {
        "period_id": row.academic_period_id,
        "period_name": row.period_name,
        "period_type": row.period_type,
        "period_sequence": row.period_sequence,
        "total_periods_in_year": row.total_periods_in_year,
        "period_progress_ratio": str(row.period_progress_ratio),
        "is_active": row.is_active,
        "year_label": row.year_label,
    }


@router.get("/me/todos")
def get_my_todos(
    academic_period_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns to-do items for the authenticated student categorized as pending, pastdue, and completed.
    Joined from ClassworkAssignment, Classwork, Subject, and StudentSubmission.
    """
    _require_student(current_user)
    student = _resolve_student(db, current_user["sub"])

    student_classes = (
        db.query(StudentClass.class_id)
        .filter(
            StudentClass.student_id == student.student_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .all()
    )
    class_ids = [sc.class_id for sc in student_classes]

    if not class_ids:
        return {
            "pending": [],
            "pastdue": [],
            "completed": [],
            "all": [],
        }

    now = datetime.now(timezone.utc)

    results = (
        db.query(
            ClassworkAssignment.classwork_assignment_id,
            ClassworkAssignment.class_id,
            ClassworkAssignment.due_date,
            ClassworkAssignment.publish_date,
            Classwork.classwork_id,
            Classwork.title,
            Classwork.classwork_type,
            Classwork.classwork_category,
            Classwork.is_graded,
            Classwork.total_points,
            Classwork.show_scores,
            Subject.subject_name,
            Subject.subject_id,
            StudentSubmission.submission_id,
            StudentSubmission.status.label("submission_status"),
            StudentSubmission.submitted_at,
            StudentSubmission.grade,
        )
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Subject, Subject.subject_id == Classwork.subject_id)
        .outerjoin(
            StudentSubmission,
            (StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
            & (StudentSubmission.student_id == student.student_id),
        )
        .filter(
            ClassworkAssignment.class_id.in_(class_ids),
            or_(ClassworkAssignment.recipient_student_id.is_(None), ClassworkAssignment.recipient_student_id == student.student_id),
            ClassworkAssignment.is_published == True,
            Classwork.is_archived == False,
        )
    )

    if academic_period_id is not None:
        # We need to join SubjectLoad to filter by period
        results = results.join(
            SubjectLoad, 
            (SubjectLoad.class_id == ClassworkAssignment.class_id) & (SubjectLoad.subject_id == Classwork.subject_id)
        ).filter(SubjectLoad.academic_period_id == academic_period_id)

    results = results.order_by(ClassworkAssignment.due_date.asc().nulls_last()).all()

    pending_items = []
    pastdue_items = []
    completed_items = []
    all_items = []

    for row in results:
        is_submitted = (row.submission_status in ("submitted", "graded")) or (row.submitted_at is not None)

        due_dt = row.due_date
        is_past_due = False
        if due_dt:
            if due_dt.tzinfo is None:
                due_dt = due_dt.replace(tzinfo=timezone.utc)
            if due_dt < now and not is_submitted:
                is_past_due = True

        status = "completed" if is_submitted else ("pastdue" if is_past_due else "pending")

        total_pts = float(row.total_points) if row.total_points is not None else (None if not row.is_graded or row.classwork_type == "READING" else 100.0)

        item = {
            "assignment_id": row.classwork_assignment_id,
            "class_id": row.class_id,
            "classwork_id": row.classwork_id,
            "title": row.title,
            "subject": row.subject_name,
            "subject_id": row.subject_id,
            "due_date": row.due_date.isoformat() if row.due_date else None,
            "deadline": row.due_date.strftime("%B %d, %Y") if row.due_date else "No deadline",
            "type": row.classwork_type,
            "category": row.classwork_category,
            "is_graded": row.is_graded,
            "total_points": total_pts,
            "status": status,
            "is_submitted": is_submitted,
            "submission_status": row.submission_status,
            "show_scores": row.show_scores,
            "grade": float(row.grade) if row.grade is not None else None,
        }

        all_items.append(item)
        if status == "completed":
            completed_items.append(item)
        elif status == "pastdue":
            pastdue_items.append(item)
        else:
            pending_items.append(item)

    return {
        "pending": pending_items,
        "pastdue": pastdue_items,
        "completed": completed_items,
        "all": all_items,
    }

