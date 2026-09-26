from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class ClassworkCoverage(Base):
    """Dated teacher assertion of topics covered by one manual activity.

    This records assessment coverage, never a per-competency student score.
    """

    __tablename__ = "classwork_coverage"
    __table_args__ = (
        CheckConstraint("lesson_id IS NOT NULL OR competency_id IS NOT NULL", name="ck_classwork_coverage_target"),
        CheckConstraint("valid_until IS NULL OR valid_until >= valid_from", name="ck_classwork_coverage_interval"),
        Index("ix_classwork_coverage_classwork", "classwork_id"),
        Index("uq_classwork_coverage_active_lesson", "classwork_id", "lesson_id", unique=True,
              postgresql_where=text("valid_until IS NULL AND lesson_id IS NOT NULL"),
              sqlite_where=text("valid_until IS NULL AND lesson_id IS NOT NULL")),
        Index("uq_classwork_coverage_active_competency", "classwork_id", "competency_id", unique=True,
              postgresql_where=text("valid_until IS NULL AND lesson_id IS NULL AND competency_id IS NOT NULL"),
              sqlite_where=text("valid_until IS NULL AND lesson_id IS NULL AND competency_id IS NOT NULL")),
    )

    coverage_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = mapped_column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False)
    lesson_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("lesson.lesson_id", ondelete="RESTRICT"))
    competency_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("competency.competency_id", ondelete="RESTRICT"))
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    linked_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    removed_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"))

    classwork = relationship("Classwork", backref="coverage_history")
    lesson = relationship("Lesson")
    competency = relationship("Competency")
