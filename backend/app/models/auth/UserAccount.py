import uuid
from sqlalchemy import Column, String, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.db.Base import Base

class UserAccount(Base):
    __tablename__ = "user_account"

    user_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    invitation_token = Column(String(255))
    account_status = Column(String(50), default="active")
    ref_type = Column(String(50))
    ref_id = Column(String(50))
    last_login = Column(DateTime(timezone=True))
    email_verified_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())