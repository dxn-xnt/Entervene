import uuid
from decimal import Decimal
from typing import Any, Literal
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.people.Student import Student
from app.services.classes.ClassShared import normalized_text, readable_text


def _official_grade_value(row: StudentPeriodGrade) -> float | None:
    for value in (row.final_period_grade, row.transmuted_grade, row.initial_grade):
        if value is not None:
            return round(float(value), 2)
    return None


def resolve_student_gwa(
    db: Session,
    student: Student | uuid.UUID,
    active_academic_year_id: int | None = None,
) -> float | None:
    """Resolve a student's General Weighted Average (GWA) in priority order:
    1. Computed arithmetic mean across subjects from their most recent completed prior academic year.
       (Includes every subject with >= 1 valid grade; works for quarters, trimesters, or semesters)
    2. Manually entered prior_gwa from the Student profile.
    3. None (nulls sort last).
    """
    if isinstance(student, uuid.UUID):
        student_obj = db.query(Student).filter(Student.student_id == student).first()
    else:
        student_obj = student

    if not student_obj:
        return None

    student_id = student_obj.student_id

    # Resolve active academic year if not provided
    if active_academic_year_id is None:
        active_ay = db.query(AcademicYear.academic_year_id).filter(AcademicYear.is_active.is_(True)).first()
        active_academic_year_id = active_ay[0] if active_ay else None

    # 1. Look up student's most recently completed academic year prior to active year
    prior_classes_query = (
        db.query(Class.class_id, Class.academic_year_id, AcademicYear.start_date)
        .join(StudentClass, Class.class_id == StudentClass.class_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .filter(StudentClass.student_id == student_id)
    )
    if active_academic_year_id is not None:
        prior_classes_query = prior_classes_query.filter(Class.academic_year_id < active_academic_year_id)

    prior_class = prior_classes_query.order_by(AcademicYear.start_date.desc()).first()

    if prior_class is not None:
        grades = (
            db.query(StudentPeriodGrade)
            .filter(StudentPeriodGrade.student_id == student_id)
            .filter(StudentPeriodGrade.class_id == prior_class.class_id)
            .all()
        )

        subject_grades: dict[int, list[float]] = {}
        for grade_row in grades:
            val = _official_grade_value(grade_row)
            if val is not None:
                subject_grades.setdefault(grade_row.subject_id, []).append(val)

        # Partial completeness: every subject with >= 1 valid grade is included
        if subject_grades:
            subject_averages = [
                sum(scores) / len(scores)
                for scores in subject_grades.values()
                if scores
            ]
            if subject_averages:
                return round(sum(subject_averages) / len(subject_averages), 2)

    # 2. Fallback to manually supplied prior_gwa
    if student_obj.prior_gwa is not None:
        return round(float(student_obj.prior_gwa), 2)

    # 3. Neither available
    return None


def _assignment_gender_group(gender: str | None) -> str:
    val = normalized_text(gender)
    if val in {"male", "m", "boy"}:
        return "male"
    return "female"


def _gender_priority(gender: str | None) -> int:
    return 0 if _assignment_gender_group(gender) == "male" else 1


def _sort_students_alphabetical(students: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        students,
        key=lambda s: (
            _gender_priority(s.get("gender")),
            normalized_text(s.get("last_name")),
            normalized_text(s.get("first_name")),
            normalized_text(s.get("middle_name")),
            str(s.get("student_id")),
        ),
    )


def _sort_students_gwa(students: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Sort order: genderPriority -> GWA descending (nulls sort last) -> last_name -> first_name -> middle_name -> student_id
    # For GWA: (0, -gwa) for non-null so higher GWA comes first, (1, 0) for null so nulls sort last
    def gwa_sort_key(s: dict[str, Any]):
        gwa = s.get("gwa")
        gwa_tuple = (0, -float(gwa)) if gwa is not None else (1, 0)
        return (
            _gender_priority(s.get("gender")),
            gwa_tuple,
            normalized_text(s.get("last_name")),
            normalized_text(s.get("first_name")),
            normalized_text(s.get("middle_name")),
            str(s.get("student_id")),
        )

    return sorted(students, key=gwa_sort_key)


def distribute_students_balanced(
    db: Session,
    academic_level_id: int,
    section_ids: list[str],
    unassigned_student_ids: list[uuid.UUID],
    current_assignments: dict[str, list[uuid.UUID]],
    mode: Literal["alphabetical", "gwa"] = "alphabetical",
) -> dict[str, list[str]]:
    """Compute an even, gender-balanced (and optionally GWA-ranked) student distribution across sections.
    This function is strictly read-only and does not persist any StudentClass rows.
    """
    # Fetch all relevant students
    all_student_ids = set(unassigned_student_ids)
    for s_ids in current_assignments.values():
        all_student_ids.update(s_ids)

    if not all_student_ids or not section_ids:
        return {sec_id: [str(sid) for sid in current_assignments.get(sec_id, [])] for sec_id in section_ids}

    student_rows = db.query(Student).filter(Student.student_id.in_(all_student_ids)).all()
    students_map: dict[uuid.UUID, dict[str, Any]] = {}

    # Resolve active academic year once for GWA lookups
    active_ay = db.query(AcademicYear.academic_year_id).filter(AcademicYear.is_active.is_(True)).first()
    active_ay_id = active_ay[0] if active_ay else None

    for s in student_rows:
        gwa = resolve_student_gwa(db, s, active_ay_id) if mode == "gwa" else None
        students_map[s.student_id] = {
            "student_id": s.student_id,
            "first_name": s.first_name,
            "middle_name": s.middle_name,
            "last_name": s.last_name,
            "gender": s.gender,
            "student_lrn": s.student_lrn,
            "gwa": gwa,
        }

    sort_fn = _sort_students_gwa if mode == "gwa" else _sort_students_alphabetical

    # Initialize section rosters with existing assignments (sorted alphabetically for display)
    result_by_section: dict[str, list[dict[str, Any]]] = {
        sec_id: _sort_students_alphabetical([
            students_map[sid] for sid in current_assignments.get(sec_id, []) if sid in students_map
        ])
        for sec_id in section_ids
    }

    # Unassigned students pool
    unassigned_students = [
        students_map[sid] for sid in unassigned_student_ids if sid in students_map
    ]

    # Distribute by gender group: Male first, then Female
    for group in ("male", "female"):
        # Sort unassigned students of this gender using the mode's sort key
        group_unassigned = sort_fn([
            st for st in unassigned_students if _assignment_gender_group(st.get("gender")) == group
        ])

        for student in group_unassigned:
            # Find section with lowest current count of this gender; tie-break on total roster count
            best_section_id: str | None = None
            best_gender_count: int = 999999
            best_total_count: int = 999999

            for sec_id in section_ids:
                sec_students = result_by_section[sec_id]
                gender_count = sum(
                    1 for st in sec_students if _assignment_gender_group(st.get("gender")) == group
                )
                total_count = len(sec_students)

                if gender_count < best_gender_count:
                    best_section_id = sec_id
                    best_gender_count = gender_count
                    best_total_count = total_count
                elif gender_count == best_gender_count and total_count < best_total_count:
                    best_section_id = sec_id
                    best_gender_count = gender_count
                    best_total_count = total_count

            if best_section_id is not None:
                result_by_section[best_section_id].append(student)
                # Re-sort section roster alphabetically for display
                result_by_section[best_section_id] = _sort_students_alphabetical(
                    result_by_section[best_section_id]
                )

    return {
        sec_id: [str(st["student_id"]) for st in students]
        for sec_id, students in result_by_section.items()
    }
