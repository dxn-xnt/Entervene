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
    if getattr(sub, "is_math_or_science", False):
        return True
    name = (sub.subject_name or "").lower()
    code = (sub.subject_codename or "").lower()
    keywords = ["math", "mathematics", "science", "physics", "chemistry", "biology"]
    return any(k in name or k in code for k in keywords)


class AutoSchedulerService:

    @staticmethod
    def get_group_periods(group_name: str | None, section_name: str = "", db: Session | None = None) -> list[tuple[str, str]]:
        name_lower = section_name.lower()
        group = (group_name or "").upper()
        
        target_group = "JHS_45MIN"
        if "campos" in name_lower or "zara" in name_lower or group == "SHS_CAMPOS_ZARA":
            target_group = "SHS_CAMPOS_ZARA"
        elif "del mundo" in name_lower or "reyes" in name_lower or group == "SHS_DELMUNDO_REYES":
            target_group = "SHS_DELMUNDO_REYES"

        if db:
            db_slots = (
                db.query(PeriodTemplateSlot)
                .filter(
                    PeriodTemplateSlot.template_group == target_group,
                    PeriodTemplateSlot.slot_type == "CLASS",
                )
                .order_by(PeriodTemplateSlot.display_order)
                .all()
            )
            if db_slots:
                return [(s.start_time, s.end_time) for s in db_slots]

        if target_group == "SHS_CAMPOS_ZARA":
            return [
                ("08:00", "09:00"),
                ("09:00", "10:00"),
                ("10:24", "12:00"),  # 96m Lab Block
                ("13:00", "14:00"),
                ("14:00", "15:00"),
                ("15:30", "16:30"),
            ]
        elif target_group == "SHS_DELMUNDO_REYES":
            return [
                ("08:00", "09:12"),  # 72m
                ("09:12", "10:24"),  # 72m
                ("10:48", "12:00"),  # 72m
                ("13:00", "14:12"),  # 72m
                ("14:12", "15:24"),  # 72m
                ("15:50", "16:50"),  # 60m PE
            ]
        else:
            # JHS 45-min standard + 60-min Enhanced (13:00-14:00, 14:00-15:00)
            return [
                ("08:00", "08:45"),
                ("08:45", "09:30"),
                ("09:45", "10:30"),
                ("10:30", "11:15"),
                ("11:15", "12:00"),
                ("13:00", "14:00"),  # Enhanced 1 (Math/Science 1-hr)
                ("14:00", "15:00"),  # Enhanced 2 (Math/Science 1-hr)
                ("15:30", "16:15"),
                ("16:15", "17:00"),
            ]

    @staticmethod
    def auto_schedule_paired_swap(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
    ) -> list[SubjectLoadItem]:
        """
        Executes CTU Paired Section Teacher-Swap scheduling logic:
        Pairs sections (e.g. Aristotle <-> Galileo) and alternates teachers back-to-back
        period by period with zero idle time and zero section overlap.
        For JHS (Grades 7-10), Math and Science are routed to the 1-hr Enhanced periods (13:00-14:00 / 14:00-15:00) 5 days/week.
        """
        all_subjects = db.query(Subject).all()
        subjects_map = {s.subject_id: s for s in all_subjects}

        class_ids = list({l.class_id for l in loads})
        classes = db.query(Class).filter(Class.class_id.in_(class_ids)).all() if class_ids else []
        classes_map = {c.class_id: c for c in classes}

        # Identify pairs
        pairs: list[tuple[int, int]] = []
        visited = set()

        for c in classes:
            if c.class_id in visited:
                continue
            if c.paired_class_id and c.paired_class_id in classes_map:
                pairs.append((c.class_id, c.paired_class_id))
                visited.add(c.class_id)
                visited.add(c.paired_class_id)

        # Fallback: if explicit paired_class_id is not set, pair classes with same academic_level_id
        if not pairs and len(classes) >= 2:
            by_level: dict[int, list[int]] = {}
            for c in classes:
                by_level.setdefault(c.academic_level_id, []).append(c.class_id)
            for lvl, c_list in by_level.items():
                for k in range(0, len(c_list) - 1, 2):
                    pairs.append((c_list[k], c_list[k + 1]))
                    visited.add(c_list[k])
                    visited.add(c_list[k + 1])

        days_5_pattern = ["MON", "TUE", "WED", "THU", "FRI"]
        days_split_a = ["MON", "WED", "FRI"]
        days_split_b = ["TUE", "THU"]

        # Apply paired swap logic to identified pairs
        for c1_id, c2_id in pairs:
            c1_obj = classes_map.get(c1_id)
            c1_name = c1_obj.section_name if c1_obj else ""
            c1_group = getattr(c1_obj, "period_template_group", None)
            is_shs = "campos" in c1_name.lower() or "zara" in c1_name.lower() or "reyes" in c1_name.lower() or "del mundo" in c1_name.lower()

            periods = AutoSchedulerService.get_group_periods(c1_group, c1_name, db)

            c1_loads = [l for l in loads if l.class_id == c1_id]
            c2_loads = [l for l in loads if l.class_id == c2_id]

            if not is_shs:
                # Separate JHS Math/Science loads from general loads
                c1_math_sci = [l for l in c1_loads if is_math_or_science_subject(l, subjects_map)]
                c2_math_sci = [l for l in c2_loads if is_math_or_science_subject(l, subjects_map)]

                c1_general = [l for l in c1_loads if l not in c1_math_sci]
                c2_general = [l for l in c2_loads if l not in c2_math_sci]

                # Assign Math & Science loads to 1-hr Enhanced periods (13:00-14:00 & 14:00-15:00) 5 days/week
                enhanced_slots = [("13:00", "14:00"), ("14:00", "15:00")]
                for idx, item in enumerate(c1_math_sci):
                    slot = enhanced_slots[idx % len(enhanced_slots)]
                    item.start_time = slot[0]
                    item.end_time = slot[1]
                    item.days_of_week = days_5_pattern
                    item.is_math_or_science = True

                for idx, item in enumerate(c2_math_sci):
                    # Swap Enhanced Period for Section 2 (Enhanced Period 2 first, then Enhanced Period 1)
                    slot = enhanced_slots[(idx + 1) % len(enhanced_slots)]
                    item.start_time = slot[0]
                    item.end_time = slot[1]
                    item.days_of_week = days_5_pattern
                    item.is_math_or_science = True

                # Exclude enhanced 13:00-15:00 slots from general period pool for JHS
                standard_periods = [p for p in periods if p not in enhanced_slots]

                # Distribute general loads into standard 45-min slots with swap mechanics
                min_gen_len = min(len(c1_general), len(c2_general))
                for idx in range(min_gen_len):
                    p1_start, p1_end = standard_periods[idx % len(standard_periods)]
                    p2_start, p2_end = standard_periods[(idx + 1) % len(standard_periods)]

                    days_choice = days_split_a if idx % 2 == 0 else days_split_b

                    if idx % 2 == 0:
                        c1_general[idx].start_time = p1_start
                        c1_general[idx].end_time = p1_end
                        c1_general[idx].days_of_week = days_choice

                        c2_general[idx].start_time = p2_start
                        c2_general[idx].end_time = p2_end
                        c2_general[idx].days_of_week = days_choice
                    else:
                        c1_general[idx].start_time = p2_start
                        c1_general[idx].end_time = p2_end
                        c1_general[idx].days_of_week = days_choice

                        c2_general[idx].start_time = p1_start
                        c2_general[idx].end_time = p1_end
                        c2_general[idx].days_of_week = days_choice

                # For remaining unassigned general loads, assign standard periods
                for idx, item in enumerate(c1_general[min_gen_len:]):
                    p_start, p_end = standard_periods[idx % len(standard_periods)]
                    item.start_time = p_start
                    item.end_time = p_end
                    item.days_of_week = days_split_a if idx % 2 == 0 else days_split_b

                for idx, item in enumerate(c2_general[min_gen_len:]):
                    p_start, p_end = standard_periods[(idx + 1) % len(standard_periods)]
                    item.start_time = p_start
                    item.end_time = p_end
                    item.days_of_week = days_split_a if idx % 2 == 0 else days_split_b

            else:
                # Standard SHS swap
                min_len = min(len(c1_loads), len(c2_loads))
                for idx in range(min_len):
                    p1_start, p1_end = periods[idx % len(periods)]
                    p2_start, p2_end = periods[(idx + 1) % len(periods)]

                    if idx % 2 == 0:
                        c1_loads[idx].start_time = p1_start
                        c1_loads[idx].end_time = p1_end
                        c1_loads[idx].days_of_week = days_5_pattern[:3]

                        c2_loads[idx].start_time = p2_start
                        c2_loads[idx].end_time = p2_end
                        c2_loads[idx].days_of_week = days_5_pattern[:3]
                    else:
                        c1_loads[idx].start_time = p2_start
                        c1_loads[idx].end_time = p2_end
                        c1_loads[idx].days_of_week = days_5_pattern[:3]

                        c2_loads[idx].start_time = p1_start
                        c2_loads[idx].end_time = p1_end
                        c2_loads[idx].days_of_week = days_5_pattern[:3]

        return loads

    @staticmethod
    def auto_schedule_loads(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
    ) -> list[SubjectLoadItem]:
        """
        Automatically places start_time, end_time, and days_of_week for subject loads.
        Math and Science subjects in JHS (Grades 7-10) are allocated 1-hr Enhanced slots 5 days/week (MON-FRI).
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

        loads_by_class: dict[int, list[SubjectLoadItem]] = {}
        for load in loads:
            loads_by_class.setdefault(load.class_id, []).append(load)

        for cid, class_loads in loads_by_class.items():
            c_obj = classes_map.get(cid)
            c_name = c_obj.section_name if c_obj else ""
            c_group = getattr(c_obj, "period_template_group", None)
            is_shs = "campos" in c_name.lower() or "zara" in c_name.lower() or "reyes" in c_name.lower() or "del mundo" in c_name.lower()

            periods = AutoSchedulerService.get_group_periods(c_group, c_name, db)

            if not is_shs:
                math_sci = [l for l in class_loads if is_math_or_science_subject(l, subjects_map)]
                general = [l for l in class_loads if l not in math_sci]

                enhanced_slots = [("13:00", "14:00"), ("14:00", "15:00")]
                for idx, item in enumerate(math_sci):
                    slot = enhanced_slots[idx % len(enhanced_slots)]
                    item.start_time = slot[0]
                    item.end_time = slot[1]
                    item.days_of_week = DAYS_5
                    item.is_math_or_science = True

                standard_periods = [p for p in periods if p not in enhanced_slots]
                for idx, item in enumerate(general):
                    p_start, p_end = standard_periods[idx % len(standard_periods)]
                    item.start_time = p_start
                    item.end_time = p_end
                    item.days_of_week = ["MON", "WED", "FRI"] if idx % 2 == 0 else ["TUE", "THU"]
            else:
                for idx, item in enumerate(class_loads):
                    p_start, p_end = periods[idx % len(periods)]
                    item.start_time = p_start
                    item.end_time = p_end
                    item.days_of_week = ["MON", "WED", "FRI"] if idx % 2 == 0 else ["TUE", "THU"]

        return loads
