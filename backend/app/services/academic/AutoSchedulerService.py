from __future__ import annotations

from datetime import datetime
from sqlalchemy.orm import Session
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.SubjectLoad import SubjectLoadItem
from app.services.academic.ConflictDetectorService import (
    parse_time_to_minutes,
    calculate_duration_hours,
    times_overlap,
)


def minutes_to_time_str(mins: int) -> str:
    h = mins // 60
    m = mins % 60
    return f"{h:02d}:{m:02d}"


def is_math_or_science_subject(item: SubjectLoadItem, subjects_map: dict[int, Subject]) -> bool:
    if getattr(item, "is_math_or_science", False):
        return True
    sub = subjects_map.get(item.subject_id)
    if not sub:
        return False
    return bool(getattr(sub, "is_math_or_science", False))


class AutoSchedulerService:

    @staticmethod
    def get_group_template_slots(
        template_group: str,
        db: Session,
    ) -> tuple[list[tuple[str, str]], list[tuple[str, str]], list[tuple[str, str]]]:
        """
        Dynamically fetches (enhanced_slots, standard_class_slots, break_slots) from the DB.
        """
        db_slots = (
            db.query(PeriodTemplateSlot)
            .filter(PeriodTemplateSlot.template_group == template_group)
            .order_by(PeriodTemplateSlot.display_order)
            .all()
        )
        if not db_slots:
            raise ValueError(f"No period template slots found in database for group: {template_group}")

        enhanced_slots: list[tuple[str, str]] = []
        standard_slots: list[tuple[str, str]] = []
        break_slots: list[tuple[str, str]] = []

        for s in db_slots:
            if s.is_locked_break:
                break_slots.append((s.start_time, s.end_time))
            elif s.slot_type == "CLASS":
                if (s.slot_name or "").lower().startswith("enhanced"):
                    enhanced_slots.append((s.start_time, s.end_time))
                else:
                    standard_slots.append((s.start_time, s.end_time))

        return enhanced_slots, standard_slots, break_slots

    @staticmethod
    def get_group_periods(group_name: str | None, section_name: str = "", db: Session | None = None) -> list[tuple[str, str]]:
        """
        Helper returning all CLASS slots for a given template group.
        """
        if not db:
            raise ValueError("A database session is required to fetch period template slots.")
        target_group = group_name or "JHS_45MIN"
        enhanced, standard, _ = AutoSchedulerService.get_group_template_slots(target_group, db)
        return standard + enhanced

    @staticmethod
    def auto_schedule_paired_swap(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
    ) -> list[SubjectLoadItem]:
        """
        Executes CTU Paired Section Teacher-Swap scheduling logic dynamically from DB template slots.
        """
        all_subjects = db.query(Subject).all()
        subjects_map = {s.subject_id: s for s in all_subjects}

        class_ids = list({l.class_id for l in loads})
        classes = db.query(Class).filter(Class.class_id.in_(class_ids)).all() if class_ids else []
        classes_map = {c.class_id: c for c in classes}

        pairs: list[tuple[int, int]] = []
        visited = set()

        for c in classes:
            if c.class_id in visited:
                continue
            if c.paired_class_id and c.paired_class_id in classes_map:
                pairs.append((c.class_id, c.paired_class_id))
                visited.add(c.class_id)
                visited.add(c.paired_class_id)

        if not pairs and len(classes) >= 2:
            by_level: dict[int, list[int]] = {}
            for c in classes:
                by_level.setdefault(c.academic_level_id, []).append(c.class_id)
            for lvl, c_list in by_level.items():
                for k in range(0, len(c_list) - 1, 2):
                    pairs.append((c_list[k], c_list[k + 1]))
                    visited.add(c_list[k])
                    visited.add(c_list[k + 1])

        unpaired_ids = [c.class_id for c in classes if c.class_id not in visited]

        DAYS_5 = ["MON", "TUE", "WED", "THU", "FRI"]
        DAYS_MWF = ["MON", "WED", "FRI"]
        DAYS_TTH = ["TUE", "THU"]

        for c1_id, c2_id in pairs:
            c1_loads = [l for l in loads if l.class_id == c1_id]
            c2_loads = [l for l in loads if l.class_id == c2_id]
            c1_obj = classes_map.get(c1_id)
            c1_group = getattr(c1_obj, "period_template_group", None) or "JHS_45MIN"

            enhanced_slots, standard_periods, _ = AutoSchedulerService.get_group_template_slots(c1_group, db)

            if enhanced_slots:
                c1_math_sci = [l for l in c1_loads if is_math_or_science_subject(l, subjects_map)]
                c2_math_sci = [l for l in c2_loads if is_math_or_science_subject(l, subjects_map)]

                c1_assigned_enh = c1_math_sci[:len(enhanced_slots)]
                c2_assigned_enh = c2_math_sci[:len(enhanced_slots)]

                for idx, item in enumerate(c1_assigned_enh):
                    slot = enhanced_slots[idx % len(enhanced_slots)]
                    item.start_time = slot[0]
                    item.end_time = slot[1]
                    item.days_of_week = DAYS_5
                    item.is_math_or_science = True

                for idx, item in enumerate(c2_assigned_enh):
                    slot = enhanced_slots[(idx + 1) % len(enhanced_slots)]
                    item.start_time = slot[0]
                    item.end_time = slot[1]
                    item.days_of_week = DAYS_5
                    item.is_math_or_science = True

                c1_general = [l for l in c1_loads if l not in c1_assigned_enh]
                c2_general = [l for l in c2_loads if l not in c2_assigned_enh]
            else:
                c1_general = c1_loads
                c2_general = c2_loads

            # Sort general loads by is_core first
            c1_general.sort(key=lambda l: (not bool(getattr(subjects_map.get(l.subject_id), "is_core", False)), l.subject_id))
            c2_general.sort(key=lambda l: (not bool(getattr(subjects_map.get(l.subject_id), "is_core", False)), l.subject_id))

            for idx, item in enumerate(c1_general):
                if standard_periods:
                    p = standard_periods[idx % len(standard_periods)]
                    pattern = DAYS_5 if idx < len(standard_periods) else (DAYS_MWF if idx % 2 == 0 else DAYS_TTH)
                    item.start_time = p[0]
                    item.end_time = p[1]
                    item.days_of_week = pattern

            for idx, item in enumerate(c2_general):
                if standard_periods:
                    shift = 1 if len(standard_periods) > 1 else 0
                    p = standard_periods[(idx + shift) % len(standard_periods)]
                    pattern = DAYS_5 if idx < len(standard_periods) else (DAYS_TTH if idx % 2 == 0 else DAYS_MWF)
                    item.start_time = p[0]
                    item.end_time = p[1]
                    item.days_of_week = pattern

        if unpaired_ids:
            unpaired_loads = [l for l in loads if l.class_id in unpaired_ids]
            AutoSchedulerService.auto_schedule_loads(db=db, loads=unpaired_loads, academic_period=academic_period)

        return loads

    @staticmethod
    def auto_schedule_loads(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
    ) -> list[SubjectLoadItem]:
        """
        Automatically places start_time, end_time, and days_of_week for subject loads.
        - Strictly DB-driven: queries period_template_slot per section's period_template_group.
        - Core Math & Science (is_math_or_science=True in DB) route to DB-defined Enhanced slots.
        - General subjects prioritize is_core=True for full 5-day slots (DAYS_5).
        - Non-core / electives split across DAYS_MWF and DAYS_TTH when period capacity requires.
        - Locked / published sections and loads are preserved intact and treated as fixed constraints.
        - Shared teachers are staggered across sections to guarantee zero double-booking.
        """
        all_subjects = db.query(Subject).all()
        subjects_map = {s.subject_id: s for s in all_subjects}

        class_ids = list({load.class_id for load in loads})
        classes_map = (
            {c.class_id: c for c in db.query(Class).filter(Class.class_id.in_(class_ids)).all()}
            if class_ids
            else {}
        )

        DAYS_5 = ["MON", "TUE", "WED", "THU", "FRI"]
        DAYS_MWF = ["MON", "WED", "FRI"]
        DAYS_TTH = ["TUE", "THU"]

        def is_item_locked(item: SubjectLoadItem) -> bool:
            return bool(getattr(item, "is_locked", False) or getattr(item, "status", "") == "published")

        # Track busy teacher schedules (from locked loads and newly scheduled loads)
        teacher_busy: dict[str, list[tuple[list[str], str, str]]] = {}
        for load in loads:
            if is_item_locked(load) and load.staff_id and load.start_time and load.end_time and load.days_of_week:
                teacher_busy.setdefault(str(load.staff_id), []).append(
                    (load.days_of_week, load.start_time, load.end_time)
                )

        loads_by_class: dict[int, list[SubjectLoadItem]] = {}
        for load in loads:
            loads_by_class.setdefault(load.class_id, []).append(load)

        for cid, class_loads in loads_by_class.items():
            unlocked_class_loads = [l for l in class_loads if not is_item_locked(l)]
            if not unlocked_class_loads:
                continue

            c_obj = classes_map.get(cid)
            c_group = getattr(c_obj, "period_template_group", None) or "JHS_45MIN"

            enhanced_slots, standard_periods, break_slots = AutoSchedulerService.get_group_template_slots(c_group, db)

            # Determine occupied slots from locked loads in this specific class
            occupied_class_slots: list[tuple[str, str, list[str]]] = []
            for l in class_loads:
                if is_item_locked(l) and l.start_time and l.end_time:
                    occupied_class_slots.append((l.start_time, l.end_time, l.days_of_week or DAYS_5))

            def slot_conflicts_with_class(s_time: str, e_time: str, days: list[str]) -> bool:
                for occ_s, occ_e, occ_d in occupied_class_slots:
                    common_d = set(days) & set(occ_d)
                    if common_d and times_overlap(s_time, e_time, occ_s, occ_e):
                        return True
                return False

            def slot_conflicts_with_teacher(staff_id: str | None, days: list[str], s_time: str, e_time: str) -> bool:
                if not staff_id or str(staff_id) not in teacher_busy:
                    return False
                for b_days, b_start, b_end in teacher_busy[str(staff_id)]:
                    common_d = set(days) & set(b_days)
                    if common_d and times_overlap(s_time, e_time, b_start, b_end):
                        return True
                return False

            # 1. Enhanced Slots Scheduling (Strict DB is_math_or_science flag)
            enhanced_candidates = [l for l in unlocked_class_loads if is_math_or_science_subject(l, subjects_map)]
            assigned_enhanced = enhanced_candidates[:len(enhanced_slots)]
            general_loads = [l for l in unlocked_class_loads if l not in assigned_enhanced]

            for idx, item in enumerate(assigned_enhanced):
                best_slot = None
                for offset in range(len(enhanced_slots)):
                    candidate = enhanced_slots[(idx + offset) % len(enhanced_slots)]
                    if not slot_conflicts_with_class(candidate[0], candidate[1], DAYS_5) and not slot_conflicts_with_teacher(item.staff_id, DAYS_5, candidate[0], candidate[1]):
                        best_slot = candidate
                        break
                if not best_slot:
                    for candidate in enhanced_slots:
                        if not slot_conflicts_with_class(candidate[0], candidate[1], DAYS_5):
                            best_slot = candidate
                            break
                if not best_slot:
                    general_loads.append(item)
                    continue

                item.start_time = best_slot[0]
                item.end_time = best_slot[1]
                item.days_of_week = DAYS_5
                item.is_math_or_science = True
                occupied_class_slots.append((best_slot[0], best_slot[1], DAYS_5))
                if item.staff_id:
                    teacher_busy.setdefault(str(item.staff_id), []).append((DAYS_5, best_slot[0], best_slot[1]))

            # 2. General Subjects Scheduling (Prioritize is_core = True for DAYS_5)
            # Sort general subjects: is_core=True first, non-core last
            general_loads.sort(
                key=lambda l: (
                    not bool(getattr(subjects_map.get(l.subject_id), "is_core", False)),
                    l.subject_id,
                )
            )

            # Compute available standard slots for this class (not already locked 5-days)
            available_standard_periods = [
                p for p in standard_periods if not slot_conflicts_with_class(p[0], p[1], DAYS_5)
            ]

            num_subjects = len(general_loads)
            num_free_periods = len(available_standard_periods)

            # Calculate how many subjects should target 5-day slots vs split slots
            if num_subjects <= num_free_periods:
                num_5day_targets = num_subjects
            else:
                num_split_periods = min(num_free_periods, num_subjects - num_free_periods)
                num_5day_targets = max(0, num_free_periods - num_split_periods)

            for idx, item in enumerate(general_loads):
                sub_obj = subjects_map.get(item.subject_id)
                is_core = bool(getattr(sub_obj, "is_core", False))
                wants_5day = idx < num_5day_targets

                best_p = None
                best_pattern = DAYS_5 if wants_5day else (DAYS_MWF if idx % 2 == 0 else DAYS_TTH)

                if wants_5day:
                    # Strategy A: Attempt to assign full DAYS_5
                    for p in standard_periods:
                        if not slot_conflicts_with_class(p[0], p[1], DAYS_5) and not slot_conflicts_with_teacher(item.staff_id, DAYS_5, p[0], p[1]):
                            best_p = p
                            best_pattern = DAYS_5
                            break

                    # Fallback if teacher has day conflict on 5-day: try MWF / TTH
                    if not best_p:
                        for pat in [DAYS_MWF, DAYS_TTH]:
                            for p in standard_periods:
                                if not slot_conflicts_with_class(p[0], p[1], pat) and not slot_conflicts_with_teacher(item.staff_id, pat, p[0], p[1]):
                                    best_p = p
                                    best_pattern = pat
                                    break
                            if best_p:
                                break
                        # Live rebalance: an unused 5-day slot remains available for subsequent subjects!
                else:
                    # Strategy B: Attempt split days (MWF / TTH)
                    patterns_to_try = [DAYS_MWF, DAYS_TTH] if idx % 2 == 0 else [DAYS_TTH, DAYS_MWF]
                    for pat in patterns_to_try:
                        for p in standard_periods:
                            if not slot_conflicts_with_class(p[0], p[1], pat) and not slot_conflicts_with_teacher(item.staff_id, pat, p[0], p[1]):
                                best_p = p
                                best_pattern = pat
                                break
                        if best_p:
                            break

                    # If both split patterns have teacher conflict, try any open pattern without class conflict
                    if not best_p:
                        for pat in patterns_to_try + [DAYS_5]:
                            for p in standard_periods:
                                if not slot_conflicts_with_class(p[0], p[1], pat):
                                    best_p = p
                                    best_pattern = pat
                                    break
                            if best_p:
                                break

                if not best_p and standard_periods:
                    # Safety fallback: first period with least conflict
                    best_p = standard_periods[idx % len(standard_periods)]
                    best_pattern = DAYS_5 if wants_5day else DAYS_MWF

                if best_p:
                    item.start_time = best_p[0]
                    item.end_time = best_p[1]
                    item.days_of_week = best_pattern
                    occupied_class_slots.append((best_p[0], best_p[1], best_pattern))
                    if item.staff_id:
                        teacher_busy.setdefault(str(item.staff_id), []).append((best_pattern, best_p[0], best_p[1]))

        return loads
