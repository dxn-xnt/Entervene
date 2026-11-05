from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.intervention.PracticeAttempt import PracticeAttempt
    from app.models.intervention.PracticeQuestion import PracticeQuestion
    from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption


class PracticeAttemptAnswer(Base):
    """Submitted response and historical diagnostic feedback for one question attempt.

    Stores the frozen question text, student selection, and authoritative correct answer
    so complete feedback can be displayed permanently, even after failed attempts or subsequent
    teacher updates.
    """

    __tablename__ = "practice_attempt_answer"
    __table_args__ = (
        CheckConstraint("points_awarded >= 0.0", name="ck_practice_attempt_answer_points_awarded"),
        CheckConstraint("points_possible > 0.0", name="ck_practice_attempt_answer_points_possible"),
        UniqueConstraint("attempt_id", "practice_question_id", name="uq_practice_attempt_answer_question"),
        Index("ix_practice_attempt_answer_attempt", "attempt_id"),
    )

    attempt_answer_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    attempt_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("practice_attempt.attempt_id", ondelete="CASCADE"),
        nullable=False,
    )
    practice_question_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("practice_question.practice_question_id", ondelete="SET NULL"),
        nullable=True,
    )
    question_text_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    question_type_snapshot: Mapped[str] = mapped_column(String(40), nullable=False)
    selected_option_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("practice_question_option.option_id", ondelete="SET NULL"),
        nullable=True,
    )
    student_answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    correct_answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    explanation_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_correct: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    points_awarded: Mapped[Decimal] = mapped_column(
        Numeric(8, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )
    points_possible: Mapped[Decimal] = mapped_column(
        Numeric(8, 2),
        nullable=False,
        default=Decimal("1.00"),
        server_default="1.00",
    )

    attempt: Mapped["PracticeAttempt"] = relationship("PracticeAttempt", back_populates="answers")
    question: Mapped["PracticeQuestion | None"] = relationship("PracticeQuestion")
    selected_option: Mapped["PracticeQuestionOption | None"] = relationship("PracticeQuestionOption")

