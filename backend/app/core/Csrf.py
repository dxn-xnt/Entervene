from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.api.v1.routes.Auth import CSRF_COOKIE_NAME


class CSRFMiddleware(BaseHTTPMiddleware):
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}
    exempt_paths = {"/api/v1/auth/login"}

    async def dispatch(self, request: Request, call_next) -> Response:
        if (
            request.method in self.unsafe_methods
            and request.url.path.startswith("/api/")
            and request.url.path not in self.exempt_paths
            and request.cookies.get(CSRF_COOKIE_NAME)
        ):
            csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
            csrf_header = request.headers.get("X-CSRF-Token")
            if not csrf_header or csrf_header != csrf_cookie:
                return JSONResponse({"detail": "Invalid CSRF token"}, status_code=403)

        return await call_next(request)
