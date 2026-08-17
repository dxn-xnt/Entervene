from sqlalchemy import Column, Integer, Boolean, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AcademicLevelPathwayScope(Base):
    __tablename__ = "academic_level_pathway_scope"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year_id = Column(
        Integer,
        ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    academic_level_id = Column(
        Integer,
        ForeignKey("academic_level.academic_level_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    requires_pathway = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    academic_year = relationship("AcademicYear", backref="pathway_scopes")
    academic_level = relationship("AcademicLevel", backref="pathway_scopes")

    __table_args__ = (
        UniqueConstraint(
            "academic_year_id",
            "academic_level_id",
            name="uq_academic_level_pathway_scope_year_level",
        ),
    )
