from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class SubjectOffering(Base):
    __tablename__ = "subject_offering"
    __table_args__ = (
        CheckConstraint(
            "pathway IN ('general', 'both', 'stem_medical', 'stem_engineering')",
            name="ck_subject_offering_pathway",
        ),
        CheckConstraint(
            "status IN ('active', 'archived')",
            name="ck_subject_offering_status",
        ),
        UniqueConstraint(
            "subject_id",
            "academic_year_id",
            "academic_level_id",
            "academic_period_id",
            "pathway",
            name="uq_subject_offering_scope_pathway",
        ),
        Index("ix_subject_offering_subject_id", "subject_id"),
        Index("ix_subject_offering_academic_year_id", "academic_year_id"),
        Index("ix_subject_offering_academic_level_id", "academic_level_id"),
        Index("ix_subject_offering_academic_period_id", "academic_period_id"),
        Index("ix_subject_offering_pathway", "pathway"),
        Index("ix_subject_offering_status", "status"),
    )

    subject_offering_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    academic_year_id: Mapped[int] = Column(Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False)
    academic_level_id: Mapped[int] = Column(Integer, ForeignKey("academic_level.academic_level_id"), nullable=False)
    academic_period_id: Mapped[int] = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    pathway: Mapped[str] = Column(String(30), nullable=False)
    status: Mapped[str] = Column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    subject: Mapped[object] = relationship("Subject", back_populates="subject_offerings")
    academic_year: Mapped[object] = relationship("AcademicYear", back_populates="subject_offerings")
    academic_level: Mapped[object] = relationship("AcademicLevel", back_populates="subject_offerings")
    academic_period: Mapped[object] = relationship("AcademicPeriod", back_populates="subject_offerings")
