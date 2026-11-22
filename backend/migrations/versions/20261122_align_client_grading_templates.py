"""Align JHS default grading templates and subject mappings with client-approved weights.

Revision ID: 20261122_client_grading_templates
Revises: cfa32ed6db83
Create Date: 2026-11-22

Client-approved JHS grading weights:
- English, Filipino, Mathematics, Science, Araling Panlipunan (AP), and
  GMRC / Values Education (VE): 20% Written Work, 50% Performance Tasks, 30% Exams (Core).
- EPP / TLE and MAPEH: 20% Written Work, 60% Performance Tasks, 20% Exams (EPP / TLE & MAPEH).

SHS configurations (Applied, Specialized, Core) and all 85% passing thresholds are preserved.
Historical grades, finalized assessments, and referenced templates are never modified or deleted.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision: str = "20261122_client_grading_templates"
down_revision: Union[str, Sequence[str], None] = "cfa32ed6db83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EPP_TLE_MAPEH_NAME = "EPP / TLE & MAPEH"
EPP_TLE_MAPEH_FAMILY = "template-epp-tle-mapeh"
EPP_TLE_MAPEH_DESC = "Junior High School EPP / TLE and MAPEH subjects"
EPP_TLE_MAPEH_COMPONENTS = (
    ("Written Work", Decimal("20.00"), 1),
    ("Performance Tasks", Decimal("60.00"), 2),
    ("Exams", Decimal("20.00"), 3),
)

_EPP_TLE_MAPEH_RE = re.compile(
    r"(?:^|[^a-z])(?:epp|tle|mapeh)(?:[0-9]*)(?:$|[^a-z])"
    r"|edukasyong\s+pantahanan"
    r"|technology\s+and\s+livelihood\s+education"
    r"|music,?\s*arts,?\s*physical\s+education",
    re.IGNORECASE,
)

_JHS_CORE_CLIENT_RE = re.compile(
    r"(?:^|[^a-z])(?:eng|english|fil|filipino|math|mathematics|enmath|sci|science|ensci|ap|gmrc|valed)(?:[0-9]*)(?:$|[^a-z])"
    r"|araling\s+panlipunan"
    r"|good\s+manners\s+and\s+right\s+conduct"
    r"|values\s+education",
    re.IGNORECASE,
)

_REDUNDANT_DUPLICATE_NAMES = frozenset({"learning are", "learning area"})
_CANONICAL_NAMES = frozenset({"core", "applied", "specialized", EPP_TLE_MAPEH_NAME.casefold()})


def _matches_epp_tle_mapeh(subject_name: str | None, subject_codename: str | None) -> bool:
    for value in (subject_name or "", subject_codename or ""):
        if value and _EPP_TLE_MAPEH_RE.search(value):
            return True
    return False


def _matches_jhs_client_core(subject_name: str | None, subject_codename: str | None) -> bool:
    if _matches_epp_tle_mapeh(subject_name, subject_codename):
        return False
    for value in (subject_name or "", subject_codename or ""):
        if value and _JHS_CORE_CLIENT_RE.search(value):
            return True
    return False


def _get_template_weights(conn, template_id: int) -> dict[str, Decimal]:
    rows = conn.execute(
        text(
            """
            SELECT component_name, weight
            FROM grading_template_component
            WHERE grading_template_id = :tid
            ORDER BY display_order
            """
        ),
        {"tid": template_id},
    ).all()
    return {str(name): Decimal(str(weight)).quantize(Decimal("0.01")) for name, weight in rows}


def _subject_has_recorded_grades(conn, subject_id: int) -> bool:
    if conn.execute(
        text("SELECT 1 FROM student_period_grade WHERE subject_id = :sid LIMIT 1"),
        {"sid": subject_id},
    ).first():
        return True
    if conn.execute(
        text("SELECT 1 FROM grade_submission_log WHERE subject_id = :sid LIMIT 1"),
        {"sid": subject_id},
    ).first():
        return True
    if conn.execute(
        text(
            """
            SELECT 1
            FROM student_submission ss
            JOIN classwork_assignment ca ON ca.classwork_assignment_id = ss.classwork_assignment_id
            JOIN classwork c ON c.classwork_id = ca.classwork_id
            WHERE c.subject_id = :sid
              AND ss.grade IS NOT NULL
            LIMIT 1
            """
        ),
        {"sid": subject_id},
    ).first():
        return True
    return False


def _subject_year_has_evidence(conn, subject_id: int, academic_year_id: int) -> bool:
    if conn.execute(
        text(
            """
            SELECT 1
            FROM classwork_assignment ca
            JOIN classwork c ON c.classwork_id = ca.classwork_id
            LEFT JOIN academic_period ap ON ap.academic_period_id = ca.academic_period_id
            LEFT JOIN class cl ON cl.class_id = ca.class_id
            WHERE c.subject_id = :sid
              AND (
                  ap.academic_year_id = :yid
                  OR (ca.academic_period_id IS NULL AND cl.academic_year_id = :yid)
              )
            LIMIT 1
            """
        ),
        {"sid": subject_id, "yid": academic_year_id},
    ).first():
        return True
    if conn.execute(
        text(
            """
            SELECT 1
            FROM student_period_grade spg
            JOIN academic_period ap ON ap.academic_period_id = spg.academic_period_id
            WHERE spg.subject_id = :sid AND ap.academic_year_id = :yid
            LIMIT 1
            """
        ),
        {"sid": subject_id, "yid": academic_year_id},
    ).first():
        return True
    if conn.execute(
        text(
            """
            SELECT 1
            FROM grade_submission_log gsl
            JOIN academic_period ap ON ap.academic_period_id = gsl.academic_period_id
            WHERE gsl.subject_id = :sid AND ap.academic_year_id = :yid
            LIMIT 1
            """
        ),
        {"sid": subject_id, "yid": academic_year_id},
    ).first():
        return True
    if conn.execute(
        text(
            """
            SELECT 1
            FROM assessment_item ai
            JOIN academic_period ap ON ap.academic_period_id = ai.academic_period_id
            WHERE ai.subject_id = :sid AND ap.academic_year_id = :yid
            LIMIT 1
            """
        ),
        {"sid": subject_id, "yid": academic_year_id},
    ).first():
        return True
    return False


def _template_historical_reference_count(conn, template_id: int) -> int:
    queries = (
        "SELECT COUNT(*) FROM student_period_grade WHERE applied_grading_template_id = :tid",
        "SELECT COUNT(*) FROM grade_submission_log WHERE applied_grading_template_id = :tid",
        "SELECT COUNT(*) FROM passing_policy_audit WHERE grading_template_id = :tid",
        "SELECT COUNT(*) FROM grading_template WHERE supersedes_template_id = :tid",
    )
    return sum(int(conn.execute(text(q), {"tid": template_id}).scalar_one()) for q in queries)


def _template_reference_count(conn, template_id: int) -> int:
    queries = (
        "SELECT COUNT(*) FROM subject WHERE grading_template_id = :tid",
        "SELECT COUNT(*) FROM subject_year_grading_template WHERE grading_template_id = :tid",
        "SELECT COUNT(*) FROM subject_period_grading_template WHERE grading_template_id = :tid",
    )
    return _template_historical_reference_count(conn, template_id) + sum(
        int(conn.execute(text(q), {"tid": template_id}).scalar_one()) for q in queries
    )


def _sync_postgres_sequence(conn, table_name: str, column_name: str) -> None:
    if conn.dialect.name != "postgresql":
        return
    conn.execute(
        text(
            f"""
            SELECT setval(
                pg_get_serial_sequence('{table_name}', '{column_name}'),
                COALESCE((SELECT MAX({column_name}) FROM {table_name}), 1),
                (SELECT COUNT(*) > 0 FROM {table_name})
            )
            """
        )
    )


def _ensure_epp_tle_mapeh_template(conn) -> int:
    existing = conn.execute(
        text(
            """
            SELECT grading_template_id
            FROM grading_template
            WHERE template_family_code = :family
               OR LOWER(TRIM(template_name)) = :name_lower
            ORDER BY grading_template_id
            LIMIT 1
            """
        ),
        {"family": EPP_TLE_MAPEH_FAMILY, "name_lower": EPP_TLE_MAPEH_NAME.casefold()},
    ).scalar_one_or_none()

    if existing is not None:
        return int(existing)

    _sync_postgres_sequence(conn, "grading_template", "grading_template_id")
    template_id = conn.execute(
        text(
            """
            INSERT INTO grading_template (
                template_name,
                template_family_code,
                revision,
                passing_threshold,
                description,
                status,
                created_at,
                updated_at
            )
            VALUES (
                :name,
                :family,
                1,
                85.00,
                :description,
                'active',
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            RETURNING grading_template_id
            """
        ),
        {
            "name": EPP_TLE_MAPEH_NAME,
            "family": EPP_TLE_MAPEH_FAMILY,
            "description": EPP_TLE_MAPEH_DESC,
        },
    ).scalar_one()

    _sync_postgres_sequence(conn, "grading_template_component", "component_id")
    for comp_name, weight, display_order in EPP_TLE_MAPEH_COMPONENTS:
        conn.execute(
            text(
                """
                INSERT INTO grading_template_component (
                    grading_template_id,
                    component_name,
                    weight,
                    display_order,
                    created_at,
                    updated_at
                )
                VALUES (
                    :tid,
                    :cname,
                    :weight,
                    :display_order,
                    CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "tid": template_id,
                "cname": comp_name,
                "weight": float(weight),
                "display_order": display_order,
            },
        )
    return int(template_id)


