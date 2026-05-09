from sqlalchemy import Column, SmallInteger, String, DateTime, Text
from sqlalchemy.sql import func
from app.db.Base import Base

class Role(Base):
    __tablename__ = "role"

    role_id = Column(SmallInteger, primary_key=True)
    role_name = Column(String(50), nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())