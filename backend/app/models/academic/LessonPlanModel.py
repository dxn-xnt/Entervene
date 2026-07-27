from __future__ import annotations

from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base

class LessonPlanModel(Base):
    __tablename__ = "lesson_plan"

    plan_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    status: Mapped[str] = mapped_column(String(20), server_default="DRAFT", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    learning_area: Mapped[str | None] = mapped_column(String(255), nullable=True)
    grade_section: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sessions: Mapped[str | None] = mapped_column(String(255), nullable=True)
    references: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    ai_declaration: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    
    # Store dynamic ILAW sections as JSON
    intentions: Mapped[dict | None] = mapped_column(JSON, nullable=True) 
    learning_experience: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    assessment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ways_forward: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    teacher_id: Mapped[str] = mapped_column(String(20), ForeignKey("academic_staff.staff_id", ondelete="CASCADE"), nullable=False)
    
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    teacher: Mapped[object] = relationship("AcademicStaff", backref="lesson_plans")
