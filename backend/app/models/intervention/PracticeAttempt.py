from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.intervention.PracticeAssessment import PracticeAssessment
    from app.models.intervention.PracticeAttemptAnswer import PracticeAttemptAnswer
    from app.models.people.Student import Student


class PracticeAttempt(Base):
    """Independent student practice attempt session.

    Records scores, passing outcomes, timestamps, randomized question/option sequences,
    and frozen attempt snapshots. Completely decoupled from StudentSubmission and official gradebook.
    """

    __tablename__ = "practice_attempt"
    __table_args__ = (
        CheckConstraint("attempt_number > 0", name="ck_practice_attempt_number_positive"),
        CheckConstraint(
            "status IN ('STARTED', 'SUBMITTED', 'ABANDONED')",
            name="ck_practice_attempt_status",
        ),
        CheckConstraint("total_score >= 0.0", name="ck_practice_attempt_total_score_non_negative"),
        CheckConstraint("max_score >= 0.0", name="ck_practice_attempt_max_score_non_negative"),
        CheckConstraint(
            "score_percentage >= 0.0 AND score_percentage <= 100.0",
            name="ck_practice_attempt_score_percentage_range",
        ),
        CheckConstraint(
            "passing_threshold_snapshot >= 0.0 AND passing_threshold_snapshot <= 100.0",
            name="ck_practice_attempt_passing_threshold_range",
        ),
        UniqueConstraint("practice_assessment_id", "student_id", "attempt_number", name="uq_practice_attempt_student_number"),
        Index("ix_practice_attempt_assessment_student", "practice_assessment_id", "student_id"),
        Index("ix_practice_attempt_student", "student_id"),
    )

    attempt_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    practice_assessment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("practice_assessment.practice_assessment_id", ondelete="RESTRICT"),
        nullable=False,
    )
    student_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.student_id", ondelete="RESTRICT"),
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="STARTED",
        server_default="STARTED",
    )
    assessment_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    total_score: Mapped[Decimal] = mapped_column(
        Numeric(8, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )
    max_score: Mapped[Decimal] = mapped_column(
        Numeric(8, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )
    score_percentage: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("0.00"),
        server_default="0.00",
    )
    passing_threshold_snapshot: Mapped[Decimal] = mapped_column(
        Numeric(5, 2),
        nullable=False,
        default=Decimal("75.00"),
        server_default="75.00",
    )
    is_passed: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    question_order: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    option_order_map: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attempt_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    assessment: Mapped["PracticeAssessment"] = relationship("PracticeAssessment", back_populates="attempts")
    student: Mapped["Student"] = relationship("Student")
    answers: Mapped[list["PracticeAttemptAnswer"]] = relationship(
        "PracticeAttemptAnswer",
        back_populates="attempt",
        cascade="all, delete-orphan",
    )

