from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class RemediationGenerationEvidenceSnapshot(Base):
    """Immutable, versioned teaching eligibility for remediation generation."""

    __tablename__ = "remediation_generation_evidence_snapshot"
    __table_args__ = (
        UniqueConstraint("intervention_id", "version", name="uq_remediation_generation_evidence_version"),
        Index("ix_remediation_generation_evidence_intervention", "intervention_id", "version"),
    )

    snapshot_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    intervention_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("intervention.intervention_id", ondelete="RESTRICT"), nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    original_evidence_cutoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    active_remediation_cutoff_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    refreshed_by_staff_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False,
    )
    evidence_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    intervention = relationship("Intervention", backref="remediation_generation_evidence_snapshots")
    refreshed_by = relationship("AcademicStaff")
