from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.Subject import Subject
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.SubjectLoad import (
    AutoScheduleDecisionItem,
    AutoScheduleSummary,
    SubjectLoadItem,
)
from app.services.academic.ConflictDetectorService import (
    calculate_duration_hours,
    get_teacher_workload_settings,
    parse_time_to_minutes,
    times_overlap,
)
from app.services.academic.OfferingDurationService import (
    load_active_offerings,
    offering_is_eligible_for_class,
    resolve_offering_for_class,
    time_range_minutes,
)
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver

DAYS_5: tuple[str, ...] = ("MON", "TUE", "WED", "THU", "FRI")
DAYS_MWF: tuple[str, ...] = ("MON", "WED", "FRI")
DAYS_TTH: tuple[str, ...] = ("TUE", "THU")
ALL_PATTERNS: tuple[tuple[str, ...], ...] = (DAYS_5, DAYS_MWF, DAYS_TTH)
MAX_SEARCH_NODES = 600


def _is_scheduled(item: SubjectLoadItem) -> bool:
    return bool(item.start_time and item.end_time and item.days_of_week)


def _format_days_label(days: list[str] | tuple[str, ...]) -> str:
    order = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}
    unique = sorted(dict.fromkeys(days), key=lambda d: order.get(d, 99))
    if tuple(unique) == DAYS_5:
        return "Mon–Fri"
    labels = {
        "MON": "Mon",
        "TUE": "Tue",
        "WED": "Wed",
        "THU": "Thu",
        "FRI": "Fri",
        "SAT": "Sat",
        "SUN": "Sun",
    }
    return ", ".join(labels.get(d, d) for d in unique)


def _format_template_name(group: str | None) -> str:
    if not group:
        return "Assigned Break Timeline"
    if group == "JHS_45MIN":
        return "Junior High (Grades 7–10)"
    if group == "SHS_CAMPOS_ZARA":
        return "SHS Template A"
    if group == "SHS_DELMUNDO_REYES":
        return "SHS Template B"
    return group.replace("_", " ")


@dataclass
class _Candidate:
    item: SubjectLoadItem
    subject_name: str
    is_core: bool
    is_jhs: bool
    required_minutes: int
    replaced_existing: bool


@dataclass
class AutoScheduleRunResult:
    scheduled_loads: list[SubjectLoadItem]
    merged_period_loads: list[SubjectLoadItem]
    items: list[AutoScheduleDecisionItem]
    summary: AutoScheduleSummary


