from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class SubjectYearGradingTemplate(Base):
    __tablename__ = "subject_year_grading_template"
    __table_args__ = (
        UniqueConstraint(
            "subject_id",
            "academic_year_id",
            name="uq_subject_year_grading_template_scope",
        ),
    )

    subject_year_grading_template_id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True
    )
    subject_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False, index=True
    )
    academic_year_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    grading_template_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("grading_template.grading_template_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    subject: Mapped[object] = relationship("Subject")
    academic_year: Mapped[object] = relationship("AcademicYear")
    grading_template: Mapped[object] = relationship("GradingTemplate")
