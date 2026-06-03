from sqlalchemy import Column, Integer, ForeignKey, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID
from app.db.Base import Base  


class UserLoginLog(Base):
    __tablename__ = "user_login_log"
    __table_args__ = (Index("ix_user_login_log_user_open", "user_id", "logout_at"),)

    login_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="CASCADE"), nullable=False)
    login_at = Column(DateTime(timezone=True), nullable=False)
    logout_at = Column(DateTime(timezone=True), nullable=True)
