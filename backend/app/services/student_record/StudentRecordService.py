from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
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
    ClassworkCategoryHeader,
    GradebookCategoryHeaderGroup,
    StudentClassworkResult,
    StudentGradebookResponse,
    StudentGradebookRow,
    StudentPeriodGradeFinalizeResponse,
    StudentRecordDetailResponse,
    StudentRecordPeriodOption,
    StudentRecordPeriodOptionsResponse,
    StudentRecordProfile,
    StudentRecordRosterResponse,
    StudentRecordRosterRow,
    StudentRecordScope,
    StudentRecordSummary,
    TermGradeSummaryResponse,
    TermGradeSummaryScope,
    TermPeriodInfo,
    TermGradeSummaryRow,
)
from app.services.prediction.PredictionOutcomeService import evaluate_outcomes_for_finalized_period_grade
from app.services.classes.ClassQueryService import _student_full_name


from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.people.AcademicStaff import AcademicStaff
from app.services.academic.SubstitutionService import SubstitutionService, _staff_full_name


COMPLETED_STATUSES = {"submitted", "graded", "late"}
GRADED_STATUS = "graded"
READING_TYPE = "READING"


def _to_decimal(value: Any, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be numeric.") from exc


@dataclass(frozen=True)
class TeacherRecordScope:
    subject_load: SubjectLoad
    class_: Class
    subject: Subject
    period: AcademicPeriod
    year: AcademicYear
    is_view_only: bool = False
    is_substitution: bool = False
    substitute_name: str | None = None
    original_teacher_name: str | None = None
    acting_staff_id: str | None = None



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
    today_date = date.today()
    active_subs = (
        db.query(TeacherSubstitution.subject_load_id, TeacherSubstitution.end_date)
        .filter(
            TeacherSubstitution.substitute_staff_id == staff_id,
            TeacherSubstitution.status == "active",
            TeacherSubstitution.start_date <= today_date,
        )
        .all()
    )
    covered_load_ids = [
        sub_id for sub_id, end_d in active_subs
        if end_d is None or today_date <= end_d
    ]

    from sqlalchemy import or_
    load_filter = SubjectLoad.staff_id == staff_id
    if covered_load_ids:
        load_filter = or_(SubjectLoad.staff_id == staff_id, SubjectLoad.subject_load_id.in_(covered_load_ids))

    query = (
        db.query(AcademicPeriod, AcademicYear)
        .join(SubjectLoad, SubjectLoad.academic_period_id == AcademicPeriod.academic_period_id)
        .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        .filter(load_filter, SubjectLoad.status.in_(["active", "published"]))
    )
    if class_id is not None:
        query = query.filter(SubjectLoad.class_id == class_id)
    if subject_id is not None:
        query = query.filter(SubjectLoad.subject_id == subject_id)

    rows = query.distinct().order_by(AcademicPeriod.is_active.desc(), AcademicPeriod.end_date.desc()).all()

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


def teacher_student_gradebook(
    db: Session,
    staff_id: str,
    class_id: int,
    subject_id: int,
    academic_period_id: int | None = None,
) -> StudentGradebookResponse:
    scope = _teacher_scope(db, staff_id, class_id, subject_id, academic_period_id)
    students = _roster(db, scope)
    assignments = _classwork_assignments(db, scope)
    submissions_by_student = _submissions_by_student(db, assignments)

    written_headers: list[ClassworkCategoryHeader] = []
    performance_headers: list[ClassworkCategoryHeader] = []
    quarterly_headers: list[ClassworkCategoryHeader] = []

    written_assignments: list[ClassworkAssignment] = []
    performance_assignments: list[ClassworkAssignment] = []
    quarterly_assignments: list[ClassworkAssignment] = []

    for assignment in assignments:
        cw = assignment.classwork
        if not getattr(cw, "is_graded", True) or (getattr(cw, "classwork_type", "") or "").upper() == READING_TYPE:
            continue
        cat_key = _categorize_assignment(assignment)
        header = ClassworkCategoryHeader(
            id=assignment.classwork_assignment_id,
            title=assignment.classwork.title,
            maxScore=float(assignment.classwork.total_points or 100),
        )
        if cat_key == "writtenWork":
            written_headers.append(header)
            written_assignments.append(assignment)
        elif cat_key == "performanceTask":
            performance_headers.append(header)
            performance_assignments.append(assignment)
        else:
            quarterly_headers.append(header)
            quarterly_assignments.append(assignment)

    student_rows: list[StudentGradebookRow] = []
    def _extract_score(subs: dict, asgn_id: int) -> float | None:
        sub = subs.get(asgn_id)
        if sub is not None and sub.grade is not None:
            return float(sub.grade)
        return None

    for student in students:
        student_subs = submissions_by_student.get(student.student_id, {})

        written_scores = [
            _extract_score(student_subs, asgn.classwork_assignment_id)
            for asgn in written_assignments
        ]
        performance_scores = [
            _extract_score(student_subs, asgn.classwork_assignment_id)
            for asgn in performance_assignments
        ]
        quarterly_scores = [
            _extract_score(student_subs, asgn.classwork_assignment_id)
            for asgn in quarterly_assignments
        ]

        # DepEd K-12 grade computation
        ps_ww, ps_pt, ps_qa, ig, tg = _deped_grade(
            written_scores, written_assignments,
            performance_scores, performance_assignments,
            quarterly_scores, quarterly_assignments,
        )

        # Prefer finalized official grade if available
        metrics = _metrics_for_student(db, scope, student, assignments, student_subs)
        if metrics.official_period_grade is not None:
            display_total = str(round(metrics.official_period_grade, 1))
        elif tg is not None:
            display_total = str(round(tg, 1))
        else:
            display_total = "0"

        student_rows.append(
            StudentGradebookRow(
                student_id=str(student.student_id),
                name=_student_name(student),
                gender=student.gender,
                writtenWork=written_scores,
                performanceTask=performance_scores,
                quarterlyAssessment=quarterly_scores,
                ps_written=ps_ww,
                ps_performance=ps_pt,
                ps_quarterly=ps_qa,
                initial_grade=ig,
                transmuted_grade=tg,
                total=display_total,
            )
        )

    return StudentGradebookResponse(
        scope=_scope_out(scope),
        classwork=[
            GradebookCategoryHeaderGroup(
                writtenWork=written_headers,
                performanceTask=performance_headers,
                quarterlyAssessment=quarterly_headers,
            )
        ],
        studentGrades=student_rows,
    )


def _categorize_assignment(assignment: ClassworkAssignment) -> str:
    cat = (assignment.classwork.classwork_category or "").upper().replace(" ", "_").replace("-", "_")
    cw_type = (assignment.classwork.classwork_type or "").upper()

    # 1. Quarterly / exam signals (strongest priority)
    if "QUARTERLY" in cat or "QUARTER" in cat or "PERIODIC" in cat or "EXAM" in cat or cw_type == "EXAM":
        return "quarterlyAssessment"

    # 2. Explicit written-work category name
    if "WRITTEN" in cat or "SEAT" in cat:
        return "writtenWork"

    # 3. Explicit performance-task category name
    if "PERFORMANCE" in cat or "PROJECT" in cat:
        return "performanceTask"

    # 4. Type-based fallback (ASSIGNMENT and QUIZ are written-work by default in DepEd)
    if cw_type in ("ACTIVITY", "PROJECT"):
        return "performanceTask"

    # 5. Default: written work
    return "writtenWork"



def _category_ps(
    scores: list[float | None],
    assignments: list[ClassworkAssignment],
) -> float | None:
    """
    Percentage Score for a category.
    PS = (Sum of student scores) / (Sum of max scores) × 100
    Returns None when there are no assignments in the category.
    """
    total_max = sum(
        float(asgn.classwork.total_points or 0)
        for asgn in assignments
    )
    if total_max <= 0:
        return None
    total_earned = sum(s for s in scores if s is not None)
    return round((total_earned / total_max) * 100, 2)


# DepEd K-12 category weights (DO 8, s. 2015 – Grades 7-10)
_WW_WEIGHT = 0.30
_PT_WEIGHT = 0.50
_QA_WEIGHT = 0.20


def _deped_transmuted(initial_grade: float) -> float:
    """
    DepEd Transmutation Table (DO 8, s. 2015).
    Transmuted Grade = ((IG - 60) / 40) × 40 + 60  when IG >= 60
                     = (IG / 60) × 60               when IG < 60
    Which simplifies to TG = IG for IG in [60, 100] and TG = IG for IG < 60
    but the grade floor is 60 for passing marks.

    The published DepEd transmutation table maps:
      100 -> 100,  95 -> 98,  90 -> 95,  85 -> 91,  80 -> 87,
       75 -> 83,   70 -> 79,  65 -> 75,  60 -> 70,  55 -> 65,
       50 -> 60,   45 -> 55,  40 -> 50,  35 -> 45,  30 -> 40,
       25 -> 35,   20 -> 30,  15 -> 25,  10 -> 20,   5 -> 15, 0 -> 10
    We interpolate linearly between these breakpoints.
    """
    TABLE = [
        (100, 100), (95, 98), (90, 95), (85, 91), (80, 87),
        (75, 83), (70, 79), (65, 75), (60, 70), (55, 65),
        (50, 60), (45, 55), (40, 50), (35, 45), (30, 40),
        (25, 35), (20, 30), (15, 25), (10, 20), (5, 15), (0, 10),
    ]
    ig = max(0.0, min(100.0, initial_grade))
    # Find the two surrounding rows
    for i in range(len(TABLE) - 1):
        ig_high, tg_high = TABLE[i]
        ig_low, tg_low = TABLE[i + 1]
        if ig_low <= ig <= ig_high:
            if ig_high == ig_low:
                return float(tg_high)
            ratio = (ig - ig_low) / (ig_high - ig_low)
            return round(tg_low + ratio * (tg_high - tg_low), 2)
    return 10.0  # fallback for ig == 0


def _deped_grade(
    written_scores: list[float | None],
    written_assignments: list[ClassworkAssignment],
    performance_scores: list[float | None],
    performance_assignments: list[ClassworkAssignment],
    quarterly_scores: list[float | None],
    quarterly_assignments: list[ClassworkAssignment],
) -> tuple[float | None, float | None, float | None, float | None, float | None]:
    """
    Compute DepEd K-12 grades (DO 8, s. 2015).
    Returns (ps_written, ps_performance, ps_quarterly, initial_grade, transmuted_grade).
    Any category with no assignments contributes 0 weighted score.
    """
    ps_ww = _category_ps(written_scores, written_assignments)
    ps_pt = _category_ps(performance_scores, performance_assignments)
    ps_qa = _category_ps(quarterly_scores, quarterly_assignments)

    has_any = ps_ww is not None or ps_pt is not None or ps_qa is not None
    if not has_any:
        return None, None, None, None, None

    ww_contrib = (ps_ww or 0.0) * _WW_WEIGHT
    pt_contrib = (ps_pt or 0.0) * _PT_WEIGHT
    qa_contrib = (ps_qa or 0.0) * _QA_WEIGHT
    ig = round(ww_contrib + pt_contrib + qa_contrib, 2)
    tg = _deped_transmuted(ig)
    return ps_ww, ps_pt, ps_qa, ig, tg



def finalize_student_period_grade(
    db: Session,
    period_grade_id: int,
    final_period_grade: float | None = None,
    finalized_by_staff_id: str | None = None,
) -> StudentPeriodGradeFinalizeResponse:
    period_grade = db.get(StudentPeriodGrade, period_grade_id)
    if period_grade is None:
        raise HTTPException(status_code=404, detail="Student period grade not found")

    if finalized_by_staff_id:
        try:
            scope = _teacher_scope(db, finalized_by_staff_id, period_grade.class_id, period_grade.subject_id, period_grade.academic_period_id)
            if scope.is_view_only:
                raise HTTPException(status_code=403, detail="You are currently on leave for this class/subject. Records are read-only.")
        except HTTPException as e:
            if e.status_code == 403 and "leave" in str(e.detail).lower():
                raise e
            pass

    if final_period_grade is not None:
        period_grade.final_period_grade = _to_decimal(final_period_grade, "final_period_grade")
    if period_grade.final_period_grade is None:
        raise HTTPException(status_code=400, detail="final_period_grade is required to finalize a period grade")

    # Resolve passing threshold from SubjectGroup via the subject FK.
    # Falls back to 75.0 if the relation is not loaded (e.g. test environments
    # that don't seed the SubjectGroup table yet).
    passing_grade: float = 75.0
    from app.models.academic.Subject import Subject
    subject = db.get(Subject, period_grade.subject_id)
    if subject is not None and hasattr(subject, "subject_group_rel") and subject.subject_group_rel is not None:
        passing_grade = float(getattr(subject.subject_group_rel, "passing_threshold", 75.0))

    period_grade.is_finalized = True
    period_grade.finalized_at = datetime.now(timezone.utc)
    period_grade.finalized_by_staff_id = finalized_by_staff_id
    period_grade.entered_by_staff_id = finalized_by_staff_id
    db.flush()

    outcome_summary = evaluate_outcomes_for_finalized_period_grade(
        db,
        period_grade.period_grade_id,
        commit=False,
    )
    db.commit()
    db.refresh(period_grade)

    return StudentPeriodGradeFinalizeResponse(
        period_grade_id=period_grade.period_grade_id,
        student_id=period_grade.student_id,
        class_id=period_grade.class_id,
        subject_id=period_grade.subject_id,
        academic_period_id=period_grade.academic_period_id,
        final_period_grade=float(period_grade.final_period_grade),
        is_finalized=period_grade.is_finalized,
        finalized_at=period_grade.finalized_at,
        finalized_by_staff_id=period_grade.finalized_by_staff_id,
        prediction_outcomes_evaluated_count=outcome_summary["evaluated_count"],
        prediction_outcomes_skipped_count=outcome_summary["skipped_count"],
        prediction_outcomes_message=outcome_summary.get("reason"),
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

    # 1. Check if staff_id is directly assigned to the subject_load
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
            SubjectLoad.status.in_(["active", "published"]),
            Class.class_status != "archived",
        )
        .first()
    )
    if row:
        subject_load, class_, subject, period, year = row
        active_sub = SubstitutionService.get_active_substitution(db, subject_load.subject_load_id)
        is_view_only = False
        sub_name = None
        if active_sub is not None and active_sub.original_staff_id == staff_id:
            is_view_only = True
            sub_staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == active_sub.substitute_staff_id).first()
            sub_name = _staff_full_name(sub_staff)

        return TeacherRecordScope(
            subject_load=subject_load,
            class_=class_,
            subject=subject,
            period=period,
            year=year,
            is_view_only=is_view_only,
            is_substitution=False,
            substitute_name=sub_name,
            original_teacher_name=None,
            acting_staff_id=staff_id,
        )

    # 2. Check if staff_id is the active substitute covering this subject_load today
    sub_row = (
        db.query(SubjectLoad, Class, Subject, AcademicPeriod, AcademicYear, TeacherSubstitution, AcademicStaff)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id)
        .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
        .join(TeacherSubstitution, TeacherSubstitution.subject_load_id == SubjectLoad.subject_load_id)
        .join(AcademicStaff, AcademicStaff.staff_id == TeacherSubstitution.original_staff_id)
        .filter(
            TeacherSubstitution.substitute_staff_id == staff_id,
            TeacherSubstitution.status == "active",
            TeacherSubstitution.start_date <= date.today(),
            SubjectLoad.class_id == class_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.academic_period_id == period_id,
            SubjectLoad.status.in_(["active", "published"]),
            Class.class_status != "archived",
        )
        .first()
    )
    if sub_row:
        subject_load, class_, subject, period, year, sub_record, orig_staff = sub_row
        if sub_record.end_date is None or date.today() <= sub_record.end_date:
            return TeacherRecordScope(
                subject_load=subject_load,
                class_=class_,
                subject=subject,
                period=period,
                year=year,
                is_view_only=False,
                is_substitution=True,
                substitute_name=None,
                original_teacher_name=_staff_full_name(orig_staff),
                acting_staff_id=staff_id,
            )

    raise HTTPException(status_code=403, detail="Student records are outside your teaching scope")



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
            Classwork.is_graded.is_(True),
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
    return bool(period.start_date <= anchor_date <= period.end_date)


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
        cw = assignment.classwork
        if not getattr(cw, "is_graded", True) or (getattr(cw, "classwork_type", "") or "").upper() == READING_TYPE:
            continue
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
        if submission is not None and submission.grade is not None and assignment.classwork.total_points is not None:
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
    due_aware = _as_aware(assignment.due_date) if assignment.due_date else None
    if due_aware and due_aware < now:
        return "missing"
    return "pending"


