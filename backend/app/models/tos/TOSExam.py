from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.academic.Subject import Subject
    from app.models.people.AcademicStaff import AcademicStaff
    from app.models.tos.TOSQuestion import TOSQuestion


class TOSExam(Base):
    __tablename__ = "tos_exam"

    tos_exam_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subject.subject_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by_staff_id: Mapped[str | None] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="SET NULL"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    quarter: Mapped[str] = mapped_column(String(10), nullable=False, default="Q1")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")
    test_parts_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    competencies_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    difficulty_ratio_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    subject: Mapped["Subject"] = relationship("Subject", backref="tos_exams")
    staff: Mapped["AcademicStaff | None"] = relationship("AcademicStaff", backref="tos_exams")
    questions: Mapped[list["TOSQuestion"]] = relationship(
        "TOSQuestion",
        back_populates="exam",
        cascade="all, delete-orphan",
        order_by="TOSQuestion.display_order",
    )
