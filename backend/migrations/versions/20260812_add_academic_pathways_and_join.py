"""Add deped_cluster, academic_pathway, subject_offering_pathway, and subject.is_core

Revision ID: 20260812_add_academic_pathways_and_join
Revises: 20260812_add_subject_groups
Create Date: 2026-08-12

Steps:
1. Add is_core (Boolean, default False) to subject table.
2. Backfill is_core=True for exact DepEd Order 017 s. 2026 Core Subjects with logging.
   NOTE: The exact-match list below is seeded specifically for this school's current DO 017 schedule.
3. Create deped_cluster reference table and seed 15 DO 017 clusters.
4. Create academic_pathway table and seed 2 active pathways ("medical-courses", "engineering-math").
5. Create subject_offering_pathway join table for multi-pathway subject offerings.
6. Add pathway_id FK (nullable) to class table.
7. Backfill class.pathway_id from legacy class.pathway string column.
8. Backfill subject_offering_pathway rows from legacy subject_offering.pathway string column.
9. Clean up legacy setting keys ('medical_pathway_enabled', 'engineering_pathway_enabled').
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = "20260812_add_academic_pathways_and_join"
down_revision = "20260812_add_subject_groups"
branch_labels = None
depends_on = None

_SEED_CLUSTERS = [
    # Academic (5)
    ("arts-humanities", "Arts, Social Sciences and Humanities", "ACADEMIC", 1),
    ("business-entrepreneurship", "Business and Entrepreneurship", "ACADEMIC", 2),
    ("stem", "Science, Technology, Engineering and Mathematics", "ACADEMIC", 3),
    ("sports-health-wellness", "Sports, Health and Wellness", "ACADEMIC", 4),
    ("field-experience", "Field Experience", "ACADEMIC", 5),
    # Tech-Pro (10)
    ("aesthetic-wellness", "Aesthetic, Wellness and Human Care", "TECH_PRO", 6),
    ("agri-fishery-food", "Agri-Fishery Business and Food Innovation", "TECH_PRO", 7),
    ("artisanry-creative", "Artisanry and Creative Enterprise", "TECH_PRO", 8),
    ("automotive-small-engine", "Automotive and Small Engine Technologies", "TECH_PRO", 9),
    ("construction-building", "Construction and Building Technologies", "TECH_PRO", 10),
    ("creative-arts-design", "Creative Arts and Design Technologies", "TECH_PRO", 11),
    ("hospitality-tourism", "Hospitality and Tourism", "TECH_PRO", 12),
    ("ict-computer-prog", "ICT Support and Computer Programming Technologies", "TECH_PRO", 13),
    ("industrial-tech", "Industrial Technologies", "TECH_PRO", 14),
    ("maritime", "Maritime", "TECH_PRO", 15),
]

_SEED_PATHWAYS = [
    ("medical-courses", "Medical Courses and Sciences Related", 1),
    ("engineering-math", "Engineering and Mathematics Related", 2),
]

# Exact DO 017 Core Subject names for this school's curriculum
_CORE_SUBJECT_NAMES = [
    "effective communication",
    "general mathematics",
    "general science",
    "life and career skills",
    "pag-aaral ng kasaysayan at lipunang pilipino",
]


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. Add is_core column to subject ──────────────────────────────────
    op.add_column(
        "subject",
        sa.Column("is_core", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    # ── 2. Backfill is_core with Discovery Logging & Exact Match ─────────
    # Discovery logging: Query candidate core subjects
    candidates = conn.execute(
        text(
            "SELECT subject_id, subject_name, subject_codename FROM subject "
            "WHERE LOWER(TRIM(subject_name)) LIKE '%communication%' "
            "   OR LOWER(TRIM(subject_name)) LIKE '%mathematics%' "
            "   OR LOWER(TRIM(subject_name)) LIKE '%general science%' "
            "   OR LOWER(TRIM(subject_name)) LIKE '%life and career%' "
            "   OR LOWER(TRIM(subject_name)) LIKE '%kasaysayan%'"
        )
    ).fetchall()
    print(f"[Migration] Discovered candidate core subjects: {[(r[0], r[1], r[2]) for r in candidates]}")

    # Precise UPDATE using exact normalized match
    for name in _CORE_SUBJECT_NAMES:
        conn.execute(
            text(
                "UPDATE subject SET is_core = TRUE "
                "WHERE LOWER(TRIM(subject_name)) = LOWER(TRIM(:name))"
            ),
            {"name": name},
        )

    updated_count = conn.execute(
        text("SELECT COUNT(*) FROM subject WHERE is_core = TRUE")
    ).scalar_one()
    print(f"[Migration] Successfully backfilled is_core=True for {updated_count} subject(s).")

    # ── 3. Create deped_cluster table and seed 15 clusters ────────────────
    op.create_table(
        "deped_cluster",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("category", sa.String(20), nullable=False, server_default="ACADEMIC"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("code", name="uq_deped_cluster_code"),
    )

    for code, name, category, order in _SEED_CLUSTERS:
        conn.execute(
            text(
                "INSERT INTO deped_cluster (code, name, category, sort_order) "
                "VALUES (:code, :name, :category, :order)"
            ),
            {"code": code, "name": name, "category": category, "order": order},
        )

    # ── 4. Create academic_pathway table and seed 2 pathways ─────────────
    op.create_table(
        "academic_pathway",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("code", sa.String(50), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deped_cluster_id", sa.Integer(), sa.ForeignKey("deped_cluster.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.UniqueConstraint("code", name="uq_academic_pathway_code"),
    )

    for code, name, order in _SEED_PATHWAYS:
        conn.execute(
            text(
                "INSERT INTO academic_pathway (code, name, is_enabled, sort_order) "
                "VALUES (:code, :name, TRUE, :order)"
            ),
            {"code": code, "name": name, "order": order},
        )

    # Fetch seeded pathway IDs for backfills
    med_id = conn.execute(
        text("SELECT id FROM academic_pathway WHERE code = 'medical-courses'")
    ).scalar_one()
    eng_id = conn.execute(
        text("SELECT id FROM academic_pathway WHERE code = 'engineering-math'")
    ).scalar_one()

    # ── 5. Create subject_offering_pathway join table ──────────────────────
    op.create_table(
        "subject_offering_pathway",
        sa.Column("subject_offering_id", sa.Integer(), sa.ForeignKey("subject_offering.subject_offering_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("pathway_id", sa.Integer(), sa.ForeignKey("academic_pathway.id", ondelete="CASCADE"), primary_key=True),
    )

    # ── 6. Add pathway_id FK column to class ──────────────────────────────
    op.add_column(
        "class",
        sa.Column("pathway_id", sa.Integer(), sa.ForeignKey("academic_pathway.id", ondelete="SET NULL"), nullable=True),
    )

    # ── 7. Backfill class.pathway_id from legacy string column ─────────────
    conn.execute(
        text("UPDATE class SET pathway_id = :med_id WHERE LOWER(pathway) = 'stem_medical'"),
        {"med_id": med_id},
    )
    conn.execute(
        text("UPDATE class SET pathway_id = :eng_id WHERE LOWER(pathway) = 'stem_engineering'"),
        {"eng_id": eng_id},
    )
    conn.execute(
        text("UPDATE class SET pathway_id = NULL WHERE LOWER(pathway) = 'general'"),
    )

    # ── 8. Backfill subject_offering_pathway from legacy pathway string ────
    # stem_medical -> med_id
    conn.execute(
        text(
            "INSERT INTO subject_offering_pathway (subject_offering_id, pathway_id) "
            "SELECT subject_offering_id, :med_id FROM subject_offering WHERE LOWER(pathway) = 'stem_medical'"
        ),
        {"med_id": med_id},
    )
    # stem_engineering -> eng_id
    conn.execute(
        text(
            "INSERT INTO subject_offering_pathway (subject_offering_id, pathway_id) "
            "SELECT subject_offering_id, :eng_id FROM subject_offering WHERE LOWER(pathway) = 'stem_engineering'"
        ),
        {"eng_id": eng_id},
    )
    # both -> both med_id and eng_id
    conn.execute(
        text(
            "INSERT INTO subject_offering_pathway (subject_offering_id, pathway_id) "
            "SELECT subject_offering_id, :med_id FROM subject_offering WHERE LOWER(pathway) = 'both'"
        ),
        {"med_id": med_id},
    )
    conn.execute(
        text(
            "INSERT INTO subject_offering_pathway (subject_offering_id, pathway_id) "
            "SELECT subject_offering_id, :eng_id FROM subject_offering WHERE LOWER(pathway) = 'both'"
        ),
        {"eng_id": eng_id},
    )

    # ── 9. Cleanup legacy settings ─────────────────────────────────────────
    conn.execute(
        text("DELETE FROM setting WHERE key IN ('medical_pathway_enabled', 'engineering_pathway_enabled')")
    )


def downgrade() -> None:
    op.drop_column("class", "pathway_id")
    op.drop_table("subject_offering_pathway")
    op.drop_table("academic_pathway")
    op.drop_table("deped_cluster")
    op.drop_column("subject", "is_core")
