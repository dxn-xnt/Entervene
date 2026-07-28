from __future__ import annotations

from datetime import datetime
from sqlalchemy.orm import Session
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.SubjectLoad import (
    ConflictItem,
    SubjectLoadItem,
    TeacherWorkloadItem,
    ValidationResultResponse,
)


def parse_time_to_minutes(time_str: str | None) -> int | None:
    if not time_str:
        return None
    try:
        parts = time_str.strip().split(":")
        hours = int(parts[0])
        minutes = int(parts[1]) if len(parts) > 1 else 0
        return hours * 60 + minutes
    except Exception:
        return None


def calculate_duration_hours(start_time: str | None, end_time: str | None) -> float:
    start_min = parse_time_to_minutes(start_time)
    end_min = parse_time_to_minutes(end_time)
    if start_min is None or end_min is None or end_min <= start_min:
        return 0.0
    return (end_min - start_min) / 60.0


def times_overlap(start1: str | None, end1: str | None, start2: str | None, end2: str | None) -> bool:
    s1 = parse_time_to_minutes(start1)
    e1 = parse_time_to_minutes(end1)
    s2 = parse_time_to_minutes(start2)
    e2 = parse_time_to_minutes(end2)

    if s1 is None or e1 is None or s2 is None or e2 is None:
        return False
    return (s1 < e2) and (s2 < e1)


