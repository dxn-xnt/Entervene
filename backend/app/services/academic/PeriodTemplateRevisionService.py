from __future__ import annotations

import hashlib
import json
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.PeriodTemplateOverridePreview import PeriodTemplateOverridePreview
from app.models.academic.PeriodTemplateRevision import PeriodTemplateRevision
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.SubjectLoad import ConflictItem, PeriodTemplateSlotSchema, SubjectLoadItem
from app.services.academic.ConflictDetectorService import ConflictDetectorService, times_overlap
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver


CONFIRMATION_PHRASE = "REPLACE PUBLISHED SCHEDULES"
PREVIEW_TTL_MINUTES = 15


def _slot_dict(slot: PeriodTemplateSlot | PeriodTemplateSlotSchema) -> dict[str, Any]:
    return {
        "slot_id": getattr(slot, "slot_id", None),
        "template_group": slot.template_group,
        "slot_name": slot.slot_name,
        "slot_type": slot.slot_type,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "is_locked_break": bool(slot.is_locked_break),
        "display_order": slot.display_order,
    }


def _load_item(load: SubjectLoad, updates: dict[str, Any] | None = None) -> SubjectLoadItem:
    values = {
        "subject_load_id": load.subject_load_id,
        "class_id": load.class_id,
        "subject_id": load.subject_id,
        "staff_id": load.staff_id,
        "academic_period_id": load.academic_period_id,
        "slot_id": load.slot_id,
        "start_time": load.start_time,
        "end_time": load.end_time,
        "days_of_week": load.days_of_week or [],
        "status": load.status or "published",
        "logical_load_id": load.logical_load_id,
        "section_revision": load.section_revision or 1,
        "base_revision": load.base_revision,
        "is_active_version": bool(load.is_active_version),
        "is_locked": bool(load.is_locked),
    }
    values.update(updates or {})
    return SubjectLoadItem(**values)


