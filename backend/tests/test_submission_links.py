"""Isolated API checks for URL deliverables on existing assignment submissions."""

import json
from datetime import datetime, timedelta, timezone

import pytest

import app.api.v1.routes.Submissions as routes
import app.services.submission.SubmissionService as service
from app.models.submissions.SubmissionLink import SubmissionLink
from tests.test_classwork_submission_authorization import _act_as, authz_context


def _url(c):
    return f"/api/v1/submissions/assignment/{c['assignment'].classwork_assignment_id}/submit"


def _fresh(c):
    _act_as(c, "student", "student")
    assert c["client"].delete(_url(c)).status_code == 200


def _post(c, links, files=None):
    return c["client"].post(
        _url(c),
        data={"links": json.dumps(links)} if links is not None else {},
        files=files,
    )


def test_link_only_submission_is_visible_to_student_and_scoped_teacher(authz_context):
    c = authz_context
    _fresh(c)
    response = _post(c, [
        {"url": "https://docs.google.com/document/d/example", "title": "Draft"},
        {"url": "https://github.com/example/work"},
    ])
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "submitted"
    assert response.json()["attachments"] == []
    assert [item["position"] for item in response.json()["links"]] == [0, 1]
    assert [item["title"] for item in response.json()["links"]] == ["Draft", None]

    own = c["client"].get("/api/v1/submissions/my-submissions")
    assert own.status_code == 200
    assert len(own.json()[0]["links"]) == 2
    _act_as(c, "owner", "teacher")
    teacher = c["client"].get(f"/api/v1/submissions/{response.json()['submission_id']}/detail")
    assert teacher.status_code == 200
    assert len(teacher.json()["links"]) == 2
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(f"/api/v1/submissions/{response.json()['submission_id']}/detail").status_code == 403


def test_mixed_submission_keeps_real_file_attachment(authz_context, monkeypatch):
    c = authz_context
    _fresh(c)

    async def save_temp(upload, _folder):
        path = c["tmp_path"] / "mixed.pdf"
        path.write_bytes(await upload.read())
        return {"file_name": "mixed.pdf", "file_path": str(path), "file_type": "application/pdf", "file_size": path.stat().st_size}

    monkeypatch.setattr(routes, "save_file", save_temp)
    response = _post(c, [{"url": "https://drive.google.com/file/d/example"}], [("files", ("mixed.pdf", b"%PDF", "application/pdf"))])
    assert response.status_code == 200, response.text
    assert len(response.json()["links"]) == 1
    assert len(response.json()["attachments"]) == 1


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=example",
    "https://example.org/project",
])
def test_other_https_sites_are_accepted(authz_context, url):
    c = authz_context
    _fresh(c)
    response = _post(c, [{"url": url}])
    assert response.status_code == 200, response.text
    assert response.json()["links"][0]["url"] == url


@pytest.mark.parametrize("bad", [
    [{"url": "javascript:alert(1)"}],
    [{"url": "data:text/html,test"}],
    [{"url": "file:///test"}],
    [{"url": "https://user:pass@example.com"}],
    [{"url": "https://example.com/bad path"}],
    [{"url": "https://example.com/\\evil"}],
    [{"url": "https://"}],
    [{"url": "https://example.com:wrong/work"}],
    [{"url": "https://example.com/" + "x" * 2048}],
    [{"url": "  "}],
    [{"url": "https://example.com/"}, {"url": "https://example.com/"}],
    [{"url": "https://example.com/", "title": "x" * 256}],
])
def test_invalid_links_are_rejected_before_submission_mutation(authz_context, bad):
    c = authz_context
    _fresh(c)
    before_attempts = c["submission"].attempt_count
    response = _post(c, bad)
    c["db"].refresh(c["submission"])
    assert response.status_code == 422
    assert c["submission"].status == "pending"
    assert c["submission"].attempt_count == before_attempts
    assert c["db"].query(SubmissionLink).count() == 0


def test_empty_and_unauthorized_link_submissions_are_rejected(authz_context):
    c = authz_context
    _fresh(c)
    assert _post(c, []).status_code == 400
    _act_as(c, "other_student", "student")
    assert _post(c, [{"url": "https://example.com/work"}]).status_code == 403
    assert c["db"].query(SubmissionLink).count() == 0


