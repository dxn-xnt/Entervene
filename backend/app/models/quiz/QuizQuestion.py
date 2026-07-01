from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.quiz.Question import Question
    from app.models.quiz.Quiz import Quiz
    from app.models.quiz.QuizAnswer import QuizAnswer


class QuizQuestion(Base):
    __tablename__ = "quiz_question"
    __table_args__ = (
        CheckConstraint("display_order > 0", name="ck_quiz_question_display_order_positive"),
        UniqueConstraint("quiz_id", "display_order", name="uq_quiz_question_display_order"),
        UniqueConstraint("quiz_id", "question_id", name="uq_quiz_question_question"),
    )

    quiz_question_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    quiz_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("quiz.quiz_id", ondelete="CASCADE"),
        nullable=False,
    )
    question_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("question.question_id", ondelete="CASCADE"),
        nullable=False,
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    quiz: Mapped["Quiz"] = relationship("Quiz", back_populates="questions")
    question: Mapped["Question"] = relationship("Question", back_populates="quiz_links")
    answers: Mapped[list["QuizAnswer"]] = relationship(
        "QuizAnswer",
        back_populates="quiz_question",
        cascade="all, delete-orphan",
    )
