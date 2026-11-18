"""Reusable database sequence reconciliation helper for PostgreSQL in Entervene.

Ensures all sequence generators are synchronized beyond existing primary keys
after explicit-ID seeding, restoring, or manual data population.
"""

from __future__ import annotations

import logging
from typing import Any, Union
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Advisory lock key: 'ENTR', 'SEQU' (ASCII values: 0x454E5452, 0x53455155)
ADVISORY_LOCK_KEY1 = 0x454E5452
ADVISORY_LOCK_KEY2 = 0x53455155


def reconcile_database_sequences(
    target: Union[Session, Connection, Engine, str],
    schema: str = "public",
) -> list[dict[str, Any]]:
    """Reconciles all PostgreSQL serial/identity sequences in the specified schema.

    Requirements:
    - Never resets a sequence backward into existing values.
    - Accurately inspects sequence ownership using `pg_get_serial_sequence`.
    - Handles both empty and populated tables safely.
    - Prevents concurrent adjustments via PostgreSQL transaction advisory lock.
    - Idempotent and safe for repeated execution.
    """
    if isinstance(target, Session):
        connection = target.connection()
        return _execute_reconciliation(connection, schema)
    elif isinstance(target, Connection):
        return _execute_reconciliation(target, schema)
    elif isinstance(target, Engine):
        with target.begin() as conn:
            return _execute_reconciliation(conn, schema)
    elif isinstance(target, str):
        from sqlalchemy import create_engine
        engine = create_engine(target)
        try:
            with engine.begin() as conn:
                return _execute_reconciliation(conn, schema)
        finally:
            engine.dispose()
    else:
        raise TypeError(f"Unsupported target type for sequence reconciliation: {type(target)}")


def _execute_reconciliation(conn: Connection, schema: str) -> list[dict[str, Any]]:
    # Acquire transaction advisory lock to prevent concurrent sequence operations
    conn.execute(
        text("SELECT pg_advisory_xact_lock(:k1, :k2);"),
        {"k1": ADVISORY_LOCK_KEY1, "k2": ADVISORY_LOCK_KEY2},
    )

    # Discover all columns with an owning sequence in the target schema
    discovery_query = text("""
        SELECT
            t.table_schema,
            t.table_name,
            c.column_name,
            pg_get_serial_sequence('"' || t.table_schema || '"."' || t.table_name || '"', c.column_name) AS seq_name
        FROM information_schema.tables t
        JOIN information_schema.columns c
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE t.table_schema = :schema
          AND t.table_type = 'BASE TABLE'
          AND pg_get_serial_sequence('"' || t.table_schema || '"."' || t.table_name || '"', c.column_name) IS NOT NULL
        ORDER BY t.table_name, c.column_name;
    """)

    results = conn.execute(discovery_query, {"schema": schema}).fetchall()
    reconciled_details: list[dict[str, Any]] = []

    for row in results:
        table_schema, table_name, column_name, seq_name = row

        # 1. Inspect table max value
        max_id_query = text(f'SELECT COALESCE(MAX("{column_name}"), 0) FROM "{table_schema}"."{table_name}";')
        max_id = conn.execute(max_id_query).scalar() or 0

        # 2. Inspect sequence state
        seq_state_query = text(f"SELECT last_value, is_called FROM {seq_name};")
        seq_state = conn.execute(seq_state_query).fetchone()
        if not seq_state:
            continue
        last_value, is_called = seq_state

        # 3. Inspect sequence parameters from pg_sequences
        seq_short_name = seq_name.split(".")[-1].replace('"', '')
        meta_query = text("""
            SELECT increment_by, min_value, max_value, start_value
            FROM pg_sequences
            WHERE schemaname = :schema AND sequencename = :seq_name;
        """)
        meta_row = conn.execute(meta_query, {"schema": table_schema, "seq_name": seq_short_name}).fetchone()
        inc = meta_row[0] if meta_row else 1
        min_val = meta_row[1] if meta_row else 1

        next_val = last_value if not is_called else last_value + inc

        detail: dict[str, Any] = {
            "table_schema": table_schema,
            "table_name": table_name,
            "column_name": column_name,
            "sequence_name": seq_name,
            "max_id": max_id,
            "before_last_value": last_value,
            "before_is_called": is_called,
            "before_nextval": next_val,
            "increment_by": inc,
            "min_value": min_val,
        }

        if max_id > 0:
            if next_val <= max_id:
                # Sequence will produce a collision. Advance safely to max_id with is_called = True
                setval_query = text(f"SELECT setval('{seq_name}', :max_val, true);")
                conn.execute(setval_query, {"max_val": max_id})
                detail["action"] = "reconciled"
                detail["after_last_value"] = max_id
                detail["after_is_called"] = True
                detail["after_nextval"] = max_id + inc
                logger.info(
                    f"Reconciled sequence {seq_name} for {table_name}.{column_name}: "
                    f"max_id={max_id}, nextval was {next_val} -> now {max_id + inc}"
                )
            else:
                detail["action"] = "already_synchronized"
                detail["after_last_value"] = last_value
                detail["after_is_called"] = is_called
                detail["after_nextval"] = next_val
        else:
            # Empty table
            if is_called or last_value != min_val:
                # Table is empty but sequence has been advanced.
                # Safe to leave if last_value >= min_val or reset to min_val if start_value
                detail["action"] = "empty_table_preserved"
                detail["after_last_value"] = last_value
                detail["after_is_called"] = is_called
                detail["after_nextval"] = next_val
            else:
                detail["action"] = "empty_table_ready"
                detail["after_last_value"] = last_value
                detail["after_is_called"] = is_called
                detail["after_nextval"] = next_val

        reconciled_details.append(detail)

    return reconciled_details
