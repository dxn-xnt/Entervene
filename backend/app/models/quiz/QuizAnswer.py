from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class QuizAnswer(Base):
    __tablename__ = "quiz_answer"
    __table_args__ = (
        CheckConstraint("points_awarded IS NULL OR points_awarded >= 0", name="ck_quiz_answer_points_non_negative"),
        UniqueConstraint("submission_id", "quiz_question_id", name="uq_quiz_answer_submission_question"),
    )

    answer_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    quiz_question_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("quiz_question.quiz_question_id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("student_submission.submission_id", ondelete="CASCADE"),
        nullable=False,
    )
    answer_text: Mapped[str | None] = mapped_column(Text)
    is_correct: Mapped[bool | None] = mapped_column(Boolean)
    points_awarded: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))

    quiz_question: Mapped[object] = relationship("QuizQuestion", back_populates="answers")
    submission: Mapped[object] = relationship("StudentSubmission", backref="quiz_answers")
