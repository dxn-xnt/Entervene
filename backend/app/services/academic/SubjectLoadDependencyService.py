from __future__ import annotations
from collections import Counter
from typing import Any
from enum import Enum
import re
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


_STANDARD_LOGICAL_ID_RE = re.compile(r"^LL_(\d+)_(\d+)_(\d+)(?:_s\d+)?$")
_MAX_LOGICAL_LOAD_ID_LEN = 64


class ChangeType(str, Enum):
    UNCHANGED = "UNCHANGED"
    SCHEDULE_CHANGED = "SCHEDULE_CHANGED"
    TEACHER_REASSIGNED = "TEACHER_REASSIGNED"
    NEW_SUBJECT = "NEW_SUBJECT"
    REMOVED_SUBJECT = "REMOVED_SUBJECT"
    REMOVED_SLOT = "REMOVED_SLOT"
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
    def get_active_substitution_count(cls, db: Session, subject_load_id: int | None) -> int:
        if subject_load_id is None:
            return 0
        from app.services.academic.SubstitutionService import SubstitutionService
        today_date = SubstitutionService.get_academic_date()
        return int(
            db.query(func.count(TeacherSubstitution.substitution_id))
            .filter(
                TeacherSubstitution.subject_load_id == subject_load_id,
                TeacherSubstitution.status == "active",
                or_(TeacherSubstitution.end_date.is_(None), TeacherSubstitution.end_date >= today_date),
            )
            .scalar()
            or 0
        )

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
        deps = dict(batched.get((load.class_id, load.subject_id), {
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
        }))

        active_sub_count = cls.get_active_substitution_count(db, load.subject_load_id)
        deps["active_substitutions"] = active_sub_count

        can_delete = (deps.get("educational_total", 0) == 0 and active_sub_count == 0)
        return can_delete, deps

    @staticmethod
    def canonical_logical_load_id(class_id: int, subject_id: int, academic_period_id: int) -> str:
        return f"LL_{class_id}_{subject_id}_{academic_period_id}"

    @staticmethod
    def is_compatible_logical_load_id(
        logical_load_id: str | None,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
    ) -> bool:
        if not logical_load_id or not isinstance(logical_load_id, str):
            return False
        cleaned = logical_load_id.strip()
        if not cleaned or len(cleaned) > _MAX_LOGICAL_LOAD_ID_LEN:
            return False
        match = _STANDARD_LOGICAL_ID_RE.match(cleaned)
        if match:
            return (int(match.group(1)), int(match.group(2)), int(match.group(3))) == (
                class_id,
                subject_id,
                academic_period_id,
            )
        return True

    @staticmethod
    def _slot_schedule_key(load: Any) -> tuple[Any, ...]:
        return (
            getattr(load, "class_id", None),
            getattr(load, "subject_id", None),
            getattr(load, "start_time", None),
            getattr(load, "end_time", None),
            tuple(sorted(getattr(load, "days_of_week", None) or [])),
            getattr(load, "slot_id", None),
        )

    @staticmethod
    def _slot_time_days_key(load: Any) -> tuple[Any, ...]:
        return (
            getattr(load, "class_id", None),
            getattr(load, "subject_id", None),
            getattr(load, "start_time", None),
            getattr(load, "end_time", None),
            tuple(sorted(getattr(load, "days_of_week", None) or [])),
        )

    @classmethod
    def _next_available_logical_load_id(
        cls,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
        forbidden: set[str],
    ) -> str:
        base = cls.canonical_logical_load_id(class_id, subject_id, academic_period_id)
        if len(base) <= _MAX_LOGICAL_LOAD_ID_LEN and base not in forbidden:
            return base
        suffix = 2
        while True:
            tag = f"_s{suffix}"
            prefix = base[: _MAX_LOGICAL_LOAD_ID_LEN - len(tag)]
            candidate = f"{prefix}{tag}"
            if candidate not in forbidden:
                return candidate
            suffix += 1

    @staticmethod
    def _ordered_candidates(candidates: list[SubjectLoad]) -> list[tuple[int, SubjectLoad]]:
        return sorted(
            enumerate(candidates),
            key=lambda pair: (
                getattr(pair[1], "subject_load_id", None) is None,
                getattr(pair[1], "subject_load_id", None) or 0,
                pair[0],
            ),
        )

    @classmethod
    def match_loads_to_drafts(
        cls,
        items: list[Any],
        drafts: list[SubjectLoad],
        *,
        academic_period_id: int | None = None,
        allow_single_slot_stateless_fallback: bool = False,
    ) -> dict[int, SubjectLoad]:
        """Match incoming slot items 1-to-1 to existing draft rows without ever collapsing multi-slot rows."""
        ordered_drafts = cls._ordered_candidates(drafts)
        matched: dict[int, SubjectLoad] = {}
        claimed_draft_indices: set[int] = set()

        def _scope(obj: Any, default_period: int | None = None) -> tuple[int, int, int | None]:
            return (
                obj.class_id,
                obj.subject_id,
                default_period if default_period is not None else getattr(obj, "academic_period_id", None),
            )

        def _claim(item_idx: int, draft_idx: int, draft_obj: SubjectLoad) -> None:
            matched[item_idx] = draft_obj
            claimed_draft_indices.add(draft_idx)

        # Pass 1: exact subject_load_id
        for i, item in enumerate(items):
            item_id = getattr(item, "subject_load_id", None)
            if item_id is None:
                continue
            item_scope = _scope(item, academic_period_id)
            for d_idx, draft in ordered_drafts:
                if d_idx in claimed_draft_indices:
                    continue
                if draft.subject_load_id == item_id and _scope(draft) == item_scope:
                    _claim(i, d_idx, draft)
                    break

        # Pass 2: unique continued_from_load_id
        unclaimed_cont_counts = Counter(
            (_scope(d), d.continued_from_load_id)
            for d_idx, d in ordered_drafts
            if d_idx not in claimed_draft_indices and d.continued_from_load_id is not None
        )
        unmatched_item_cont_counts = Counter(
            (_scope(it, academic_period_id), getattr(it, "continued_from_load_id", None))
            for i, it in enumerate(items)
            if i not in matched and getattr(it, "continued_from_load_id", None) is not None
        )
        for i, item in enumerate(items):
            if i in matched:
                continue
            cont_id = getattr(item, "continued_from_load_id", None)
            if cont_id is None:
                continue
            item_scope = _scope(item, academic_period_id)
            key = (item_scope, cont_id)
            if unclaimed_cont_counts[key] != 1 or unmatched_item_cont_counts[key] != 1:
                continue
            for d_idx, draft in ordered_drafts:
                if d_idx in claimed_draft_indices:
                    continue
                if _scope(draft) == item_scope and draft.continued_from_load_id == cont_id:
                    _claim(i, d_idx, draft)
                    break

        # Pass 3: unique compatible logical_load_id
        unclaimed_log_counts = Counter(
            (_scope(d), d.logical_load_id)
            for d_idx, d in ordered_drafts
            if d_idx not in claimed_draft_indices and d.logical_load_id
        )
        unmatched_item_log_counts = Counter(
            (_scope(it, academic_period_id), getattr(it, "logical_load_id", None))
            for i, it in enumerate(items)
            if i not in matched and getattr(it, "logical_load_id", None)
        )
        for i, item in enumerate(items):
            if i in matched:
                continue
            log_id = getattr(item, "logical_load_id", None)
            if not log_id:
                continue
            item_scope = _scope(item, academic_period_id)
            key = (item_scope, log_id)
            if unclaimed_log_counts[key] != 1 or unmatched_item_log_counts[key] != 1:
                continue
            for d_idx, draft in ordered_drafts:
                if d_idx in claimed_draft_indices:
                    continue
                if _scope(draft) == item_scope and draft.logical_load_id == log_id:
                    _claim(i, d_idx, draft)
                    break

        # Pass 4: exact schedule signature (with slot_id, then start/end/days)
        for key_fn in (cls._slot_schedule_key, cls._slot_time_days_key):
            for i, item in enumerate(items):
                if i in matched:
                    continue
                item_scope = _scope(item, academic_period_id)
                item_sig = key_fn(item)
                for d_idx, draft in ordered_drafts:
                    if d_idx in claimed_draft_indices:
                        continue
                    if _scope(draft) == item_scope and key_fn(draft) == item_sig:
                        _claim(i, d_idx, draft)
                        break

        # Pass 5: duplicate logical_load_id fallback (repairs legacy shared logical_load_id drafts)
        for i, item in enumerate(items):
            if i in matched:
                continue
            log_id = getattr(item, "logical_load_id", None)
            if not log_id:
                continue
            item_scope = _scope(item, academic_period_id)
            for d_idx, draft in ordered_drafts:
                if d_idx in claimed_draft_indices:
                    continue
                if _scope(draft) == item_scope and draft.logical_load_id == log_id:
                    _claim(i, d_idx, draft)
                    break

        # Pass 6: single-slot stateless compatibility (caller sent 1 slot without IDs after rescheduling)
        if allow_single_slot_stateless_fallback:
            scope_item_counts = Counter(_scope(it, academic_period_id) for it in items)
            for i, item in enumerate(items):
                if i in matched:
                    continue
                if (
                    getattr(item, "subject_load_id", None) is not None
                    or getattr(item, "logical_load_id", None)
                    or getattr(item, "continued_from_load_id", None) is not None
                ):
                    continue
                item_scope = _scope(item, academic_period_id)
                if scope_item_counts[item_scope] != 1:
                    continue
                remaining_for_scope = [
                    (d_idx, d)
                    for d_idx, d in ordered_drafts
                    if d_idx not in claimed_draft_indices and _scope(d) == item_scope
                ]
                if len(remaining_for_scope) == 1:
                    _claim(i, remaining_for_scope[0][0], remaining_for_scope[0][1])

        return matched

    @classmethod
    def match_loads_to_baselines(
        cls,
        items: list[Any],
        baselines: list[SubjectLoad],
        *,
        academic_period_id: int | None = None,
        matched_drafts: dict[int, SubjectLoad] | None = None,
        allow_single_slot_stateless_fallback: bool = True,
    ) -> dict[int, SubjectLoad]:
        """Match incoming/draft slot items 1-to-1 to active baseline published rows."""
        ordered_baselines = cls._ordered_candidates(baselines)
        draft_map = matched_drafts or {}
        matched: dict[int, SubjectLoad] = {}
        claimed_base_indices: set[int] = set()

        def _scope(obj: Any, default_period: int | None = None) -> tuple[int, int, int | None]:
            return (
                obj.class_id,
                obj.subject_id,
                default_period if default_period is not None else getattr(obj, "academic_period_id", None),
            )

        def _effective_logical_id(i: int, item: Any) -> str | None:
            raw = getattr(item, "logical_load_id", None)
            if raw:
                return raw
            draft = draft_map.get(i)
            return getattr(draft, "logical_load_id", None) if draft is not None else None

        def _claim(item_idx: int, base_idx: int, base_obj: SubjectLoad) -> None:
            matched[item_idx] = base_obj
            claimed_base_indices.add(base_idx)

        # Pass 1a: authoritative matched draft's continued_from_load_id
        for i, item in enumerate(items):
            draft = draft_map.get(i)
            cont_id = getattr(draft, "continued_from_load_id", None) if draft is not None else None
            if cont_id is None:
                continue
            item_scope = _scope(item, academic_period_id)
            for b_idx, base in ordered_baselines:
                if b_idx in claimed_base_indices:
                    continue
                if base.subject_load_id is not None and base.subject_load_id == cont_id and _scope(base) == item_scope:
                    _claim(i, b_idx, base)
                    break

        # Pass 1b: item's own continued_from_load_id (when no draft link matched above)
        for i, item in enumerate(items):
            if i in matched:
                continue
            cont_id = getattr(item, "continued_from_load_id", None)
            if cont_id is None:
                continue
            item_scope = _scope(item, academic_period_id)
            for b_idx, base in ordered_baselines:
                if b_idx in claimed_base_indices:
                    continue
                if base.subject_load_id is not None and base.subject_load_id == cont_id and _scope(base) == item_scope:
                    _claim(i, b_idx, base)
                    break

        # Pass 2: unique compatible logical_load_id
        unclaimed_base_log_counts = Counter(
            (_scope(b), b.logical_load_id)
            for b_idx, b in ordered_baselines
            if b_idx not in claimed_base_indices and b.logical_load_id
        )
        unmatched_item_log_counts = Counter(
            (_scope(it, academic_period_id), _effective_logical_id(i, it))
            for i, it in enumerate(items)
            if i not in matched and _effective_logical_id(i, it)
        )
        for i, item in enumerate(items):
            if i in matched:
                continue
            log_id = _effective_logical_id(i, item)
            if not log_id:
                continue
            item_scope = _scope(item, academic_period_id)
            key = (item_scope, log_id)
            if unclaimed_base_log_counts[key] != 1 or unmatched_item_log_counts[key] != 1:
                continue
            for b_idx, base in ordered_baselines:
                if b_idx in claimed_base_indices:
                    continue
                if _scope(base) == item_scope and base.logical_load_id == log_id:
                    _claim(i, b_idx, base)
                    break

        # Pass 3: exact schedule signature (with slot_id, then start/end/days)
        for key_fn in (cls._slot_schedule_key, cls._slot_time_days_key):
            for i, item in enumerate(items):
                if i in matched:
                    continue
                item_scope = _scope(item, academic_period_id)
                item_sig = key_fn(item)
                for b_idx, base in ordered_baselines:
                    if b_idx in claimed_base_indices:
                        continue
                    if _scope(base) == item_scope and key_fn(base) == item_sig:
                        _claim(i, b_idx, base)
                        break

        # Pass 4: duplicate logical_load_id fallback (for legacy baselines sharing LL_c_s_p)
        for i, item in enumerate(items):
            if i in matched:
                continue
            log_id = _effective_logical_id(i, item)
            if not log_id:
                continue
            item_scope = _scope(item, academic_period_id)
            for b_idx, base in ordered_baselines:
                if b_idx in claimed_base_indices:
                    continue
                if _scope(base) == item_scope and base.logical_load_id == log_id:
                    _claim(i, b_idx, base)
                    break

        # Pass 5: stateless single-slot fallback (caller edited a single-slot subject without sending IDs)
        if allow_single_slot_stateless_fallback:
            scope_item_counts = Counter(_scope(it, academic_period_id) for it in items)
            for i, item in enumerate(items):
                if i in matched:
                    continue
                if (
                    getattr(item, "subject_load_id", None) is not None
                    or _effective_logical_id(i, item)
                    or getattr(item, "continued_from_load_id", None) is not None
                ):
                    continue
                item_scope = _scope(item, academic_period_id)
                if scope_item_counts[item_scope] != 1:
                    continue
                remaining_for_scope = [
                    (b_idx, b)
                    for b_idx, b in ordered_baselines
                    if b_idx not in claimed_base_indices and _scope(b) == item_scope
                ]
                if len(remaining_for_scope) == 1:
                    _claim(i, remaining_for_scope[0][0], remaining_for_scope[0][1])

        return matched

    @classmethod
    def allocate_logical_load_ids(
        cls,
        items: list[Any],
        *,
        academic_period_id: int,
        matched_baselines: dict[int, SubjectLoad] | None = None,
        matched_drafts: dict[int, SubjectLoad] | None = None,
        reserved_ids: set[str] | None = None,
    ) -> list[str]:
        """
        Assign a unique, stable logical_load_id to every slot item in a section.
        - Single-slot subjects keep canonical LL_{class_id}_{subject_id}_{academic_period_id}.
        - Additional slots receive LL_{class_id}_{subject_id}_{academic_period_id}_s2, _s3, ...
        - Matched baseline/draft slots retain their existing valid logical_load_id first so
          newly added slots earlier in the payload never steal an existing slot's identity.
        """
        base_map = matched_baselines or {}
        draft_map = matched_drafts or {}
        blocked_new_ids = set(reserved_ids or ())
        used_ids: set[str] = set()
        allocated: list[str | None] = [None] * len(items)

        # Pass A: preserve valid preferred IDs in authority order
        # (matched baselines -> matched drafts -> unmatched items with explicit IDs)
        def _priority_key(idx: int) -> tuple[int, int, int]:
            if idx in base_map:
                return (0, base_map[idx].subject_load_id or 0, idx)
            if idx in draft_map:
                return (1, draft_map[idx].subject_load_id or 0, idx)
            return (2, 0, idx)

        for i in sorted(range(len(items)), key=_priority_key):
            item = items[i]
            candidates: list[str | None] = []
            if i in base_map:
                candidates.append(base_map[i].logical_load_id)
            if i in draft_map:
                candidates.append(draft_map[i].logical_load_id)
            candidates.append(getattr(item, "logical_load_id", None))

            is_matched_baseline = i in base_map
            for cand in candidates:
                if not cls.is_compatible_logical_load_id(
                    cand, item.class_id, item.subject_id, academic_period_id
                ):
                    continue
                cleaned = cand.strip()
                if cleaned in used_ids:
                    continue
                if not is_matched_baseline and cleaned in blocked_new_ids:
                    continue
                allocated[i] = cleaned
                used_ids.add(cleaned)
                break

        # Pass B: allocate deterministic unique IDs for new or legacy-duplicate slots
        for i, item in enumerate(items):
            if allocated[i] is not None:
                continue
            chosen = cls._next_available_logical_load_id(
                item.class_id,
                item.subject_id,
                academic_period_id,
                used_ids | blocked_new_ids,
            )
            allocated[i] = chosen
            used_ids.add(chosen)

        return [val for val in allocated if val is not None]

    @classmethod
    def classify_section_changes(
        cls,
        baseline_loads: list[SubjectLoad],
        draft_loads: list[SubjectLoad],
    ) -> list[dict[str, Any]]:
        """
        Compares the baseline published snapshot against the draft snapshot using 1-to-1 slot matching.
        Classifies each change into:
        UNCHANGED, SCHEDULE_CHANGED, TEACHER_REASSIGNED, NEW_SUBJECT, REMOVED_SUBJECT, REMOVED_SLOT.
        Enforces strict immutable identity: rows with different (class_id, subject_id, academic_period_id)
        never match, even if they share a logical_load_id.
        """
        matched_baselines = cls.match_loads_to_baselines(
            draft_loads,
            baseline_loads,
            academic_period_id=None,
            allow_single_slot_stateless_fallback=True,
        )
        matched_baseline_objs = set(id(b) for b in matched_baselines.values())
        remaining_subject_keys = {
            (d.class_id, d.subject_id, d.academic_period_id) for d in draft_loads
        }

        classified: list[dict[str, Any]] = []

        # Unmatched baseline rows -> REMOVED_SLOT if subject still has another slot, else REMOVED_SUBJECT
        for b_load in baseline_loads:
            if id(b_load) in matched_baseline_objs:
                continue
            b_key = (b_load.class_id, b_load.subject_id, b_load.academic_period_id)
            change_type = (
                ChangeType.REMOVED_SLOT
                if b_key in remaining_subject_keys
                else ChangeType.REMOVED_SUBJECT
            )
            classified.append({
                "change_type": change_type,
                "logical_load_id": b_load.logical_load_id
                or cls.canonical_logical_load_id(b_load.class_id, b_load.subject_id, b_load.academic_period_id),
                "baseline_load": b_load,
                "draft_load": None,
            })

        # Matched & newly added draft rows
        for i, d_load in enumerate(draft_loads):
            b_load = matched_baselines.get(i)
            log_id = (
                d_load.logical_load_id
                or (b_load.logical_load_id if b_load is not None else None)
                or cls.canonical_logical_load_id(d_load.class_id, d_load.subject_id, d_load.academic_period_id)
            )
            if b_load is None:
                classified.append({
                    "change_type": ChangeType.NEW_SUBJECT,
                    "logical_load_id": log_id,
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
                or (b_load.days_of_week or []) != (d_load.days_of_week or [])
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

        return classified
