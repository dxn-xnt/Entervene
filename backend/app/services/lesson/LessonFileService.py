from pathlib import Path

from fastapi import Request
from starlette.datastructures import UploadFile as StarletteUploadFile


async def files_from_form(request: Request, field_names: set[str]) -> list[StarletteUploadFile]:
    """Read upload files from accepted multipart field names."""
    try:
        form = await request.form()
    except Exception:
        return []

    uploads: list[StarletteUploadFile] = []
    for key, value in form.multi_items():
        if key in field_names and isinstance(value, StarletteUploadFile) and value.filename:
            uploads.append(value)
    return uploads


def resolve_lesson_file_path(stored_path: str) -> Path:
    """Resolve the stored lesson material path before serving a download."""
    return Path(stored_path)
