import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from sqlalchemy import UniqueConstraint

import app.models  # noqa: F401
from app.models.academic.Class_ import Class


MIGRATION_PATH = (
    Path(__file__).parents[1]
    / "migrations"
    / "versions"
    / "20260606_class_adviser_academic_year_integrity.py"
)


def load_migration_module():
    spec = importlib.util.spec_from_file_location("class_adviser_year_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_class_orm_declares_adviser_year_uniqueness():
    unique_column_sets = {
        tuple(constraint.columns.keys())
        for constraint in Class.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert ("adviser_staff_id", "academic_year_id") in unique_column_sets


def test_migration_reports_duplicate_adviser_year_assignments():
    migration = load_migration_module()
    bind = Mock()
    bind.execute.return_value.fetchall.return_value = [
        SimpleNamespace(
            adviser_staff_id="T-1",
            academic_year_id=7,
            class_ids=[10, 11],
            section_names=["Aristotle", "Galileo"],
        )
    ]

    try:
        migration._validate_no_duplicate_adviser_years(bind)
        assert False, "Expected duplicate adviser-year assignments to stop the migration."
    except RuntimeError as error:
        message = str(error)
        assert "adviser_staff_id=T-1" in message
        assert "academic_year_id=7" in message
        assert "conflicting class_ids=[10, 11]" in message
        assert "conflicting section_names=['Aristotle', 'Galileo']" in message
