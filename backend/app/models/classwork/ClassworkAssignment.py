from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class ClassworkAssignment(Base):
    __tablename__ = "classwork_assignment"
    __table_args__ = (
        UniqueConstraint("classwork_id", "class_id", name="uq_classwork_assignment"),
    )

    classwork_assignment_id = Column(Integer, primary_key=True, autoincrement=True)
    classwork_id            = Column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False)
    class_id                = Column(Integer, ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False)
    assigned_by_staff_id    = Column(String(20), ForeignKey("academic_staff.staff_id"), nullable=False)
    publish_date            = Column(DateTime(timezone=True))
    due_date                = Column(DateTime(timezone=True))
    lock_date               = Column(DateTime(timezone=True))
    is_published            = Column(Boolean, default=False)
    is_locked               = Column(Boolean, default=False)
    max_attempts            = Column(Integer, default=1)
    assigned_at             = Column(DateTime(timezone=True), server_default=func.now())
    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    updated_at              = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    classwork = relationship("Classwork", back_populates="assignments")
    class_    = relationship("Class", backref="classwork_assignments")
    staff     = relationship("AcademicStaff", backref="classwork_assignments")
    submissions = relationship("StudentSubmission", back_populates="classwork_assignment", cascade="all, delete-orphan")
