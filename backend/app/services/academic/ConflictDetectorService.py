from __future__ import annotations

from datetime import datetime
from sqlalchemy.orm import Session
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.SubjectOffering import SubjectOffering
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
        # 4. Subject Offering Scope Check (Term / Grade Level / Pathway)
        # ---------------------------------------------------------
        if academic_period and hasattr(academic_period, 'academic_period_id'):
            try:
                period_offerings = (
                    db.query(SubjectOffering)
                    .filter(
                        SubjectOffering.academic_period_id == academic_period.academic_period_id,
                        SubjectOffering.status == "active",
                    )
                    .all()
                )
            except Exception:
                period_offerings = []
            if period_offerings:
                offered_tuples = {
                    (so.subject_id, so.academic_level_id, (so.pathway or "general").casefold())
                    for so in period_offerings
                }
                for load in loads:
                    class_obj = classes_map.get(load.class_id)
                    if class_obj:
                        cls_level_id = class_obj.academic_level_id
                        cls_pathway = (getattr(class_obj, "pathway", None) or "general").casefold()
                        subject_obj = subjects_map.get(load.subject_id)
                        s_name = subject_obj.subject_name if subject_obj else f"Subject #{load.subject_id}"
                        c_name = class_obj.section_name if class_obj else f"Class #{load.class_id}"

                        is_offered = any(
                            so_sub == load.subject_id
                            and so_lvl == cls_level_id
                            and (
                                so_pw == "both"
                                or so_pw == cls_pathway
                                or (so_pw == "general" and cls_pathway == "general")
                            )
                            for (so_sub, so_lvl, so_pw) in offered_tuples
                        )

                        if not is_offered:
                            conflicts.append(
                                ConflictItem(
                                    rule="SUBJECT_NOT_OFFERED_IN_PERIOD",
                                    severity="warning",
                                    message=f"Subject '{s_name}' is not in active subject offerings for section {c_name} in this term.",
                                    class_id=load.class_id,
                                    subject_id=load.subject_id,
                                    affected_key=f"{load.class_id}_{load.subject_id}",
                                )
                            )

        # ---------------------------------------------------------
        # 5. Math/Science 1-Hour Duration Mismatch Check (JHS)
        # ---------------------------------------------------------
        for load in loads:
            subject_obj = subjects_map.get(load.subject_id)
            class_obj = classes_map.get(load.class_id)
            if subject_obj and class_obj:
                s_name = subject_obj.subject_name or ""
                s_code = subject_obj.subject_codename or ""
                c_name = class_obj.section_name or ""
                is_jhs = not any(k in c_name.lower() for k in ["campos", "zara", "reyes", "del mundo"])
                is_math_sci = getattr(subject_obj, "is_math_or_science", False) or any(k in s_name.lower() or k in s_code.lower() for k in ["math", "mathematics", "science", "physics", "chemistry", "biology"])

                if is_jhs and is_math_sci and load.start_time and load.end_time:
                    dur_hrs = calculate_duration_hours(load.start_time, load.end_time)
                    if dur_hrs < 0.95:  # less than 60 mins
                        dur_mins = int(dur_hrs * 60)
                        conflicts.append(
                            ConflictItem(
                                rule="MATH_SCIENCE_DURATION_MISMATCH",
                                severity="warning",
                                message=f"Core subject '{s_name}' in JHS section '{c_name}' is assigned {dur_mins} mins, but requires 1 hr (60 mins) per day.",
                                class_id=load.class_id,
                                subject_id=load.subject_id,
                                affected_key=f"{load.class_id}_{load.subject_id}",
                            )
                        )

        # ---------------------------------------------------------
        # 6. Break Time Violation Check (Homeroom / Recess / Lunch)
        # ---------------------------------------------------------
        all_break_slots = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.is_locked_break == True).all()
        break_map: dict[str, list[PeriodTemplateSlot]] = {}
        for bslot in all_break_slots:
            break_map.setdefault(bslot.template_group, []).append(bslot)

        for load in loads:
            if not load.start_time or not load.end_time:
                continue
            class_obj = classes_map.get(load.class_id)
            if not class_obj:
                continue

            c_name = class_obj.section_name or ""
            grp = "JHS_45MIN"
            if "campos" in c_name.lower() or "zara" in c_name.lower():
                grp = "SHS_CAMPOS_ZARA"
            elif "del mundo" in c_name.lower() or "reyes" in c_name.lower():
                grp = "SHS_DELMUNDO_REYES"

            group_breaks = break_map.get(grp, [])
            for bslot in group_breaks:
                if times_overlap(load.start_time, load.end_time, bslot.start_time, bslot.end_time):
                    subject_obj = subjects_map.get(load.subject_id)
                    s_name = subject_obj.subject_name if subject_obj else f"Subject #{load.subject_id}"
                    conflicts.append(
                        ConflictItem(
                            rule="BREAK_TIME_VIOLATION",
                            severity="error",
                            message=f"Subject '{s_name}' in section '{c_name}' overlaps with {bslot.slot_name} ({bslot.start_time}-{bslot.end_time}).",
                            class_id=load.class_id,
                            subject_id=load.subject_id,
                            affected_key=f"{load.class_id}_{load.subject_id}",
                        )
                    )

        has_errors = any(c.severity == "error" for c in conflicts)
        failing_rules = {c.rule for c in conflicts if c.severity == "error"}
        total_rules = 6
        passed_count = max(0, total_rules - len(failing_rules))

        grouped_conflicts: dict[str, list[ConflictItem]] = {}
        for c in conflicts:
            grouped_conflicts.setdefault(c.rule, []).append(c)

        return ValidationResultResponse(
            is_valid=not has_errors,
            conflicts=conflicts,
            grouped_conflicts=grouped_conflicts,
            teacher_workloads=teacher_workloads,
            passed_checks_count=passed_count,
            total_checks_count=total_rules,
            can_publish=not has_errors,
        )

