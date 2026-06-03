import uuid
from sqlalchemy import Column, String, Date, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.db.Base import Base


class AcademicStaff(Base):
    __tablename__ = "academic_staff"

    staff_id          = Column(String(20), primary_key=True)
    first_name        = Column(String(100), nullable=False)
    middle_name       = Column(String(100))
    last_name         = Column(String(100), nullable=False)
    dob               = Column(Date)
    suffix            = Column(String(10))
    gender            = Column(String(20))
    contact_number    = Column(String(20))
    email             = Column(String(255), unique=True)
    address           = Column(Text)
    hired_date        = Column(Date)
    employment_status = Column(String(50))
    user_id           = Column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="SET NULL"), unique=True)

    __table_args__ = (
        Index("ix_academic_staff_user_id", "user_id"),
    )

    advised_classes = relationship("Class", back_populates="adviser")
    subject_loads   = relationship("SubjectLoad", back_populates="staff")
    user_account    = relationship("UserAccount")