class ConflictDetectorService:

    @staticmethod
    def validate_loads(db: Session, loads: list[SubjectLoadItem], academic_period=None) -> ValidationResultResponse:
        conflicts: list[ConflictItem] = []

        # Map helpers
        subject_ids = list({load.subject_id for load in loads})
        class_ids = list({load.class_id for load in loads})
        staff_ids = list({load.staff_id for load in loads if load.staff_id})

        subjects_map = {s.subject_id: s for s in db.query(Subject).filter(Subject.subject_id.in_(subject_ids)).all()} if subject_ids else {}
        classes_map = {c.class_id: c for c in db.query(Class).filter(Class.class_id.in_(class_ids)).all()} if class_ids else {}
        staff_map = {st.staff_id: st for st in db.query(AcademicStaff).filter(AcademicStaff.staff_id.in_(staff_ids)).all()} if staff_ids else {}

        # Compute weeks in the academic period for term-total comparison
        num_weeks = None
        if academic_period and hasattr(academic_period, 'start_date') and hasattr(academic_period, 'end_date'):
            if academic_period.start_date and academic_period.end_date:
                delta = academic_period.end_date - academic_period.start_date
                num_weeks = max(1, delta.days // 7)

        # ---------------------------------------------------------
        # 1. Teacher Time Overlap & 2. Section Timetable Overlap
        # ---------------------------------------------------------
        for i in range(len(loads)):
            load1 = loads[i]
            c1_name = classes_map[load1.class_id].section_name if load1.class_id in classes_map else f"Class #{load1.class_id}"
            s1_name = subjects_map[load1.subject_id].subject_name if load1.subject_id in subjects_map else f"Subject #{load1.subject_id}"

            for j in range(i + 1, len(loads)):
                load2 = loads[j]
                c2_name = classes_map[load2.class_id].section_name if load2.class_id in classes_map else f"Class #{load2.class_id}"
                s2_name = subjects_map[load2.subject_id].subject_name if load2.subject_id in subjects_map else f"Subject #{load2.subject_id}"

                # Find common days
                common_days = set(load1.days_of_week or []).intersection(set(load2.days_of_week or []))
                if not common_days:
                    continue

                if times_overlap(load1.start_time, load1.end_time, load2.start_time, load2.end_time):
                    day_list_str = ", ".join(sorted(list(common_days)))

                    # Rule 1: Teacher Time Overlap
                    if load1.staff_id and load2.staff_id and load1.staff_id == load2.staff_id:
                        t_name = f"{staff_map[load1.staff_id].first_name} {staff_map[load1.staff_id].last_name}" if load1.staff_id in staff_map else load1.staff_id
                        conflicts.append(
                            ConflictItem(
                                rule="TEACHER_OVERLAP",
                                severity="error",
                                message=f"Teacher {t_name} is double-booked on {day_list_str} ({load1.start_time}-{load1.end_time} in {c1_name} vs {load2.start_time}-{load2.end_time} in {c2_name}).",
                                class_id=load1.class_id,
                                subject_id=load1.subject_id,
                                staff_id=load1.staff_id,
                                day=list(common_days)[0],
                                affected_key=f"{load1.class_id}_{load1.subject_id}",
                            )
                        )

                    # Rule 2: Section Timetable Overlap
                    if load1.class_id == load2.class_id:
                        conflicts.append(
                            ConflictItem(
                                rule="SECTION_OVERLAP",
                                severity="error",
                                message=f"Section {c1_name} has overlapping subjects on {day_list_str} ({s1_name} at {load1.start_time}-{load1.end_time} vs {s2_name} at {load2.start_time}-{load2.end_time}).",
                                class_id=load1.class_id,
                                subject_id=load1.subject_id,
                                staff_id=load1.staff_id,
                                day=list(common_days)[0],
                                affected_key=f"{load1.class_id}_{load1.subject_id}",
                            )
                        )

        # ---------------------------------------------------------
        # 3. Daily Workload Capacity (Strict) & Teacher Tracker
        # ---------------------------------------------------------
        teacher_daily_hours: dict[str, dict[str, float]] = {}
        teacher_daily_subjects: dict[str, dict[str, set[int]]] = {}

        for load in loads:
            if not load.staff_id or not load.days_of_week or not load.start_time or not load.end_time:
                continue

            duration = calculate_duration_hours(load.start_time, load.end_time)
            staff_id = load.staff_id

            if staff_id not in teacher_daily_hours:
                teacher_daily_hours[staff_id] = {}
                teacher_daily_subjects[staff_id] = {}

            for day in load.days_of_week:
                teacher_daily_hours[staff_id][day] = teacher_daily_hours[staff_id].get(day, 0.0) + duration
                if day not in teacher_daily_subjects[staff_id]:
                    teacher_daily_subjects[staff_id][day] = set()
                teacher_daily_subjects[staff_id][day].add(load.subject_id)

        teacher_workloads: list[TeacherWorkloadItem] = []

        for staff_id, daily_hrs in teacher_daily_hours.items():
            staff_obj = staff_map.get(staff_id)
            staff_name = f"{staff_obj.first_name} {staff_obj.last_name}" if staff_obj else staff_id

            daily_sub_counts = {day: len(subs) for day, subs in teacher_daily_subjects.get(staff_id, {}).items()}
            total_weekly = sum(daily_hrs.values())
            has_warning = False

            for day, hrs in daily_hrs.items():
                if hrs > 6.0:
                    has_warning = True
                    conflicts.append(
                        ConflictItem(
                            rule="DAILY_WORKLOAD_EXCEEDED",
                            severity="error",
                            message=f"Teacher {staff_name} exceeds max 6 hours/day on {day} ({hrs:.1f} hrs scheduled).",
                            staff_id=staff_id,
                            day=day,
                        )
                    )

            for day, count in daily_sub_counts.items():
                if count > 4:
                    has_warning = True
                    conflicts.append(
                        ConflictItem(
                            rule="DAILY_WORKLOAD_EXCEEDED",
                            severity="error",
                            message=f"Teacher {staff_name} exceeds max 4 subjects/day on {day} ({count} subjects scheduled).",
                            staff_id=staff_id,
                            day=day,
                        )
                    )

            teacher_workloads.append(
                TeacherWorkloadItem(
                    staff_id=staff_id,
                    staff_name=staff_name,
                    daily_hours=daily_hrs,
                    daily_subjects_count=daily_sub_counts,
                    total_weekly_hours=total_weekly,
                    has_capacity_warning=has_warning,
                )
            )

        # ---------------------------------------------------------
        # 4. Total Subject Hours Validation (Term Total)
        # ---------------------------------------------------------
        # Group loads by (class_id, subject_id)
        load_groups: dict[tuple[int, int], list[SubjectLoadItem]] = {}
        for load in loads:
            key = (load.class_id, load.subject_id)
            if key not in load_groups:
                load_groups[key] = []
            load_groups[key].append(load)

        for (cid, sid), group in load_groups.items():
            subject_obj = subjects_map.get(sid)
            class_obj = classes_map.get(cid)
            if not subject_obj or not subject_obj.hours or subject_obj.hours <= 0:
                continue

            required_hours = float(subject_obj.hours)
            weekly_scheduled = 0.0

            for load in group:
                dur = calculate_duration_hours(load.start_time, load.end_time)
                days_count = len(load.days_of_week or [])
                weekly_scheduled += dur * days_count

            # subject.hours is the total for the entire term, so multiply weekly by num_weeks
            if num_weeks is not None:
                total_scheduled = weekly_scheduled * num_weeks
            else:
                # Fallback: assume 20 weeks if no period info available
                total_scheduled = weekly_scheduled * 20

            if abs(total_scheduled - required_hours) > 0.01:
                c_name = class_obj.section_name if class_obj else f"Class #{cid}"
                conflicts.append(
                    ConflictItem(
                        rule="SUBJECT_HOURS_MISMATCH",
                        severity="warning",
                        message=f"Subject '{subject_obj.subject_name}' in {c_name} requires {required_hours:.0f} hrs total for the term, but {total_scheduled:.1f} hrs are scheduled ({weekly_scheduled:.1f} hrs/wk × {num_weeks or 20} weeks).",
                        class_id=cid,
                        subject_id=sid,
                        affected_key=f"{cid}_{sid}",
                    )
                )

        has_errors = any(c.severity == "error" for c in conflicts)
        return ValidationResultResponse(
            is_valid=not has_errors,
            conflicts=conflicts,
            teacher_workloads=teacher_workloads,
        )

