"""Bounded per-worker flood and concurrency protection; proxy limits supplement it."""
import time
from collections import OrderedDict
from threading import Lock

from starlette.responses import JSONResponse
from app.core.Config import settings


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
            "/invite", "/resend-invitation", "/upload-csv", "/auto-schedule", "/predictions/",
        )):
            allowed = allowed and self.limiter.allow("expensive:" + client, 10)
        if not allowed or self.inflight >= 100:
            return await JSONResponse({"detail": "Too many requests. Please wait."}, 429,
                                      headers={"Retry-After": "60"})(scope, receive, send)
        # Count streamed/chunked bodies too; Content-Length alone is untrusted.
        maximum = 65536 if path.startswith("/api/v1/ai/") else 25 * 1024 * 1024
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
        try:
            await self.app(scope, bounded_receive, send)
        finally:
            self.inflight -= 1
