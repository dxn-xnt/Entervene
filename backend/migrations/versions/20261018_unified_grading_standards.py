"""Unify Subject Groups and Grading Templates into Subject Grading Standards

Revision ID: 20261018_unified_grading_standards
Revises: 20261017_official_sections
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = "20261018_unified_grading_standards"
down_revision = "20261017_official_sections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add subject_group_id FK to grading_template
    op.add_column(
        "grading_template",
        sa.Column("subject_group_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_grading_template_subject_group_id",
        "grading_template",
        "subject_groups",
        ["subject_group_id"],
        ["subject_group_id"],
        ondelete="RESTRICT",
    )

    # A fresh database has no Subject Group seed rows or legacy templates.
    # The following data migration applies only to the reviewed existing
    # installation; the successor revision creates the three canonical
    # templates for an empty installation.
    if (conn.execute(text("SELECT count(*) FROM grading_template")).scalar_one() == 0
            and conn.execute(text("SELECT count(*) FROM subject")).scalar_one() == 0):
        return

    # 2. Fix the typo "Elective Susbjects" -> "Elective Subjects"
    conn.execute(
        text("UPDATE grading_template SET template_name = 'Elective Subjects' WHERE template_name = 'Elective Susbjects'")
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = 'Elective Subjects' WHERE default_grading_template = 'Elective Susbjects'")
    )

    # 3. Associate existing seed templates with Core group (id 1) and standardize names
    conn.execute(
        text("""
            UPDATE grading_template
            SET subject_group_id = 1,
                template_name = 'Core — Academic',
                description = 'Junior High and Senior High School Core Academic subjects'
            WHERE grading_template_id = 1
        """)
    )
    conn.execute(
        text("""
            UPDATE grading_template
            SET subject_group_id = 1,
                template_name = 'Core — Research & Electives',
                description = 'Core Curriculum Electives and Research subjects'
            WHERE grading_template_id = 2
        """)
    )
    conn.execute(
        text("""
            UPDATE grading_template
            SET subject_group_id = 1,
                template_name = 'Core — EPP/TLE',
                description = 'Junior High School EPP and Technology & Livelihood Education'
            WHERE grading_template_id = 3
        """)
    )
    conn.execute(
        text("""
            UPDATE grading_template
            SET subject_group_id = 1,
                template_name = 'Core — Values Education / GMRC',
                description = 'Values Education and Good Moral & Right Conduct'
            WHERE grading_template_id = 4
        """)
    )
    conn.execute(
        text("""
            UPDATE grading_template
            SET subject_group_id = 1,
                template_name = 'Core — MAPEH',
                description = 'Music, Arts, Physical Education, and Health'
            WHERE grading_template_id = 7
        """)
    )

    # Helper function to create template and components
    def insert_standard(name: str, desc: str, group_id: int, components: list[tuple[str, float, int]]):
        res = conn.execute(
            text("""
                INSERT INTO grading_template (template_name, description, subject_group_id, status, created_at, updated_at)
                VALUES (:name, :desc, :gid, 'active', now(), now())
                RETURNING grading_template_id
            """),
            {"name": name, "desc": desc, "gid": group_id},
        )
        tid = res.scalar_one()
        for cname, weight, order in components:
            conn.execute(
                text("""
                    INSERT INTO grading_template_component (grading_template_id, component_name, weight, display_order, created_at, updated_at)
                    VALUES (:tid, :cname, :weight, :order, now(), now())
                """),
                {"tid": tid, "cname": cname, "weight": weight, "order": order},
            )
        return tid

    # 4. Create standards for other groups
    # Standard 20/50/30 components
    comp_20_50_30 = [("Written Works", 20.00, 1), ("Performance Tasks", 50.00, 2), ("Exams", 30.00, 3)]
    # Technical 20/40/40 components
    comp_20_40_40 = [("Written Work", 20.00, 1), ("Performance Task", 40.00, 2), ("Exams", 40.00, 3)]

    # Specialized (Group ID 3)
    spec_acad_id = insert_standard("Specialized — Academic", "Senior High School STEM Specialized subjects", 3, comp_20_50_30)
    spec_tech_id = insert_standard("Specialized — Technical / CAD", "Senior High School Technical drafting & specialized electives", 3, comp_20_40_40)

    # Applied (Group ID 2)
    appl_acad_id = insert_standard("Applied — Immersion & Applied", "Senior High School Applied subjects and Work Immersion", 2, comp_20_50_30)

    # Enhanced (Group ID 6)
    enh_acad_id = insert_standard("Enhanced — Research & Science", "Enhanced curriculum advanced research and science", 6, comp_20_50_30)

    # Other (Group ID 5)
    oth_acad_id = insert_standard("Other — Academic Standard", "General academic subjects under baseline threshold", 5, comp_20_50_30)
    oth_elec_id = insert_standard("Other — Elective Subjects", "Electives and special interest subjects under baseline threshold", 5, comp_20_40_40)

    # Research (Group ID 4)
    insert_standard("Research — Capstone & Research", "Institutional research and capstone projects", 4, comp_20_50_30)

    # 5. Migrate all 40 subjects to point to their exact unified template IDs
    # Core group subjects (Group ID 1)
    conn.execute(
        text("UPDATE subject SET default_grading_template = '1' WHERE subject_group_id = 1 AND default_grading_template = 'Core Subjects'")
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = '7' WHERE subject_group_id = 1 AND default_grading_template = 'MAPEH Subjects'")
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = '3' WHERE subject_group_id = 1 AND default_grading_template = 'EPP/TLE Subjects'")
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = '4' WHERE subject_group_id = 1 AND default_grading_template = 'Values Education / GMRC'")
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = '2' WHERE subject_group_id = 1 AND default_grading_template = 'Elective Subjects'")
    )

    # Specialized group subjects (Group ID 3)
    conn.execute(
        text("UPDATE subject SET default_grading_template = :tid WHERE subject_group_id = 3 AND default_grading_template = 'Core Subjects'"),
        {"tid": str(spec_acad_id)},
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = :tid WHERE subject_group_id = 3 AND default_grading_template = 'Elective Subjects'"),
        {"tid": str(spec_tech_id)},
    )

    # Applied group subjects (Group ID 2)
    conn.execute(
        text("UPDATE subject SET default_grading_template = :tid WHERE subject_group_id = 2 AND default_grading_template = 'Core Subjects'"),
        {"tid": str(appl_acad_id)},
    )

    # Enhanced group subjects (Group ID 6)
    conn.execute(
        text("UPDATE subject SET default_grading_template = :tid WHERE subject_group_id = 6 AND default_grading_template = 'Core Subjects'"),
        {"tid": str(enh_acad_id)},
    )

    # Other group subjects (Group ID 5)
    conn.execute(
        text("UPDATE subject SET default_grading_template = :tid WHERE subject_group_id = 5 AND default_grading_template = 'Core Subjects'"),
        {"tid": str(oth_acad_id)},
    )
    conn.execute(
        text("UPDATE subject SET default_grading_template = :tid WHERE subject_group_id = 5 AND default_grading_template = 'Elective Subjects'"),
        {"tid": str(oth_elec_id)},
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Revert subject templates to legacy string names
    conn.execute(text("UPDATE subject SET default_grading_template = 'Core Subjects' WHERE default_grading_template = '1'"))
    conn.execute(text("UPDATE subject SET default_grading_template = 'Elective Susbjects' WHERE default_grading_template = '2'"))
    conn.execute(text("UPDATE subject SET default_grading_template = 'EPP/TLE Subjects' WHERE default_grading_template = '3'"))
    conn.execute(text("UPDATE subject SET default_grading_template = 'Values Education / GMRC' WHERE default_grading_template = '4'"))
    conn.execute(text("UPDATE subject SET default_grading_template = 'MAPEH Subjects' WHERE default_grading_template = '7'"))

    # Revert any subjects assigned to the new template IDs back to their previous template strings
    conn.execute(text("UPDATE subject SET default_grading_template = 'Core Subjects' WHERE subject_group_id IN (2, 3, 5, 6) AND default_grading_template NOT IN ('Elective Susbjects', 'EPP/TLE Subjects', 'Values Education / GMRC', 'MAPEH Subjects')"))
    conn.execute(text("UPDATE subject SET default_grading_template = 'Elective Susbjects' WHERE default_grading_template NOT IN ('1', '3', '4', '7', 'Core Subjects', 'EPP/TLE Subjects', 'Values Education / GMRC', 'MAPEH Subjects')"))

    # Remove newly added templates
    conn.execute(text("DELETE FROM grading_template WHERE grading_template_id NOT IN (1, 2, 3, 4, 7)"))

    # Revert existing template names
    conn.execute(text("UPDATE grading_template SET template_name = 'Core Subjects', subject_group_id = NULL WHERE grading_template_id = 1"))
    conn.execute(text("UPDATE grading_template SET template_name = 'Elective Susbjects', subject_group_id = NULL WHERE grading_template_id = 2"))
    conn.execute(text("UPDATE grading_template SET template_name = 'EPP/TLE Subjects', subject_group_id = NULL WHERE grading_template_id = 3"))
    conn.execute(text("UPDATE grading_template SET template_name = 'Values Education / GMRC', subject_group_id = NULL WHERE grading_template_id = 4"))
    conn.execute(text("UPDATE grading_template SET template_name = 'MAPEH Subjects', subject_group_id = NULL WHERE grading_template_id = 7"))

    # Drop FK and column
    op.drop_constraint("fk_grading_template_subject_group_id", "grading_template", type_="foreignkey")
    op.drop_column("grading_template", "subject_group_id")
