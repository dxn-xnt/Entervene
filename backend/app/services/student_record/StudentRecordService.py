from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.StudentRecord import (
    StudentClassworkResult,
    StudentRecordDetailResponse,
    StudentRecordPeriodOption,
    StudentRecordPeriodOptionsResponse,
    StudentRecordProfile,
    StudentRecordRosterResponse,
    StudentRecordRosterRow,
    StudentRecordScope,
    StudentRecordSummary,
)


COMPLETED_STATUSES = {"submitted", "graded", "late"}
GRADED_STATUS = "graded"
READING_TYPE = "READING"


@dataclass(frozen=True)
class TeacherRecordScope:
    subject_load: SubjectLoad
    class_: Class
    subject: Subject
    period: AcademicPeriod
    year: AcademicYear


@dataclass(frozen=True)
class Metrics:
    official_period_grade: float | None
    running_classwork_percentage: float | None
    completion_rate: float | None
    assigned_count: int
    submitted_count: int
    missing_count: int
    late_count: int
    graded_count: int
    ungraded_count: int


def teacher_period_options(
    db: Session,
    staff_id: str,
    class_id: int | None = None,
    subject_id: int | None = None,
) -> StudentRecordPeriodOptionsResponse:
    query = (
        db.query(AcademicPeriod, AcademicYear)
        .join(SubjectLoad, SubjectLoad.academic_period_id == AcademicPeriod.academic_period_id)
        .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        .filter(SubjectLoad.staff_id == staff_id, SubjectLoad.status == "active")
    )
    if class_id is not None:
        query = query.filter(SubjectLoad.class_id == class_id)
    if subject_id is not None:
        query = query.filter(SubjectLoad.subject_id == subject_id)

    rows = query.order_by(AcademicPeriod.is_active.desc(), AcademicPeriod.end_date.desc()).all()
    options = [
        StudentRecordPeriodOption(
            academic_year_id=year.academic_year_id,
            academic_period_id=period.academic_period_id,
            year_label=year.year_label,
            period_name=period.period_name,
            is_active=bool(period.is_active),
            start_date=period.start_date,
            end_date=period.end_date,
        )
        for period, year in rows
    ]
    default_period = next((item.academic_period_id for item in options if item.is_active), None)
    if default_period is None and options:
        default_period = options[0].academic_period_id
    return StudentRecordPeriodOptionsResponse(
        default_academic_period_id=default_period,
        periods=options,
    )


def teacher_student_roster(
    db: Session,
    staff_id: str,
    class_id: int,
    subject_id: int,
    academic_period_id: int | None,
) -> StudentRecordRosterResponse:
    scope = _teacher_scope(db, staff_id, class_id, subject_id, academic_period_id)
    students = _roster(db, scope)
    assignments = _classwork_assignments(db, scope)
    submissions_by_student = _submissions_by_student(db, assignments)
    return StudentRecordRosterResponse(
        scope=_scope_out(scope),
        students=[
            _roster_row(
                student,
                _metrics_for_student(db, scope, student, assignments, submissions_by_student.get(student.student_id, {})),
            )
            for student in students
        ],
    )


def teacher_student_record_detail(
    db: Session,
    staff_id: str,
    class_id: int,
    subject_id: int,
    student_id: UUID,
    academic_period_id: int | None,
) -> StudentRecordDetailResponse:
    scope = _teacher_scope(db, staff_id, class_id, subject_id, academic_period_id)
    student = _scoped_student(db, scope, student_id)
    assignments = _classwork_assignments(db, scope)
    submissions = _submissions_by_student(db, assignments).get(student.student_id, {})
    metrics = _metrics_for_student(db, scope, student, assignments, submissions)
    return StudentRecordDetailResponse(
        student=StudentRecordProfile(
            student_id=str(student.student_id),
            lrn=student.student_lrn,
            full_name=_student_name(student),
            email=student.email,
            academic_level=_academic_level_label(scope.class_.academic_level),
            section_name=scope.class_.section_name,
        ),
        scope=_scope_out(scope),
        summary=StudentRecordSummary(**metrics.__dict__),
        classwork_results=[
            _classwork_result(assignment, submissions.get(assignment.classwork_assignment_id))
            for assignment in assignments
        ],
    )


