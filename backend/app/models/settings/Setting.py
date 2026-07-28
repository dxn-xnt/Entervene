import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.Base import Base


class SettingType(str, enum.Enum):
    """Allowed data types for a setting value."""

    STRING = "string"
    BOOLEAN = "boolean"
    INTEGER = "integer"
    JSON = "json"


class Setting(Base):
    """Dynamic application setting stored in PostgreSQL.

    Values are always persisted as text.  The ``type`` column tells the
    cache layer (and the API) how to parse / validate the value.
    """

    __tablename__ = "setting"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=False, default="")
    type = Column(
        Enum(SettingType, name="setting_type_enum", create_type=True),
        nullable=False,
    )
    group = Column(String(50), nullable=False, default="general")
    is_public = Column(Boolean, nullable=False, default=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by = Column(
        UUID(as_uuid=True),
        ForeignKey("user_account.user_id"),
        nullable=True,
    )
