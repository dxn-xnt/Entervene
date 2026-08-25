from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base

if TYPE_CHECKING:
    from app.models.academic.Competency import Competency
    from app.models.tos.TOSExam import TOSExam


class TOSQuestion(Base):
    __tablename__ = "tos_question"

    tos_question_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tos_exam_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tos_exam.tos_exam_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    competency_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("competency.competency_id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    competency_label: Mapped[str] = mapped_column(String(500), nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(40), nullable=False)
    difficulty_band: Mapped[str] = mapped_column(String(20), nullable=False)
    cognitive_level: Mapped[str] = mapped_column(String(20), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    points: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, default=Decimal("1.00"))
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    options_json: Mapped[str | None] = mapped_column(Text, nullable=True, default="[]")

    exam: Mapped["TOSExam"] = relationship("TOSExam", back_populates="questions")
    competency: Mapped["Competency | None"] = relationship("Competency", backref="tos_questions")