def _teacher_scope(
    db: Session,
    staff_id: str,
    class_id: int,
    subject_id: int,
    academic_period_id: int | None,
) -> TeacherRecordScope:
    period_id = academic_period_id or _default_period_id(db, staff_id)
    if period_id is None:
        raise HTTPException(status_code=404, detail="No active or recent academic period found")

    row = (
        db.query(SubjectLoad, Class, Subject, AcademicPeriod, AcademicYear)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
        .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        .filter(
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.class_id == class_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.academic_period_id == period_id,
            SubjectLoad.status == "active",
            Class.class_status != "archived",
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=403, detail="Student records are outside your teaching scope")
    subject_load, class_, subject, period, year = row
    return TeacherRecordScope(
        subject_load=subject_load,
        class_=class_,
        subject=subject,
        period=period,
        year=year,
    )


def _default_period_id(db: Session, staff_id: str) -> int | None:
    options = teacher_period_options(db, staff_id)
    return options.default_academic_period_id


def _roster(db: Session, scope: TeacherRecordScope) -> list[Student]:
    return (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            StudentClass.class_id == scope.class_.class_id,
            StudentClass.academic_year_id == scope.year.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )


def _scoped_student(db: Session, scope: TeacherRecordScope, student_id: UUID) -> Student:
    student = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            Student.student_id == student_id,
            StudentClass.class_id == scope.class_.class_id,
            StudentClass.academic_year_id == scope.year.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .first()
    )
    if not student:
        raise HTTPException(status_code=404, detail="Student is not enrolled in this class scope")
    return student


def _classwork_assignments(db: Session, scope: TeacherRecordScope) -> list[ClassworkAssignment]:
    rows = (
        db.query(ClassworkAssignment)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == scope.class_.class_id,
            Classwork.subject_id == scope.subject.subject_id,
            Classwork.is_archived.is_(False),
            Classwork.classwork_type != READING_TYPE,
        )
        .order_by(ClassworkAssignment.due_date.asc().nullslast(), Classwork.created_at.asc())
        .all()
    )
    # Classwork assignments do not have academic_period_id yet. Due-date based
    # filtering can hide overdue/missing work when configured dates drift, so
    # use all class/subject assignments until the schema can filter directly.
    return rows


def _assignment_in_period(assignment: ClassworkAssignment, period: AcademicPeriod) -> bool:
    # Classwork assignments currently have no academic_period_id. Until the
    # schema gains one, use due date, then assigned_at, then classwork.created_at
    # as the best available period anchor.
    anchor = assignment.due_date or assignment.assigned_at
    if anchor is None and assignment.classwork:
        anchor = assignment.classwork.created_at
    if anchor is None:
        return True
    anchor_date = anchor.date() if isinstance(anchor, datetime) else anchor
    return period.start_date <= anchor_date <= period.end_date


def _submissions_by_student(
    db: Session,
    assignments: list[ClassworkAssignment],
) -> dict[UUID, dict[int, StudentSubmission]]:
    assignment_ids = [assignment.classwork_assignment_id for assignment in assignments]
    if not assignment_ids:
        return {}
    submissions = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id.in_(assignment_ids))
        .all()
    )
    grouped: dict[UUID, dict[int, StudentSubmission]] = {}
    for submission in submissions:
        grouped.setdefault(submission.student_id, {})[submission.classwork_assignment_id] = submission
    return grouped


def _metrics_for_student(
    db: Session,
    scope: TeacherRecordScope,
    student: Student,
    assignments: list[ClassworkAssignment],
    submissions: dict[int, StudentSubmission],
) -> Metrics:
    official_grade = _official_period_grade(db, scope, student)
    assigned_count = len(assignments)
    submitted_count = 0
    missing_count = 0
    late_count = 0
    graded_count = 0
    ungraded_count = 0
    earned = Decimal("0")
    possible = Decimal("0")
    now = datetime.now(timezone.utc)

    for assignment in assignments:
        submission = submissions.get(assignment.classwork_assignment_id)
        status = _status_for_assignment(assignment, submission, now)
        has_score = (
            submission is not None
            and submission.grade is not None
            and assignment.classwork.total_points is not None
        )
        if status in COMPLETED_STATUSES:
            submitted_count += 1
        if status == "missing":
            missing_count += 1
        if status == "late":
            late_count += 1
        # Quiz submissions can be auto-scored before their status is marked as graded.
        if has_score:
            graded_count += 1
            earned += Decimal(str(submission.grade))
            possible += Decimal(str(assignment.classwork.total_points))
        elif status in {"submitted", "late", GRADED_STATUS}:
            ungraded_count += 1

    return Metrics(
        official_period_grade=official_grade,
        running_classwork_percentage=_percentage(earned, possible),
        completion_rate=_ratio(submitted_count, assigned_count),
        assigned_count=assigned_count,
        submitted_count=submitted_count,
        missing_count=missing_count,
        late_count=late_count,
        graded_count=graded_count,
        ungraded_count=ungraded_count,
    )


