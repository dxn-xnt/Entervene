from sqlalchemy import Column, String, Integer, BigInteger, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class ClassworkAttachment(Base):
    __tablename__ = "classwork_attachment"

    classwork_attachment_id = Column(Integer, primary_key=True, autoincrement=True)
    classwork_id            = Column(Integer, ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False)
    file_name               = Column(String(255), nullable=False)
    file_path               = Column(Text, nullable=False)
    file_type               = Column(String(100))
    file_size               = Column(BigInteger, nullable=False)
    uploaded_at             = Column(DateTime(timezone=True), server_default=func.now())

    classwork = relationship("Classwork", back_populates="attachments")
