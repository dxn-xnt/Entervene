"""Make Core, Applied, and Specialized the only grading configurations.

Revision ID: 20261018_three_grading_templates
Revises: 20261018_unified_grading_standards
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "20261018_three_grading_templates"
down_revision = "20261018_unified_grading_standards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    names = ("Core", "Applied", "Specialized")
    # Existing IDs are stable in the preceding migration.
    rows = conn.execute(text("SELECT grading_template_id FROM grading_template")).scalars().all()
    old_ids = set(rows)
    expected = {1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14}
    demo_subjects = conn.execute(text("""
        SELECT subject_id, subject_name, subject_codename,
               subject_group_id, default_grading_template
        FROM subject ORDER BY subject_id
    """)).all()
    demo_components = conn.execute(text("""
        SELECT component_name, weight, display_order
        FROM grading_template_component
        WHERE grading_template_id = 1
        ORDER BY display_order
    """)).all()
    reviewed_demo = (
        old_ids == {1}
        and len(demo_subjects) == 1
        and tuple(demo_subjects[0]) == (1, "Mathematics", "MATHEMATICS", None, "1")
        and [(row.component_name, float(row.weight), row.display_order) for row in demo_components] == [
            ("Written Works", 20.0, 1),
            ("Performance Tasks", 50.0, 2),
            ("Examination", 30.0, 3),
        ]
        and conn.execute(text("SELECT count(*) FROM subject_groups")).scalar_one() == 0
    )
    if old_ids not in (expected, set()) and not reviewed_demo:
        raise RuntimeError(f"Unexpected grading template IDs: {sorted(old_ids)}")
    subject_count = conn.execute(text("SELECT count(*) FROM subject")).scalar_one()

    op.add_column("grading_template", sa.Column("passing_threshold", sa.Numeric(5, 2), nullable=True))
    op.add_column("subject", sa.Column("grading_template_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_subject_grading_template_id", "subject", "grading_template",
        ["grading_template_id"], ["grading_template_id"], ondelete="RESTRICT",
    )

    if old_ids == expected:
        # All reviewed subjects are mapped by existing template ID, except
        # the four explicitly approved exceptions from Enhanced and Other.
        conn.execute(text("""
            UPDATE subject SET grading_template_id = CASE
              WHEN subject_id = 53 THEN 8
              WHEN subject_id = 1 THEN 1
              WHEN subject_id IN (46, 47) THEN 8
              WHEN default_grading_template IN ('1','2','3','4','7') THEN 1
              WHEN default_grading_template IN ('8','9') THEN 8
              WHEN default_grading_template = '10' THEN 10
              ELSE NULL END
        """))
        counts = dict(conn.execute(text("""
            SELECT grading_template_id, count(*) FROM subject
            GROUP BY grading_template_id
        """)).all())
        if counts != {1: 28, 8: 11, 10: 1}:
            raise RuntimeError(f"Subject assignment counts differ from approved 28/1/11: {counts}")
        conn.execute(text("DELETE FROM grading_template WHERE grading_template_id NOT IN (1,8,10)"))
    elif reviewed_demo:
        conn.execute(text("UPDATE subject SET grading_template_id = 1 WHERE subject_id = 1"))
        for template_id, name in ((8, names[2]), (10, names[1])):
            conn.execute(text("""
                INSERT INTO grading_template (grading_template_id, template_name, status)
                VALUES (:id, :name, 'active')
            """), {"id": template_id, "name": name})
        conn.execute(text("""
            SELECT setval(pg_get_serial_sequence('grading_template','grading_template_id'),
                          (SELECT max(grading_template_id) FROM grading_template))
        """))
    else:
        for template_id, name in ((1, names[0]), (10, names[1]), (8, names[2])):
            exists = conn.execute(
                text("SELECT count(*) FROM grading_template WHERE grading_template_id = :id"),
                {"id": template_id},
            ).scalar_one() > 0
            if not exists:
                conn.execute(text("""
                    INSERT INTO grading_template (grading_template_id, template_name, status)
                    VALUES (:id, :name, 'active')
                """), {"id": template_id, "name": name})
            else:
                conn.execute(text("""
                    UPDATE grading_template SET template_name = :name, status = 'active'
                    WHERE grading_template_id = :id
                """), {"id": template_id, "name": name})

        conn.execute(text("""
            SELECT setval(pg_get_serial_sequence('grading_template','grading_template_id'),
                          COALESCE((SELECT max(grading_template_id) FROM grading_template), 1))
        """))

        # Map existing subjects to a valid template (default to 1 'Core')
        has_default_gt = conn.execute(text("""
            SELECT count(*) FROM information_schema.columns 
            WHERE table_name = 'subject' AND column_name = 'default_grading_template'
        """)).scalar_one() > 0
        if has_default_gt:
            conn.execute(text("""
                UPDATE subject SET grading_template_id = CASE
                  WHEN default_grading_template = '10' THEN 10
                  WHEN default_grading_template IN ('8','9') THEN 8
                  ELSE 1 END
            """))
        else:
            conn.execute(text("UPDATE subject SET grading_template_id = 1 WHERE grading_template_id IS NULL"))

        conn.execute(text("DELETE FROM grading_template WHERE grading_template_id NOT IN (1,8,10)"))

    for template_id, name, threshold, weights in (
        (1, "Core", 87, (20, 50, 30)),
        (10, "Applied", 85, (20, 60, 20)),
        (8, "Specialized", 85, (20, 50, 30)),
    ):
        conn.execute(text("""
            UPDATE grading_template SET template_name=:name,
              passing_threshold=:threshold, status='active',
              academic_level_id=NULL, subject_id=NULL, updated_at=now()
            WHERE grading_template_id=:id
        """), {"id": template_id, "name": name, "threshold": threshold})
        conn.execute(text("DELETE FROM grading_template_component WHERE grading_template_id=:id"), {"id": template_id})
        for order, (component, weight) in enumerate(zip(
            ("Written Work", "Performance Tasks", "Exams"), weights,
        ), start=1):
            conn.execute(text("""
                INSERT INTO grading_template_component
                  (grading_template_id, component_name, weight, display_order)
                VALUES (:id, :component, :weight, :position)
            """), {"id": template_id, "component": component, "weight": weight, "position": order})

    op.alter_column("grading_template", "passing_threshold", nullable=False)
    op.alter_column("subject", "grading_template_id", nullable=False)
    op.create_check_constraint(
        "ck_grading_template_passing_threshold", "grading_template",
        "passing_threshold >= 0 AND passing_threshold <= 100",
    )
    op.create_unique_constraint("uq_grading_template_name", "grading_template", ["template_name"])
    op.drop_constraint("fk_grading_template_subject_group_id", "grading_template", type_="foreignkey")
    op.drop_column("grading_template", "subject_group_id")
    op.drop_index("ix_grading_template_academic_level_id", table_name="grading_template")
    op.drop_index("ix_grading_template_subject_id", table_name="grading_template")
    op.drop_constraint("grading_template_academic_level_id_fkey", "grading_template", type_="foreignkey")
    op.drop_constraint("grading_template_subject_id_fkey", "grading_template", type_="foreignkey")
    op.drop_column("grading_template", "academic_level_id")
    op.drop_column("grading_template", "subject_id")
    if reviewed_demo:
        op.drop_constraint("subject_subject_group_id_fkey", "subject", type_="foreignkey")
    else:
        op.drop_constraint("fk_subject_subject_group_id", "subject", type_="foreignkey")
    op.drop_column("subject", "subject_group_id")
    op.drop_column("subject", "subject_group")
    op.drop_column("subject", "default_grading_template")
    op.drop_table("subject_groups")


def downgrade() -> None:
    raise RuntimeError(
        "This data consolidation cannot reconstruct the twelve source templates. "
        "Restore the verified pre-three-templates PostgreSQL backup instead."
    )
