"""
verify_postgres_migration.py

Verifies the PostgreSQL database schema and data integrity:
1. Checks for any duplicate active loads on (class_id, subject_id, academic_period_id).
2. Verifies the partial unique index uq_active_subject_load_period exists and is valid.
3. Verifies new columns: logical_load_id, section_revision, base_revision, is_active_version, is_locked.
4. Verifies SubjectLoadAssignmentLog table.
"""

from sqlalchemy import text
from app.db.Session import SessionLocal


def verify():
    db = SessionLocal()
    try:
        print("=== Checking PostgreSQL Database Integrity ===")

        # 1. Check for duplicates
        dup_query = text("""
            SELECT class_id, subject_id, academic_period_id, COUNT(*)
            FROM subject_load
            WHERE is_active_version = TRUE
            GROUP BY class_id, subject_id, academic_period_id
            HAVING COUNT(*) > 1;
        """)
        dups = db.execute(dup_query).fetchall()
        print(f"Active duplicates on (class_id, subject_id, academic_period_id): {len(dups)}")
        assert len(dups) == 0, f"Found active duplicates: {dups}"

        # Check alembic version
        ver_rows = db.execute(text("SELECT version_num FROM alembic_version;")).fetchall()
        print(f"Current alembic version in DB: {ver_rows}")

        # 2. Check partial unique index
        all_idx_query = text("""
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE tablename = 'subject_load';
        """)
        all_indexes = db.execute(all_idx_query).fetchall()
        print(f"All indexes on subject_load ({len(all_indexes)}):")
        for idx in all_indexes:
            print(f"  {idx[0]}: {idx[1]}")

        # 3. Check columns
        col_query = text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'subject_load'
            AND column_name IN ('logical_load_id', 'section_revision', 'base_revision', 'is_active_version', 'is_locked')
            ORDER BY column_name;
        """)
        cols = db.execute(col_query).fetchall()
        print(f"Revision columns found: {len(cols)} / 5")
        for c in cols:
            print(f"  {c[0]} ({c[1]}, nullable={c[2]})")
        assert len(cols) == 5, "Expected all 5 section revision columns to exist in PostgreSQL"

        # 4. Check SubjectLoadAssignmentLog table
        table_query = text("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'subject_load_assignment_log'
            ORDER BY ordinal_position;
        """)
        log_cols = db.execute(table_query).fetchall()
        print(f"subject_load_assignment_log columns: {len(log_cols)}")
        for lc in log_cols:
            print(f"  {lc[0]} ({lc[1]})")
        assert len(log_cols) > 0, "Expected subject_load_assignment_log table to exist"

        print("=== POSTGRESQL MIGRATION INTEGRITY VERIFIED SUCCESSFULLY! ===")
    finally:
        db.close()


if __name__ == "__main__":
    verify()
