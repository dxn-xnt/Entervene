from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.Base import Base


class SubmissionLink(Base):
    __tablename__ = "submission_link"
    __table_args__ = (UniqueConstraint("submission_id", "position", name="uq_submission_link_position"),)

    submission_link_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("student_submission.submission_id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    submission: Mapped["StudentSubmission"] = relationship("StudentSubmission", back_populates="links")
