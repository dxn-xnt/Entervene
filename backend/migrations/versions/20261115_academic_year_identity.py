"""Deduplicate academic years and enforce one row per school-year start.

Revision ID: 20261115_academic_year_identity
Revises: 20261114_offering_duration
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

from alembic import op
import sqlalchemy as sa


revision = "20261115_academic_year_identity"
down_revision = "20261114_offering_duration"
branch_labels = None
depends_on = None


def _academic_year_references(bind: sa.engine.Connection) -> list[tuple[str, str]]:
    inspector = sa.inspect(bind)
    references: list[tuple[str, str]] = []
    for table_name in inspector.get_table_names():
        for foreign_key in inspector.get_foreign_keys(table_name):
            if (
                foreign_key.get("referred_table") == "academic_year"
                and foreign_key.get("referred_columns") == ["academic_year_id"]
            ):
                columns = foreign_key.get("constrained_columns") or []
                if len(columns) == 1:
                    references.append((table_name, columns[0]))
    return references


def _reference_count(
    bind: sa.engine.Connection,
    references: list[tuple[str, str]],
    academic_year_id: int,
) -> int:
    preparer = bind.dialect.identifier_preparer
    total = 0
    for table_name, column_name in references:
        table = preparer.quote(table_name)
        column = preparer.quote(column_name)
        total += int(
            bind.execute(
                sa.text(f"SELECT count(*) FROM {table} WHERE {column} = :year_id"),
                {"year_id": academic_year_id},
            ).scalar_one()
        )
    return total


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text("LOCK TABLE academic_year IN ACCESS EXCLUSIVE MODE"))

    rows = bind.execute(
        sa.text(
            """
            SELECT academic_year_id, year_label, start_date, end_date, is_active
            FROM academic_year
            ORDER BY academic_year_id
            """
        )
    ).mappings().all()

    by_start_year: dict[int, list[sa.RowMapping]] = defaultdict(list)
    for row in rows:
        start_date = row["start_date"]
        if isinstance(start_date, date):
            by_start_year[start_date.year].append(row)

    references = _academic_year_references(bind)
    for start_year, duplicates in sorted(by_start_year.items()):
        if len(duplicates) < 2:
            continue

        counts = {
            int(row["academic_year_id"]): _reference_count(
                bind, references, int(row["academic_year_id"])
            )
            for row in duplicates
        }
        referenced = [row for row in duplicates if counts[int(row["academic_year_id"])] > 0]
        if len(referenced) > 1:
            detail = ", ".join(
                f"id={row['academic_year_id']} references={counts[int(row['academic_year_id'])]}"
                for row in referenced
            )
            raise RuntimeError(
                "Cannot safely merge academic-year duplicates because more than one row "
                f"for {start_year}-{start_year + 1} contains dependent data: {detail}"
            )

        survivor = (
            referenced[0]
            if referenced
            else next((row for row in duplicates if row["is_active"]), duplicates[0])
        )
        survivor_id = int(survivor["academic_year_id"])
        was_active = any(bool(row["is_active"]) for row in duplicates)

        for row in duplicates:
            duplicate_id = int(row["academic_year_id"])
            if duplicate_id == survivor_id:
                continue
            if counts[duplicate_id] != 0:
                raise RuntimeError(
                    f"Refusing to delete referenced academic_year id={duplicate_id}."
                )
            bind.execute(
                sa.text("DELETE FROM academic_year WHERE academic_year_id = :year_id"),
                {"year_id": duplicate_id},
            )

        bind.execute(
            sa.text(
                """
                UPDATE academic_year
                SET year_label = :canonical_label,
                    is_active = :was_active
                WHERE academic_year_id = :year_id
                """
            ),
            {
                "canonical_label": f"{start_year}-{start_year + 1}",
                "was_active": was_active,
                "year_id": survivor_id,
            },
        )

    duplicate_labels = bind.execute(
        sa.text(
            """
            SELECT lower(btrim(year_label)) AS normalized_label, count(*) AS row_count
            FROM academic_year
            GROUP BY lower(btrim(year_label))
            HAVING count(*) > 1
            """
        )
    ).mappings().all()
    if duplicate_labels:
        raise RuntimeError(
            "Academic-year labels remain duplicated after safe cleanup: "
            + ", ".join(str(row["normalized_label"]) for row in duplicate_labels)
        )

    op.create_unique_constraint(
        "uq_academic_year_year_label", "academic_year", ["year_label"]
    )
    op.create_index(
        "uq_academic_year_start_year",
        "academic_year",
        [sa.text("EXTRACT(YEAR FROM start_date)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_academic_year_start_year", table_name="academic_year")
    op.drop_constraint(
        "uq_academic_year_year_label", "academic_year", type_="unique"
    )
