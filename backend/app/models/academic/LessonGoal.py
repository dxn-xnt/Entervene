from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.academic.Class_ import Class
    from app.models.academic.Subject import Subject
    from app.models.academic.AcademicPeriod import AcademicPeriod
    from app.models.academic.Lesson import Lesson
    from app.models.classwork.Classwork import Classwork
    from app.models.people.AcademicStaff import AcademicStaff


class LessonGoal(Base):
    __tablename__ = "lesson_goal"
    __table_args__ = (
        UniqueConstraint("class_id", "subject_id", "academic_period_id", name="uq_lesson_goal_class_subject_period"),
    )

    goal_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_id: Mapped[int] = mapped_column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id: Mapped[int] = mapped_column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False, index=True)
    academic_period_id: Mapped[int] = mapped_column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_staff_id: Mapped[str | None] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class_: Mapped["Class"] = relationship("Class", backref="lesson_goals")
    subject: Mapped["Subject"] = relationship("Subject", backref="lesson_goals")
    academic_period: Mapped["AcademicPeriod"] = relationship("AcademicPeriod", backref="lesson_goals")
    staff: Mapped["AcademicStaff | None"] = relationship("AcademicStaff", backref="lesson_goals")
    items: Mapped[list["LessonGoalItem"]] = relationship(
        "LessonGoalItem",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="LessonGoalItem.order_index",
    )


class LessonGoalItem(Base):
    __tablename__ = "lesson_goal_item"

    goal_item_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    goal_id: Mapped[int] = mapped_column(Integer, ForeignKey("lesson_goal.goal_id", ondelete="CASCADE"), nullable=False, index=True)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "LESSON" or "CLASSWORK"
    lesson_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("lesson.lesson_id", ondelete="CASCADE"), nullable=True)
    classwork_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    goal: Mapped["LessonGoal"] = relationship("LessonGoal", back_populates="items")
    lesson: Mapped["Lesson | None"] = relationship("Lesson")
    classwork: Mapped["Classwork | None"] = relationship("Classwork")
