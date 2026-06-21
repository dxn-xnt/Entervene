from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AssessmentItem(Base):
    __tablename__ = "assessment_item"
    __table_args__ = (
        CheckConstraint(
            "component_type IN ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'PERIODICAL_ASSESSMENT')",
            name="ck_assessment_item_component_type",
        ),
        CheckConstraint("max_score > 0", name="ck_assessment_item_max_score_positive"),
        UniqueConstraint(
            "class_id",
            "subject_id",
            "academic_period_id",
            "component_type",
            "item_number",
            name="uq_assessment_item_scope_item",
        ),
        Index("ix_assessment_item_class_id", "class_id"),
        Index("ix_assessment_item_subject_id", "subject_id"),
        Index("ix_assessment_item_academic_period_id", "academic_period_id"),
    )

    assessment_id = Column(Integer, primary_key=True, autoincrement=True)
    class_id = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False)
    academic_period_id = Column(Integer, ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False)
    component_type = Column(String(40), nullable=False)
    item_number = Column(Integer, nullable=False)
    max_score = Column(Numeric(8, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    class_ = relationship("Class", backref="assessment_items")
    subject = relationship("Subject", backref="assessment_items")
    academic_period = relationship("AcademicPeriod", backref="assessment_items")
