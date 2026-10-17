"""Configure official sections by academic year and grade.

Revision ID: 20261017_official_sections
Revises: 20261007_rubric_templates
"""

from alembic import op
import sqlalchemy as sa


revision = "20261017_official_sections"
down_revision = "20261007_rubric_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "official_section",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("academic_year_id", sa.Integer(), sa.ForeignKey("academic_year.academic_year_id", ondelete="CASCADE"), nullable=False),
        sa.Column("academic_level_id", sa.Integer(), sa.ForeignKey("academic_level.academic_level_id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_name", sa.String(length=100), nullable=False),
        sa.Column("normalized_name", sa.String(length=100), nullable=False),
        sa.Column("pathway_id", sa.Integer(), sa.ForeignKey("academic_pathway.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("academic_year_id", "academic_level_id", "normalized_name", name="uq_official_section_year_level_name"),
    )
    conn = op.get_bind()
    year_id = conn.execute(sa.text("SELECT academic_year_id FROM academic_year WHERE year_label = :label"), {"label": "2025-2026"}).scalar()
    if year_id is None:
        return  # Other installations can configure their own year through Admin Settings.

    levels = {row.grade_level: row.academic_level_id for row in conn.execute(sa.text("SELECT grade_level, academic_level_id FROM academic_level WHERE grade_level BETWEEN 7 AND 12"))}
    pathways = {row.code: row.id for row in conn.execute(sa.text("SELECT code, id FROM academic_pathway WHERE code IN ('engineering-math', 'medical-courses')"))}
    names = {
        7: [("Aristotle", None), ("Galileo", None)],
        8: [("Newton", None), ("Plato", None)],
        9: [("Archimedes", None), ("Copernicus", None)],
        10: [("Socrates", None), ("Einstein", None)],
        11: [("Campos", "engineering-math"), ("Zara", "medical-courses")],
        12: [("Del Mundo", None), ("Reyes", None)],
    }
    for grade, sections in names.items():
        if grade not in levels:
            continue
        for name, code in sections:
            if code and code not in pathways:
                raise RuntimeError(f"Existing academic pathway {code} is required before seeding official sections.")
            conn.execute(sa.text("""
                INSERT INTO official_section (academic_year_id, academic_level_id, section_name, normalized_name, pathway_id, is_active)
                VALUES (:year, :level, :name, :normalized, :pathway, TRUE)
            """), {"year": year_id, "level": levels[grade], "name": name, "normalized": name.casefold(), "pathway": pathways.get(code)})


def downgrade() -> None:
    op.drop_table("official_section")
