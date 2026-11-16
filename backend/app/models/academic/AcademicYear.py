from __future__ import annotations
from datetime import date, datetime

from sqlalchemy import String, Date, Boolean, Integer, DateTime, Index, UniqueConstraint, extract
from sqlalchemy.sql import func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.Base import Base


class AcademicYear(Base):
    __tablename__ = "academic_year"
    __table_args__ = (
        UniqueConstraint("year_label", name="uq_academic_year_year_label"),
    )

    academic_year_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year_label: Mapped[str] = mapped_column(String(20), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())


    periods = relationship("AcademicPeriod", back_populates="academic_year")
    classes = relationship("Class", back_populates="academic_year")
    subject_offerings = relationship("SubjectOffering", back_populates="academic_year")


Index(
    "uq_academic_year_start_year",
    extract("year", AcademicYear.start_date),
    unique=True,
).ddl_if(dialect="postgresql")
