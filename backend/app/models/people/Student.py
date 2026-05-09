from sqlalchemy import Column, String, Text, Integer, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.db.Base import Base

class Student(Base):
    __tablename__ = "student"

    student_id = Column(UUID(as_uuid=True), primary_key=True)
    student_lrn = Column(String(12), unique=True, nullable=False)
    first_name = Column(String(100), nullable=False)
    middle_name = Column(String(100))
    last_name = Column(String(100), nullable=False)
    suffix = Column(String(10))
    gender = Column(String(20))
    contact_number = Column(String(20))
    email = Column(String(255), unique=True)
    address = Column(Text)
    account_status = Column(String(50), default="active")
    guardian_id = Column(UUID(as_uuid=True))
    academic_level_id = Column(Integer)
    import_log_id = Column(Integer)
    user_id = Column(UUID(as_uuid=True), unique=True)

    __table_args__ = (
        CheckConstraint(r"student_lrn ~ '^[0-9]{12}$'", name="lrn_check"),
    )