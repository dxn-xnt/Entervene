"""Opt-in lesson authorization parity on strictly guarded local PostgreSQL.

Run this file with DASHBOARD_TEST_PG_URL supplied in the process environment.
The existing dashboard guard permits only plain postgresql://, loopback port
55432 and activity_test, with no URL query parameters or libpq routing overrides.
Every live case gets its own generated schema, model-created tables and cleanup.
No app settings/session database is used for PostgreSQL and no env file is read
by this module. Guard/privacy tests and SQLite reference cases need no server.
"""

from contextlib import contextmanager
from unittest.mock import Mock

import pytest

from tests import test_lesson_authorization_lifecycle as lesson_cases
from tests import test_teacher_dashboard_postgres as postgres_guard


# Reuse the tested URL guard, current_database check, original model constraints,
# unique-schema creation/cleanup, and external HTTP prohibition without changing
# the dashboard tests or introducing a second safety policy.
lesson_context = lesson_cases.lesson_context
postgres_dashboard_session = postgres_guard.postgres_dashboard_session
prohibit_external_provider_http = postgres_guard.prohibit_external_provider_http


_CASES = [
    ("owner_read", "test_lesson_detail_follows_access_matrix", {}),
    ("owner_update_and_publish", "test_owner_can_update_and_publish_lesson", {}),
    ("owner_delete", "test_lesson_delete_archives_and_preserves_linked_classwork", {}),
    ("different_section", "test_lesson_detail_blocks_same_subject_different_class_teacher", {}),
    ("ownerless_unassigned", "test_unassigned_ownerless_lesson_has_no_subject_only_read_grant", {}),
    ("ownerless_assigned", "test_ownerless_assigned_lesson_keeps_explicit_load_read_grant", {}),
    ("adviser_not_assigned", "test_adviser_alone_does_not_grant_lesson_detail_access", {}),
    ("primary_during_substitution", "test_primary_teacher_keeps_read_only_class_access_during_substitution", {}),
    ("student_unpublished", "test_student_cannot_access_unpublished_lesson", {}),
    ("private_linked_work", "test_private_lesson_linked_work_cannot_bypass_owner_check", {}),
    ("other_class_linked_work", "test_read_grant_for_another_class_does_not_leak_linked_work", {}),
    ("embedded_private_lesson", "test_readable_classwork_cannot_embed_unassigned_private_lesson", {}),
    ("curated_selection_owner_only", "test_curated_selection_checks_all_item_owners_before_writing", {}),
]
_CASES += [
    (f"read_{reader}", "test_shared_assigned_lesson_reads_remain_available", {"reader": reader})
    for reader in ("assigned_teacher", "substitute")
]
_CASES += [
    (f"writes_denied_{reader}", "_assert_readers_cannot_mutate", {"reader": reader})
    for reader in ("assigned_teacher", "substitute")
]
_CASES += [
    (f"period_{mismatch}", "test_lesson_read_scope_matches_assigned_school_year_and_tagged_period",
     {"period_mismatch": mismatch})
    for mismatch in ("past_year", "different_year", "different_term")
]
_CASES += [
    (f"substitute_{state}", "test_substitution_read_grant_requires_active_current_authority", {"state": state})
    for state in ("future", "expired", "cancelled", "inactive_load")
]
_CASES += [
    (f"substitute_boundary_{boundary}", "test_substitute_date_boundaries_are_inclusive", {"boundary": boundary})
    for boundary in ("start", "end", "same_day")
]
_CASES += [
    (f"unassigned_same_subject_{same_subject}",
     "test_unrelated_teacher_detail_is_indistinguishable_from_missing_id", {"same_subject": same_subject})
    for same_subject in (True, False)
]
_CASES += [
    (f"admin_{restricted}", "test_admin_detail_read_stays_available_without_staff_profile", {"restricted": restricted})
    for restricted in ("unpublished", "archived", "unassigned")
]
_CASES += [
    (f"student_{restricted}", "test_student_visibility_rules_stay_unchanged", {"restricted": restricted})
    for restricted in ("assignment_unpublished", "unenrolled", "archived")
]
_CASES += [
    (f"sibling_read_{reader}", "test_shared_read_policy_covers_sibling_details_and_downloads", {"reader": reader})
    for reader in ("owner", "assigned_teacher", "substitute", "future", "expired", "unassigned", "other_section", "wrong_year")
]
_CASES += [
    (f"sibling_write_{reader}", "test_shared_read_exceptions_cannot_write_sibling_content", {"reader": reader})
    for reader in ("assigned_teacher", "substitute")
]
_CASES += [
    (f"competency_ownerless_{ownerless}", "test_unassigned_competency_has_no_subject_only_legacy_grant", {"ownerless": ownerless})
    for ownerless in (False, True)
]
_CASE_IDS = frozenset(case[0] for case in _CASES)
_PATH_CASES = frozenset({
    "test_readable_classwork_cannot_embed_unassigned_private_lesson",
    "test_curated_selection_checks_all_item_owners_before_writing",
    "test_shared_read_policy_covers_sibling_details_and_downloads",
    "test_shared_read_exceptions_cannot_write_sibling_content",
})
_PATCH_CASES = frozenset({
    "_assert_readers_cannot_mutate",
    "test_curated_selection_checks_all_item_owners_before_writing",
    "test_shared_read_exceptions_cannot_write_sibling_content",
})


