from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class Intervention(Base):
    __tablename__ = "intervention"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CANDIDATE', 'ACTIVE', 'RESOLVED')",
            name="ck_intervention_status",
        ),
        CheckConstraint(
            "(status = 'RESOLVED' AND resolution_reason IS NOT NULL AND resolved_at IS NOT NULL) "
            "OR (status <> 'RESOLVED' AND resolution_reason IS NULL AND resolved_at IS NULL)",
            name="ck_intervention_resolution",
        ),
        CheckConstraint(
            "(activated_at IS NULL AND activated_by_staff_id IS NULL) OR "
            "(activated_at IS NOT NULL AND activated_by_staff_id IS NOT NULL)",
            name="ck_intervention_activation_pair",
        ),
        CheckConstraint(
            "status <> 'ACTIVE' OR activated_at IS NOT NULL",
            name="ck_intervention_active_requires_activation",
        ),
        Index(
            "uq_intervention_open_scope",
            "student_id", "class_id", "subject_id", "academic_period_id",
            unique=True,
            postgresql_where=text("status IN ('CANDIDATE', 'ACTIVE')"),
            sqlite_where=text("status IN ('CANDIDATE', 'ACTIVE')"),
        ),
    )

    intervention_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("student.student_id", ondelete="RESTRICT"), nullable=False,
    )
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("class.class_id", ondelete="RESTRICT"), nullable=False)
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="RESTRICT"), nullable=False)
    academic_period_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("academic_period.academic_period_id", ondelete="RESTRICT"), nullable=False,
    )
    source_prediction_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("development_current_term_prediction.prediction_id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
    )
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="CANDIDATE", server_default="CANDIDATE")
    resolution_reason: Mapped[str | None] = mapped_column(String(80))
    diagnosis_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_by_staff_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    student = relationship("Student", backref="interventions")
    class_ = relationship("Class", backref="interventions")
    subject = relationship("Subject", backref="interventions")
    academic_period = relationship("AcademicPeriod", backref="interventions")
    source_prediction = relationship("DevelopmentCurrentTermPrediction", backref="interventions")
    activated_by = relationship("AcademicStaff", backref="activated_interventions")