def apply_client_grading_templates(conn) -> None:
    """Idempotent data alignment for client-approved JHS grading templates."""
    epp_template_id = _ensure_epp_tle_mapeh_template(conn)

    # 1. Reassign eligible JHS (Grade <= 10) EPP/TLE and MAPEH subjects to EPP / TLE & MAPEH (20/60/20)
    jhs_subjects = conn.execute(
        text(
            """
            SELECT s.subject_id, s.subject_name, s.subject_codename, s.grading_template_id
            FROM subject s
            JOIN academic_level al ON al.academic_level_id = s.academic_level_id
            WHERE al.grade_level <= 10
            ORDER BY s.subject_id
            """
        )
    ).mappings().all()

    for subj in jhs_subjects:
        sid = int(subj["subject_id"])
        if not _matches_epp_tle_mapeh(subj["subject_name"], subj["subject_codename"]):
            continue
        if int(subj["grading_template_id"]) != epp_template_id:
            if not _subject_has_recorded_grades(conn, sid):
                conn.execute(
                    text(
                        """
                        UPDATE subject
                        SET grading_template_id = :tid,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE subject_id = :sid
                        """
                    ),
                    {"tid": epp_template_id, "sid": sid},
                )
        # Clean up any un-evidenced year override pointing elsewhere for this EPP/TLE/MAPEH subject
        sygt_rows = conn.execute(
            text(
                """
                SELECT subject_year_grading_template_id, academic_year_id, grading_template_id
                FROM subject_year_grading_template
                WHERE subject_id = :sid AND grading_template_id <> :tid
                """
            ),
            {"sid": sid, "tid": epp_template_id},
        ).mappings().all()
        for row in sygt_rows:
            if not _subject_year_has_evidence(conn, sid, int(row["academic_year_id"])):
                conn.execute(
                    text(
                        "DELETE FROM subject_year_grading_template WHERE subject_year_grading_template_id = :id"
                    ),
                    {"id": int(row["subject_year_grading_template_id"])},
                )

    # 2. Remove erroneous un-evidenced year overrides on JHS client-Core subjects
    core_template_id = conn.execute(
        text(
            """
            SELECT grading_template_id
            FROM grading_template
            WHERE LOWER(TRIM(template_name)) = 'core' AND status = 'active'
            ORDER BY revision DESC, grading_template_id ASC
            LIMIT 1
            """
        )
    ).scalar_one_or_none()

    if core_template_id is not None:
        core_weights = _get_template_weights(conn, int(core_template_id))
        expected_core_weights = {
            "Written Work": Decimal("20.00"),
            "Performance Tasks": Decimal("50.00"),
            "Exams": Decimal("30.00"),
        }
        if core_weights == expected_core_weights:
            mismatched_overrides = conn.execute(
                text(
                    """
                    SELECT sy.subject_year_grading_template_id,
                           sy.subject_id,
                           sy.academic_year_id,
                           sy.grading_template_id,
                           s.subject_name,
                           s.subject_codename,
                           s.grading_template_id AS catalog_template_id
                    FROM subject_year_grading_template sy
                    JOIN subject s ON s.subject_id = sy.subject_id
                    JOIN academic_level al ON al.academic_level_id = s.academic_level_id
                    WHERE al.grade_level <= 10
                      AND s.grading_template_id = :core_id
                      AND sy.grading_template_id <> :core_id
                    ORDER BY sy.subject_year_grading_template_id
                    """
                ),
                {"core_id": int(core_template_id)},
            ).mappings().all()

            for ov in mismatched_overrides:
                if not _matches_jhs_client_core(ov["subject_name"], ov["subject_codename"]):
                    continue
                override_weights = _get_template_weights(conn, int(ov["grading_template_id"]))
                if override_weights == expected_core_weights:
                    continue
                if not _subject_year_has_evidence(conn, int(ov["subject_id"]), int(ov["academic_year_id"])):
                    conn.execute(
                        text(
                            "DELETE FROM subject_year_grading_template WHERE subject_year_grading_template_id = :id"
                        ),
                        {"id": int(ov["subject_year_grading_template_id"])},
                    )

        # 3. Consolidate & delete redundant duplicate templates (e.g., typo 'Learning Are')
        #    ONLY when weights + passing_threshold are identical to Core AND zero historical
        #    snapshots/audits/revision links reference the duplicate template.
        core_threshold = Decimal(
            str(
                conn.execute(
                    text("SELECT passing_threshold FROM grading_template WHERE grading_template_id = :cid"),
                    {"cid": int(core_template_id)},
                ).scalar_one()
            )
        ).quantize(Decimal("0.01"))
        candidates = conn.execute(
            text(
                """
                SELECT grading_template_id, template_name, passing_threshold
                FROM grading_template
                ORDER BY grading_template_id
                """
            )
        ).mappings().all()
        for tpl in candidates:
            tid = int(tpl["grading_template_id"])
            normalized_name = (tpl["template_name"] or "").strip().casefold()
            if normalized_name in _CANONICAL_NAMES:
                continue
            if normalized_name not in _REDUNDANT_DUPLICATE_NAMES:
                continue
            tpl_threshold = Decimal(str(tpl["passing_threshold"])).quantize(Decimal("0.01"))
            if tpl_threshold != core_threshold:
                continue
            if _get_template_weights(conn, tid) != expected_core_weights:
                continue
            if _template_historical_reference_count(conn, tid) > 0:
                continue

            # Safe equivalence consolidation: weights & passing threshold are identical to Core.
            conn.execute(
                text(
                    """
                    UPDATE subject
                    SET grading_template_id = :core_id,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE grading_template_id = :dup_id
                    """
                ),
                {"core_id": int(core_template_id), "dup_id": tid},
            )
            conn.execute(
                text(
                    """
                    UPDATE subject_year_grading_template
                    SET grading_template_id = :core_id,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE grading_template_id = :dup_id
                    """
                ),
                {"core_id": int(core_template_id), "dup_id": tid},
            )
            conn.execute(
                text(
                    """
                    UPDATE subject_period_grading_template
                    SET grading_template_id = :core_id,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE grading_template_id = :dup_id
                    """
                ),
                {"core_id": int(core_template_id), "dup_id": tid},
            )
            if _template_reference_count(conn, tid) == 0:
                conn.execute(
                    text("DELETE FROM grading_template WHERE grading_template_id = :tid"),
                    {"tid": tid},
                )


def upgrade() -> None:
    conn = op.get_bind()
    apply_client_grading_templates(conn)


def downgrade() -> None:
    conn = op.get_bind()
    epp_id = conn.execute(
        text(
            """
            SELECT grading_template_id
            FROM grading_template
            WHERE template_family_code = :family
            LIMIT 1
            """
        ),
        {"family": EPP_TLE_MAPEH_FAMILY},
    ).scalar_one_or_none()
    if epp_id is None:
        return
    if _template_reference_count(conn, int(epp_id)) > 0:
        raise RuntimeError(
            "Cannot downgrade client grading template alignment while 'EPP / TLE & MAPEH' "
            "is referenced by subjects or historical records. Restore the pre-migration backup instead."
        )
    conn.execute(
        text("DELETE FROM grading_template WHERE grading_template_id = :tid"),
        {"tid": int(epp_id)},
    )
