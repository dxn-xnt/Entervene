"""Make offering duration authoritative and remove subject scheduling flag.

Revision ID: 20261114_offering_duration
Revises: 20261113_subject_year_template, 20261113_suggestion_links
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_offering_duration"
down_revision = ("20261113_subject_year_template", "20261113_suggestion_links")
branch_labels = None
depends_on = None


_VERIFIED_JHS_ENHANCED_CODES = (
    "MATH7", "SCI7", "EMATH8", "ESCIE8",
    "MATH9", "SCI9", "MATH10", "SCI10",
)


def upgrade() -> None:
    bind = op.get_bind()
    codes = ", ".join(f"'{code}'" for code in _VERIFIED_JHS_ENHANCED_CODES)
    bind.execute(sa.text(f"""
        UPDATE subject_offering AS offering
        SET minutes = 60
        FROM subject
        WHERE offering.subject_id = subject.subject_id
          AND offering.status = 'active'
          AND offering.minutes IS NULL
          AND subject.is_math_or_science IS TRUE
          AND subject.subject_codename IN ({codes})
    """))

    ambiguous = bind.execute(sa.text("""
        SELECT COUNT(*)
        FROM subject_offering AS offering
        JOIN subject ON subject.subject_id = offering.subject_id
        WHERE offering.status = 'active'
          AND offering.minutes IS NULL
          AND subject.is_math_or_science IS TRUE
    """)).scalar_one()
    if ambiguous:
        raise RuntimeError(
            f"Refusing to remove is_math_or_science: {ambiguous} active flagged "
            "offering(s) still have no verified duration. Configure them in "
            "Curriculum Plan and rerun the migration."
        )

    invalid = bind.execute(sa.text(
        "SELECT COUNT(*) FROM subject_offering WHERE minutes IS NOT NULL AND minutes <= 0"
    )).scalar_one()
    if invalid:
        raise RuntimeError(
            f"Refusing to add the positive-minutes constraint: {invalid} invalid offering(s) exist."
        )

    op.create_check_constraint(
        "ck_subject_offering_minutes_positive",
        "subject_offering",
        "minutes IS NULL OR minutes > 0",
    )
    op.drop_column("subject", "is_math_or_science")


def downgrade() -> None:
    # The original classifications cannot be reconstructed reliably after
    # duration becomes authoritative, so downgrade restores a conservative
    # false value only.
    op.add_column(
        "subject",
        sa.Column(
            "is_math_or_science",
            sa.Boolean(),
            nullable=True,
            server_default=sa.false(),
        ),
    )
    op.drop_constraint(
        "ck_subject_offering_minutes_positive",
        "subject_offering",
        type_="check",
    )
