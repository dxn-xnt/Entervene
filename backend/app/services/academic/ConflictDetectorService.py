from __future__ import annotations

from sqlalchemy.orm import Session
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.SubjectLoad import (
    ConflictItem,
    SubjectLoadItem,
    TeacherWorkloadItem,
    ValidationResultResponse,
)
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver
from app.services.academic.OfferingDurationService import (
    load_active_offerings,
    resolve_offering_for_class,
    time_range_minutes,
)


def parse_time_to_minutes(time_str: str | None) -> int | None:
    if not time_str:
        return None
    try:
        h, m = time_str.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return None


def get_teacher_workload_settings(db: Session) -> dict[str, float]:
    from app.models.settings.Setting import Setting
    keys = ["min_subjects_per_day", "max_subjects_per_day", "max_hours_per_day"]
    settings = db.query(Setting).filter(Setting.key.in_(keys)).all()
    s_map = {s.key: s.value for s in settings}
    return {
        "min_subjects_per_day": float(s_map.get("min_subjects_per_day", 4)),
        "max_subjects_per_day": float(s_map.get("max_subjects_per_day", 6)),
        "max_hours_per_day": float(s_map.get("max_hours_per_day", 6.0)),
    }


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
    def validate_loads(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
        *,
        require_complete_schedule: bool = False,
    ) -> ValidationResultResponse:
        conflicts: list[ConflictItem] = []

        # Map helpers
        subject_ids = list({load.subject_id for load in loads})
        class_ids = list({load.class_id for load in loads})
        staff_ids = list({load.staff_id for load in loads if load.staff_id})

        subjects_map = {s.subject_id: s for s in db.query(Subject).filter(Subject.subject_id.in_(subject_ids)).all()} if subject_ids else {}
        classes_map = {c.class_id: c for c in db.query(Class).filter(Class.class_id.in_(class_ids)).all()} if class_ids else {}
        staff_map = {st.staff_id: st for st in db.query(AcademicStaff).filter(AcademicStaff.staff_id.in_(staff_ids)).all()} if staff_ids else {}
        class_slots_map = {
            class_id: PeriodTemplateResolver.slots_for_class(db, class_obj)
            for class_id, class_obj in classes_map.items()
        }

        # Compute weeks in the academic period for term-total comparison
        num_weeks = None
        if academic_period and hasattr(academic_period, 'start_date') and hasattr(academic_period, 'end_date'):
            if academic_period.start_date and academic_period.end_date:
                delta = academic_period.end_date - academic_period.start_date
                num_weeks = max(1, delta.days // 7)

        # ---------------------------------------------------------
        # 0. Unassigned Teacher Check
        # ---------------------------------------------------------
        for load in loads:
            if not load.staff_id:
                c_name = classes_map[load.class_id].section_name if load.class_id in classes_map else f"Section #{load.class_id}"
                s_name = subjects_map[load.subject_id].subject_name if load.subject_id in subjects_map else f"Subject #{load.subject_id}"
                conflicts.append(
                    ConflictItem(
                        rule="UNASSIGNED_TEACHER",
                        severity="warning",
                        message=f"Subject '{s_name}' in section '{c_name}' has no assigned teacher.",
                        class_id=load.class_id,
                        subject_id=load.subject_id,
                        affected_key=f"{load.class_id}_{load.subject_id}",
                    )
                )

        if require_complete_schedule:
            for load in loads:
                if load.start_time and load.end_time and load.days_of_week:
                    continue
                c_name = classes_map[load.class_id].section_name if load.class_id in classes_map else f"Section #{load.class_id}"
                s_name = subjects_map[load.subject_id].subject_name if load.subject_id in subjects_map else f"Subject #{load.subject_id}"
                conflicts.append(
                    ConflictItem(
                        rule="UNSCHEDULED_LOAD",
                        severity="error",
                        message=f"Subject '{s_name}' in section '{c_name}' must have a valid time and at least one meeting day.",
                        class_id=load.class_id,
                        subject_id=load.subject_id,
                        affected_key=f"{load.class_id}_{load.subject_id}",
                    )
                )

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
                        key1 = f"{load1.class_id}_{load1.subject_id}"
                        key2 = f"{load2.class_id}_{load2.subject_id}"
                        conflicts.append(
                            ConflictItem(
                                rule="TEACHER_OVERLAP",
                                severity="error",
                                message=f"Teacher {t_name} is double-booked on {day_list_str} ({load1.start_time}-{load1.end_time} in {c1_name} vs {load2.start_time}-{load2.end_time} in {c2_name}).",
                                class_id=load1.class_id,
                                subject_id=load1.subject_id,
                                staff_id=load1.staff_id,
                                day=list(common_days)[0],
                                affected_key=key1,
                                affected_keys=list(dict.fromkeys([key1, key2])),
                                related_class_id=load2.class_id,
                                related_subject_id=load2.subject_id,
                                related_affected_key=key2,
                            )
                        )

                    # Rule 2: Section Timetable Overlap
                    if load1.class_id == load2.class_id:
                        key1 = f"{load1.class_id}_{load1.subject_id}"
                        key2 = f"{load2.class_id}_{load2.subject_id}"
                        conflicts.append(
                            ConflictItem(
                                rule="SECTION_OVERLAP",
                                severity="error",
                                message=f"Section {c1_name} has overlapping subjects on {day_list_str} ({s1_name} at {load1.start_time}-{load1.end_time} vs {s2_name} at {load2.start_time}-{load2.end_time}).",
                                class_id=load1.class_id,
                                subject_id=load1.subject_id,
                                staff_id=load1.staff_id,
                                day=list(common_days)[0],
                                affected_key=key1,
                                affected_keys=list(dict.fromkeys([key1, key2])),
                                related_class_id=load2.class_id,
                                related_subject_id=load2.subject_id,
                                related_affected_key=key2,
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
        caps = get_teacher_workload_settings(db)
        min_sub = int(caps["min_subjects_per_day"])
        max_sub = int(caps["max_subjects_per_day"])
        max_hrs = caps["max_hours_per_day"]

        for staff_id, daily_hrs in teacher_daily_hours.items():
            staff_obj = staff_map.get(staff_id)
            staff_name = f"{staff_obj.first_name} {staff_obj.last_name}" if staff_obj else staff_id

            daily_sub_counts = {day: len(subs) for day, subs in teacher_daily_subjects.get(staff_id, {}).items()}
            total_weekly = sum(daily_hrs.values())
            has_warning = False

            for day, hrs in daily_hrs.items():
                if hrs > max_hrs:
                    has_warning = True
                    conflicts.append(
                        ConflictItem(
                            rule="DAILY_WORKLOAD_EXCEEDED",
                            severity="error",
                            message=f"Teacher {staff_name} exceeds max {max_hrs} hours/day on {day} ({hrs:.1f} hrs scheduled).",
                            staff_id=staff_id,
                            day=day,
                        )
                    )

            for day, count in daily_sub_counts.items():
                if count > max_sub:
                    has_warning = True
                    conflicts.append(
                        ConflictItem(
                            rule="DAILY_WORKLOAD_EXCEEDED",
                            severity="error",
                            message=f"Teacher {staff_name} exceeds max {max_sub} subjects/day on {day} ({count} subjects scheduled).",
                            staff_id=staff_id,
                            day=day,
                        )
                    )
                elif count > 0 and count < min_sub:
                    has_warning = True
                    conflicts.append(
                        ConflictItem(
                            rule="DAILY_WORKLOAD_MINIMUM",
                            severity="warning",
                            message=f"Teacher {staff_name} has only {count} subjects on {day} (minimum is {min_sub}).",
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
            # Offering eligibility is a publication invariant. Do not swallow
            # lookup failures: callers must not interpret a failed query as an
            # academic period with no configured offerings.
            period_offerings = load_active_offerings(
                db,
                academic_period_id=academic_period.academic_period_id,
                academic_year_id=academic_period.academic_year_id,
            )

            for load in loads:
                class_obj = classes_map.get(load.class_id)
                if class_obj is None:
                    continue

                subject_obj = subjects_map.get(load.subject_id)
                s_name = subject_obj.subject_name if subject_obj else f"Subject #{load.subject_id}"
                c_name = class_obj.section_name or f"Class #{load.class_id}"

                offering = resolve_offering_for_class(
                    period_offerings,
                    subject_id=load.subject_id,
                    class_obj=class_obj,
                    academic_period_id=load.academic_period_id,
                )

                if offering is None:
                    conflicts.append(
                        ConflictItem(
                            rule="SUBJECT_NOT_OFFERED_IN_PERIOD",
                            severity="error",
                            message=(
                                f"Subject '{s_name}' has no active offering for section "
                                f"'{c_name}' in this academic year, grading period, "
                                "grade level, and pathway."
                            ),
                            class_id=load.class_id,
                            subject_id=load.subject_id,
                            affected_key=f"{load.class_id}_{load.subject_id}",
                        )
                    )
                elif offering.minutes is None:
                    conflicts.append(
                        ConflictItem(
                            rule="MISSING_OFFERING_DURATION",
                            severity="error",
                            message=f"Subject offering for '{s_name}' in section '{c_name}' has no period duration set (minutes is null). Please set the period minutes in Subject Offerings before publishing.",
                            class_id=load.class_id,
                            subject_id=load.subject_id,
                            affected_key=f"{load.class_id}_{load.subject_id}",
                        )
                    )
                elif (not load.start_time or not load.end_time) and not any(
                    slot.slot_type == "CLASS"
                    and not slot.is_locked_break
                    and time_range_minutes(slot.start_time, slot.end_time) == offering.minutes
                    for slot in class_slots_map.get(load.class_id, [])
                ):
                    conflicts.append(
                        ConflictItem(
                            rule="NO_MATCHING_DURATION_SLOT",
                            severity="error",
                            message=(
                                f"Subject '{s_name}' is configured for {offering.minutes} minutes, "
                                f"but section '{c_name}' has no matching timetable slot."
                            ),
                            class_id=load.class_id,
                            subject_id=load.subject_id,
                            affected_key=f"{load.class_id}_{load.subject_id}",
                        )
                    )
                elif load.start_time and load.end_time:
                    scheduled_minutes = time_range_minutes(load.start_time, load.end_time)
                    if scheduled_minutes is not None and scheduled_minutes != offering.minutes:
                        conflicts.append(
                            ConflictItem(
                                rule="OFFERING_DURATION_MISMATCH",
                                severity="error",
                                message=(
                                    f"Subject '{s_name}' is configured for {offering.minutes} minutes "
                                    f"in Curriculum Plan, but the selected timetable slot is "
                                    f"{scheduled_minutes} minutes."
                                ),
                                class_id=load.class_id,
                                subject_id=load.subject_id,
                                affected_key=f"{load.class_id}_{load.subject_id}",
                            )
                        )

        # ---------------------------------------------------------
        # 5b. Core Subject Split Schedule Warning Check (JHS)
        # ---------------------------------------------------------
        for load in loads:
            subject_obj = subjects_map.get(load.subject_id)
            class_obj = classes_map.get(load.class_id)
            if subject_obj and class_obj:
                s_name = subject_obj.subject_name or ""
                c_name = class_obj.section_name or ""
                c_group = getattr(class_obj, "period_template_group", None) or "JHS_45MIN"
                is_jhs = c_group == "JHS_45MIN"
                is_core = getattr(subject_obj, "is_core", False)

                if is_jhs and is_core and load.days_of_week and len(load.days_of_week) < 5:
                    conflicts.append(
                        ConflictItem(
                            rule="CORE_SUBJECT_SPLIT_SCHEDULE",
                            severity="warning",
                            message=f"Core subject '{s_name}' in section '{c_name}' is scheduled for only {len(load.days_of_week)} days ({', '.join(load.days_of_week)}) instead of standard 5-day daily schedule.",
                            class_id=load.class_id,
                            subject_id=load.subject_id,
                            affected_key=f"{load.class_id}_{load.subject_id}",
                        )
                    )

        # ---------------------------------------------------------
        # 6. Break Time Violation Check (Homeroom / Recess / Lunch)
        # ---------------------------------------------------------
        break_map: dict[int, list[PeriodTemplateSlot]] = {}
        for class_id, class_obj in classes_map.items():
            break_map[class_id] = [
                slot for slot in PeriodTemplateResolver.slots_for_class(db, class_obj)
                if slot.is_locked_break or slot.slot_type != "CLASS"
            ]

        for load in loads:
            if not load.start_time or not load.end_time:
                continue
            class_obj = classes_map.get(load.class_id)
            if not class_obj:
                continue

            c_name = class_obj.section_name or ""
            grp = getattr(class_obj, "period_template_group", None) or "JHS_45MIN"

            group_breaks = break_map.get(load.class_id, [])
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

        # ---------------------------------------------------------
        # 7. Pre-flight Diagnostic: Bell Schedule Configuration Check
        # ---------------------------------------------------------
        checked_class_ids = set()
        levels_map = {lvl.academic_level_id: lvl for lvl in db.query(AcademicLevel).all()}
        for load in loads:
            if load.class_id in checked_class_ids:
                continue
            checked_class_ids.add(load.class_id)
            class_obj = classes_map.get(load.class_id)
            if not class_obj:
                continue

            c_name = class_obj.section_name or f"Class #{class_obj.class_id}"
            lvl = levels_map.get(class_obj.academic_level_id)
            grade = lvl.grade_level if lvl else class_obj.academic_level_id
            grp = getattr(class_obj, "period_template_group", None)

            if grp is None:
                conflicts.append(
                    ConflictItem(
                        rule="UNCONFIGURED_BELL_SCHEDULE",
                        severity="warning",
                        message=f"Section '{c_name}' has no timetable template assigned. Please assign a bell schedule in Break Settings.",
                        class_id=class_obj.class_id,
                        subject_id=load.subject_id,
                        affected_key=f"{class_obj.class_id}_{load.subject_id}",
                    )
                )
            elif grade >= 11 and grp == "JHS_45MIN":
                conflicts.append(
                    ConflictItem(
                        rule="UNCONFIGURED_BELL_SCHEDULE",
                        severity="warning",
                        message=f"Senior High section '{c_name}' is currently assigned to the Junior High bell schedule ('JHS_45MIN'). Please assign an SHS timetable template in Break Settings to avoid break overlaps.",
                        class_id=class_obj.class_id,
                        subject_id=load.subject_id,
                        affected_key=f"{class_obj.class_id}_{load.subject_id}",
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
