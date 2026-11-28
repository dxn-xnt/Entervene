"""Endpoint-level coverage for bounded large attachment uploads."""
import asyncio
from contextlib import contextmanager
import json
import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.core import FileUpload, RequestLimits
from app.core.RequestLimits import RequestLimitsMiddleware
from app.db.Session import get_db
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.submissions.SubmissionAttachment import SubmissionAttachment
from app.services.classwork.ClassworkService import (
    add_classwork_attachment,
    remove_classwork_attachment,
)
from app.services.submission.SubmissionService import (
    clear_submission_files,
    remove_submission_attachment,
    submit_student_work,
    unsubmit_student_work,
)
from tests.test_classwork_submission_authorization import authz_context  # noqa: F401


VIDEO_HEADER = b"\x00\x00\x00\x18ftypmp42"


def _sparse_file(path: Path, size: int, header: bytes = VIDEO_HEADER) -> Path:
    with path.open("wb") as target:
        target.write(header[:size])
        if size > len(header):
            target.seek(size - 1)
            target.write(b"\0")
    return path


@contextmanager
def _limited_client(context):
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware)
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(submissions_router, prefix="/api/v1/submissions")
    app.dependency_overrides[get_db] = lambda: context["db"]
    app.dependency_overrides[get_current_user] = lambda: context["identity"]
    with TestClient(app) as client:
        yield client


def _teacher_upload(context, client, path: Path, content_type: str = "video/mp4"):
    with path.open("rb") as source:
        return client.post(
            f"/api/v1/classwork-assignments/classwork/{context['classwork'].classwork_id}/attachments",
            files={"file": (path.name, source, content_type)},
        )


def _student_upload(context, client, path: Path, content_type: str = "video/mp4"):
    context["identity"].update(sub=context["accounts"]["student"].user_id, role="student")
    with path.open("rb") as source:
        return client.post(
            f"/api/v1/submissions/assignment/{context['assignment'].classwork_assignment_id}/submit",
            files={"files": (path.name, source, content_type)},
        )


def test_teacher_endpoint_accepts_actual_100_mib_video(authz_context, monkeypatch):
    context = authz_context
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    video = _sparse_file(context["tmp_path"] / "teacher.mp4", FileUpload.VIDEO_UPLOAD_LIMIT)
    with _limited_client(context) as client:
        response = _teacher_upload(context, client, video)
    assert response.status_code == 200, response.text
    assert response.json()["file_size"] == FileUpload.VIDEO_UPLOAD_LIMIT


def test_student_endpoint_accepts_actual_100_mib_video(authz_context, monkeypatch):
    context = authz_context
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    video = _sparse_file(context["tmp_path"] / "student.mp4", FileUpload.VIDEO_UPLOAD_LIMIT)
    with _limited_client(context) as client:
        response = _student_upload(context, client, video)
    assert response.status_code == 200, response.text
    assert any(item["file_size"] == FileUpload.VIDEO_UPLOAD_LIMIT for item in response.json()["attachments"])


def test_endpoint_rejects_video_one_byte_over_limit(authz_context, monkeypatch):
    context = authz_context
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    video = _sparse_file(context["tmp_path"] / "oversize.mp4", FileUpload.VIDEO_UPLOAD_LIMIT + 1)
    with _limited_client(context) as client:
        response = _teacher_upload(context, client, video)
    assert response.status_code == 400
    assert response.json()["detail"] == FileUpload.VIDEO_SIZE_ERROR


def test_endpoint_rejects_document_one_byte_over_limit(authz_context, monkeypatch):
    context = authz_context
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    document = _sparse_file(
        context["tmp_path"] / "oversize.pdf",
        FileUpload.DOCUMENT_FILE_SIZE_LIMIT + 1,
        b"%PDF-1.7\n",
    )
    with _limited_client(context) as client:
        response = _teacher_upload(context, client, document, "application/pdf")
    assert response.status_code == 400
    assert response.json()["detail"] == FileUpload.DOCUMENT_SIZE_ERROR


def test_cumulative_aggregate_accepts_exact_boundary(authz_context, monkeypatch):
    context = authz_context
    context["classwork_attachment"].file_size = FileUpload.VIDEO_UPLOAD_LIMIT
    context["classwork_attachment"].file_type = "video/mp4"
    context["db"].commit()
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    video = _sparse_file(context["tmp_path"] / "boundary.mp4", FileUpload.VIDEO_UPLOAD_LIMIT)
    with _limited_client(context) as client:
        response = _teacher_upload(context, client, video)
    assert response.status_code == 200, response.text


