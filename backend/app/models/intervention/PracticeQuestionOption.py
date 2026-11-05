from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.intervention.PracticeQuestion import PracticeQuestion


class PracticeQuestionOption(Base):
    """Multiple-choice or True/False answer option for a Practice Question."""

    __tablename__ = "practice_question_option"
    __table_args__ = (
        CheckConstraint("option_order > 0", name="ck_practice_question_option_order_positive"),
        UniqueConstraint("practice_question_id", "option_order", name="uq_practice_question_option_order"),
        Index("ix_practice_question_option_question", "practice_question_id"),
    )

    option_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    practice_question_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("practice_question.practice_question_id", ondelete="CASCADE"),
        nullable=False,
    )
    option_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    option_order: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    question: Mapped["PracticeQuestion"] = relationship("PracticeQuestion", back_populates="options")

