from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class SuggestionClasswork(Base):
    __tablename__ = "suggestion_classwork"
    __table_args__ = (
        CheckConstraint(
            "score_before IS NULL OR score_before >= 0",
            name="ck_suggestion_classwork_score_before_non_negative",
        ),
        CheckConstraint(
            "score_after IS NULL OR score_after >= 0",
            name="ck_suggestion_classwork_score_after_non_negative",
        ),
        UniqueConstraint("student_suggestion_id", name="uq_suggestion_classwork_suggestion"),
    )

    suggestion_classwork_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_suggestion_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("student_suggestion.student_suggestion_id", ondelete="CASCADE"),
        nullable=False,
    )
    classwork_assignment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="CASCADE"),
        nullable=False,
    )
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    score_before: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    score_after: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))

    suggestion: Mapped[object] = relationship("StudentSuggestion", back_populates="classwork_link")
    classwork_assignment: Mapped[object] = relationship("ClassworkAssignment", backref="study_suggestion_links")
