from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.suggestion.SuggestionClasswork import SuggestionClasswork


class StudentSuggestion(Base):
    __tablename__ = "student_suggestion"
    __table_args__ = (
        CheckConstraint("resource_type IN ('LESSON', 'CLASSWORK')", name="ck_student_suggestion_resource_type"),
        CheckConstraint("suggestion_type IN ('MANUAL', 'AUTOMATED')", name="ck_student_suggestion_type"),
        CheckConstraint(
            "priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')",
            name="ck_student_suggestion_priority",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'DISMISSED', 'ARCHIVED')",
            name="ck_student_suggestion_status",
        ),
        CheckConstraint(
            "(resource_type = 'LESSON' AND lesson_id IS NOT NULL) OR "
            "(resource_type = 'CLASSWORK' AND lesson_id IS NULL)",
            name="ck_student_suggestion_resource_link",
        ),
        Index("ix_student_suggestion_student_status", "student_id", "status"),
        Index("ix_student_suggestion_subject_status", "subject_id", "status"),
        # Lesson duplicates can be enforced directly; classwork duplicates are
        # checked in the suggestion service because the classwork link is a child row.
        Index(
            "uq_student_suggestion_active_lesson",
            "student_id",
            "subject_id",
            "lesson_id",
            unique=True,
            postgresql_where=text("status = 'ACTIVE' AND lesson_id IS NOT NULL"),
            sqlite_where=text("status = 'ACTIVE' AND lesson_id IS NOT NULL"),
        ),
    )

    student_suggestion_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    suggestion_type: Mapped[str] = mapped_column(String(30), nullable=False, default="MANUAL")
    resource_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    resource_links: Mapped[dict | None] = mapped_column(JSON)
    priority: Mapped[str] = mapped_column(String(30), nullable=False, default="NORMAL")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="ACTIVE")
    is_viewed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.student_id", ondelete="CASCADE"),
        nullable=False,
    )
    subject_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subject.subject_id", ondelete="CASCADE"),
        nullable=False,
    )
    lesson_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("lesson.lesson_id", ondelete="SET NULL"),
    )
    created_by_staff_id: Mapped[str | None] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="SET NULL"),
    )

    student: Mapped[object] = relationship("Student", backref=backref("study_suggestions"))
    subject: Mapped[object] = relationship("Subject", backref=backref("study_suggestions"))
    lesson: Mapped[object | None] = relationship("Lesson", backref=backref("study_suggestions"))
    created_by_staff: Mapped[object | None] = relationship("AcademicStaff", backref=backref("study_suggestions"))
    classwork_link: Mapped["SuggestionClasswork | None"] = relationship(
        "SuggestionClasswork",
        back_populates="suggestion",
        cascade="all, delete-orphan",
        uselist=False,
    )