def _safe_lesson_failure(case_id, backend, error):
    """No exception text, URLs, credentials, SQL parameters or response bodies."""
    safe_case = case_id if type(case_id) is str and case_id in _CASE_IDS else "unknown"
    safe_backend = backend if type(backend) is str and backend in {"sqlite", "postgres"} else "unknown"
    return postgres_guard._safe_failure(
        f"lesson authorization {safe_backend} assertion or query", error,
    ) + f"; case={safe_case}"


def _assert_readers_cannot_mutate(context, monkeypatch, reader):
    # Establish the genuine read exception once; do not mock authorization.
    lesson_cases.test_shared_assigned_lesson_reads_remain_available(context, reader)
    lesson = context["lesson"]
    before = (lesson.title, lesson.is_archived, lesson.is_published, lesson.is_draft)
    commits = Mock(side_effect=AssertionError("Denied request must not commit"))
    monkeypatch.setattr(context["db"], "commit", commits)
    for method, suffix, body in [
        ("PUT", "", {"title": "Denied edit"}),
        ("PUT", "", {"is_published": False}),
        ("PUT", "", {"is_draft": True}),
        ("DELETE", "", None),
        ("PUT", "/publish", None),
        ("POST", "/assign", {"class_ids": [context["class"].class_id]}),
        ("PUT", "/archive", None),
        ("PUT", "/unarchive", None),
        ("DELETE", "/classwork/999", None),
    ]:
        response = context["client"].request(
            method, f"/api/v1/lessons/{lesson.lesson_id}{suffix}", json=body,
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Lesson not found"}
    commits.assert_not_called()
    context["db"].refresh(lesson)
    assert (lesson.title, lesson.is_archived, lesson.is_published, lesson.is_draft) == before


def _invoke_case(case, context, tmp_path, monkeypatch):
    case_id, function_name, arguments = case
    function = (
        _assert_readers_cannot_mutate if function_name == "_assert_readers_cannot_mutate"
        else getattr(lesson_cases, function_name)
    )
    kwargs = dict(arguments)
    if function_name in _PATH_CASES:
        tmp_path.mkdir(parents=True, exist_ok=True)
        kwargs["tmp_path"] = tmp_path
    # Restore mocked commit methods before session/schema cleanup, and before
    # running the PostgreSQL half of the same parity case.
    with monkeypatch.context() as scoped_patch:
        if function_name in _PATCH_CASES:
            kwargs["monkeypatch"] = scoped_patch
        function(context, **kwargs)


def _run_parity(case, sqlite_context, postgres_session, tmp_path, monkeypatch):
    backend = "sqlite"
    try:
        _invoke_case(case, sqlite_context, tmp_path / "sqlite", monkeypatch)
        backend = "postgres"
        with lesson_cases._lesson_context_for_session(postgres_session) as context:
            _invoke_case(case, context, tmp_path / "postgres", monkeypatch)
    except Exception as error:
        pytest.fail(_safe_lesson_failure(case[0], backend, error), pytrace=False)


@pytest.mark.parametrize("case", _CASES, ids=[case[0] for case in _CASES])
def test_lesson_authorization_execute_on_guarded_postgres(
    case, postgres_dashboard_session, lesson_context, tmp_path, monkeypatch,
):
    """Integration: identical policy assertions on private SQLite and PostgreSQL."""
    _run_parity(case, lesson_context, postgres_dashboard_session, tmp_path, monkeypatch)


@pytest.mark.parametrize("case", _CASES, ids=[case[0] for case in _CASES])
def test_lesson_postgres_reference_case_on_sqlite(case, lesson_context, tmp_path, monkeypatch):
    """Mocked-behavior: every parity adapter runs without a PostgreSQL server."""
    (tmp_path / "sqlite").mkdir()
    _invoke_case(case, lesson_context, tmp_path / "sqlite", monkeypatch)


def test_lesson_postgres_fixture_skips_without_process_url(monkeypatch):
    """Unit: no env-file fallback, engine construction or connection when unset."""
    monkeypatch.delenv("DASHBOARD_TEST_PG_URL", raising=False)
    engine_factory = Mock()
    monkeypatch.setattr(postgres_guard, "create_engine", engine_factory)
    fixture = postgres_dashboard_session.__wrapped__()
    with pytest.raises(pytest.skip.Exception, match="DASHBOARD_TEST_PG_URL is unset"):
        next(fixture)
    engine_factory.assert_not_called()


@pytest.mark.parametrize("database", ["entervene_preview", "activity_db", "entervene_db"])
def test_lesson_postgres_fixture_refuses_non_test_databases_before_connect(monkeypatch, database):
    """Unit: sharing the dashboard guard never permits the preview/app databases."""
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", f"postgresql://x@localhost:55432/{database}")
    monkeypatch.setattr(postgres_guard.importlib.util, "find_spec", lambda _name: object())
    engine_factory = Mock()
    monkeypatch.setattr(postgres_guard, "create_engine", engine_factory)
    fixture = postgres_dashboard_session.__wrapped__()
    with pytest.raises(pytest.fail.Exception) as caught:
        next(fixture)
    assert "check=database" in str(caught.value)
    engine_factory.assert_not_called()


@pytest.mark.parametrize("backend", ["sqlite", "postgres", "unknown"])
@pytest.mark.parametrize("error_kind", ["assertion", "query", "guard"])
def test_lesson_postgres_parity_errors_never_expose_details(backend, error_kind, capsys, caplog):
    """Unit: credential-like markers stay private even on assertion failures."""
    user_marker = "fake-" + "user-marker"
    password_marker = "fake-" + "password-marker"
    raw_url = postgres_guard.URL.create(
        "postgresql", username=user_marker, password=password_marker,
        host="localhost", port=55432, database="activity_test",
    ).render_as_string(hide_password=False)
    error_class = {
        "assertion": AssertionError,
        "query": RuntimeError,
        "guard": postgres_guard.DashboardPostgresSafetyError,
    }[error_kind]
    visible = _safe_lesson_failure("owner_read", backend, error_class(raw_url))
    captured = capsys.readouterr()
    visible += captured.out + captured.err + caplog.text
    if any(marker in visible for marker in (raw_url, user_marker, password_marker, "://")):
        pytest.fail("Lesson PostgreSQL diagnostics exposed confidential details", pytrace=False)
    assert "case=owner_read" in visible


def test_lesson_postgres_unknown_case_and_backend_are_not_echoed():
    """Unit: diagnostic labels are allowlisted, not arbitrary input strings."""
    marker = "fake-private-diagnostic-marker"
    visible = _safe_lesson_failure(marker, marker, RuntimeError(marker))
    if marker in visible:
        pytest.fail("Lesson PostgreSQL diagnostics exposed unknown labels", pytrace=False)
    assert "case=unknown" in visible


def test_lesson_postgres_parity_runner_sanitizes_fixture_and_assertion_errors(monkeypatch, tmp_path):
    """Unit: raw exceptions from either the comparison or PG seeding never escape."""
    marker = "fake-private-exception-marker"
    error = RuntimeError(marker)

    @contextmanager
    def failed_seed(_session):
        raise error
        yield  # pragma: no cover -- preserve context-manager protocol

    monkeypatch.setattr(lesson_cases, "_lesson_context_for_session", failed_seed)
    monkeypatch.setattr(lesson_cases, "test_lesson_detail_follows_access_matrix", lambda _context: None)
    with pytest.raises(pytest.fail.Exception) as caught:
        _run_parity(_CASES[0], {}, Mock(), tmp_path, monkeypatch)
    if marker in str(caught.value):
        pytest.fail("Lesson PostgreSQL runner exposed a fixture exception", pytrace=False)
    assert "postgres" in str(caught.value)

    def failed_assertion(_context):
        raise AssertionError(marker)

    monkeypatch.setattr(lesson_cases, "test_lesson_detail_follows_access_matrix", failed_assertion)
    with pytest.raises(pytest.fail.Exception) as caught:
        _run_parity(_CASES[0], {}, Mock(), tmp_path, monkeypatch)
    if marker in str(caught.value):
        pytest.fail("Lesson PostgreSQL runner exposed an assertion exception", pytrace=False)
    assert "sqlite" in str(caught.value)
