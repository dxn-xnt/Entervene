from sqlalchemy import Column, SmallInteger, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.db.Base import Base

class UserRoles(Base):
    __tablename__ = "user_roles"

    user_id = Column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="CASCADE"), primary_key=True)
    role_id = Column(SmallInteger, ForeignKey("role.role_id", ondelete="CASCADE"), primary_key=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())