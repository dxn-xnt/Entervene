from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.intervention.Intervention import Intervention
    from app.models.intervention.PracticeAttempt import PracticeAttempt
    from app.models.intervention.PracticeQuestion import PracticeQuestion
    from app.models.people.AcademicStaff import AcademicStaff


class PracticeAssessment(Base):
    """Independent, ungraded assessment linked strictly to an intervention.

    Maintains 0 foreign keys to general classworks, student submissions,
    gradebook calculations, or grade adjustments.
    """

    __tablename__ = "practice_assessment"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')",
            name="ck_practice_assessment_status",
        ),
        CheckConstraint(
            "gatekeeper_policy IN ('REQUIRE_PASS', 'REQUIRE_ATTEMPT', 'OPTIONAL')",
            name="ck_practice_assessment_gatekeeper_policy",
        ),
        CheckConstraint(
            "passing_percentage >= 0.0 AND passing_percentage <= 100.0",
            name="ck_practice_assessment_passing_percentage",
        ),
        CheckConstraint(
            "version > 0",
            name="ck_practice_assessment_version_positive",
        ),
        UniqueConstraint("intervention_id", name="uq_practice_assessment_intervention"),
        Index("ix_practice_assessment_intervention", "intervention_id"),
    )

    practice_assessment_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    intervention_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("intervention.intervention_id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default="Practice Assessment",
        server_default="Practice Assessment",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="DRAFT",
        server_default="DRAFT",
    )
    gatekeeper_policy: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="REQUIRE_PASS",
        server_default="REQUIRE_PASS",
    )
    passing_percentage: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("75.00"),
        server_default="75.00",
    )
    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )
    shuffle_options: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    created_by_staff_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    intervention: Mapped["Intervention"] = relationship(
        "Intervention",
        backref=backref("practice_assessment", uselist=False),
    )
    created_by: Mapped["AcademicStaff"] = relationship("AcademicStaff")
    questions: Mapped[list["PracticeQuestion"]] = relationship(
        "PracticeQuestion",
        back_populates="assessment",
        cascade="all, delete-orphan",
        order_by="PracticeQuestion.display_order",
    )
    attempts: Mapped[list["PracticeAttempt"]] = relationship(
        "PracticeAttempt",
        back_populates="assessment",
    )