def test_link_submission_respects_lock_deadline_and_graded_protection(authz_context):
    c = authz_context
    _fresh(c)
    c["assignment"].is_locked = True
    c["db"].commit()
    assert _post(c, [{"url": "https://example.com/work"}]).status_code == 403
    c["assignment"].is_locked = False
    c["assignment"].due_date = datetime.now(timezone.utc) - timedelta(days=1)
    c["assignment"].allow_late_submissions = False
    c["db"].commit()
    assert _post(c, [{"url": "https://example.com/work"}]).status_code == 403
    c["assignment"].allow_late_submissions = True
    c["db"].commit()
    sent = _post(c, [{"url": "https://example.com/work"}])
    assert sent.status_code == 200
    assert sent.json()["status"] == "late"
    c["submission"].status = "graded"
    c["submission"].grade = 87
    c["submission"].feedback = "Good work"
    c["db"].commit()
    assert _post(c, [{"url": "https://example.com/changed"}]).status_code == 403
    assert c["client"].post(_url(c).replace("/submit", "/unsubmit")).status_code == 403
    assert c["client"].delete(_url(c)).status_code == 403
    c["db"].refresh(c["submission"])
    assert str(c["submission"].grade) == "87.00"
    assert c["submission"].feedback == "Good work"
    assert len(c["submission"].links) == 1


def test_link_only_unsubmit_resubmit_and_clear(authz_context):
    c = authz_context
    _fresh(c)
    first = _post(c, [{"url": "https://example.com/one"}])
    assert first.status_code == 200
    unsubmitted = c["client"].post(_url(c).replace("/submit", "/unsubmit"))
    assert unsubmitted.status_code == 200
    assert unsubmitted.json()["status"] == "pending"
    assert len(unsubmitted.json()["links"]) == 1
    assert _post(c, []).status_code == 400
    assert c["db"].query(SubmissionLink).count() == 1
    second = _post(c, [{"url": "https://example.com/two"}])
    assert second.status_code == 200, second.text
    assert second.json()["attempt_count"] == first.json()["attempt_count"] + 1
    assert [link["url"] for link in second.json()["links"]] == ["https://example.com/two"]
    assert c["client"].delete(_url(c)).status_code == 200
    c["db"].expire_all()
    assert c["db"].query(SubmissionLink).count() == 0
    assert c["submission"].status == "pending"


def test_direct_link_resubmission_replaces_links_without_touching_feedback(authz_context):
    c = authz_context
    _fresh(c)
    first = _post(c, [{"url": "https://example.com/first"}])
    assert first.status_code == 200
    c["submission"].feedback = "Teacher note"
    c["db"].commit()
    second = _post(c, [{"url": "https://example.com/second"}])
    assert second.status_code == 200, second.text
    assert second.json()["attempt_count"] == first.json()["attempt_count"] + 1
    assert [link["url"] for link in second.json()["links"]] == ["https://example.com/second"]
    assert second.json()["feedback"] == "Teacher note"


@pytest.mark.parametrize("classwork_type", ["ACTIVITY", "READING", "QUIZ"])
def test_only_assignment_and_activity_accept_links(authz_context, classwork_type):
    c = authz_context
    _fresh(c)
    c["classwork"].classwork_type = classwork_type
    c["db"].commit()
    response = _post(c, [{"url": "https://example.com/work"}])
    assert response.status_code == (200 if classwork_type == "ACTIVITY" else 422)


def test_link_persistence_failure_rolls_back_files_attempts_and_links(authz_context, monkeypatch):
    c = authz_context
    _fresh(c)
    original = service.SubmissionLink
    calls = 0

    def failing_link(**values):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated persistence failure")
        return original(**values)

    async def save_temp(upload, _folder):
        path = c["tmp_path"] / "rollback.pdf"
        path.write_bytes(await upload.read())
        return {"file_name": "rollback.pdf", "file_path": str(path), "file_type": "application/pdf", "file_size": path.stat().st_size}

    monkeypatch.setattr(service, "SubmissionLink", failing_link)
    monkeypatch.setattr(routes, "save_file", save_temp)
    before_attempts = c["submission"].attempt_count
    with pytest.raises(RuntimeError, match="simulated persistence failure"):
        _post(c, [
            {"url": "https://example.com/one"},
            {"url": "https://example.com/two"},
        ], [("files", ("rollback.pdf", b"%PDF", "application/pdf"))])
    c["db"].expire_all()
    assert c["submission"].attempt_count == before_attempts
    assert c["submission"].status == "pending"
    assert c["db"].query(SubmissionLink).count() == 0
    assert not (c["tmp_path"] / "rollback.pdf").exists()