class AutoSchedulerService:
    """Conflict-free, DB-driven draft schedule generator."""

    @staticmethod
    def _teacher_name(staff_map: dict[str, AcademicStaff], staff_id: str | None) -> str | None:
        if not staff_id:
            return None
        staff = staff_map.get(staff_id)
        if not staff:
            return staff_id
        return f"{staff.first_name} {staff.last_name}".strip() or staff_id

    @staticmethod
    def _within_school_hours(
        slot: PeriodTemplateSlot,
        school_start_mins: int,
        school_end_mins: int,
    ) -> bool:
        start_mins = parse_time_to_minutes(slot.start_time)
        end_mins = parse_time_to_minutes(slot.end_time)
        if start_mins is None or end_mins is None or end_mins <= start_mins:
            return False
        return start_mins >= school_start_mins and end_mins <= school_end_mins

    @classmethod
    def generate_draft_schedule(
        cls,
        db: Session,
        *,
        academic_period,
        baseline_loads: list[SubjectLoadItem],
        target_class_ids: set[int],
        locked_class_ids: set[int],
        overwrite_existing_drafts: bool = False,
        school_hours: tuple[str, str] = ("06:00", "20:00"),
    ) -> AutoScheduleRunResult:
        """
        Propose conflict-free draft schedules for unlocked target sections without
        mutating the database.

        - Locked / published sections are always preserved verbatim.
        - Non-target sections' schedules are treated as fixed teacher constraints.
        - Existing manually configured draft schedules in target sections are
          preserved unless ``overwrite_existing_drafts=True``.
        - Active subject offerings determine eligible subjects and exact durations;
          offerings and teacher assignments are never fabricated.
        """
        period_id = academic_period.academic_period_id
        year_id = academic_period.academic_year_id

        school_start_mins = parse_time_to_minutes(school_hours[0])
        school_end_mins = parse_time_to_minutes(school_hours[1])
        if school_start_mins is None:
            school_start_mins = 6 * 60
        if school_end_mins is None:
            school_end_mins = 20 * 60

        all_classes = (
            db.query(Class)
            .filter(Class.academic_year_id == year_id)
            .all()
        )
        classes_map = {c.class_id: c for c in all_classes}
        levels_map = {
            lvl.academic_level_id: lvl.grade_level
            for lvl in db.query(AcademicLevel).all()
        }
        subjects_map = {s.subject_id: s for s in db.query(Subject).all()}
        staff_map = {st.staff_id: st for st in db.query(AcademicStaff).all()}

        active_offerings = load_active_offerings(
            db,
            academic_period_id=period_id,
            academic_year_id=year_id,
        )
        caps = get_teacher_workload_settings(db)
        max_hours_per_day = float(caps["max_hours_per_day"])
        max_subjects_per_day = int(caps["max_subjects_per_day"])

        # Group baseline loads by class_id
        baseline_by_class: dict[int, list[SubjectLoadItem]] = {}
        for load in baseline_loads:
            baseline_by_class.setdefault(load.class_id, []).append(load.model_copy(deep=True))

        # Global teacher occupancy and daily workload trackers
        teacher_busy: dict[str, list[tuple[set[str], str, str]]] = {}
        teacher_daily_hours: dict[str, dict[str, float]] = {}
        teacher_daily_subjects: dict[str, dict[str, dict[tuple[int, int], int]]] = {}

        def add_teacher_load(
            staff_id: str | None,
            class_id: int,
            subject_id: int,
            start_time: str | None,
            end_time: str | None,
            days: list[str] | tuple[str, ...],
        ) -> None:
            if not staff_id or not start_time or not end_time or not days:
                return
            day_set = set(days)
            teacher_busy.setdefault(staff_id, []).append((day_set, start_time, end_time))
            hours = calculate_duration_hours(start_time, end_time)
            hrs_map = teacher_daily_hours.setdefault(staff_id, {})
            sub_map = teacher_daily_subjects.setdefault(staff_id, {})
            key = (class_id, subject_id)
            for d in day_set:
                hrs_map[d] = hrs_map.get(d, 0.0) + hours
                d_subs = sub_map.setdefault(d, {})
                d_subs[key] = d_subs.get(key, 0) + 1

        def remove_teacher_load(
            staff_id: str | None,
            class_id: int,
            subject_id: int,
            start_time: str | None,
            end_time: str | None,
            days: list[str] | tuple[str, ...],
        ) -> None:
            if not staff_id or not start_time or not end_time or not days:
                return
            day_set = set(days)
            busy_list = teacher_busy.get(staff_id)
            if busy_list:
                busy_list.pop()
            hours = calculate_duration_hours(start_time, end_time)
            hrs_map = teacher_daily_hours.get(staff_id, {})
            sub_map = teacher_daily_subjects.get(staff_id, {})
            key = (class_id, subject_id)
            for d in day_set:
                hrs_map[d] = max(0.0, hrs_map.get(d, 0.0) - hours)
                d_subs = sub_map.get(d, {})
                if key in d_subs:
                    d_subs[key] -= 1
                    if d_subs[key] <= 0:
                        del d_subs[key]

        def check_teacher_slot(
            staff_id: str | None,
            class_id: int,
            subject_id: int,
            start_time: str,
            end_time: str,
            days: tuple[str, ...],
        ) -> str | None:
            if not staff_id:
                return None
            day_set = set(days)
            for b_days, b_start, b_end in teacher_busy.get(staff_id, []):
                if (day_set & b_days) and times_overlap(start_time, end_time, b_start, b_end):
                    return "TEACHER_OVERLAP"
            hours = calculate_duration_hours(start_time, end_time)
            hrs_map = teacher_daily_hours.get(staff_id, {})
            sub_map = teacher_daily_subjects.get(staff_id, {})
            key = (class_id, subject_id)
            for d in day_set:
                if hrs_map.get(d, 0.0) + hours > max_hours_per_day + 1e-9:
                    return "TEACHER_WORKLOAD_HOURS"
                current_subs = sub_map.get(d, {})
                projected_count = len(current_subs) + (0 if key in current_subs else 1)
                if projected_count > max_subjects_per_day:
                    return "TEACHER_WORKLOAD_SUBJECTS"
            return None

        # Pre-seed teacher constraints from:
        # 1. All non-target classes (both published and draft)
        # 2. All locked target classes (published)
        # 3. Preserved loads in unlocked target classes (handled per-class below,
        #    but we must seed ALL preserved loads BEFORE scheduling ANY section so
        #    multi-section generation respects preserved drafts in later sections too!)
        preserved_by_class: dict[int, list[SubjectLoadItem]] = {}
        to_schedule_by_class: dict[int, list[tuple[SubjectLoadItem, bool]]] = {}
        empty_curriculum_sections: list[str] = []
        decisions: list[AutoScheduleDecisionItem] = []

        # Non-target classes: strictly fixed constraints
        for cid, c_loads in baseline_by_class.items():
            if cid in target_class_ids:
                continue
            for load in c_loads:
                if _is_scheduled(load):
                    add_teacher_load(
                        load.staff_id,
                        load.class_id,
                        load.subject_id,
                        load.start_time,
                        load.end_time,
                        load.days_of_week,
                    )

        sorted_target_cids = sorted(
            target_class_ids,
            key=lambda cid: (
                levels_map.get(classes_map[cid].academic_level_id, 999)
                if cid in classes_map
                else 999,
                cid,
            ),
        )

        # Phase 1: Partition every target section into preserved vs schedulable candidates
        # and register ALL preserved loads into global teacher trackers first.
        for cid in sorted_target_cids:
            cls_obj = classes_map.get(cid)
            if cls_obj is None:
                continue
            c_name = cls_obj.section_name or f"Section #{cid}"
            existing_rows = baseline_by_class.get(cid, [])

            if cid in locked_class_ids:
                preserved_by_class[cid] = existing_rows
                seen_subjects: set[int] = set()
                for load in existing_rows:
                    if _is_scheduled(load):
                        add_teacher_load(
                            load.staff_id,
                            load.class_id,
                            load.subject_id,
                            load.start_time,
                            load.end_time,
                            load.days_of_week,
                        )
                    if load.subject_id in seen_subjects:
                        continue
                    seen_subjects.add(load.subject_id)
                    sub_obj = subjects_map.get(load.subject_id)
                    decisions.append(
                        AutoScheduleDecisionItem(
                            class_id=cid,
                            section_name=c_name,
                            subject_id=load.subject_id,
                            subject_name=sub_obj.subject_name if sub_obj else f"Subject #{load.subject_id}",
                            staff_id=load.staff_id,
                            staff_name=cls._teacher_name(staff_map, load.staff_id),
                            outcome="skipped",
                            reason_code="SECTION_LOCKED",
                            reason=f"Section '{c_name}' is published and locked. Unlock Section first to regenerate.",
                            slot_id=load.slot_id,
                            start_time=load.start_time,
                            end_time=load.end_time,
                            days_of_week=list(load.days_of_week or []),
                        )
                    )
                continue

            # Unlocked target section: gather eligible subjects from active SubjectOfferings
            eligible_offerings = [
                so for so in active_offerings if offering_is_eligible_for_class(so, cls_obj)
            ]
            eligible_subject_ids: list[int] = []
            seen_elig: set[int] = set()
            for so in sorted(eligible_offerings, key=lambda item: item.subject_id):
                sub_obj = subjects_map.get(so.subject_id)
                if sub_obj is None or getattr(sub_obj, "status", "active") != "active":
                    continue
                if so.subject_id not in seen_elig:
                    seen_elig.add(so.subject_id)
                    eligible_subject_ids.append(so.subject_id)

            if not eligible_subject_ids:
                empty_curriculum_sections.append(c_name)

            # Group existing rows in this section by subject_id
            rows_by_subject: dict[int, list[SubjectLoadItem]] = {}
            for row in existing_rows:
                rows_by_subject.setdefault(row.subject_id, []).append(row)

            section_preserved: list[SubjectLoadItem] = []
            section_candidates: list[tuple[SubjectLoadItem, bool]] = []

            # Preserve ineligible existing draft loads untouched (for admin review)
            for sid, sub_rows in rows_by_subject.items():
                if sid in seen_elig:
                    continue
                sub_obj = subjects_map.get(sid)
                s_name = sub_obj.subject_name if sub_obj else f"Subject #{sid}"
                for row in sub_rows:
                    section_preserved.append(row)
                    if _is_scheduled(row):
                        add_teacher_load(
                            row.staff_id,
                            row.class_id,
                            row.subject_id,
                            row.start_time,
                            row.end_time,
                            row.days_of_week,
                        )
                first_row = sub_rows[0]
                decisions.append(
                    AutoScheduleDecisionItem(
                        class_id=cid,
                        section_name=c_name,
                        subject_id=sid,
                        subject_name=s_name,
                        staff_id=first_row.staff_id,
                        staff_name=cls._teacher_name(staff_map, first_row.staff_id),
                        outcome="skipped",
                        reason_code="SUBJECT_NOT_OFFERED",
                        reason=f"Subject '{s_name}' has no active offering for '{c_name}' in this term/pathway; existing load preserved for review.",
                        slot_id=first_row.slot_id,
                        start_time=first_row.start_time,
                        end_time=first_row.end_time,
                        days_of_week=list(first_row.days_of_week or []),
                    )
                )

            # Handle eligible subjects
            for sid in eligible_subject_ids:
                sub_obj = subjects_map.get(sid)
                s_name = sub_obj.subject_name if sub_obj else f"Subject #{sid}"
                sub_rows = rows_by_subject.get(sid, [])
                scheduled_rows = [r for r in sub_rows if _is_scheduled(r)]

                if scheduled_rows and not overwrite_existing_drafts:
                    # Preserve all existing scheduled slots for this subject (drop stray empty duplicates)
                    for row in scheduled_rows:
                        section_preserved.append(row)
                        add_teacher_load(
                            row.staff_id,
                            row.class_id,
                            row.subject_id,
                            row.start_time,
                            row.end_time,
                            row.days_of_week,
                        )
                    first_row = scheduled_rows[0]
                    slot_summary = (
                        f"{first_row.start_time}-{first_row.end_time}, {_format_days_label(first_row.days_of_week)}"
                        if len(scheduled_rows) == 1
                        else f"{len(scheduled_rows)} manually configured slots"
                    )
                    decisions.append(
                        AutoScheduleDecisionItem(
                            class_id=cid,
                            section_name=c_name,
                            subject_id=sid,
                            subject_name=s_name,
                            staff_id=first_row.staff_id,
                            staff_name=cls._teacher_name(staff_map, first_row.staff_id),
                            outcome="skipped",
                            reason_code="PRESERVED_MANUAL_DRAFT",
                            reason=f"Preserved existing manual schedule ({slot_summary}).",
                            slot_id=first_row.slot_id,
                            start_time=first_row.start_time,
                            end_time=first_row.end_time,
                            days_of_week=list(first_row.days_of_week or []),
                        )
                    )
                    continue

                # Build single clean draft candidate (no duplicates!) preserving teacher & revision lineage
                base_row = scheduled_rows[0] if scheduled_rows else (sub_rows[0] if sub_rows else None)
                preserved_staff_id = next((r.staff_id for r in sub_rows if r.staff_id), None)
                if base_row is not None:
                    candidate_item = base_row.model_copy(
                        update={
                            "staff_id": preserved_staff_id,
                            "slot_id": None,
                            "start_time": None,
                            "end_time": None,
                            "days_of_week": [],
                            "status": "draft",
                            "is_locked": False,
                            "is_active_version": False,
                        }
                    )
                else:
                    candidate_item = SubjectLoadItem(
                        class_id=cid,
                        subject_id=sid,
                        staff_id=None,
                        academic_period_id=period_id,
                        slot_id=None,
                        start_time=None,
                        end_time=None,
                        days_of_week=[],
                        status="draft",
                        is_locked=False,
                        is_active_version=False,
                    )
                section_candidates.append((candidate_item, bool(scheduled_rows)))

            preserved_by_class[cid] = section_preserved
            to_schedule_by_class[cid] = section_candidates

        # Phase 2: Schedule candidates for each unlocked target section
        # Order sections with more assigned teachers first to reduce cross-section teacher contention.
        unlocked_target_cids = [cid for cid in sorted_target_cids if cid not in locked_class_ids and cid in classes_map]
        unlocked_target_cids.sort(
            key=lambda cid: (
                -sum(1 for item, _ in to_schedule_by_class.get(cid, []) if item.staff_id),
                levels_map.get(classes_map[cid].academic_level_id, 999),
                cid,
            )
        )

        generated_by_class: dict[int, list[SubjectLoadItem]] = {}

        for cid in unlocked_target_cids:
            cls_obj = classes_map[cid]
            c_name = cls_obj.section_name or f"Section #{cid}"
            grade = levels_map.get(cls_obj.academic_level_id)
            is_shs = grade is not None and grade >= 11
            is_jhs = grade is not None and 7 <= grade <= 10
            raw_group = (getattr(cls_obj, "period_template_group", None) or "").strip() or None

            section_candidates = to_schedule_by_class.get(cid, [])
            if not section_candidates:
                generated_by_class[cid] = []
                continue

            # Validate Break Timeline configuration for this section
            template_blocker: tuple[str, str] | None = None
            if is_shs and not raw_group:
                template_blocker = (
                    "MISSING_BELL_SCHEDULE",
                    f"No Break Timeline is assigned to {c_name}. Assign a Senior High template in Edit Break Timelines.",
                )
            elif is_shs and raw_group == "JHS_45MIN":
                template_blocker = (
                    "JHS_TEMPLATE_ON_SHS",
                    f"{c_name} is assigned to the Junior High template (JHS_45MIN). Assign an SHS template in Edit Break Timelines.",
                )

            resolved_slots = [] if template_blocker else PeriodTemplateResolver.slots_for_class(db, cls_obj)
            break_slots = [
                slot for slot in resolved_slots
                if slot.is_locked_break or slot.slot_type != "CLASS"
            ]
            class_slots = [
                slot for slot in resolved_slots
                if slot.slot_type == "CLASS"
                and not slot.is_locked_break
                and cls._within_school_hours(slot, school_start_mins, school_end_mins)
                and not any(
                    times_overlap(slot.start_time, slot.end_time, b.start_time, b.end_time)
                    for b in break_slots
                )
            ]

            if template_blocker is None and not class_slots:
                template_label = _format_template_name(raw_group or ("JHS_45MIN" if is_jhs else None))
                template_blocker = (
                    "NO_CLASS_PERIODS",
                    f"No valid class periods are configured in {template_label} within school hours ({school_hours[0]}–{school_hours[1]}).",
                )

            if template_blocker is not None:
                code, reason = template_blocker
                section_out: list[SubjectLoadItem] = []
                for item, replaced in section_candidates:
                    sub_obj = subjects_map.get(item.subject_id)
                    s_name = sub_obj.subject_name if sub_obj else f"Subject #{item.subject_id}"
                    section_out.append(item)
                    decisions.append(
                        AutoScheduleDecisionItem(
                            class_id=cid,
                            section_name=c_name,
                            subject_id=item.subject_id,
                            subject_name=s_name,
                            staff_id=item.staff_id,
                            staff_name=cls._teacher_name(staff_map, item.staff_id),
                            outcome="unscheduled",
                            reason_code=code,
                            reason=reason,
                            replaced_existing=replaced,
                        )
                    )
                generated_by_class[cid] = section_out
                continue

            # Track occupied slots in this section (from preserved manual drafts + newly placed)
            occupied_class_slots: list[tuple[str, str, set[str]]] = [
                (row.start_time, row.end_time, set(row.days_of_week))
                for row in preserved_by_class.get(cid, [])
                if _is_scheduled(row) and row.start_time and row.end_time
            ]

            def slot_conflicts_with_section(slot: PeriodTemplateSlot, days: tuple[str, ...]) -> bool:
                day_set = set(days)
                for occ_s, occ_e, occ_days in occupied_class_slots:
                    if (day_set & occ_days) and times_overlap(slot.start_time, slot.end_time, occ_s, occ_e):
                        return True
                return False

            configured_durations = sorted({
                dur for dur in (time_range_minutes(s.start_time, s.end_time) for s in class_slots)
                if dur is not None
            })
            configured_durations_text = ", ".join(f"{d} min" for d in configured_durations)

            # Group schedulable candidates by offering duration
            duration_groups: dict[int, list[_Candidate]] = {}
            section_results: list[SubjectLoadItem] = []

            for item, replaced in section_candidates:
                sub_obj = subjects_map.get(item.subject_id)
                s_name = sub_obj.subject_name if sub_obj else f"Subject #{item.subject_id}"
                offering = resolve_offering_for_class(
                    active_offerings,
                    subject_id=item.subject_id,
                    class_obj=cls_obj,
                    academic_period_id=period_id,
                )
                if offering is None:
                    section_results.append(item)
                    decisions.append(
                        AutoScheduleDecisionItem(
                            class_id=cid,
                            section_name=c_name,
                            subject_id=item.subject_id,
                            subject_name=s_name,
                            staff_id=item.staff_id,
                            staff_name=cls._teacher_name(staff_map, item.staff_id),
                            outcome="unscheduled",
                            reason_code="SUBJECT_NOT_OFFERED",
                            reason=f"Subject '{s_name}' has no active offering for section '{c_name}' in this academic year, term, grade level, and pathway.",
                            replaced_existing=replaced,
                        )
                    )
                    continue
                if offering.minutes is None:
                    section_results.append(item)
                    decisions.append(
                        AutoScheduleDecisionItem(
                            class_id=cid,
                            section_name=c_name,
                            subject_id=item.subject_id,
                            subject_name=s_name,
                            staff_id=item.staff_id,
                            staff_name=cls._teacher_name(staff_map, item.staff_id),
                            outcome="unscheduled",
                            reason_code="MISSING_OFFERING_DURATION",
                            reason=f"Subject offering for '{s_name}' has no period duration (minutes) configured in Curriculum Plan.",
                            replaced_existing=replaced,
                        )
                    )
                    continue

                matching_slots = [
                    slot for slot in class_slots
                    if time_range_minutes(slot.start_time, slot.end_time) == offering.minutes
                ]
                if not matching_slots:
                    section_results.append(item)
                    decisions.append(
                        AutoScheduleDecisionItem(
                            class_id=cid,
                            section_name=c_name,
                            subject_id=item.subject_id,
                            subject_name=s_name,
                            staff_id=item.staff_id,
                            staff_name=cls._teacher_name(staff_map, item.staff_id),
                            outcome="unscheduled",
                            reason_code="NO_MATCHING_DURATION_SLOT",
                            reason=(
                                f"Subject '{s_name}' requires a {offering.minutes}-minute period, "
                                f"but {_format_template_name(raw_group or 'JHS_45MIN')} only has {configured_durations_text} class periods configured."
                            ),
                            replaced_existing=replaced,
                        )
                    )
                    continue

                duration_groups.setdefault(offering.minutes, []).append(
                    _Candidate(
                        item=item,
                        subject_name=s_name,
                        is_core=bool(getattr(sub_obj, "is_core", False)),
                        is_jhs=is_jhs,
                        required_minutes=offering.minutes,
                        replaced_existing=replaced,
                    )
                )

            # Solve each duration group with MRV ordering + bounded backtracking
            for required_minutes in sorted(duration_groups.keys()):
                group_candidates = duration_groups[required_minutes]
                matching_slots = [
                    slot for slot in class_slots
                    if time_range_minutes(slot.start_time, slot.end_time) == required_minutes
                ]

                def valid_options_for(cand: _Candidate, prefer_split: bool) -> list[tuple[PeriodTemplateSlot, tuple[str, ...]]]:
                    patterns = (DAYS_MWF, DAYS_TTH, DAYS_5) if prefer_split else (DAYS_5, DAYS_MWF, DAYS_TTH)
                    opts: list[tuple[PeriodTemplateSlot, tuple[str, ...]]] = []
                    for pat in patterns:
                        for slot in matching_slots:
                            if slot_conflicts_with_section(slot, pat):
                                continue
                            if check_teacher_slot(
                                cand.item.staff_id,
                                cid,
                                cand.item.subject_id,
                                slot.start_time,
                                slot.end_time,
                                pat,
                            ) is not None:
                                continue
                            opts.append((slot, pat))
                    return opts

                # Calculate how many 5-day slots can be allocated while maximizing total fit
                free_5day_count = sum(
                    1 for slot in matching_slots if not slot_conflicts_with_section(slot, DAYS_5)
                )
                half_free_count = sum(
                    1
                    for slot in matching_slots
                    if slot_conflicts_with_section(slot, DAYS_5)
                    and (
                        not slot_conflicts_with_section(slot, DAYS_MWF)
                        or not slot_conflicts_with_section(slot, DAYS_TTH)
                    )
                )
                num_subjects = len(group_candidates)
                if num_subjects <= free_5day_count:
                    target_5day_slots = num_subjects
                else:
                    # Each split period fits 2 subjects; half-free periods fit 1 split subject
                    remaining_after_half = max(0, num_subjects - half_free_count)
                    target_5day_slots = max(0, 2 * free_5day_count - remaining_after_half)

                # Order candidates: core JHS prioritized for 5-day, most-constrained teachers first (MRV)
                initial_counts = {
                    cand.item.subject_id: len(valid_options_for(cand, False))
                    for cand in group_candidates
                }
                # First decide which subjects prefer 5-day vs split (core first)
                core_order = sorted(
                    group_candidates,
                    key=lambda c: (
                        not (c.is_jhs and c.is_core),
                        not c.is_core,
                        initial_counts[c.item.subject_id],
                        c.item.subject_id,
                    ),
                )
                prefer_5day_ids = {c.item.subject_id for c in core_order[:target_5day_slots]}

                # Search order: most-constrained (fewest valid options, especially with teachers) first
                search_candidates = sorted(
                    group_candidates,
                    key=lambda c: (
                        initial_counts[c.item.subject_id],
                        c.item.staff_id is None,
                        not (c.is_jhs and c.is_core),
                        c.item.subject_id,
                    ),
                )

                jhs_core_total = sum(1 for c in search_candidates if c.is_jhs and c.is_core)
                ideal_5day = min(num_subjects, target_5day_slots)
                ideal_core_5day = min(jhs_core_total, ideal_5day)

                best_score: tuple[int, int, int, int] = (-1, -1, -1, -10**9)
                best_assignment: dict[int, tuple[PeriodTemplateSlot, tuple[str, ...]]] = {}
                current_assignment: dict[int, tuple[PeriodTemplateSlot, tuple[str, ...]]] = {}
                nodes_visited = 0
                found_ideal = False

                def backtrack(
                    idx: int,
                    scheduled_cnt: int,
                    core_5day_cnt: int,
                    total_5day_cnt: int,
                    order_penalty: int,
                ) -> None:
                    nonlocal best_score, best_assignment, nodes_visited, found_ideal
                    if found_ideal or nodes_visited >= MAX_SEARCH_NODES:
                        return
                    nodes_visited += 1

                    # Upper-bound pruning: can we beat best_score on scheduled_cnt?
                    remaining = num_subjects - idx
                    if scheduled_cnt + remaining < best_score[0]:
                        return

                    if idx == num_subjects:
                        score = (scheduled_cnt, core_5day_cnt, total_5day_cnt, -order_penalty)
                        if score > best_score:
                            best_score = score
                            best_assignment = dict(current_assignment)
                            if (
                                scheduled_cnt == num_subjects
                                and core_5day_cnt >= ideal_core_5day
                                and total_5day_cnt >= ideal_5day
                            ):
                                found_ideal = True
                        return

                    cand = search_candidates[idx]
                    prefer_split = cand.item.subject_id not in prefer_5day_ids
                    options = valid_options_for(cand, prefer_split)

                    # Try valid placements
                    for slot, pat in options:
                        if found_ideal or nodes_visited >= MAX_SEARCH_NODES:
                            break
                        occupied_class_slots.append((slot.start_time, slot.end_time, set(pat)))
                        add_teacher_load(
                            cand.item.staff_id,
                            cid,
                            cand.item.subject_id,
                            slot.start_time,
                            slot.end_time,
                            pat,
                        )
                        current_assignment[cand.item.subject_id] = (slot, pat)
                        is_5 = pat == DAYS_5
                        backtrack(
                            idx + 1,
                            scheduled_cnt + 1,
                            core_5day_cnt + (1 if (is_5 and cand.is_jhs and cand.is_core) else 0),
                            total_5day_cnt + (1 if is_5 else 0),
                            order_penalty + int(slot.display_order or 0),
                        )
                        del current_assignment[cand.item.subject_id]
                        remove_teacher_load(
                            cand.item.staff_id,
                            cid,
                            cand.item.subject_id,
                            slot.start_time,
                            slot.end_time,
                            pat,
                        )
                        occupied_class_slots.pop()

                    # Also allow leaving this candidate unscheduled (if placing it blocked more subjects)
                    if not found_ideal and nodes_visited < MAX_SEARCH_NODES:
                        if scheduled_cnt + (remaining - 1) >= best_score[0]:
                            backtrack(
                                idx + 1,
                                scheduled_cnt,
                                core_5day_cnt,
                                total_5day_cnt,
                                order_penalty,
                            )

                backtrack(0, 0, 0, 0, 0)

                # Commit the best assignment found for this duration group
                for cand in group_candidates:
                    chosen = best_assignment.get(cand.item.subject_id)
                    if chosen is not None:
                        slot, pat = chosen
                        occupied_class_slots.append((slot.start_time, slot.end_time, set(pat)))
                        add_teacher_load(
                            cand.item.staff_id,
                            cid,
                            cand.item.subject_id,
                            slot.start_time,
                            slot.end_time,
                            pat,
                        )
                        updated_item = cand.item.model_copy(
                            update={
                                "slot_id": slot.slot_id,
                                "start_time": slot.start_time,
                                "end_time": slot.end_time,
                                "days_of_week": list(pat),
                                "status": "draft",
                                "is_locked": False,
                                "is_active_version": False,
                            }
                        )
                        section_results.append(updated_item)
                        reason_code = "SCHEDULED_5_DAY" if pat == DAYS_5 else "SCHEDULED_SPLIT"
                        days_label = _format_days_label(pat)
                        action_verb = "Regenerated" if cand.replaced_existing else "Scheduled"
                        decisions.append(
                            AutoScheduleDecisionItem(
                                class_id=cid,
                                section_name=c_name,
                                subject_id=cand.item.subject_id,
                                subject_name=cand.subject_name,
                                staff_id=cand.item.staff_id,
                                staff_name=cls._teacher_name(staff_map, cand.item.staff_id),
                                outcome="generated",
                                reason_code=reason_code,
                                reason=f"{action_verb} in {slot.slot_name} ({slot.start_time}–{slot.end_time}, {days_label}).",
                                replaced_existing=cand.replaced_existing,
                                slot_id=slot.slot_id,
                                slot_name=slot.slot_name,
                                start_time=slot.start_time,
                                end_time=slot.end_time,
                                days_of_week=list(pat),
                            )
                        )
                    else:
                        # Diagnose exact reason why no conflict-free slot was available
                        section_free_attempts = 0
                        teacher_overlap_hits = 0
                        teacher_workload_hits = 0
                        for pat in ALL_PATTERNS:
                            for slot in matching_slots:
                                if slot_conflicts_with_section(slot, pat):
                                    continue
                                section_free_attempts += 1
                                t_err = check_teacher_slot(
                                    cand.item.staff_id,
                                    cid,
                                    cand.item.subject_id,
                                    slot.start_time,
                                    slot.end_time,
                                    pat,
                                )
                                if t_err == "TEACHER_OVERLAP":
                                    teacher_overlap_hits += 1
                                elif t_err in ("TEACHER_WORKLOAD_HOURS", "TEACHER_WORKLOAD_SUBJECTS"):
                                    teacher_workload_hits += 1

                        t_name = cls._teacher_name(staff_map, cand.item.staff_id)
                        if section_free_attempts == 0:
                            r_code = "SECTION_CAPACITY_FULL"
                            r_msg = (
                                f"All {len(matching_slots)} matching {required_minutes}-minute period(s) "
                                f"in section '{c_name}' are already occupied across all available days."
                            )
                        elif teacher_workload_hits > 0:
                            r_code = "TEACHER_WORKLOAD_LIMIT"
                            r_msg = (
                                f"Assigning {t_name} to any remaining {required_minutes}-minute period "
                                f"would exceed daily workload limits (max {max_hours_per_day:g} hrs/day or {max_subjects_per_day} subjects/day)."
                            )
                        elif teacher_overlap_hits > 0:
                            r_code = "TEACHER_CONFLICT"
                            r_msg = (
                                f"Assigned teacher {t_name} already has overlapping classes in other sections "
                                f"on all remaining {required_minutes}-minute periods."
                            )
                        else:
                            r_code = "NO_VALID_SLOT"
                            r_msg = (
                                f"No conflict-free {required_minutes}-minute period is available "
                                f"for '{cand.subject_name}' in section '{c_name}'."
                            )

                        section_results.append(cand.item)
                        decisions.append(
                            AutoScheduleDecisionItem(
                                class_id=cid,
                                section_name=c_name,
                                subject_id=cand.item.subject_id,
                                subject_name=cand.subject_name,
                                staff_id=cand.item.staff_id,
                                staff_name=t_name,
                                outcome="unscheduled",
                                reason_code=r_code,
                                reason=r_msg,
                                replaced_existing=cand.replaced_existing,
                            )
                        )

            generated_by_class[cid] = section_results

        # Phase 3: Assemble target loads and full merged period snapshot (zero duplicates)
        scheduled_loads: list[SubjectLoadItem] = []
        for cid in sorted_target_cids:
            scheduled_loads.extend(preserved_by_class.get(cid, []))
            scheduled_loads.extend(generated_by_class.get(cid, []))

        merged_period_loads: list[SubjectLoadItem] = list(scheduled_loads)
        for cid, c_loads in baseline_by_class.items():
            if cid not in target_class_ids:
                merged_period_loads.extend(c_loads)

        decisions.sort(key=lambda d: (d.class_id, d.outcome, d.subject_name))

        summary = AutoScheduleSummary(
            target_sections_count=len([cid for cid in sorted_target_cids if cid in classes_map]),
            locked_sections_count=len([cid for cid in sorted_target_cids if cid in locked_class_ids and cid in classes_map]),
            generated_count=sum(1 for d in decisions if d.outcome == "generated"),
            skipped_count=sum(1 for d in decisions if d.outcome == "skipped"),
            unscheduled_count=sum(1 for d in decisions if d.outcome == "unscheduled"),
            replaced_count=sum(1 for d in decisions if d.outcome == "generated" and d.replaced_existing),
            empty_curriculum_sections=empty_curriculum_sections,
        )

        return AutoScheduleRunResult(
            scheduled_loads=scheduled_loads,
            merged_period_loads=merged_period_loads,
            items=decisions,
            summary=summary,
        )
