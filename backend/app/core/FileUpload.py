"""Validated, streamed attachment storage for Entervene."""
import asyncio
import hashlib
import logging
import os
import uuid
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.routing import APIRoute
from starlette.datastructures import UploadFile

DOCUMENT_FILE_SIZE_LIMIT = 10 * 1024 * 1024
VIDEO_UPLOAD_LIMIT = 100 * 1024 * 1024
MAX_ATTACHMENT_COUNT = 10
MAX_AGGREGATE_ATTACHMENT_SIZE = 200 * 1024 * 1024
MAX_ATTACHMENT_MULTIPART_REQUEST_SIZE = 210 * 1024 * 1024
MAX_CONCURRENT_LARGE_ATTACHMENT_UPLOADS = 4
MAX_FILE_SIZE = DOCUMENT_FILE_SIZE_LIMIT
VIDEO_SIZE_ERROR = "The video exceeds the maximum allowed file size of 100 MB."
DOCUMENT_SIZE_ERROR = "The file exceeds the maximum allowed file size of 10 MB."
ATTACHMENT_COUNT_ERROR = "A maximum of 10 attachments is allowed per classwork or submission."
ATTACHMENT_AGGREGATE_SIZE_ERROR = "Attachments exceed the maximum aggregate size of 200 MB."
ATTACHMENT_SAVE_ERROR = "The attachment could not be saved. Please try again."

DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png"}
VIDEO_MIME_TYPES = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}
VIDEO_EXTENSIONS = set(VIDEO_MIME_TYPES)
ALLOWED_EXTENSIONS = DOCUMENT_EXTENSIONS | VIDEO_EXTENSIONS
ALLOWED_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    **VIDEO_MIME_TYPES,
}

UPLOAD_BASE_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
_CHUNK_SIZE = 1024 * 1024
logger = logging.getLogger(__name__)


def _file_details(file: UploadFile) -> tuple[str, str, bool, int]:
    filename = file.filename
    if not filename:
        raise HTTPException(status_code=400, detail="File must have a name.")
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    is_video = ext in VIDEO_EXTENSIONS
    return filename, ext, is_video, VIDEO_UPLOAD_LIMIT if is_video else DOCUMENT_FILE_SIZE_LIMIT


def _validate_mime_type(ext: str, content_type: str | None) -> None:
    normalized = content_type.split(";", 1)[0].lower() if content_type else ""
    if normalized != ALLOWED_MIME_TYPES[ext]:
        raise HTTPException(status_code=400, detail="The selected file does not match its file extension.")


def _validate_video_header(ext: str, header: bytes) -> None:
    is_webm = header.startswith(b"\x1a\x45\xdf\xa3")
    is_iso_video = len(header) >= 12 and header[4:8] == b"ftyp"
    if (ext == ".webm" and not is_webm) or (ext in {".mp4", ".mov"} and not is_iso_video):
        raise HTTPException(status_code=400, detail="The selected file is empty, corrupt, or is not a valid video.")


def upload_file_size(file: UploadFile) -> int:
    parsed_size = getattr(file, "size", None)
    if isinstance(parsed_size, int) and parsed_size >= 0:
        return parsed_size
    raw_file = getattr(file, "file", None)
    if raw_file is None:
        raise HTTPException(status_code=400, detail="Unable to determine attachment size.")
    position = raw_file.tell()
    try:
        raw_file.seek(0, os.SEEK_END)
        return int(raw_file.tell())
    finally:
        raw_file.seek(position)


def validate_attachment_collection(
    existing_attachments: Iterable[object],
    incoming_files: Iterable[UploadFile],
) -> None:
    incoming = list(incoming_files)
    if not incoming:
        return
    existing = list(existing_attachments)
    if len(existing) + len(incoming) > MAX_ATTACHMENT_COUNT:
        raise HTTPException(status_code=400, detail=ATTACHMENT_COUNT_ERROR)
    existing_bytes = sum(max(0, int(getattr(item, "file_size", 0) or 0)) for item in existing)
    incoming_bytes = sum(upload_file_size(item) for item in incoming)
    if existing_bytes + incoming_bytes > MAX_AGGREGATE_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail=ATTACHMENT_AGGREGATE_SIZE_ERROR)


def validate_saved_attachment_collection(
    existing_attachments: Iterable[object],
    saved_infos: Iterable[dict],
) -> None:
    """Validate count and aggregate bytes using already-staged file metadata."""
    incoming = list(saved_infos)
    if not incoming:
        return
    existing = list(existing_attachments)
    if len(existing) + len(incoming) > MAX_ATTACHMENT_COUNT:
        raise HTTPException(status_code=400, detail=ATTACHMENT_COUNT_ERROR)
    existing_bytes = sum(max(0, int(getattr(item, "file_size", 0) or 0)) for item in existing)
    incoming_bytes = sum(max(0, int(item.get("file_size", 0) or 0)) for item in incoming)
    if existing_bytes + incoming_bytes > MAX_AGGREGATE_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail=ATTACHMENT_AGGREGATE_SIZE_ERROR)


class AttachmentLimitedRoute(APIRoute):
    """Populate FastAPI's form cache with the attachment file-count cap."""

    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def limited_handler(request: Request):
            if request.headers.get("content-type", "").lower().startswith("multipart/form-data"):
                await request.form(max_files=MAX_ATTACHMENT_COUNT, max_fields=1000)
            return await original_handler(request)

        return limited_handler


