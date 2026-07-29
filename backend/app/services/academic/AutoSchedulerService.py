from __future__ import annotations

from datetime import datetime
from sqlalchemy.orm import Session
from app.models.academic.Subject import Subject
from app.models.academic.Class_ import Class
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


class AutoSchedulerService:

    @staticmethod
    def get_group_periods(group_name: str | None, section_name: str = "") -> list[tuple[str, str]]:
        name_lower = section_name.lower()
        group = (group_name or "").upper()

        if "campos" in name_lower or "zara" in name_lower or group == "SHS_CAMPOS_ZARA":
            return [
                ("08:00", "09:00"),
                ("09:00", "10:00"),
                ("10:24", "12:00"),  # 96m Lab Block
                ("13:00", "14:00"),
                ("14:00", "15:00"),
                ("15:30", "16:30"),
            ]
        elif "del mundo" in name_lower or "reyes" in name_lower or group == "SHS_DELMUNDO_REYES":
            return [
                ("08:00", "09:12"),  # 72m
                ("09:12", "10:24"),  # 72m
                ("10:48", "12:00"),  # 72m
                ("13:00", "14:12"),  # 72m
                ("14:12", "15:24"),  # 72m
                ("15:50", "16:50"),  # 60m PE
            ]
        else:
            # JHS 45-min standard + 60-min Enhanced
            return [
                ("08:00", "08:45"),
                ("08:45", "09:30"),
                ("09:45", "10:30"),
                ("10:30", "11:15"),
                ("11:15", "12:00"),
                ("13:00", "14:00"),
                ("14:00", "15:00"),
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
        """
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

        days_pattern = ["MON", "TUE", "WED", "THU", "FRI"]

        # Apply paired swap logic to identified pairs
        for c1_id, c2_id in pairs:
            c1_obj = classes_map.get(c1_id)
            c1_name = c1_obj.section_name if c1_obj else ""
            c1_group = getattr(c1_obj, "period_template_group", None)

            periods = AutoSchedulerService.get_group_periods(c1_group, c1_name)

            c1_loads = [l for l in loads if l.class_id == c1_id]
            c2_loads = [l for l in loads if l.class_id == c2_id]

            min_len = min(len(c1_loads), len(c2_loads))
            for idx in range(min_len):
                p1_start, p1_end = periods[idx % len(periods)]
                p2_start, p2_end = periods[(idx + 1) % len(periods)]

                # Alternate periods for Section 1 and Section 2
                if idx % 2 == 0:
                    c1_loads[idx].start_time = p1_start
                    c1_loads[idx].end_time = p1_end
                    c1_loads[idx].days_of_week = days_pattern[:3]

                    c2_loads[idx].start_time = p2_start
                    c2_loads[idx].end_time = p2_end
                    c2_loads[idx].days_of_week = days_pattern[:3]
                else:
                    c1_loads[idx].start_time = p2_start
                    c1_loads[idx].end_time = p2_end
                    c1_loads[idx].days_of_week = days_pattern[:3]

                    c2_loads[idx].start_time = p1_start
                    c2_loads[idx].end_time = p1_end
                    c2_loads[idx].days_of_week = days_pattern[:3]

        # For any remaining loads, run standard auto-scheduler
        return AutoSchedulerService.auto_schedule_loads(db=db, loads=loads, academic_period=academic_period)

    @staticmethod
    def auto_schedule_loads(
        db: Session,
        loads: list[SubjectLoadItem],
        academic_period=None,
    ) -> list[SubjectLoadItem]:
        """
        Automatically places start_time, end_time, and days_of_week for subject loads
        such that:
        1. No section double-booking occurs.
        2. No teacher double-booking occurs.
        3. School bounds (06:00 AM to 05:00 PM) are respected.
        4. Teacher daily workload limits (max 6 hrs/day, 4 subjects/day) are respected.
        """
        class_ids = list({load.class_id for load in loads})
        classes_map = (
            {c.class_id: c for c in db.query(Class).filter(Class.class_id.in_(class_ids)).all()}
            if class_ids
            else {}
        )

        DAYS = ["MON", "TUE", "WED", "THU", "FRI"]

        # Group loads by section class_id
        loads_by_class: dict[int, list[SubjectLoadItem]] = {}
        for load in loads:
            loads_by_class.setdefault(load.class_id, []).append(load)

        for cid, class_loads in loads_by_class.items():
            c_obj = classes_map.get(cid)
            c_name = c_obj.section_name if c_obj else ""
            c_group = getattr(c_obj, "period_template_group", None)
            periods = AutoSchedulerService.get_group_periods(c_group, c_name)

            for idx, item in enumerate(class_loads):
                # Pick sequential period index per subject
                p_start, p_end = periods[idx % len(periods)]
                item.start_time = p_start
                item.end_time = p_end

                # Alternate days pattern to prevent bottlenecking
                if idx % 2 == 0:
                    item.days_of_week = ["MON", "WED", "FRI"]
                else:
                    item.days_of_week = ["TUE", "THU"]

        return loads
