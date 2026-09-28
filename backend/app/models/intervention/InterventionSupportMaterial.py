from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class InterventionSupportMaterial(Base):
    __tablename__ = "intervention_support_material"
    __table_args__ = (
        CheckConstraint("kind IN ('STUDENT_REVIEWER', 'REMEDIAL_ASSESSMENT')", name="ck_intervention_support_kind"),
        CheckConstraint("status IN ('DRAFT', 'SENT')", name="ck_intervention_support_status"),
        CheckConstraint(
            "(status = 'SENT' AND sent_at IS NOT NULL AND sent_by_staff_id IS NOT NULL) OR "
            "(status = 'DRAFT' AND sent_at IS NULL AND sent_by_staff_id IS NULL)",
            name="ck_intervention_support_sent_pair",
        ),
        UniqueConstraint("intervention_id", "kind", name="uq_intervention_support_kind"),
    )

    material_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    intervention_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("intervention.intervention_id", ondelete="RESTRICT"), nullable=False, index=True,
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT", server_default="DRAFT")
    evidence_basis: Mapped[dict] = mapped_column(JSON, nullable=False)
    generated_content: Mapped[dict | None] = mapped_column(JSON)
    current_content: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by_staff_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False,
    )
    updated_by_staff_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_by_staff_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
    )

    intervention = relationship("Intervention", backref="support_materials")
