from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.quiz.QuestionOption import QuestionOption
    from app.models.quiz.QuizQuestion import QuizQuestion


class Question(Base):
    __tablename__ = "question"
    __table_args__ = (
        CheckConstraint("question_type IN ('MULTIPLE_CHOICE', 'SHORT_ANSWER')", name="ck_question_type"),
        CheckConstraint("difficulty_level IS NULL OR difficulty_level IN ('EASY', 'MEDIUM', 'HARD')", name="ck_question_difficulty"),
        CheckConstraint("points > 0", name="ck_question_points_positive"),
        CheckConstraint("max_file_size_mb IS NULL OR max_file_size_mb > 0", name="ck_question_max_file_size_positive"),
    )

    question_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(40), nullable=False)
    difficulty_level: Mapped[str | None] = mapped_column(String(30))
    points: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    is_ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    expected_answer_type: Mapped[str | None] = mapped_column(String(40))
    max_file_size_mb: Mapped[int | None] = mapped_column(Integer)
    lesson_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("lesson.lesson_id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lesson: Mapped[object] = relationship("Lesson", backref="questions")
    options: Mapped[list["QuestionOption"]] = relationship(
        "QuestionOption",
        back_populates="question",
        cascade="all, delete-orphan",
    )
    quiz_links: Mapped[list["QuizQuestion"]] = relationship(
        "QuizQuestion",
        back_populates="question",
        cascade="all, delete-orphan",
    )
