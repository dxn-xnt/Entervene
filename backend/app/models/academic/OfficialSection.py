from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class OfficialSection(Base):
    """A school-approved section choice for one grade and academic year."""

    __tablename__ = "official_section"
    __table_args__ = (
        UniqueConstraint("academic_year_id", "academic_level_id", "normalized_name", name="uq_official_section_year_level_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    academic_year_id: Mapped[int] = mapped_column(ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False)
    academic_level_id: Mapped[int] = mapped_column(ForeignKey("academic_level.academic_level_id", ondelete="CASCADE"), nullable=False)
    section_name: Mapped[str] = mapped_column(String(100), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(100), nullable=False)
    pathway_id: Mapped[int | None] = mapped_column(ForeignKey("academic_pathway.id", ondelete="RESTRICT"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), server_default=func.now())

    academic_year = relationship("AcademicYear")
    academic_level = relationship("AcademicLevel")
    pathway = relationship("AcademicPathway")
