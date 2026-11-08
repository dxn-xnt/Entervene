import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.browser.remediation_fixture import (
    _target,
    seed_20_practice_questions,
    PREFIX,
    PROTECTED_DATABASES,
    SOURCE,
)


def test_target_rejects_missing_or_invalid_database_name():
    with pytest.raises(ValueError, match="Invalid or missing database name"):
        _target({})
    with pytest.raises(ValueError, match="Invalid or missing database name"):
        _target({"database": ""})
    with pytest.raises(ValueError, match="Invalid or missing database name"):
        _target({"database": 123})


def test_target_rejects_protected_databases():
    for db_name in ["entervendb", "postgres", "schooldb", "entervene_demo"]:
        assert db_name in PROTECTED_DATABASES
        with pytest.raises(ValueError, match="Refusing non-disposable or protected"):
            _target({"database": db_name})


def test_target_rejects_names_without_disposable_prefix():
    with pytest.raises(ValueError, match="Refusing non-disposable or protected"):
        _target({"database": "some_other_database_name"})


def test_target_destructive_mode_requires_disposable_flag():
    valid_name = f"{PREFIX}unit_test_safe_123"
    state = {
        "database": valid_name,
        "test_run_id": "test-uuid-1",
        # missing "disposable": True
    }
    with pytest.raises(ValueError, match="lacks 'disposable: true' marker"):
        _target(state, is_destructive=True)


def test_target_destructive_mode_requires_test_run_id():
    valid_name = f"{PREFIX}unit_test_safe_123"
    state = {
        "database": valid_name,
        "disposable": True,
        # missing "test_run_id"
    }
    with pytest.raises(ValueError, match="lacks 'test_run_id' verification"):
        _target(state, is_destructive=True)


def test_target_destructive_mode_blocks_active_dev_database(monkeypatch):
    monkeypatch.delenv("ALLOW_DESTRUCTIVE_FIXTURE_ON_ACTIVE_DEV", raising=False)
    active_db = SOURCE.database
    state = {
        "database": active_db,
        "disposable": True,
        "test_run_id": "test-uuid-1",
    }
    # If active_db happens to start with PREFIX, it should still fail because it matches SOURCE.database
    if active_db.startswith(PREFIX):
        with pytest.raises(RuntimeError, match="currently configured as the active backend database"):
            _target(state, is_destructive=True)


def test_seed_20_practice_questions_refuses_overwrite_when_existing_records_exist(monkeypatch, tmp_path):
    monkeypatch.delenv("ALLOW_FIXTURE_QUESTION_OVERWRITE", raising=False)
    monkeypatch.setenv("ALLOW_DESTRUCTIVE_FIXTURE_ON_ACTIVE_DEV", "true")

    state_file = tmp_path / "test_state.json"
    state_file.write_text(
        '{"database": "' + f"{PREFIX}mock_db" + '", "disposable": true, "test_run_id": "uuid-1", "intervention_id": 1}',
        encoding="utf-8",
    )

    mock_db = MagicMock()
    mock_assessment = MagicMock()
    mock_assessment.practice_assessment_id = 100
    mock_db.query.return_value.filter_by.return_value.first.return_value = mock_assessment
    # Existing questions count = 20
    mock_db.query.return_value.filter_by.return_value.count.return_value = 20

    with patch("tests.browser.remediation_fixture.create_engine") as mock_engine, \
         patch("tests.browser.remediation_fixture.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__.return_value = mock_db

        with pytest.raises(RuntimeError, match="Refusing to overwrite existing Practice Assessment"):
            seed_20_practice_questions(state_file, allow_overwrite=False)


def test_seed_20_practice_questions_permits_overwrite_with_explicit_flag(monkeypatch, tmp_path):
    monkeypatch.delenv("ALLOW_FIXTURE_QUESTION_OVERWRITE", raising=False)
    monkeypatch.setenv("ALLOW_DESTRUCTIVE_FIXTURE_ON_ACTIVE_DEV", "true")

    state_file = tmp_path / "test_state.json"
    state_file.write_text(
        '{"database": "' + f"{PREFIX}mock_db" + '", "disposable": true, "test_run_id": "uuid-1", "intervention_id": 1}',
        encoding="utf-8",
    )

    mock_db = MagicMock()
    mock_assessment = MagicMock()
    mock_assessment.practice_assessment_id = 100
    mock_db.query.return_value.filter_by.return_value.first.return_value = mock_assessment
    mock_db.query.return_value.filter_by.return_value.count.return_value = 20
    mock_db.query.return_value.filter_by.return_value.all.return_value = []

    with patch("tests.browser.remediation_fixture.create_engine") as mock_engine, \
         patch("tests.browser.remediation_fixture.Session") as mock_session_cls:
        mock_session_cls.return_value.__enter__.return_value = mock_db

        # Should NOT raise RuntimeError when allow_overwrite=True
        seed_20_practice_questions(state_file, allow_overwrite=True)
        assert mock_db.commit.called
