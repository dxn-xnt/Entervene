from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class SubjectPeriodGradingTemplate(Base):
    __tablename__ = "subject_period_grading_template"
    __table_args__ = (
        UniqueConstraint("subject_id", "academic_period_id", name="uq_subject_period_grading_template_scope"),
    )

    subject_period_grading_template_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False, index=True)
    academic_period_id: Mapped[int] = mapped_column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False, index=True)
    grading_template_id: Mapped[int] = mapped_column(Integer, ForeignKey("grading_template.grading_template_id", ondelete="RESTRICT"), nullable=False, index=True)
    policy_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    change_reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subject: Mapped[object] = relationship("Subject")
    academic_period: Mapped[object] = relationship("AcademicPeriod")
    grading_template: Mapped[object] = relationship("GradingTemplate")
