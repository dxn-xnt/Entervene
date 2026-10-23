"""Explicit, administrator-confirmed passing policy and append-only change log."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func
from sqlalchemy.types import Uuid

from app.db.Base import Base


class AcademicYearPassingPolicy(Base):
    __tablename__ = "academic_year_passing_policy"
    __table_args__ = (
        CheckConstraint("general_average_threshold >= 0 AND general_average_threshold <= 100", name="ck_academic_year_passing_policy_range"),
        CheckConstraint("version > 0", name="ck_academic_year_passing_policy_version"),
    )

    academic_year_id: Mapped[int] = mapped_column(Integer, ForeignKey("academic_year.academic_year_id", ondelete="RESTRICT"), primary_key=True)
    general_average_threshold: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_by: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("user_account.user_id", ondelete="RESTRICT"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class PassingPolicyAudit(Base):
    __tablename__ = "passing_policy_audit"
    __table_args__ = (
        CheckConstraint("policy_scope IN ('template', 'general_average')", name="ck_passing_policy_audit_scope"),
        CheckConstraint("old_threshold IS NULL OR (old_threshold >= 0 AND old_threshold <= 100)", name="ck_passing_policy_audit_old_range"),
        CheckConstraint("new_threshold >= 0 AND new_threshold <= 100", name="ck_passing_policy_audit_new_range"),
        CheckConstraint("(policy_scope = 'template' AND grading_template_id IS NOT NULL) OR (policy_scope = 'general_average' AND grading_template_id IS NULL)", name="ck_passing_policy_audit_target"),
        UniqueConstraint("policy_scope", "academic_year_id", "grading_template_id", "revision", name="uq_passing_policy_audit_revision"),
    )

    audit_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    policy_scope: Mapped[str] = mapped_column(String(24), nullable=False)
    academic_year_id: Mapped[int] = mapped_column(Integer, ForeignKey("academic_year.academic_year_id", ondelete="RESTRICT"), nullable=False)
    grading_template_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("grading_template.grading_template_id", ondelete="RESTRICT"), nullable=True)
    source_academic_year_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("academic_year.academic_year_id", ondelete="RESTRICT"), nullable=True)
    source_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    old_threshold: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    new_threshold: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("user_account.user_id", ondelete="RESTRICT"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