def test_cumulative_aggregate_rejects_one_byte_over_boundary(authz_context, monkeypatch):
    context = authz_context
    context["classwork_attachment"].file_size = FileUpload.VIDEO_UPLOAD_LIMIT
    context["classwork_attachment"].file_type = "video/mp4"
    context["db"].add(ClassworkAttachment(
        classwork_id=context["classwork"].classwork_id,
        file_name="one-byte.pdf",
        file_path=str(context["tmp_path"] / "one-byte.pdf"),
        file_type="application/pdf",
        file_size=1,
    ))
    context["db"].commit()
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    video = _sparse_file(context["tmp_path"] / "aggregate-over.mp4", FileUpload.VIDEO_UPLOAD_LIMIT)
    with _limited_client(context) as client:
        response = _teacher_upload(context, client, video)
    assert response.status_code == 400
    assert response.json()["detail"] == FileUpload.ATTACHMENT_AGGREGATE_SIZE_ERROR


def test_saved_attachment_count_is_enforced(authz_context, monkeypatch):
    context = authz_context
    for index in range(9):
        context["db"].add(ClassworkAttachment(
            classwork_id=context["classwork"].classwork_id,
            file_name=f"saved-{index}.pdf",
            file_path=str(context["tmp_path"] / f"saved-{index}.pdf"),
            file_type="application/pdf",
            file_size=1,
        ))
    context["db"].commit()
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    document = _sparse_file(context["tmp_path"] / "extra.pdf", 20, b"%PDF-1.7\n")
    with _limited_client(context) as client:
        response = _teacher_upload(context, client, document, "application/pdf")
    assert response.status_code == 400
    assert response.json()["detail"] == FileUpload.ATTACHMENT_COUNT_ERROR


def test_saved_submission_attachment_count_is_enforced(authz_context, monkeypatch):
    context = authz_context
    for index in range(9):
        context["db"].add(SubmissionAttachment(
            submission_id=context["submission"].submission_id,
            file_name=f"saved-{index}.pdf",
            file_path=str(context["tmp_path"] / f"submission-saved-{index}.pdf"),
            file_type="application/pdf",
            file_size=1,
        ))
    context["db"].commit()
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    document = _sparse_file(context["tmp_path"] / "submission-extra.pdf", 20, b"%PDF-1.7\n")
    with _limited_client(context) as client:
        response = _student_upload(context, client, document, "application/pdf")
    assert response.status_code == 400
    assert response.json()["detail"] == FileUpload.ATTACHMENT_COUNT_ERROR


def test_multipart_parser_rejects_more_than_ten_files(authz_context):
    context = authz_context
    data = {
        "title": "Too many files",
        "classwork_type": "ASSIGNMENT",
        "subject_id": str(context["subject"].subject_id),
        "class_ids": str(context["allowed_class"].class_id),
        "academic_period_id": str(context["period"].academic_period_id),
    }
    files = [("files", (f"file-{index}.pdf", b"%PDF-1.7", "application/pdf")) for index in range(11)]
    with _limited_client(context) as client:
        response = client.post("/api/v1/classwork-assignments/with-assignments", data=data, files=files)
    assert response.status_code == 400
    assert "Maximum number of files is 10" in response.json()["detail"]


def test_ordinary_non_ai_request_remains_limited_to_25_mib():
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware)

    @app.post("/ordinary")
    async def ordinary(request: Request):
        return {"size": len(await request.body())}

    with TestClient(app) as client:
        response = client.post("/ordinary", content=b"x" * (25 * 1024 * 1024 + 1))
    assert response.status_code == 413


def test_route_aware_multipart_request_cap_and_ai_cap_are_preserved():
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware)

    @app.post("/api/v1/classwork-assignments/classwork/{classwork_id}/attachments")
    async def attachment(classwork_id: int):
        return {"classwork_id": classwork_id}

    @app.post("/api/v1/ai/check")
    async def ai_check():
        return {"ok": True}

    multipart_headers = {
        "Content-Type": "multipart/form-data; boundary=phase1",
        "Content-Length": str(FileUpload.MAX_ATTACHMENT_MULTIPART_REQUEST_SIZE + 1),
    }
    with TestClient(app) as client:
        multipart_response = client.post(
            "/api/v1/classwork-assignments/classwork/1/attachments",
            content=b"",
            headers=multipart_headers,
        )
        ai_response = client.post("/api/v1/ai/check", content=b"x" * 65537)
    assert multipart_response.status_code == 413
    assert ai_response.status_code == 413


