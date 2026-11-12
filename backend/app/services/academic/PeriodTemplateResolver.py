from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.PeriodTemplateRevision import PeriodTemplateRevision
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.services.academic.SubstitutionService import SubstitutionService


class PeriodTemplateResolver:
    """Resolve effective slots while keeping Class.period_template_group stable."""

    @staticmethod
    def effective_revision(
        db: Session, *, base_group: str, academic_year_id: int, as_of: date | None = None
    ) -> PeriodTemplateRevision | None:
        target = as_of or SubstitutionService.get_academic_date()
        return (
            db.query(PeriodTemplateRevision)
            .filter(
                PeriodTemplateRevision.base_template_group == base_group,
                PeriodTemplateRevision.academic_year_id == academic_year_id,
                PeriodTemplateRevision.effective_from <= target,
                (PeriodTemplateRevision.effective_to.is_(None))
                | (PeriodTemplateRevision.effective_to >= target),
                PeriodTemplateRevision.status.in_(("active", "scheduled", "superseded")),
            )
            .order_by(PeriodTemplateRevision.revision_number.desc())
            .first()
        )

    @classmethod
    def effective_group(
        cls, db: Session, *, base_group: str, academic_year_id: int, as_of: date | None = None
    ) -> str:
        revision = cls.effective_revision(
            db, base_group=base_group, academic_year_id=academic_year_id, as_of=as_of
        )
        return revision.version_template_group if revision else base_group

    @classmethod
    def slots_for_group(
        cls, db: Session, *, base_group: str, academic_year_id: int, as_of: date | None = None
    ) -> list[PeriodTemplateSlot]:
        group = cls.effective_group(
            db, base_group=base_group, academic_year_id=academic_year_id, as_of=as_of
        )
        return (
            db.query(PeriodTemplateSlot)
            .filter(PeriodTemplateSlot.template_group == group)
            .order_by(PeriodTemplateSlot.display_order)
            .all()
        )

    @classmethod
    def slots_for_class(
        cls, db: Session, class_obj: Class, as_of: date | None = None
    ) -> list[PeriodTemplateSlot]:
        base_group = class_obj.period_template_group or "JHS_45MIN"
        slots = cls.slots_for_group(
            db,
            base_group=base_group,
            academic_year_id=class_obj.academic_year_id,
            as_of=as_of,
        )
        level = db.get(AcademicLevel, class_obj.academic_level_id)
        if not level or not 7 <= level.grade_level <= 10 or base_group == "JHS_45MIN":
            return slots

        shared_slots = cls.slots_for_group(
            db,
            base_group="JHS_45MIN",
            academic_year_id=class_obj.academic_year_id,
            as_of=as_of,
        )
        shared_first = next(
            (slot for slot in shared_slots if slot.slot_type == "CLASS" and slot.slot_name == "Period 1"),
            None,
        )
        if shared_first is None:
            return slots
        merged = [slot for slot in slots if slot.slot_name != "Period 1"] + [shared_first]
        return sorted(merged, key=lambda slot: slot.display_order)
