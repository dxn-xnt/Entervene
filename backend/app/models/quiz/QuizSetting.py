from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, backref, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class QuizSetting(Base):
    __tablename__ = "quiz_setting"
    __table_args__ = (
        CheckConstraint("max_attempts IS NULL OR max_attempts > 0", name="ck_quiz_setting_max_attempts_positive"),
        UniqueConstraint("classwork_id", name="uq_quiz_setting_classwork"),
    )

    quiz_setting_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classwork_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("classwork.classwork_id", ondelete="CASCADE"),
        nullable=False,
    )
    is_shuffle_questions: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    enable_per_question_scoring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enable_per_question_time_limits: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_attempts: Mapped[int | None] = mapped_column(Integer)
    show_correct_answers: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    classwork: Mapped[object] = relationship("Classwork", backref=backref("quiz_setting", uselist=False))