def test_actual_submission_endpoint_accepts_multipart_without_content_length(authz_context, monkeypatch):
    context = authz_context
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", context["tmp_path"] / "uploads")
    context["identity"].update(sub=context["accounts"]["student"].user_id, role="student")

    def chunks():
        yield b"--phase1\r\nContent-Disposition: form-data; name=\"files\"; filename=\"notes.pdf\"\r\n"
        yield b"Content-Type: application/pdf\r\n\r\n%PDF-1.7 no-content-length"
        yield b"\r\n--phase1--\r\n"

    with _limited_client(context) as client:
        response = client.post(
            f"/api/v1/submissions/assignment/{context['assignment'].classwork_assignment_id}/submit",
            content=chunks(),
            headers={"Content-Type": "multipart/form-data; boundary=phase1"},
        )
    assert response.status_code == 200, response.text


def test_chunked_request_without_content_length_is_stream_limited(monkeypatch):
    monkeypatch.setattr(RequestLimits, "MAX_ATTACHMENT_MULTIPART_REQUEST_SIZE", 32)
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware)

    @app.post("/api/v1/submissions/assignment/{assignment_id}/submit")
    async def upload(assignment_id: int, request: Request):
        return {"size": len(await request.body())}

    def chunks():
        yield b"--phase1\r\nContent-Disposition: form-data; name=\"files\"; filename=\"a.pdf\"\r\n"
        yield b"Content-Type: application/pdf\r\n\r\n%PDF-1.7"
        yield b"\r\n--phase1--\r\n"

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/submissions/assignment/1/submit",
            content=chunks(),
            headers={"Content-Type": "multipart/form-data; boundary=phase1"},
        )
    assert response.status_code == 413


def test_cancellation_after_an_earlier_file_cleans_transaction_files(authz_context, monkeypatch):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    saved_path = upload_root / "submissions" / "cancelled-first.pdf"
    calls = 0

    async def save_then_cancel(upload, category):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise asyncio.CancelledError
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(b"%PDF-1.7 first")
        return {
            "file_name": upload.filename,
            "file_path": str(saved_path),
            "file_type": "application/pdf",
            "file_size": saved_path.stat().st_size,
        }

    class Upload:
        content_type = "application/pdf"
        size = 16

        def __init__(self, filename):
            self.filename = filename

    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    before = context["db"].query(SubmissionAttachment).count()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(submit_student_work(
            context["assignment"].classwork_assignment_id,
            request,
            [Upload("first.pdf"), Upload("second.pdf")],
            context["student"],
            context["db"],
            save_file_func=save_then_cancel,
        ))

    assert not saved_path.exists()
    assert context["db"].query(SubmissionAttachment).count() == before


def test_duplicate_replay_distinguishes_same_name_and_size_different_content(authz_context, monkeypatch):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    context["identity"].update(sub=context["accounts"]["student"].user_id, role="student")

    # Clear fixture's initial submission so we start cleanly.
    context["db"].delete(context["submission"])
    context["db"].commit()

    url = f"/api/v1/submissions/assignment/{context['assignment'].classwork_assignment_id}/submit"
    with _limited_client(context) as client:
        first = client.post(
            url,
            files={"files": ("report.pdf", b"%PDF-1.7 version-A", "application/pdf")},
        )
        assert first.status_code == 200, first.text
        first_id = first.json()["submission_id"]
        assert len(first.json()["attachments"]) == 1

        # Exact identical content replay returns existing submission without duplicating files.
        replay = client.post(
            url,
            files={"files": ("report.pdf", b"%PDF-1.7 version-A", "application/pdf")},
        )
        assert replay.status_code == 200, replay.text
        assert replay.json()["submission_id"] == first_id
        assert len(replay.json()["attachments"]) == 1
        assert len(list((upload_root / "submissions").glob("*.pdf"))) == 1

        # Same filename and exact same byte size, but DIFFERENT content must NOT be discarded as replay.
        different_content = client.post(
            url,
            files={"files": ("report.pdf", b"%PDF-1.7 version-B", "application/pdf")},
        )
        assert different_content.status_code == 200, different_content.text
        assert different_content.json()["submission_id"] == first_id
        assert len(different_content.json()["attachments"]) == 2
        assert len(list((upload_root / "submissions").glob("*.pdf"))) == 2