def _is_late(assignment: ClassworkAssignment, submission: StudentSubmission) -> bool:
    if not assignment.due_date or not submission.submitted_at:
        return False
    sub_aware = _as_aware(submission.submitted_at)
    due_aware = _as_aware(assignment.due_date)
    if not sub_aware or not due_aware:
        return False
    return sub_aware > due_aware


def _as_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
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
        is_view_only=scope.is_view_only,
        is_substitution=scope.is_substitution,
        substitute_name=scope.substitute_name,
        original_teacher_name=scope.original_teacher_name,
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
    return _student_full_name(student)


def _academic_level_label(level: AcademicLevel | None) -> str | None:
    if not level:
        return None
    return level.level_name if level.level_name else f"Grade {level.grade_level}"


def teacher_term_grade_summary(
    db: Session,
    staff_id: str,
    class_id: int,
    subject_id: int,
) -> TermGradeSummaryResponse:
    options = teacher_period_options(db, staff_id, class_id, subject_id)
    if not options.periods:
        raise HTTPException(status_code=403, detail="Student records are outside your teaching scope")
        
    base_scope = _teacher_scope(db, staff_id, class_id, subject_id, options.default_academic_period_id)
    
    # Sort periods by start_date to assign sequence
    sorted_periods = sorted(options.periods, key=lambda p: p.start_date)
    handled_period_ids = {p.academic_period_id for p in sorted_periods}
    
    periods_info = [
        TermPeriodInfo(
            academic_period_id=p.academic_period_id,
            period_name=p.period_name,
            period_sequence=i + 1
        )
        for i, p in enumerate(sorted_periods)
    ]
    
    students = _roster(db, base_scope)
    
    passing_grade: float = 75.0
    if base_scope.subject is not None and hasattr(base_scope.subject, "subject_group_rel") and base_scope.subject.subject_group_rel is not None:
        passing_grade = float(getattr(base_scope.subject.subject_group_rel, "passing_threshold", 75.0))
        
    student_rows = {}
    for student in students:
        student_rows[student.student_id] = TermGradeSummaryRow(
            student_id=str(student.student_id),
            name=_student_name(student),
            gender=student.gender,
            term_grades={},
            final_grade=None,
            remark=None,
        )
        
    for p in sorted_periods:
        gradebook = teacher_student_gradebook(db, staff_id, class_id, subject_id, p.academic_period_id)
        for gb_row in gradebook.studentGrades:
            sid = UUID(gb_row.student_id)
            if sid in student_rows:
                grade_val = float(gb_row.total) if gb_row.total and gb_row.total != "0" else None
                student_rows[sid].term_grades[p.academic_period_id] = grade_val
                
    for sid, row in student_rows.items():
        missing_any = False
        grades = []
        for pid in handled_period_ids:
            g = row.term_grades.get(pid)
            if g is None:
                missing_any = True
            else:
                grades.append(g)
                
        if grades:
            row.final_grade = round(sum(grades) / len(grades), 1)
            
        if missing_any:
            row.remark = "INCOMPLETE"
        elif row.final_grade is not None:
            row.remark = "PASSED" if row.final_grade >= passing_grade else "FAILED"
            
    return TermGradeSummaryResponse(
        scope=TermGradeSummaryScope(
            class_id=base_scope.class_.class_id,
            subject_id=base_scope.subject.subject_id,
            academic_year_id=base_scope.year.academic_year_id,
            section_name=base_scope.class_.section_name,
            subject_name=base_scope.subject.subject_name,
            year_label=base_scope.year.year_label,
        ),
        periods=periods_info,
        students=list(student_rows.values()),
        passing_threshold=passing_grade,
    )

