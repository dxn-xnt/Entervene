from __future__ import annotations

from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.orm import Mapped, relationship

from app.db.Base import Base


class SubjectOfferingPathway(Base):
    __tablename__ = "subject_offering_pathway"

    subject_offering_id: Mapped[int] = Column(
        Integer,
        ForeignKey("subject_offering.subject_offering_id", ondelete="CASCADE"),
        primary_key=True,
    )
    pathway_id: Mapped[int] = Column(
        Integer,
        ForeignKey("academic_pathway.id", ondelete="CASCADE"),
        primary_key=True,
    )

    subject_offering: Mapped[object] = relationship("SubjectOffering", back_populates="offering_pathways")
    pathway: Mapped[object] = relationship("AcademicPathway", back_populates="offering_pathways")
