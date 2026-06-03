# app/core/FileUpload.py
"""
File upload utilities for the Entervene LMS.
- Max 4 MB per file
- Only PDF, DOCX, PPTX, JPG, PNG allowed
"""
import os
import uuid
from pathlib import Path
from fastapi import HTTPException
from starlette.datastructures import UploadFile

MAX_FILE_SIZE = 4 * 1024 * 1024  # 4 MB

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".pptx", ".jpg", ".jpeg", ".png"}

ALLOWED_MIME_TYPES = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
}

# Base directory for uploads (relative to backend root)
UPLOAD_BASE_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"


async def validate_file(file: UploadFile) -> None:
    """Validate file extension and size. Raises HTTPException on failure."""
    filename = file.filename
    if not filename:
        raise HTTPException(status_code=400, detail="File must have a name.")

    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Read file content to check size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(content)} bytes). Maximum is {MAX_FILE_SIZE} bytes (4 MB).",
        )

    # Seek back so the file can be read again later
    await file.seek(0)


async def save_file(file: UploadFile, category: str) -> dict:
    """
    Save an uploaded file to disk.

    Args:
        file: The uploaded file
        category: Subfolder name, e.g. 'lessons', 'classworks', 'submissions'

    Returns:
        dict with file_name, file_path, file_type, file_size
    """
    await validate_file(file)

    filename = file.filename or "upload"
    ext = os.path.splitext(filename)[1].lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"

    target_dir = UPLOAD_BASE_DIR / category
    target_dir.mkdir(parents=True, exist_ok=True)

    target_path = target_dir / unique_name

    content = await file.read()
    with open(target_path, "wb") as f:
        f.write(content)

    return {
        "file_name": filename,
        "file_path": str(target_path),
        "file_type": ALLOWED_MIME_TYPES.get(ext, file.content_type or "application/octet-stream"),
        "file_size": len(content),
    }


def delete_file(file_path: str) -> None:
    """Delete a file from disk. Silently ignores missing files."""
    try:
        path = Path(file_path)
        if path.exists():
            path.unlink()
    except Exception:
        pass  # Best-effort deletion
