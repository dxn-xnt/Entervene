from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    event,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base
from app.services.AcademicPeriodService import normalize_academic_period_values


class AcademicPeriod(Base):
    __tablename__ = "academic_period"
    __table_args__ = (
        CheckConstraint("period_type IN ('QUARTER', 'TERM', 'SEMESTER')", name="ck_academic_period_period_type"),
        CheckConstraint("period_sequence > 0", name="ck_academic_period_sequence_positive"),
        CheckConstraint("total_periods_in_year > 0", name="ck_academic_period_total_positive"),
        CheckConstraint(
            "period_progress_ratio = round((period_sequence * 1.0 / total_periods_in_year), 4)",
            name="ck_academic_period_progress_ratio",
        ),
        UniqueConstraint(
            "academic_year_id",
            "period_type",
            "period_sequence",
            name="uq_academic_period_year_type_sequence",
        ),
    )

    academic_period_id = Column(Integer, primary_key=True, autoincrement=True)
    period_name        = Column(String(100), nullable=False)
    period_type        = Column(String(20), nullable=False, default="TERM")
    period_sequence    = Column(Integer, nullable=False, default=1)
    total_periods_in_year = Column(Integer, nullable=False, default=3)
    period_progress_ratio = Column(Numeric(6, 4), nullable=False, default=0.3333)
    start_date         = Column(Date, nullable=False)
    end_date           = Column(Date, nullable=False)
    is_active          = Column(Boolean, default=False)
    academic_year_id   = Column(Integer, ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False)
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    academic_year = relationship("AcademicYear", back_populates="periods")
    subject_loads = relationship("SubjectLoad", back_populates="period")
    classes       = relationship("Class", back_populates="academic_period")
    subject_offerings = relationship("SubjectOffering", back_populates="academic_period")


@event.listens_for(AcademicPeriod, "before_insert")
@event.listens_for(AcademicPeriod, "before_update")
def _validate_academic_period(mapper, connection, target):
    normalize_academic_period_values(target)
