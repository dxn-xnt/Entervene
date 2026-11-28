import asyncio
from unittest.mock import MagicMock, mock_open, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core import FileUpload


class VirtualUpload:
    def __init__(self, size: int, *, filename: str = "lesson.mp4", content_type: str = "video/mp4", header: bytes = b"\x00\x00\x00\x18ftypmp42"):
        self.filename = filename
        self.content_type = content_type
        self.size = size
        self.header = header
        self.position = 0

    async def seek(self, offset: int):
        self.position = offset

    async def read(self, amount: int = -1):
        if self.position >= self.size:
            return b""
        amount = self.size - self.position if amount < 0 else min(amount, self.size - self.position)
        start = self.position
        self.position += amount
        prefix = self.header[start : start + amount] if start < len(self.header) else b""
        return prefix + (b"\x00" * (amount - len(prefix)))


class CancellingUpload(VirtualUpload):
    async def read(self, amount: int = -1):
        if self.position:
            raise asyncio.CancelledError
        return await super().read(12)


def run(coro):
    return asyncio.run(coro)


def test_video_limit_accepts_exactly_100_mib_and_rejects_one_byte_more():
    run(FileUpload.validate_file(VirtualUpload(FileUpload.VIDEO_UPLOAD_LIMIT)))
    with pytest.raises(HTTPException) as exc:
        run(FileUpload.validate_file(VirtualUpload(FileUpload.VIDEO_UPLOAD_LIMIT + 1)))
    assert exc.value.status_code == 400
    assert exc.value.detail == FileUpload.VIDEO_SIZE_ERROR


def test_video_below_limit_and_valid_webm_are_accepted():
    run(FileUpload.validate_file(VirtualUpload(
        1024,
        filename="lesson.webm",
        content_type="video/webm",
        header=b"\x1a\x45\xdf\xa3webm",
    )))


def test_empty_and_unsupported_videos_are_rejected():
    with pytest.raises(HTTPException) as empty:
        run(FileUpload.validate_file(VirtualUpload(0)))
    assert "empty" in str(empty.value.detail).lower()
    with pytest.raises(HTTPException) as unsupported:
        run(FileUpload.validate_file(VirtualUpload(100, filename="lesson.avi", content_type="video/x-msvideo")))
    assert "not allowed" in str(unsupported.value.detail).lower()


def test_document_limit_remains_10_mib():
    run(FileUpload.validate_file(VirtualUpload(
        FileUpload.DOCUMENT_FILE_SIZE_LIMIT,
        filename="notes.pdf",
        content_type="application/pdf",
        header=b"%PDF-1.7",
    )))
    with pytest.raises(HTTPException):
        run(FileUpload.validate_file(VirtualUpload(
            FileUpload.DOCUMENT_FILE_SIZE_LIMIT + 1,
            filename="notes.pdf",
            content_type="application/pdf",
            header=b"%PDF-1.7",
        )))


@pytest.mark.parametrize(
    ("filename", "content_type", "header"),
    [
        ("fake.mp4", "video/mp4", b"MZ executable"),
        ("fake.webm", "video/webm", b"not an ebml file"),
        ("fake.mov", "application/octet-stream", b"\x00\x00\x00\x18ftypqt  "),
    ],
)
def test_video_validation_rejects_disguised_or_mismatched_files(filename, content_type, header):
    with pytest.raises(HTTPException):
        run(FileUpload.validate_file(VirtualUpload(len(header), filename=filename, content_type=content_type, header=header)))


def test_failed_stream_is_removed(monkeypatch):
    base = MagicMock()
    target_dir = MagicMock()
    target_path = MagicMock()
    base.__truediv__.return_value = target_dir
    target_dir.__truediv__.return_value = target_path
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", base)
    monkeypatch.setattr(FileUpload, "VIDEO_UPLOAD_LIMIT", 32)
    with patch("builtins.open", mock_open()), pytest.raises(HTTPException) as exc:
        run(FileUpload.save_file(VirtualUpload(33), "submissions"))
    assert exc.value.detail == FileUpload.VIDEO_SIZE_ERROR
    target_path.unlink.assert_called_once_with(missing_ok=True)


def test_cancelled_stream_removes_partial_file_and_reraises(tmp_path, monkeypatch):
    upload_root = tmp_path / "uploads"
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)

    with pytest.raises(asyncio.CancelledError):
        run(FileUpload.save_file(CancellingUpload(1024), "submissions"))

    assert list(upload_root.rglob("*.*")) == []


def test_cleanup_unlink_error_does_not_mask_original_save_failure(monkeypatch):
    base = MagicMock()
    target_dir = MagicMock()
    target_path = MagicMock()
    target_path.unlink.side_effect = OSError("locked file")
    base.__truediv__.return_value = target_dir
    target_dir.__truediv__.return_value = target_path
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", base)
    monkeypatch.setattr(FileUpload, "VIDEO_UPLOAD_LIMIT", 32)

    with patch("builtins.open", mock_open()), pytest.raises(HTTPException) as exc:
        run(FileUpload.save_file(VirtualUpload(33), "submissions"))
    assert exc.value.detail == FileUpload.VIDEO_SIZE_ERROR
    target_path.unlink.assert_called_once_with(missing_ok=True)


def test_delete_file_resolves_normalized_upload_path_against_configured_root(tmp_path, monkeypatch):
    upload_root = tmp_path / "uploads"
    stored_file = upload_root / "classworks" / "rollback.mp4"
    stored_file.parent.mkdir(parents=True)
    stored_file.write_bytes(b"video")
    monkeypatch.setattr(FileUpload, "UPLOAD_BASE_DIR", upload_root)

    FileUpload.delete_file("uploads/classworks/rollback.mp4")

    assert not stored_file.exists()


def test_protected_file_response_supports_byte_ranges():
    path = MagicMock()
    path.stat.return_value.st_size = 10
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": [(b"range", b"bytes=2-5")]})
    response = FileUpload.protected_file_response(request, path, "clip.mp4", "video/mp4", True)
    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["content-length"] == "4"
    assert response.headers["accept-ranges"] == "bytes"
