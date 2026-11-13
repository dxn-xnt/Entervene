"""Verify the classwork link revision against an isolated in-memory database."""

from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_reference_link_revision_preserves_existing_classwork_and_downgrades(monkeypatch):
    revision = import_module("migrations.versions.20261112_classwork_refs")
    engine = sa.create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE classwork (classwork_id INTEGER PRIMARY KEY, title VARCHAR(255))")
            connection.exec_driver_sql("INSERT INTO classwork VALUES (7, 'Existing')")
            monkeypatch.setattr(revision, "op", Operations(MigrationContext.configure(connection)))
            revision.upgrade()
            columns = {column["name"] for column in sa.inspect(connection).get_columns("classwork_reference_link")}
            assert columns == {"classwork_reference_link_id", "classwork_id", "url", "title", "position"}
            connection.exec_driver_sql("INSERT INTO classwork_reference_link (classwork_id, url, position) VALUES (7, 'https://example.test/', 0)")
            assert connection.exec_driver_sql("SELECT COUNT(*) FROM classwork_reference_link").scalar_one() == 1
            assert connection.exec_driver_sql("SELECT title FROM classwork WHERE classwork_id=7").scalar_one() == "Existing"
            revision.downgrade()
            assert "classwork_reference_link" not in sa.inspect(connection).get_table_names()
            assert connection.exec_driver_sql("SELECT title FROM classwork WHERE classwork_id=7").scalar_one() == "Existing"
    finally:
        engine.dispose()
