from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.intervention.PracticeAssessment import PracticeAssessment
    from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption


class PracticeQuestion(Base):
    """Question item within a Practice Assessment.

    Supports MULTIPLE_CHOICE, TRUE_FALSE, and IDENTIFICATION formats
    compatible with deterministic automated server-side scoring.
    """

    __tablename__ = "practice_question"
    __table_args__ = (
        CheckConstraint(
            "question_type IN ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'IDENTIFICATION')",
            name="ck_practice_question_type",
        ),
        CheckConstraint("points > 0", name="ck_practice_question_points_positive"),
        CheckConstraint("display_order > 0", name="ck_practice_question_display_order_positive"),
        CheckConstraint("version > 0", name="ck_practice_question_version_positive"),
        UniqueConstraint("practice_assessment_id", "version", "display_order", name="uq_practice_question_order_version"),
        Index("ix_practice_question_assessment", "practice_assessment_id"),
    )

    practice_question_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    practice_assessment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("practice_assessment.practice_assessment_id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        default="MULTIPLE_CHOICE",
        server_default="MULTIPLE_CHOICE",
    )
    points: Mapped[Decimal] = mapped_column(
        Numeric(8, 2),
        nullable=False,
        default=Decimal("1.00"),
        server_default="1.00",
    )
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_ai_generated: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    assessment: Mapped["PracticeAssessment"] = relationship("PracticeAssessment", back_populates="questions")
    options: Mapped[list["PracticeQuestionOption"]] = relationship(
        "PracticeQuestionOption",
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="PracticeQuestionOption.option_order",
    )

