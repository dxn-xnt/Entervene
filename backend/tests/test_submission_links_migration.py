"""Exercise the new revision against an isolated in-memory database."""

from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_submission_link_revision_preserves_existing_submission_on_upgrade_and_downgrade(monkeypatch):
    revision = import_module("migrations.versions.20261112_submission_links")
    engine = sa.create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE student_submission (submission_id INTEGER PRIMARY KEY, status VARCHAR(30))")
            connection.exec_driver_sql("INSERT INTO student_submission VALUES (7, 'submitted')")
            monkeypatch.setattr(revision, "op", Operations(MigrationContext.configure(connection)))
            revision.upgrade()
            columns = {column["name"] for column in sa.inspect(connection).get_columns("submission_link")}
            assert columns == {"submission_link_id", "submission_id", "url", "title", "position"}
            connection.exec_driver_sql(
                "INSERT INTO submission_link (submission_id, url, title, position) "
                "VALUES (7, 'https://example.com/work', NULL, 0)"
            )
            assert connection.exec_driver_sql("SELECT COUNT(*) FROM submission_link").scalar_one() == 1
            assert connection.exec_driver_sql("SELECT status FROM student_submission WHERE submission_id=7").scalar_one() == "submitted"
            revision.downgrade()
            assert "submission_link" not in sa.inspect(connection).get_table_names()
            assert connection.exec_driver_sql("SELECT status FROM student_submission WHERE submission_id=7").scalar_one() == "submitted"
    finally:
        engine.dispose()
