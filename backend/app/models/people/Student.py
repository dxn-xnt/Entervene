from sqlalchemy import Column, String, Text, Integer, CheckConstraint, ForeignKey, Index, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.Base import Base


class Student(Base):
    __tablename__ = "student"

    student_id        = Column(UUID(as_uuid=True), primary_key=True)
    student_lrn       = Column(String(12), unique=True, nullable=False)
    first_name        = Column(String(100), nullable=False)
    middle_name       = Column(String(100))
    last_name         = Column(String(100), nullable=False)
    dob               = Column(Date)
    suffix            = Column(String(10))
    gender            = Column(String(20))
    contact_number    = Column(String(20))
    email             = Column(String(255), unique=True)
    address           = Column(Text)
    # guardian_id       = Column(UUID(as_uuid=True))   # not in DB yet
    academic_level_id = Column(Integer, ForeignKey("academic_level.academic_level_id", ondelete="RESTRICT"), nullable=True)
    # import_log_id     = Column(Integer)              # not in DB yet
    user_id           = Column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="SET NULL"), unique=True)

    __table_args__ = (
        CheckConstraint(r"student_lrn ~ '^[0-9]{12}$'", name="lrn_check"),
        Index("ix_student_academic_level_id", "academic_level_id"),
        Index("ix_student_user_id", "user_id"),
    )

    student_classes = relationship("StudentClass", back_populates="student")
    academic_level = relationship("AcademicLevel")
    user_account = relationship("UserAccount")
