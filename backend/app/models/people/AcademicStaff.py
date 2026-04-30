import uuid
from sqlalchemy import Column, String, Date, Text
from sqlalchemy.dialects.postgresql import UUID
from app.db.Base import Base

class AcademicStaff(Base):
    __tablename__ = "academic_staff"

    staff_id = Column(String(20), primary_key=True)
    first_name = Column(String(100), nullable=False)
    middle_name = Column(String(100))
    last_name = Column(String(100), nullable=False)
    dob = Column(Date)
    suffix = Column(String(10))
    gender = Column(String(20))
    contact_number = Column(String(20))
    email = Column(String(255), unique=True)
    address = Column(Text)
    hired_date = Column(Date)
    employment_status = Column(String(50))
    user_id = Column(UUID(as_uuid=True), unique=True)