def test_duplicate_replay_handles_links_mixed_media_reordering_and_unsubmit(authz_context, monkeypatch):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    context["identity"].update(sub=context["accounts"]["student"].user_id, role="student")
    context["db"].delete(context["submission"])
    context["db"].commit()

    url = f"/api/v1/submissions/assignment/{context['assignment'].classwork_assignment_id}/submit"
    links_a = json.dumps([{"url": "https://example.com/doc-a", "title": "Doc A"}])
    links_b = json.dumps([{"url": "https://example.com/doc-b", "title": "Doc B"}])
    video_bytes = VIDEO_HEADER + b"sample-video"
    pdf_bytes = b"%PDF-1.7 sample-doc"

    with _limited_client(context) as client:
        # Mixed video + document + link submission
        mixed = client.post(
            url,
            data={"links": links_a},
            files=[
                ("files", ("clip.mp4", video_bytes, "video/mp4")),
                ("files", ("notes.pdf", pdf_bytes, "application/pdf")),
            ],
        )
        assert mixed.status_code == 200, mixed.text
        assert len(mixed.json()["attachments"]) == 2
        assert len(mixed.json()["links"]) == 1

        # Reordered identical attachments + same links -> replay, no duplicate files
        reordered = client.post(
            url,
            data={"links": links_a},
            files=[
                ("files", ("notes.pdf", pdf_bytes, "application/pdf")),
                ("files", ("clip.mp4", video_bytes, "video/mp4")),
            ],
        )
        assert reordered.status_code == 200, reordered.text
        assert len(reordered.json()["attachments"]) == 2
        assert len(list((upload_root / "submissions").glob("*"))) == 2

        # Same files, DIFFERENT links -> NOT a replay, updates links
        diff_links = client.post(
            url,
            data={"links": links_b},
            files=[
                ("files", ("clip.mp4", video_bytes, "video/mp4")),
                ("files", ("notes.pdf", pdf_bytes, "application/pdf")),
            ],
        )
        assert diff_links.status_code == 200, diff_links.text
        assert [link["url"] for link in diff_links.json()["links"]] == ["https://example.com/doc-b"]
        assert len(diff_links.json()["attachments"]) == 4

        # Same links, DIFFERENT attached file -> NOT a replay, adds legitimate additional attachment
        extra_file = client.post(
            url,
            data={"links": links_b},
            files=[("files", ("extra.pdf", b"%PDF-1.7 extra", "application/pdf"))],
        )
        assert extra_file.status_code == 200, extra_file.text
        assert len(extra_file.json()["attachments"]) == 5

        # Unsubmit and resubmit works normally
        unsubmit_student_work(context["assignment"].classwork_assignment_id, context["student"], context["db"])
        resubmitted = client.post(
            url,
            data={"links": links_b},
            files=[("files", ("final.pdf", b"%PDF-1.7 final", "application/pdf"))],
        )
        assert resubmitted.status_code == 200, resubmitted.text
        assert len(resubmitted.json()["attachments"]) == 6


def test_ambiguous_commit_retains_file_conservatively_and_logs_orphan_risk(authz_context, monkeypatch, caplog):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    saved_path = upload_root / "classworks" / "ambiguous.pdf"

    async def fake_save(upload, category):
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(b"%PDF-1.7 ambiguous")
        return {
            "file_name": upload.filename,
            "file_path": str(saved_path),
            "file_type": "application/pdf",
            "file_size": saved_path.stat().st_size,
        }

    class Upload:
        filename = "ambiguous.pdf"
        content_type = "application/pdf"
        size = 18

    real_db = context["db"]
    original_commit = real_db.commit
    original_query = real_db.query
    commit_failed = False

    def failing_commit():
        nonlocal commit_failed
        commit_failed = True
        raise RuntimeError("connection dropped during commit")

    def failing_verify_query(*args, **kwargs):
        if commit_failed:
            raise RuntimeError("connection unavailable for verification")
        return original_query(*args, **kwargs)

    monkeypatch.setattr(real_db, "commit", failing_commit)
    monkeypatch.setattr(real_db, "query", failing_verify_query)

    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError, match="connection dropped during commit"):
        asyncio.run(add_classwork_attachment(
            context["classwork"].classwork_id,
            Upload(),
            context["owner"].staff_id,
            real_db,
            save_file_func=fake_save,
        ))

    monkeypatch.setattr(real_db, "commit", original_commit)
    monkeypatch.setattr(real_db, "query", original_query)
    assert saved_path.is_file(), "Ambiguous commit must retain staged file conservatively"
    assert "AMBIGUOUS_COMMIT" in caplog.text and "ORPHAN_FILE_RISK" in caplog.text


