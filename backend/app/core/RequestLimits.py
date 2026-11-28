"""Bounded per-worker flood and concurrency protection; proxy limits supplement it."""
import re
import time
from collections import OrderedDict
from threading import Lock

from starlette.responses import JSONResponse
from app.core.Config import settings
from app.core.FileUpload import (
    MAX_ATTACHMENT_MULTIPART_REQUEST_SIZE,
    MAX_CONCURRENT_LARGE_ATTACHMENT_UPLOADS,
)


_ATTACHMENT_UPLOAD_PATHS = (
    re.compile(r"^/api/v1/classwork-assignments/with-assignments$"),
    re.compile(r"^/api/v1/classwork-assignments/classwork/\d+/attachments$"),
    re.compile(r"^/api/v1/submissions/assignment/\d+/submit$"),
)


def is_attachment_upload_request(method: str, path: str) -> bool:
    return method == "POST" and any(pattern.fullmatch(path) for pattern in _ATTACHMENT_UPLOAD_PATHS)


class WindowLimiter:
    def __init__(self, capacity=10000):
        self.entries = OrderedDict()
        self.capacity = capacity
        self.lock = Lock()

    def allow(self, key, limit, now=None):
        window = int((time.monotonic() if now is None else now) // 60)
        with self.lock:
            # Entries retain insertion order for their current minute.
            while self.entries and next(iter(self.entries.values()))[0] < window:
                self.entries.popitem(last=False)
            if key not in self.entries and len(self.entries) >= self.capacity:
                return False
            previous_window, count = self.entries.get(key, (window, 0))
            if previous_window != window:
                count = 0
            if count >= limit:
                return False
            self.entries[key] = (window, count + 1)
            return True


login_limiter = WindowLimiter()


class RequestLimitsMiddleware:
    def __init__(self, app):
        self.app = app
        self.limiter = WindowLimiter()
        self.inflight = 0
        self.large_attachment_inflight = 0

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            return await self.app(scope, receive, send)
        path = scope["path"]
        client = (scope.get("client") or ("unknown",))[0]
        is_auth = path.startswith("/api/v1/auth/") and scope["method"] == "POST"
        allowed = self.limiter.allow("global", settings.api_requests_per_minute)
        allowed = allowed and self.limiter.allow("ip:" + client, settings.api_ip_requests_per_minute)
        if is_auth:
            allowed = allowed and self.limiter.allow("auth:" + client, 300)
        if scope["method"] == "POST" and any(part in path for part in (
            "/invite", "/resend-invitation", "/upload-csv", "/predictions/",
        )):
            allowed = allowed and self.limiter.allow("expensive:" + client, 10)
        if not allowed or self.inflight >= 100:
            return await JSONResponse({"detail": "Too many requests. Please wait."}, 429,
                                      headers={"Retry-After": "60"})(scope, receive, send)
        # Count streamed/chunked bodies too; Content-Length alone is untrusted.
        content_type = next(
            (value.decode("latin-1").lower() for name, value in scope.get("headers", []) if name.lower() == b"content-type"),
            "",
        )
        is_attachment_upload = bool(
            is_attachment_upload_request(scope["method"], path)
            and content_type.startswith("multipart/form-data")
        )
        maximum = (
            65536
            if path.startswith("/api/v1/ai/")
            else MAX_ATTACHMENT_MULTIPART_REQUEST_SIZE
            if is_attachment_upload
            else 25 * 1024 * 1024
        )
        content_length = None
        for name, value in scope.get("headers", []):
            if name.lower() == b"content-length":
                try:
                    content_length = int(value)
                except ValueError:
                    content_length = None
                break
        if content_length is not None and content_length > maximum:
            return await JSONResponse({"detail": "Request body is too large."}, 413)(scope, receive, send)
        is_large_attachment_upload = bool(
            is_attachment_upload
            and (content_length is None or content_length > 25 * 1024 * 1024)
        )
        if (
            is_large_attachment_upload
            and self.large_attachment_inflight >= MAX_CONCURRENT_LARGE_ATTACHMENT_UPLOADS
        ):
            return await JSONResponse(
                {"detail": "Too many large uploads are in progress. Please wait."},
                429,
                headers={"Retry-After": "30"},
            )(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > maximum:
                from starlette.exceptions import HTTPException
                raise HTTPException(413, "Request body is too large.")
            return message

        self.inflight += 1
        if is_large_attachment_upload:
            self.large_attachment_inflight += 1
        try:
            await self.app(scope, bounded_receive, send)
        finally:
            self.inflight -= 1
            if is_large_attachment_upload:
                self.large_attachment_inflight -= 1
