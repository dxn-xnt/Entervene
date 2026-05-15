from sqlalchemy import Column, String, Integer, BigInteger, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.Base import Base


class SubmissionAttachment(Base):
    __tablename__ = "submission_attachment"

    submission_attachment_id = Column(Integer, primary_key=True, autoincrement=True)
    submission_id            = Column(Integer, ForeignKey("student_submission.submission_id", ondelete="CASCADE"), nullable=False)
    file_name                = Column(String(255), nullable=False)
    file_path                = Column(Text, nullable=False)
    file_type                = Column(String(100))
    file_size                = Column(BigInteger, nullable=False)
    uploaded_at              = Column(DateTime(timezone=True), server_default=func.now())

    submission = relationship("StudentSubmission", back_populates="attachments")