def _official_period_grade(db: Session, scope: TeacherRecordScope, student: Student) -> float | None:
    row = (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == student.student_id,
            StudentPeriodGrade.class_id == scope.class_.class_id,
            StudentPeriodGrade.subject_id == scope.subject.subject_id,
            StudentPeriodGrade.academic_period_id == scope.period.academic_period_id,
        )
        .first()
    )
    if not row:
        return None
    for value in (row.final_period_grade, row.transmuted_grade, row.initial_grade):
        if value is not None:
            return float(value)
    return None


def _status_for_assignment(
    assignment: ClassworkAssignment,
    submission: StudentSubmission | None,
    now: datetime,
) -> str:
    if submission:
        status = (submission.status or "pending").lower()
        if status == "missed":
            return "missing"
        if status == "submitted" and _is_late(assignment, submission):
            return "late"
        return status
    if assignment.due_date and _as_aware(assignment.due_date) < now:
        return "missing"
    return "pending"


def _is_late(assignment: ClassworkAssignment, submission: StudentSubmission) -> bool:
    if not assignment.due_date or not submission.submitted_at:
        return False
    return _as_aware(submission.submitted_at) > _as_aware(assignment.due_date)


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _classwork_result(
    assignment: ClassworkAssignment,
    submission: StudentSubmission | None,
) -> StudentClassworkResult:
    status = _status_for_assignment(assignment, submission, datetime.now(timezone.utc))
    total_points = (
        float(assignment.classwork.total_points)
        if assignment.classwork.total_points is not None
        else None
    )
    score = float(submission.grade) if submission and submission.grade is not None else None
    return StudentClassworkResult(
        classwork_id=assignment.classwork.classwork_id,
        assignment_id=assignment.classwork_assignment_id,
        title=assignment.classwork.title,
        type=assignment.classwork.classwork_type,
        category=assignment.classwork.classwork_category,
        due_date=assignment.due_date,
        status=status,
        score=score,
        total_points=total_points,
        percentage=round((score / total_points) * 100, 2) if score is not None and total_points else None,
        submitted_at=submission.submitted_at if submission else None,
        graded_at=submission.graded_at if submission else None,
    )


def _roster_row(student: Student, metrics: Metrics) -> StudentRecordRosterRow:
    return StudentRecordRosterRow(
        student_id=str(student.student_id),
        lrn=student.student_lrn,
        full_name=_student_name(student),
        email=student.email,
        official_period_grade=metrics.official_period_grade,
        running_classwork_percentage=metrics.running_classwork_percentage,
        completion_rate=metrics.completion_rate,
        submitted_count=metrics.submitted_count,
        missing_count=metrics.missing_count,
        late_count=metrics.late_count,
        ungraded_count=metrics.ungraded_count,
    )


def _scope_out(scope: TeacherRecordScope) -> StudentRecordScope:
    return StudentRecordScope(
        class_id=scope.class_.class_id,
        subject_id=scope.subject.subject_id,
        academic_year_id=scope.year.academic_year_id,
        academic_period_id=scope.period.academic_period_id,
        section_name=scope.class_.section_name,
        subject_name=scope.subject.subject_name,
        period_name=scope.period.period_name,
        year_label=scope.year.year_label,
    )


def _ratio(part: int, whole: int) -> float | None:
    if whole <= 0:
        return None
    return round((part / whole) * 100, 2)


def _percentage(earned: Decimal, possible: Decimal) -> float | None:
    if possible <= 0:
        return None
    return round(float((earned / possible) * Decimal("100")), 2)


def _student_name(student: Student) -> str:
    return " ".join(
        part
        for part in [
            student.first_name,
            student.middle_name,
            student.last_name,
            student.suffix,
        ]
        if part
    )


def _academic_level_label(level: AcademicLevel | None) -> str | None:
    if not level:
        return None
    return level.level_name or f"Grade {level.grade_level}"
