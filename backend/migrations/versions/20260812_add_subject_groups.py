"""Add subject_groups table and migrate subject.subject_group text to FK

Revision ID: 20260812_add_subject_groups
Revises: 20260729_make_subject_load_staff_id_nullable
Create Date: 2026-08-12

Steps
-----
1. Create subject_groups table.
2. Seed five default rows:
   - Core        passing_threshold=85  (DepEd Order 41 s. 2005 — explicitly defined)
   - Applied     passing_threshold=83  *** PROVISIONAL — confirm with admin/registrar ***
   - Specialized passing_threshold=83  *** PROVISIONAL — confirm with admin/registrar ***
   - Research    passing_threshold=83  *** PROVISIONAL — confirm with admin/registrar ***
   - Other       passing_threshold=83  (DepEd baseline for everything else)
   Applied, Specialized, and Research are seeded at 83 because DepEd Order 41 only
   explicitly names Core (85) vs everything else (83).  Admin should confirm before
   the first grading period.
3. Add subject_group_id (nullable, ON DELETE RESTRICT) to subject.
4. Backfill subject_group_id by case-insensitive name match against the seeded rows.
5. Assign stragglers (unmatched or NULL subject_group) to the "Other" group.
6. Alter subject_group_id to NOT NULL.
   NOTE: The ORM model (Subject.py) declares Mapped[int] / nullable=False to match
   this final state.  It is NOT used to CREATE the table; Alembic owns the schema.
   The old subject_group String(50) column is kept for rollback safety and will be
   dropped in a separate follow-up migration once the FK path is confirmed stable.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = "20260812_add_subject_groups"
down_revision = "844db2477657"
branch_labels = None
depends_on = None


_SEED_GROUPS = [
    # (name, passing_threshold, display_order)
    ("Core",        85, 1),
    ("Applied",     83, 2),
    ("Specialized", 83, 3),
    ("Research",    83, 4),
    ("Other",       83, 5),
]


def upgrade() -> None:
    # ── 1. Create subject_groups table ────────────────────────────────────
    op.create_table(
        "subject_groups",
        sa.Column("subject_group_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("passing_threshold", sa.Numeric(5, 2), nullable=False, server_default="83"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("name", name="uq_subject_groups_name"),
    )

    # ── 2. Seed default groups ────────────────────────────────────────────
    conn = op.get_bind()
    for name, threshold, order in _SEED_GROUPS:
        conn.execute(
            text(
                "INSERT INTO subject_groups (name, passing_threshold, display_order) "
                "VALUES (:name, :threshold, :order)"
            ),
            {"name": name, "threshold": threshold, "order": order},
        )

    # Fetch the "Other" group id for the straggler fallback
    other_id = conn.execute(
        text("SELECT subject_group_id FROM subject_groups WHERE LOWER(name) = 'other'")
    ).scalar_one()

    # ── 3. Add subject_group_id as nullable FK (nullable during backfill) ─
    op.add_column(
        "subject",
        sa.Column("subject_group_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_subject_subject_group_id",
        "subject",
        "subject_groups",
        ["subject_group_id"],
        ["subject_group_id"],
        ondelete="RESTRICT",
    )

    # ── 4. Backfill from old text column (case-insensitive match) ─────────
    for name, _, _ in _SEED_GROUPS:
        row = conn.execute(
            text("SELECT subject_group_id FROM subject_groups WHERE LOWER(name) = LOWER(:name)"),
            {"name": name},
        ).first()
        if row is None:
            continue
        group_id = row[0]
        conn.execute(
            text(
                "UPDATE subject SET subject_group_id = :gid "
                "WHERE LOWER(COALESCE(subject_group, '')) = LOWER(:name)"
            ),
            {"gid": group_id, "name": name},
        )

    # ── 5. Assign stragglers (NULL subject_group or unrecognised name) ────
    conn.execute(
        text("UPDATE subject SET subject_group_id = :gid WHERE subject_group_id IS NULL"),
        {"gid": other_id},
    )

    # ── 6. Alter to NOT NULL ──────────────────────────────────────────────
    op.alter_column("subject", "subject_group_id", nullable=False)


def downgrade() -> None:
    op.drop_constraint("fk_subject_subject_group_id", "subject", type_="foreignkey")
    op.drop_column("subject", "subject_group_id")
    op.drop_table("subject_groups")
