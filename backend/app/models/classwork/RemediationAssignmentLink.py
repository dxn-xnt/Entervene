from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.Base import Base


class RemediationAssignmentLink(Base):
    """Audit-only WW/PT linkage; official grade calculations do not consume this table."""

    __tablename__ = "remediation_assignment_link"
    __table_args__ = (
        UniqueConstraint("remediation_assignment_id", name="uq_remediation_link_attempt"),
        UniqueConstraint("original_assignment_id", "student_id", name="uq_remediation_link_original_student"),
        CheckConstraint(
            "remediation_assignment_id <> original_assignment_id",
            name="ck_remediation_link_distinct_assignments",
        ),
        CheckConstraint(
            "component IN ('WRITTEN_WORK', 'PERFORMANCE_TASK')",
            name="ck_remediation_link_component",
        ),
        CheckConstraint(
            "score_adjustment_cap >= 0 AND score_adjustment_cap < 100",
            name="ck_remediation_link_cap_range",
        ),
        Index("ix_remediation_link_original", "original_assignment_id"),
        Index("ix_remediation_link_intervention", "source_intervention_id"),
    )

    remediation_link_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_intervention_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("intervention.intervention_id", ondelete="RESTRICT"), nullable=False,
    )
    remediation_assignment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="RESTRICT"), nullable=False,
    )
    original_assignment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="RESTRICT"), nullable=False,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="RESTRICT"), nullable=False,
    )
    component: Mapped[str] = mapped_column(String(32), nullable=False)
    score_adjustment_cap: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="75.00",
    )
    created_by_staff_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
