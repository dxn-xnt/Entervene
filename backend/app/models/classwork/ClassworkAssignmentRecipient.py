from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class ClassworkAssignmentRecipient(Base):
    __tablename__ = "classwork_assignment_recipient"
    __table_args__ = (
        UniqueConstraint(
            "classwork_assignment_id",
            "student_id",
            name="uq_cw_assignment_recipient",
        ),
        Index("ix_cw_assignment_recipient_assignment", "classwork_assignment_id"),
        Index("ix_cw_assignment_recipient_student", "student_id"),
    )

    recipient_id: Mapped[int] = Column(Integer, primary_key=True, autoincrement=True)
    classwork_assignment_id: Mapped[int] = Column(
        Integer,
        ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="CASCADE"),
        nullable=False,
    )
    student_id: Mapped[UUID] = Column(
        PG_UUID(as_uuid=True),
        ForeignKey("student.student_id", ondelete="RESTRICT"),
        nullable=False,
    )
    assigned_by_staff_id: Mapped[str] = Column(
        String(20),
        ForeignKey("academic_staff.staff_id"),
        nullable=False,
    )
    created_at: Mapped[datetime | None] = Column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    classwork_assignment: Mapped["ClassworkAssignment"] = relationship(
        "ClassworkAssignment",
        back_populates="recipients",
    )
    student: Mapped[object] = relationship("Student")
    staff: Mapped[object] = relationship("AcademicStaff")