def test_post_commit_response_failure_preserves_committed_file(authz_context, monkeypatch):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    saved_path = upload_root / "classworks" / "committed.pdf"

    async def fake_save(upload, category):
        saved_path.parent.mkdir(parents=True, exist_ok=True)
        saved_path.write_bytes(b"%PDF-1.7 committed")
        return {
            "file_name": upload.filename,
            "file_path": str(saved_path),
            "file_type": "application/pdf",
            "file_size": saved_path.stat().st_size,
        }

    class Upload:
        filename = "committed.pdf"
        content_type = "application/pdf"
        size = 18

    from app.services.classwork import ClassworkService

    def broken_response(_attachment):
        raise RuntimeError("serialization error after commit")

    monkeypatch.setattr(ClassworkService, "build_attachment_response", broken_response)

    with pytest.raises(RuntimeError, match="serialization error after commit"):
        asyncio.run(add_classwork_attachment(
            context["classwork"].classwork_id,
            Upload(),
            context["owner"].staff_id,
            context["db"],
            save_file_func=fake_save,
        ))

    assert saved_path.is_file(), "Committed file must NOT be deleted when post-commit response building fails"


def test_clear_submission_files_attempts_all_deletions_after_commit(authz_context, monkeypatch):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    extra_path = upload_root / "submissions" / "second-clear.pdf"
    extra_path.parent.mkdir(parents=True, exist_ok=True)
    extra_path.write_bytes(b"%PDF-1.7 second")
    context["db"].add(SubmissionAttachment(
        submission_id=context["submission"].submission_id,
        file_name="second-clear.pdf",
        file_path=str(extra_path),
        file_type="application/pdf",
        file_size=15,
    ))
    context["db"].commit()

    attempted: list[str] = []

    def fail_first_delete(path: str) -> bool:
        attempted.append(path)
        return len(attempted) > 1

    with pytest.raises(HTTPException) as exc:
        clear_submission_files(
            context["assignment"].classwork_assignment_id,
            context["student"],
            context["db"],
            delete_file_func=fail_first_delete,
        )
    assert exc.value.status_code == 500
    assert len(attempted) == 2, "clear_submission_files must attempt deleting every file even if the first fails"


def test_unauthorized_removal_is_blocked_and_preserves_physical_file(authz_context, monkeypatch):
    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    existing_path = Path(context["classwork_attachment"].file_path)
    existing_path.parent.mkdir(parents=True, exist_ok=True)
    existing_path.write_bytes(b"%PDF-1.7 protected")

    with pytest.raises(HTTPException) as exc:
        remove_classwork_attachment(
            context["classwork"].classwork_id,
            context["classwork_attachment"].classwork_attachment_id,
            "T-UNAUTHORIZED",
            context["db"],
        )
    assert exc.value.status_code == 404
    assert existing_path.is_file()


def test_one_byte_range_preflight_returns_206_single_byte_and_native_download_sets_attachment_disposition(
    authz_context, monkeypatch
):
    from datetime import timedelta
    from app.api.v1.routes.Auth import ACCESS_COOKIE_NAME
    from app.core.Security import create_token
    from app.services.classwork import ClassworkResponseService

    context = authz_context
    upload_root = context["tmp_path"] / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)
    monkeypatch.setattr(ClassworkResponseService, "BASE_DIR", context["tmp_path"])
    monkeypatch.setattr(ClassworkResponseService, "UPLOADS_DIR", upload_root)
    video = _sparse_file(context["tmp_path"] / "range-probe.mp4", 4096)

    with _limited_client(context) as client:
        uploaded = _teacher_upload(context, client, video)
        assert uploaded.status_code == 200, uploaded.text
        attachment_id = uploaded.json()["classwork_attachment_id"]
        download_path = (
            f"/api/v1/classwork-assignments/classwork/{context['classwork'].classwork_id}"
            f"/attachments/{attachment_id}/download"
        )
        token = create_token(
            str(context["accounts"]["owner"].user_id), "teacher", "access", timedelta(minutes=30)
        )
        cookie_headers = {"Cookie": f"{ACCESS_COOKIE_NAME}={token}"}

        # 1-byte Range preflight must return ONLY 1 byte (206), never a full video transfer.
        probe = client.get(download_path, headers={**cookie_headers, "Range": "bytes=0-0"})
        assert probe.status_code == 206, probe.text
        assert probe.headers["content-length"] == "1"
        assert probe.headers["content-range"] == "bytes 0-0/4096"
        assert probe.headers["content-type"] == "video/mp4"
        assert len(probe.content) == 1

        # Native download without Range uses cookie auth and attachment Content-Disposition.
        full_download = client.get(download_path, headers=cookie_headers)
        assert full_download.status_code == 200, full_download.text
        assert full_download.headers["content-type"] == "video/mp4"
        assert "attachment" in full_download.headers["content-disposition"].lower()
        assert "range-probe.mp4" in full_download.headers["content-disposition"]
        assert len(full_download.content) == 4096