class PeriodTemplateRevisionService:
    @staticmethod
    def _base_group_for_slot(db: Session, slot: PeriodTemplateSlot) -> str:
        revision = (
            db.query(PeriodTemplateRevision)
            .filter(PeriodTemplateRevision.version_template_group == slot.template_group)
            .first()
        )
        return revision.base_template_group if revision else slot.template_group

    @staticmethod
    def _fingerprint(
        slots: list[PeriodTemplateSlot],
        loads: list[SubjectLoad],
        classes: list[Class],
    ) -> str:
        payload = {
            "slots": [
                [s.slot_id, s.template_group, s.slot_name, s.slot_type, s.start_time, s.end_time, bool(s.is_locked_break), s.display_order]
                for s in sorted(slots, key=lambda row: row.slot_id)
            ],
            "loads": [
                [
                    row.subject_load_id,
                    row.class_id,
                    row.subject_id,
                    row.staff_id,
                    row.slot_id,
                    row.start_time,
                    row.end_time,
                    sorted(row.days_of_week or []),
                    row.section_revision,
                    row.version,
                    row.status,
                    bool(row.is_active_version),
                    row.updated_at.isoformat() if row.updated_at else None,
                ]
                for row in sorted(loads, key=lambda item: item.subject_load_id)
            ],
            "classes": [[c.class_id, c.period_template_group, c.updated_at.isoformat() if c.updated_at else None] for c in classes],
        }
        return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @classmethod
    def _collect_context(
        cls,
        db: Session,
        *,
        period: AcademicPeriod,
        submitted_slots: list[PeriodTemplateSlotSchema],
        effective_date: date,
        lock: bool = False,
    ) -> dict[str, Any]:
        submitted_by_id = {item.slot_id: item for item in submitted_slots if item.slot_id is not None}
        query = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.slot_id.in_(submitted_by_id))
        if lock:
            query = query.order_by(PeriodTemplateSlot.slot_id).with_for_update()
        db_slots = query.all() if submitted_by_id else []
        db_by_id = {slot.slot_id: slot for slot in db_slots}
        changed: list[tuple[PeriodTemplateSlot, PeriodTemplateSlotSchema]] = []
        for slot_id, item in submitted_by_id.items():
            current = db_by_id.get(slot_id)
            if current and any(
                (
                    current.slot_name != item.slot_name,
                    current.slot_type != item.slot_type,
                    current.start_time != item.start_time,
                    current.end_time != item.end_time,
                    bool(current.is_locked_break) != bool(item.is_locked_break),
                    current.display_order != item.display_order,
                )
            ):
                changed.append((current, item))
        if not changed:
            raise HTTPException(status_code=422, detail="No period-template changes were detected.")

        base_groups = {cls._base_group_for_slot(db, current) for current, _ in changed}
        if len(base_groups) != 1:
            raise HTTPException(status_code=422, detail="Published-schedule replacement supports one template at a time.")
        base_group = next(iter(base_groups))
        shared_jhs_first_slot_changed = any(
            current.template_group == "JHS_45MIN" and current.slot_name == "Period 1"
            for current, _ in changed
        )
        classes_query = db.query(Class)
        if shared_jhs_first_slot_changed:
            classes_query = classes_query.join(
                AcademicLevel,
                AcademicLevel.academic_level_id == Class.academic_level_id,
            ).filter(AcademicLevel.grade_level.between(7, 10))
        else:
            classes_query = classes_query.filter(Class.period_template_group == base_group)
        classes_query = classes_query.filter(
            Class.academic_year_id == period.academic_year_id,
            Class.class_status == "active",
        ).order_by(Class.class_id)
        if lock:
            classes_query = classes_query.with_for_update()
        classes = classes_query.all()
        class_ids = [item.class_id for item in classes]

        loads_query = db.query(SubjectLoad).join(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id,
        ).filter(
            AcademicPeriod.academic_year_id == period.academic_year_id,
            or_(AcademicPeriod.end_date.is_(None), AcademicPeriod.end_date >= effective_date),
            SubjectLoad.class_id.in_(class_ids),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(("published", "active")),
        ).order_by(SubjectLoad.class_id, SubjectLoad.subject_load_id)
        if lock:
            loads_query = loads_query.with_for_update()
        published = loads_query.all() if class_ids else []

        changed_by_id = {old.slot_id: new for old, new in changed}
        changed_by_time = {(old.start_time, old.end_time): new for old, new in changed}
        affected = [
            load for load in published
            if load.slot_id in changed_by_id
            or (load.slot_id is None and (load.start_time, load.end_time) in changed_by_time)
        ]
        # A bell-template revision changes the timetable rendered for every
        # published section using the template, even when the edited row is a
        # break with no direct SubjectLoad reference.
        affected_class_ids = sorted({load.class_id for load in published})
        affected_classes = [item for item in classes if item.class_id in affected_class_ids]
        complete_affected_loads = [load for load in published if load.class_id in affected_class_ids]
        effective_slots = PeriodTemplateResolver.slots_for_group(
            db,
            base_group=base_group,
            academic_year_id=period.academic_year_id,
        )
        return {
            "base_group": base_group,
            "classes": classes,
            "affected_classes": affected_classes,
            "published": published,
            "affected": affected,
            "complete_affected_loads": complete_affected_loads,
            "changed": changed,
            "changed_by_id": changed_by_id,
            "changed_by_time": changed_by_time,
            "effective_slots": effective_slots,
        }

    @classmethod
    def _proposed_snapshot(cls, db: Session, period: AcademicPeriod, context: dict[str, Any]) -> list[SubjectLoadItem]:
        affected_class_ids = {item.class_id for item in context["affected_classes"]}
        all_active = db.query(SubjectLoad).filter(
            SubjectLoad.academic_period_id == period.academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(("published", "active")),
        ).all()
        proposed: list[SubjectLoadItem] = []
        for load in all_active:
            if load.class_id not in affected_class_ids:
                proposed.append(_load_item(load))
                continue
            replacement = context["changed_by_id"].get(load.slot_id)
            if replacement is None and load.slot_id is None:
                replacement = context["changed_by_time"].get((load.start_time, load.end_time))
            proposed.append(_load_item(load, {
                "start_time": replacement.start_time if replacement else load.start_time,
                "end_time": replacement.end_time if replacement else load.end_time,
            }))
        return proposed

    @classmethod
    def _validate_school_snapshot(
        cls,
        db: Session,
        context: dict[str, Any],
    ) -> list[ConflictItem]:
        conflicts: list[ConflictItem] = []
        period_ids = sorted({load.academic_period_id for load in context["published"]})
        for period_id in period_ids:
            affected_period = db.get(AcademicPeriod, period_id)
            if not affected_period:
                conflicts.append(ConflictItem(
                    rule="MISSING_ACADEMIC_PERIOD",
                    severity="error",
                    message=f"Academic period #{period_id} could not be resolved.",
                ))
                continue
            proposed = cls._proposed_snapshot(db, affected_period, context)
            validation = ConflictDetectorService.validate_loads(
                db=db,
                loads=proposed,
                academic_period=affected_period,
                require_complete_schedule=True,
            )
            conflicts.extend(validation.conflicts)
            conflicts.extend(cls._template_break_conflicts(proposed, context))
        return conflicts

    @staticmethod
    def _template_break_conflicts(
        proposed: list[SubjectLoadItem],
        context: dict[str, Any],
    ) -> list[ConflictItem]:
        submitted = {item.slot_id: item for _, item in context["changed"]}
        effective_slots = [submitted.get(slot.slot_id, slot) for slot in context["effective_slots"]]
        breaks = [slot for slot in effective_slots if slot.is_locked_break or slot.slot_type != "CLASS"]
        affected_class_ids = {item.class_id for item in context["affected_classes"]}
        conflicts: list[ConflictItem] = []
        for load in proposed:
            if load.class_id not in affected_class_ids or not load.start_time or not load.end_time:
                continue
            for break_slot in breaks:
                if times_overlap(load.start_time, load.end_time, break_slot.start_time, break_slot.end_time):
                    conflicts.append(ConflictItem(
                        rule="BREAK_TIME_VIOLATION",
                        severity="error",
                        message=f"The revised time for subject #{load.subject_id} overlaps {break_slot.slot_name} ({break_slot.start_time}-{break_slot.end_time}).",
                        class_id=load.class_id,
                        subject_id=load.subject_id,
                        affected_key=f"{load.class_id}_{load.subject_id}",
                    ))
        return conflicts

    @classmethod
    def create_preview(
        cls,
        db: Session,
        *,
        period: AcademicPeriod,
        submitted_slots: list[PeriodTemplateSlotSchema],
        effective_date: date,
        actor: str,
    ) -> dict[str, Any]:
        if effective_date < SubstitutionService.get_academic_date():
            raise HTTPException(status_code=422, detail="The effective date cannot be in the past.")
        if period.start_date and effective_date < period.start_date:
            raise HTTPException(status_code=422, detail="The effective date is before the academic period starts.")
        if period.end_date and effective_date > period.end_date:
            raise HTTPException(status_code=422, detail="The effective date is after the academic period ends.")

        context = cls._collect_context(
            db,
            period=period,
            submitted_slots=submitted_slots,
            effective_date=effective_date,
        )
        conflicts = cls._validate_school_snapshot(db, context)
        current_errors = [item for item in conflicts if item.severity == "error"]
        fingerprint = cls._fingerprint(context["effective_slots"], context["published"], context["classes"])
        changed_slots = [
            {"slot_id": old.slot_id, "slot_name": old.slot_name, "old_start_time": old.start_time,
             "old_end_time": old.end_time, "new_start_time": new.start_time, "new_end_time": new.end_time}
            for old, new in context["changed"]
        ]
        impact = {
            "template_group": context["base_group"],
            "changed_slots": changed_slots,
            "affected_sections": [
                {"class_id": item.class_id, "section_name": item.section_name}
                for item in context["affected_classes"]
            ],
            "affected_section_count": len(context["affected_classes"]),
            "affected_published_load_count": len(context["complete_affected_loads"]),
            "conflicts": [item.model_dump() for item in conflicts],
            "can_apply": not current_errors and bool(context["affected_classes"]),
        }
        token = secrets.token_urlsafe(32)
        preview = PeriodTemplateOverridePreview(
            token=token,
            fingerprint=fingerprint,
            academic_year_id=period.academic_year_id,
            academic_period_id=period.academic_period_id,
            base_template_group=context["base_group"],
            effective_date=effective_date,
            payload={"slots": [_slot_dict(item) for item in submitted_slots]},
            impact=impact,
            status="pending",
            created_by=actor,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=PREVIEW_TTL_MINUTES),
        )
        db.add(preview)
        db.commit()
        return {**impact, "preview_token": token, "expires_at": preview.expires_at.isoformat(), "effective_date": effective_date.isoformat()}

    @staticmethod
    def _version_group(base_group: str, academic_year_id: int, revision_number: int) -> str:
        suffix = f"__Y{academic_year_id}R{revision_number}"
        return f"{base_group[:50-len(suffix)]}{suffix}"

    @classmethod
    def apply_preview(
        cls,
        db: Session,
        *,
        token: str,
        confirmation: str,
        actor: str,
    ) -> dict[str, Any]:
        if confirmation != CONFIRMATION_PHRASE:
            raise HTTPException(status_code=422, detail=f"Type {CONFIRMATION_PHRASE} exactly to continue.")
        preview = (
            db.query(PeriodTemplateOverridePreview)
            .filter(PeriodTemplateOverridePreview.token == token)
            .with_for_update()
            .first()
        )
        if not preview:
            raise HTTPException(status_code=404, detail="Schedule replacement preview not found.")
        now = datetime.now(timezone.utc)
        expiry = preview.expires_at
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if preview.status != "pending" or expiry <= now:
            raise HTTPException(status_code=409, detail="This schedule replacement preview has expired or was already used. Generate a new preview.")
        period = db.get(AcademicPeriod, preview.academic_period_id)
        if not period:
            raise HTTPException(status_code=404, detail="Academic period not found.")
        submitted = [PeriodTemplateSlotSchema(**item) for item in preview.payload["slots"]]
        context = cls._collect_context(
            db,
            period=period,
            submitted_slots=submitted,
            effective_date=preview.effective_date,
            lock=True,
        )
        current_fingerprint = cls._fingerprint(context["effective_slots"], context["published"], context["classes"])
        if current_fingerprint != preview.fingerprint:
            raise HTTPException(status_code=409, detail="The template or an affected schedule changed after preview. Generate a new impact preview.")

        blocking = [
            item for item in cls._validate_school_snapshot(db, context)
            if item.severity == "error"
        ]
        if blocking:
            raise HTTPException(status_code=409, detail=f"Schedule replacement is blocked: {blocking[0].message}")

        prior_revisions = (
            db.query(PeriodTemplateRevision)
            .filter(
                PeriodTemplateRevision.base_template_group == context["base_group"],
                PeriodTemplateRevision.academic_year_id == period.academic_year_id,
            )
            .order_by(PeriodTemplateRevision.revision_number)
            .with_for_update()
            .all()
        )
        revision_number = max((row.revision_number for row in prior_revisions), default=0) + 1
        effective_date = preview.effective_date
        for prior in prior_revisions:
            if prior.effective_from < effective_date and (prior.effective_to is None or prior.effective_to >= effective_date):
                prior.effective_to = effective_date - timedelta(days=1)
                if prior.status == "active":
                    prior.status = "superseded"

        revision = PeriodTemplateRevision(
            base_template_group=context["base_group"],
            version_template_group=cls._version_group(context["base_group"], period.academic_year_id, revision_number),
            academic_year_id=period.academic_year_id,
            revision_number=revision_number,
            effective_from=effective_date,
            status="active" if effective_date <= SubstitutionService.get_academic_date() else "scheduled",
            created_by=actor,
        )
        db.add(revision)
        db.flush()

        changes_by_id = context["changed_by_id"]
        new_slot_by_old: dict[int, PeriodTemplateSlot] = {}
        for old in context["effective_slots"]:
            changed = changes_by_id.get(old.slot_id)
            source = changed or old
            new_slot = PeriodTemplateSlot(
                template_group=revision.version_template_group,
                slot_name=source.slot_name,
                slot_type=source.slot_type,
                start_time=source.start_time,
                end_time=source.end_time,
                is_locked_break=source.is_locked_break,
                display_order=source.display_order,
            )
            db.add(new_slot)
            db.flush()
            new_slot_by_old[old.slot_id] = new_slot

        immediate = effective_date <= SubstitutionService.get_academic_date()
        affected_class_ids = {item.class_id for item in context["affected_classes"]}
        all_current = [load for load in context["published"] if load.class_id in affected_class_ids]
        staff_ids = sorted({load.staff_id for load in all_current if load.staff_id})
        if staff_ids:
            db.query(AcademicStaff).filter(AcademicStaff.staff_id.in_(staff_ids)).order_by(AcademicStaff.staff_id).with_for_update().all()

        created: list[SubjectLoad] = []
        for old in all_current:
            replacement = changes_by_id.get(old.slot_id)
            mapped_slot = new_slot_by_old.get(old.slot_id)
            new_load = SubjectLoad(
                class_id=old.class_id,
                subject_id=old.subject_id,
                staff_id=old.staff_id,
                academic_period_id=old.academic_period_id,
                slot_id=mapped_slot.slot_id if mapped_slot else old.slot_id,
                template_revision_id=revision.revision_id,
                start_time=replacement.start_time if replacement else old.start_time,
                end_time=replacement.end_time if replacement else old.end_time,
                days_of_week=list(old.days_of_week or []),
                status="published" if immediate else "scheduled",
                logical_load_id=old.logical_load_id,
                section_revision=(old.section_revision or 1) + 1,
                base_revision=old.section_revision or 1,
                version=(old.version or 1) + 1,
                is_active_version=immediate,
                is_locked=True,
                locked_at=now if immediate else None,
                published_at=now if immediate else None,
                published_by=actor,
                last_modified_by=actor,
                continued_from_load_id=old.subject_load_id,
                effective_from=effective_date,
            )
            db.add(new_load)
            created.append(new_load)
            old.effective_to = effective_date - timedelta(days=1)
            if immediate:
                old.is_active_version = False
                old.status = "archived"

        db.flush()
        if immediate:
            for new_load in created:
                previous_id = new_load.continued_from_load_id
                db.query(TeacherSubstitution).filter(
                    TeacherSubstitution.subject_load_id == previous_id,
                    TeacherSubstitution.status == "active",
                ).update({TeacherSubstitution.subject_load_id: new_load.subject_load_id}, synchronize_session=False)

        preview.status = "applied"
        preview.applied_at = now
        db.commit()
        return {
            "message": (
                f"Published replacement Revision {revision_number} is now active."
                if immediate else f"Published replacement Revision {revision_number} is scheduled for {effective_date.isoformat()}."
            ),
            "revision_id": revision.revision_id,
            "revision_number": revision_number,
            "effective_date": effective_date.isoformat(),
            "status": revision.status,
            "affected_section_count": len(affected_class_ids),
            "created_load_count": len(created),
        }

    @classmethod
    def activate_due_revisions(cls, db: Session, as_of: date | None = None) -> int:
        target = as_of or SubstitutionService.get_academic_date()
        revisions = db.query(PeriodTemplateRevision).filter(
            PeriodTemplateRevision.status == "scheduled",
            PeriodTemplateRevision.effective_from <= target,
        ).order_by(PeriodTemplateRevision.effective_from, PeriodTemplateRevision.revision_id).all()
        activated = 0
        for revision in revisions:
            scheduled = db.query(SubjectLoad).filter(
                SubjectLoad.template_revision_id == revision.revision_id,
                SubjectLoad.status == "scheduled",
            ).order_by(SubjectLoad.class_id, SubjectLoad.subject_load_id).with_for_update().all()
            for new_load in scheduled:
                current = db.query(SubjectLoad).filter(
                    SubjectLoad.class_id == new_load.class_id,
                    SubjectLoad.subject_id == new_load.subject_id,
                    SubjectLoad.academic_period_id == new_load.academic_period_id,
                    SubjectLoad.is_active_version.is_(True),
                    SubjectLoad.status.in_(("published", "active")),
                ).with_for_update().first()
                if current:
                    current.is_active_version = False
                    current.status = "archived"
                    current.effective_to = revision.effective_from - timedelta(days=1)
                    new_load.continued_from_load_id = current.subject_load_id
                new_load.status = "published"
                new_load.is_active_version = True
                new_load.published_at = datetime.now(timezone.utc)
                new_load.locked_at = datetime.now(timezone.utc)
                db.flush()
                if current:
                    db.query(TeacherSubstitution).filter(
                        TeacherSubstitution.subject_load_id == current.subject_load_id,
                        TeacherSubstitution.status == "active",
                    ).update({TeacherSubstitution.subject_load_id: new_load.subject_load_id}, synchronize_session=False)
            revision.status = "active"
            activated += 1
        if activated:
            db.commit()
        return activated