async def validate_file(file: UploadFile) -> None:
    """Validate an upload without retaining it in memory or changing its position."""
    _filename, ext, is_video, limit = _file_details(file)
    await file.seek(0)
    header = await file.read(32)
    if not header:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    _validate_mime_type(ext, file.content_type)
    if is_video:
        _validate_video_header(ext, header)
    total = len(header)
    while total <= limit:
        chunk = await file.read(min(_CHUNK_SIZE, limit + 1 - total))
        if not chunk:
            break
        total += len(chunk)
    await file.seek(0)
    if total > limit:
        detail = VIDEO_SIZE_ERROR if is_video else DOCUMENT_SIZE_ERROR
        raise HTTPException(status_code=400, detail=detail)


async def save_file(file: UploadFile, category: str) -> dict:
    """Validate and stream an upload to a uniquely named file on disk."""
    filename, ext, is_video, limit = _file_details(file)
    _validate_mime_type(ext, file.content_type)
    target_dir = UPLOAD_BASE_DIR / category
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{uuid.uuid4().hex}{ext}"
    total = 0
    header = b""
    await file.seek(0)
    try:
        with open(target_path, "wb") as destination:
            while chunk := await file.read(_CHUNK_SIZE):
                if not header:
                    header = chunk[:32]
                    if is_video:
                        _validate_video_header(ext, header)
                total += len(chunk)
                if total > limit:
                    detail = VIDEO_SIZE_ERROR if is_video else DOCUMENT_SIZE_ERROR
                    raise HTTPException(status_code=400, detail=detail)
                destination.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="The selected file is empty.")
        await file.seek(0)
    except asyncio.CancelledError:
        try:
            target_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Could not delete cancelled partial upload %s", target_path, exc_info=True)
        try:
            await file.seek(0)
        except Exception:
            logger.warning("Could not rewind a cancelled upload", exc_info=True)
        raise
    except Exception:
        try:
            target_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Could not delete failed partial upload %s", target_path, exc_info=True)
        try:
            await file.seek(0)
        except Exception:
            logger.warning("Could not rewind a failed upload", exc_info=True)
        raise
    return {
        "file_name": filename,
        "file_path": str(target_path),
        "file_type": ALLOWED_MIME_TYPES.get(ext, file.content_type or "application/octet-stream"),
        "file_size": total,
    }


def resolve_stored_file_path(file_path: str) -> Path:
    """Resolve an absolute or normalized uploads/... path against UPLOAD_BASE_DIR."""
    path = Path(file_path)
    if not path.is_absolute():
        normalized_parts = Path(file_path.replace("\\", "/")).parts
        try:
            uploads_index = normalized_parts.index("uploads")
            path = UPLOAD_BASE_DIR.parent / Path(*normalized_parts[uploads_index:])
        except ValueError:
            pass
    return path


def file_sha256(file_path: str) -> str | None:
    """Stream-compute the SHA-256 hex digest of a stored file, or None if unreadable."""
    try:
        path = resolve_stored_file_path(file_path)
        if not path.is_file():
            return None
        digest = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(_CHUNK_SIZE):
                digest.update(chunk)
        return digest.hexdigest()
    except Exception:
        logger.warning("Could not fingerprint stored attachment %s", file_path, exc_info=True)
        return None


def delete_file(file_path: str) -> bool:
    """Delete a stored upload. Missing files are harmless during rollback cleanup."""
    try:
        path = resolve_stored_file_path(file_path)
        if path.exists():
            path.unlink()
        return True
    except Exception:
        logger.error("Failed to delete stored attachment %s", file_path, exc_info=True)
        return False


def _range_chunks(path: Path, start: int, end: int):
    with path.open("rb") as source:
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            chunk = source.read(min(_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def protected_file_response(
    request: Request | None,
    path: Path,
    filename: str,
    media_type: str,
    inline: bool,
):
    """Serve an authorized file, including one RFC 7233 byte range for video seeking."""
    size = path.stat().st_size
    range_header = request.headers.get("range") if request is not None else None
    disposition = "inline" if inline else "attachment"
    common_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(filename)}",
    }
    if not range_header:
        return FileResponse(
            path=str(path),
            filename=filename,
            media_type=media_type,
            content_disposition_type=disposition,
            headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"},
        )
    try:
        unit, value = range_header.strip().split("=", 1)
        if unit.lower() != "bytes" or "," in value:
            raise ValueError
        start_text, end_text = value.split("-", 1)
        if start_text:
            start = int(start_text)
            end = min(int(end_text), size - 1) if end_text else size - 1
        else:
            suffix = int(end_text)
            if suffix <= 0:
                raise ValueError
            start, end = max(0, size - suffix), size - 1
        if start < 0 or start >= size or end < start:
            raise ValueError
    except (TypeError, ValueError):
        raise HTTPException(status_code=416, detail="Requested byte range is not satisfiable", headers={"Content-Range": f"bytes */{size}"}) from None
    headers = {
        **common_headers,
        "Content-Range": f"bytes {start}-{end}/{size}",
        "Content-Length": str(end - start + 1),
    }
    return StreamingResponse(_range_chunks(path, start, end), status_code=206, media_type=media_type, headers=headers)
