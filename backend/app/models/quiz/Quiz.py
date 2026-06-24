from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.quiz.QuizQuestion import QuizQuestion


class Quiz(Base):
    __tablename__ = "quiz"
    __table_args__ = (
        CheckConstraint("total_items >= 0", name="ck_quiz_total_items_non_negative"),
        CheckConstraint("duration_minutes IS NULL OR duration_minutes > 0", name="ck_quiz_duration_positive"),
        CheckConstraint("status IN ('DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED')", name="ck_quiz_status"),
        UniqueConstraint("classwork_id", name="uq_quiz_classwork"),
    )

    quiz_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("classwork.classwork_id", ondelete="CASCADE"),
        nullable=False,
    )
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_minutes: Mapped[int | None] = mapped_column(Integer)
    accessible_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="DRAFT")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    classwork: Mapped[object] = relationship("Classwork", backref=backref("quiz", uselist=False))
    questions: Mapped[list["QuizQuestion"]] = relationship(
        "QuizQuestion",
        back_populates="quiz",
        cascade="all, delete-orphan",
    )
