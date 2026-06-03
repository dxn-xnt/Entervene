import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.Base import Base


def _48h_from_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(hours=48)


class InvitationToken(Base):
    __tablename__ = "invitation_token"

    token_id   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("user_account.user_id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True)   # SHA-256 hex digest
    expires_at = Column(DateTime(timezone=True), nullable=False, default=_48h_from_now)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user = relationship("UserAccount")