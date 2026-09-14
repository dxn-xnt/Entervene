from __future__ import annotations
from typing import Any
from enum import Enum
from sqlalchemy import func, distinct, or_
from sqlalchemy.orm import Session

from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from app.models.attendance.Attendance import AttendanceRecord
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.SubjectLoadAssignmentLog import SubjectLoadAssignmentLog


class ChangeType(str, Enum):
    UNCHANGED = "UNCHANGED"
    SCHEDULE_CHANGED = "SCHEDULE_CHANGED"
    TEACHER_REASSIGNED = "TEACHER_REASSIGNED"
    NEW_SUBJECT = "NEW_SUBJECT"
    REMOVED_SUBJECT = "REMOVED_SUBJECT"
    IDENTITY_CHANGED = "IDENTITY_CHANGED"


class SubjectLoadDependencyService:

    @staticmethod
    def get_batched_period_dependencies(
        db: Session, academic_period_id: int
    ) -> dict[tuple[int, int], dict[str, int]]:
        """
        Executes independent grouped queries to count educational dependencies
        by (class_id, subject_id) for the given academic_period_id.
        Avoids multi-table joins and Cartesian explosion.
        """
        result: dict[tuple[int, int], dict[str, int]] = {}

        def _get_entry(cid: int, sid: int) -> dict[str, int]:
            if (cid, sid) not in result:
                result[(cid, sid)] = {
                    "classwork_assignments": 0,
                    "student_submissions": 0,
                    "assessment_scores": 0,
                    "period_grades": 0,
                    "grade_logs": 0,
                    "attendance_records": 0,
                    "lesson_assignments": 0,
                    "substitutions": 0,
                    "reassignment_logs": 0,
                    "educational_total": 0,
                    "administrative_total": 0,
                    "total": 0,
                }
            return result[(cid, sid)]

        # 1. Classwork assignments
        try:
            ca_rows = (
                db.query(
                    ClassworkAssignment.class_id,
                    Classwork.subject_id,
                    func.count(distinct(ClassworkAssignment.classwork_assignment_id)),
                )
                .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
                .filter(
                    or_(
                        ClassworkAssignment.academic_period_id == academic_period_id,
                        ClassworkAssignment.academic_period_id.is_(None),
                    )
                )
                .group_by(ClassworkAssignment.class_id, Classwork.subject_id)
                .all()
            )
            for cid, sid, cnt in ca_rows:
                entry = _get_entry(cid, sid)
                entry["classwork_assignments"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 2. Student Submissions
        try:
            subm_rows = (
                db.query(
                    ClassworkAssignment.class_id,
                    Classwork.subject_id,
                    func.count(distinct(StudentSubmission.submission_id)),
                )
                .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
                .join(StudentSubmission, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
                .filter(
                    or_(
                        ClassworkAssignment.academic_period_id == academic_period_id,
                        ClassworkAssignment.academic_period_id.is_(None),
                    )
                )
                .group_by(ClassworkAssignment.class_id, Classwork.subject_id)
                .all()
            )
            for cid, sid, cnt in subm_rows:
                entry = _get_entry(cid, sid)
                entry["student_submissions"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 3. Assessment Scores
        try:
            score_rows = (
                db.query(
                    StudentAssessmentScore.class_id,
                    StudentAssessmentScore.subject_id,
                    func.count(StudentAssessmentScore.score_id),
                )
                .filter(StudentAssessmentScore.academic_period_id == academic_period_id)
                .group_by(StudentAssessmentScore.class_id, StudentAssessmentScore.subject_id)
                .all()
            )
            for cid, sid, cnt in score_rows:
                entry = _get_entry(cid, sid)
                entry["assessment_scores"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 4. Period Grades
        try:
            grade_rows = (
                db.query(
                    StudentPeriodGrade.class_id,
                    StudentPeriodGrade.subject_id,
                    func.count(StudentPeriodGrade.grade_id),
                )
                .filter(StudentPeriodGrade.academic_period_id == academic_period_id)
                .group_by(StudentPeriodGrade.class_id, StudentPeriodGrade.subject_id)
                .all()
            )
            for cid, sid, cnt in grade_rows:
                entry = _get_entry(cid, sid)
                entry["period_grades"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 5. Grade Submission Logs
        try:
            log_rows = (
                db.query(
                    GradeSubmissionLog.class_id,
                    GradeSubmissionLog.subject_id,
                    func.count(GradeSubmissionLog.log_id),
                )
                .filter(GradeSubmissionLog.academic_period_id == academic_period_id)
                .group_by(GradeSubmissionLog.class_id, GradeSubmissionLog.subject_id)
                .all()
            )
            for cid, sid, cnt in log_rows:
                entry = _get_entry(cid, sid)
                entry["grade_logs"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 6. Attendance Records
        try:
            from app.models.academic.AcademicPeriod import AcademicPeriod
            period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
            att_query = (
                db.query(
                    AttendanceRecord.class_id,
                    AttendanceRecord.subject_id,
                    func.count(AttendanceRecord.attendance_id),
                )
                .filter(AttendanceRecord.subject_id.isnot(None))
            )
            if period and period.start_date and period.end_date:
                att_query = att_query.filter(
                    AttendanceRecord.date >= period.start_date,
                    AttendanceRecord.date <= period.end_date,
                )
            att_rows = att_query.group_by(AttendanceRecord.class_id, AttendanceRecord.subject_id).all()
            for cid, sid, cnt in att_rows:
                entry = _get_entry(cid, sid)
                entry["attendance_records"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 7. Lesson Assignments
        try:
            les_rows = (
                db.query(
                    LessonAssignment.class_id,
                    Lesson.subject_id,
                    func.count(distinct(LessonAssignment.lesson_assignment_id)),
                )
                .join(Lesson, Lesson.lesson_id == LessonAssignment.lesson_id)
                .group_by(LessonAssignment.class_id, Lesson.subject_id)
                .all()
            )
            for cid, sid, cnt in les_rows:
                entry = _get_entry(cid, sid)
                entry["lesson_assignments"] = cnt
                entry["educational_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 8. Teacher Substitutions
        try:
            sub_rows = (
                db.query(
                    SubjectLoad.class_id,
                    SubjectLoad.subject_id,
                    func.count(distinct(TeacherSubstitution.substitution_id)),
                )
                .join(TeacherSubstitution, TeacherSubstitution.subject_load_id == SubjectLoad.subject_load_id)
                .filter(SubjectLoad.academic_period_id == academic_period_id)
                .group_by(SubjectLoad.class_id, SubjectLoad.subject_id)
                .all()
            )
            for cid, sid, cnt in sub_rows:
                entry = _get_entry(cid, sid)
                entry["substitutions"] = cnt
                entry["administrative_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        # 9. Reassignment Logs
        try:
            reassign_rows = (
                db.query(
                    SubjectLoadAssignmentLog.class_id,
                    SubjectLoadAssignmentLog.subject_id,
                    func.count(SubjectLoadAssignmentLog.log_id),
                )
                .filter(SubjectLoadAssignmentLog.academic_period_id == academic_period_id)
                .group_by(SubjectLoadAssignmentLog.class_id, SubjectLoadAssignmentLog.subject_id)
                .all()
            )
            for cid, sid, cnt in reassign_rows:
                entry = _get_entry(cid, sid)
                entry["reassignment_logs"] = cnt
                entry["administrative_total"] += cnt
                entry["total"] += cnt
        except Exception:
            pass

        return result

    @classmethod
    def can_delete_subject_load(
        cls, db: Session, load: SubjectLoad
    ) -> tuple[bool, dict[str, int]]:
        """
        Authoritative check inspecting educational dependencies and active administrative locks.
        Returns (can_delete, dependencies_dict).

        - Educational dependencies (classwork, submissions, scores, grades, attendance, lessons)
          strictly block subject removal/deletion to preserve academic integrity.
        - Active substitutions currently covering the subject block removal until resolved.
        - Historical audit logs (past reassignment logs, completed substitutions) do NOT block
          section revision pruning because previous physical loads remain archived with their history.
        """
        batched = cls.get_batched_period_dependencies(db, load.academic_period_id)
        deps = batched.get((load.class_id, load.subject_id), {
            "classwork_assignments": 0,
            "student_submissions": 0,
            "assessment_scores": 0,
            "period_grades": 0,
            "grade_logs": 0,
            "attendance_records": 0,
            "lesson_assignments": 0,
            "substitutions": 0,
            "reassignment_logs": 0,
            "educational_total": 0,
            "administrative_total": 0,
            "total": 0,
        })

        from app.services.academic.SubstitutionService import SubstitutionService
        today_date = SubstitutionService.get_academic_date()
        active_sub_count = (
            db.query(func.count(TeacherSubstitution.substitution_id))
            .filter(
                TeacherSubstitution.subject_load_id == load.subject_load_id,
                TeacherSubstitution.status == "active",
                or_(TeacherSubstitution.end_date.is_(None), TeacherSubstitution.end_date >= today_date),
            )
            .scalar() or 0
        )
        deps["active_substitutions"] = active_sub_count

        can_delete = (deps.get("educational_total", 0) == 0 and active_sub_count == 0)
        return can_delete, deps

    @staticmethod
    def classify_section_changes(
        baseline_loads: list[SubjectLoad], draft_loads: list[SubjectLoad]
    ) -> list[dict[str, Any]]:
        """
        Compares the baseline published snapshot against the draft snapshot.
        Classifies each change into:
        UNCHANGED, SCHEDULE_CHANGED, TEACHER_REASSIGNED, NEW_SUBJECT, REMOVED_SUBJECT, IDENTITY_CHANGED
        """
        baseline_by_logical = {l.logical_load_id: l for l in baseline_loads}
        draft_by_logical = {l.logical_load_id: l for l in draft_loads}

        classified: list[dict[str, Any]] = []

        # Check existing and updated
        for log_id, b_load in baseline_by_logical.items():
            if log_id not in draft_by_logical:
                classified.append({
                    "change_type": ChangeType.REMOVED_SUBJECT,
                    "logical_load_id": log_id,
                    "baseline_load": b_load,
                    "draft_load": None,
                })
            else:
                d_load = draft_by_logical[log_id]
                # Strict immutable identity rule:
                # Math -> Science must always be decomposed into:
                # REMOVED_SUBJECT(Math, log_id) + NEW_SUBJECT(Science, new logical_load_id)
                if (
                    b_load.subject_id != d_load.subject_id
                    or b_load.class_id != d_load.class_id
                    or b_load.academic_period_id != d_load.academic_period_id
                ):
                    classified.append({
                        "change_type": ChangeType.REMOVED_SUBJECT,
                        "logical_load_id": log_id,
                        "baseline_load": b_load,
                        "draft_load": None,
                    })
                    classified.append({
                        "change_type": ChangeType.NEW_SUBJECT,
                        "logical_load_id": f"LL_{d_load.class_id}_{d_load.subject_id}_{d_load.academic_period_id}",
                        "baseline_load": None,
                        "draft_load": d_load,
                    })
                elif b_load.staff_id != d_load.staff_id:
                    classified.append({
                        "change_type": ChangeType.TEACHER_REASSIGNED,
                        "logical_load_id": log_id,
                        "baseline_load": b_load,
                        "draft_load": d_load,
                    })
                elif (
                    b_load.start_time != d_load.start_time
                    or b_load.end_time != d_load.end_time
                    or b_load.days_of_week != d_load.days_of_week
                    or b_load.slot_id != d_load.slot_id
                ):
                    classified.append({
                        "change_type": ChangeType.SCHEDULE_CHANGED,
                        "logical_load_id": log_id,
                        "baseline_load": b_load,
                        "draft_load": d_load,
                    })
                else:
                    classified.append({
                        "change_type": ChangeType.UNCHANGED,
                        "logical_load_id": log_id,
                        "baseline_load": b_load,
                        "draft_load": d_load,
                    })

        # Check newly added subjects
        for log_id, d_load in draft_by_logical.items():
            if log_id not in baseline_by_logical:
                classified.append({
                    "change_type": ChangeType.NEW_SUBJECT,
                    "logical_load_id": log_id,
                    "baseline_load": None,
                    "draft_load": d_load,
                })

        return classified
