from __future__ import annotations

from typing import Any

from fastapi import Request
from starlette.responses import JSONResponse


class ContentCloningError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        field: str | None = None,
        retryable: bool = False,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field
        self.retryable = retryable
        super().__init__(message)

    def detail(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "field": self.field,
            "retryable": self.retryable,
        }


async def content_cloning_error_handler(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    if not isinstance(exc, ContentCloningError):
        return JSONResponse(
            status_code=500,
            content={"detail": {"code": "INTERNAL_ERROR", "message": "Internal Server Error"}},
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail()})
