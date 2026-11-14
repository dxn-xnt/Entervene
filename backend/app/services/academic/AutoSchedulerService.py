from __future__ import annotations

from sqlalchemy.orm import Session
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.schemas.SubjectLoad import SubjectLoadItem
from app.services.academic.ConflictDetectorService import (
    times_overlap,
)
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver
from app.services.academic.OfferingDurationService import (
    load_active_offerings,
    resolve_offering_for_class,
    time_range_minutes,
)


class AutoSchedulerService:

    @staticmethod
    def get_group_template_slots(
        template_group: str,
        db: Session,
        academic_year_id: int | None = None,
    ) -> tuple[list[tuple[str, str]], list[tuple[str, str]], list[tuple[str, str]]]:
        """
        Dynamically fetches (enhanced_slots, standard_class_slots, break_slots) from the DB.
        """
        db_slots = (
            PeriodTemplateResolver.slots_for_group(
                db,
                base_group=template_group,
                academic_year_id=academic_year_id,
            )
            if academic_year_id is not None
            else db.query(PeriodTemplateSlot)
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
                # Kept as a compatibility tuple for callers of this legacy
                # helper; scheduling itself is duration-driven.
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
        """Schedule paired sections through the same conflict-free allocator.

        The former positional paired-section algorithm assigned slots without
        checking the complete teacher timetable.  Pairing remains represented
        by the class configuration, while placement uses the strict allocator
        so this mode cannot create a double-booking as a fallback.
        """
        return AutoSchedulerService.auto_schedule_loads(
            db=db,
            loads=loads,
            academic_period=academic_period,
        )

    @staticmethod
    def auto_schedule_loads(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
    ) -> list[SubjectLoadItem]:
        """
        Automatically places start_time, end_time, and days_of_week for subject loads.
        - Strictly DB-driven: queries period_template_slot per section's period_template_group.
        - Each subject routes to a slot whose duration matches its active offering.
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
        period_ids = {item.academic_period_id for item in loads}
        offerings = []
        for period_id in period_ids:
            offerings.extend(load_active_offerings(db, academic_period_id=period_id))

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

            resolved_slots = PeriodTemplateResolver.slots_for_class(db, c_obj) if c_obj else []
            class_periods = [
                (slot.start_time, slot.end_time) for slot in resolved_slots
                if slot.slot_type == "CLASS" and not slot.is_locked_break
            ]
            break_slots = [
                (slot.start_time, slot.end_time) for slot in resolved_slots
                if slot.is_locked_break or slot.slot_type != "CLASS"
            ]

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

            duration_groups: dict[int, list[SubjectLoadItem]] = {}
            for item in unlocked_class_loads:
                offering = resolve_offering_for_class(
                    offerings,
                    subject_id=item.subject_id,
                    class_obj=c_obj,
                    academic_period_id=item.academic_period_id,
                ) if c_obj else None
                if offering is None or offering.minutes is None:
                    item.start_time = None
                    item.end_time = None
                    item.days_of_week = []
                    continue
                duration_groups.setdefault(offering.minutes, []).append(item)

            for required_minutes, duration_loads in duration_groups.items():
                matching_periods = [
                    period for period in class_periods
                    if time_range_minutes(period[0], period[1]) == required_minutes
                ]
                duration_loads.sort(
                    key=lambda l: (
                        not bool(getattr(subjects_map.get(l.subject_id), "is_core", False)),
                        l.subject_id,
                    )
                )
                available_periods = [
                    p for p in matching_periods if not slot_conflicts_with_class(p[0], p[1], DAYS_5)
                ]

                num_subjects = len(duration_loads)
                num_free_periods = len(available_periods)

                # Calculate how many subjects should target 5-day slots vs split slots
                if num_subjects <= num_free_periods:
                    num_5day_targets = num_subjects
                else:
                    num_split_periods = min(num_free_periods, num_subjects - num_free_periods)
                    num_5day_targets = max(0, num_free_periods - num_split_periods)

                for idx, item in enumerate(duration_loads):
                    wants_5day = idx < num_5day_targets

                    best_p = None
                    best_pattern = DAYS_5 if wants_5day else (DAYS_MWF if idx % 2 == 0 else DAYS_TTH)

                    if wants_5day:
                        # Strategy A: Attempt to assign full DAYS_5
                        for p in matching_periods:
                            if not slot_conflicts_with_class(p[0], p[1], DAYS_5) and not slot_conflicts_with_teacher(item.staff_id, DAYS_5, p[0], p[1]):
                                best_p = p
                                best_pattern = DAYS_5
                                break

                        # Fallback if teacher has day conflict on 5-day: try MWF / TTH
                        if not best_p:
                            for pat in [DAYS_MWF, DAYS_TTH]:
                                for p in matching_periods:
                                    if not slot_conflicts_with_class(p[0], p[1], pat) and not slot_conflicts_with_teacher(item.staff_id, pat, p[0], p[1]):
                                        best_p = p
                                        best_pattern = pat
                                        break
                                if best_p:
                                    break
                    else:
                        # Strategy B: Attempt split days (MWF / TTH)
                        patterns_to_try = [DAYS_MWF, DAYS_TTH] if idx % 2 == 0 else [DAYS_TTH, DAYS_MWF]
                        for pat in patterns_to_try:
                            for p in matching_periods:
                                if not slot_conflicts_with_class(p[0], p[1], pat) and not slot_conflicts_with_teacher(item.staff_id, pat, p[0], p[1]):
                                    best_p = p
                                    best_pattern = pat
                                    break
                            if best_p:
                                break

                    if best_p:
                        item.start_time = best_p[0]
                        item.end_time = best_p[1]
                        item.days_of_week = best_pattern
                        occupied_class_slots.append((best_p[0], best_p[1], best_pattern))
                        if item.staff_id:
                            teacher_busy.setdefault(str(item.staff_id), []).append((best_pattern, best_p[0], best_p[1]))
                    else:
                        item.start_time = None
                        item.end_time = None
                        item.days_of_week = []

        return loads
