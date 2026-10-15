from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.api.v1.routes.Auth import CSRF_COOKIE_NAME


class CSRFMiddleware(BaseHTTPMiddleware):
    unsafe_methods = {"POST", "PUT", "PATCH", "DELETE"}
    exempt_paths = {
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/auth/logout",
        "/api/v1/auth/accept-invitation",
        "/api/v1/auth/forgot-password",
        "/api/v1/auth/reset-password",
    }

    async def dispatch(self, request: Request, call_next) -> Response:
        normalized_path = request.url.path.rstrip("/")
        if (
            request.method in self.unsafe_methods
            and request.url.path.startswith("/api/")
            and normalized_path not in self.exempt_paths
            and request.cookies.get(CSRF_COOKIE_NAME)
        ):
            csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
            csrf_header = request.headers.get("X-CSRF-Token")
            if not csrf_header or csrf_header != csrf_cookie:
                return JSONResponse({"detail": "Invalid CSRF token"}, status_code=403)

        response = await call_next(request)
        # Always reflect the CSRF token in response headers when present in cookies,
        # so frontend clients on a different port/host always have an up-to-date token
        # across any request (not only /auth/me).
        csrf_token = request.cookies.get(CSRF_COOKIE_NAME)
        if csrf_token and "X-CSRF-Token" not in response.headers:
            response.headers["X-CSRF-Token"] = csrf_token
        return response
