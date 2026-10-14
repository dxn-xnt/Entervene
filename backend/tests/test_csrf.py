from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import CSRF_COOKIE_NAME, set_auth_cookies
from app.core.Csrf import CSRFMiddleware


def test_csrf_middleware_rejects_unsafe_request_with_missing_header():
    app = FastAPI()
    app.add_middleware(CSRFMiddleware)

    @app.post("/api/v1/students/example")
    def unsafe_endpoint():
        return {"ok": True}

    client = TestClient(app)
    client.cookies.set(CSRF_COOKIE_NAME, "csrf-value")

    response = client.post("/api/v1/students/example")

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid CSRF token"


def test_csrf_middleware_accepts_matching_double_submit_token():
    app = FastAPI()
    app.add_middleware(CSRFMiddleware)

    @app.post("/api/v1/students/example")
    def unsafe_endpoint():
        return {"ok": True}

    client = TestClient(app)
    client.cookies.set(CSRF_COOKIE_NAME, "csrf-value")

    response = client.post("/api/v1/students/example", headers={"X-CSRF-Token": "csrf-value"})

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_issued_token_can_be_used_when_frontend_cannot_read_api_cookie():
    app = FastAPI()
    app.add_middleware(CSRFMiddleware)

    @app.post("/api/v1/auth/login")
    def login(response: Response):
        set_auth_cookies(response, "access", "refresh")
        return {"ok": True}

    @app.post("/api/v1/students/example")
    def unsafe_endpoint():
        return {"ok": True}

    client = TestClient(app)
    login_response = client.post("/api/v1/auth/login")
    assert login_response.status_code == 200
    token = login_response.headers["X-CSRF-Token"]
    assert token == client.cookies.get(CSRF_COOKIE_NAME)
    assert client.post("/api/v1/students/example").status_code == 403
    assert client.post(
        "/api/v1/students/example", headers={"X-CSRF-Token": token}
    ).status_code == 200


def test_session_probe_returns_csrf_token_even_when_access_is_expired():
    app = FastAPI()
    app.add_middleware(CSRFMiddleware)

    @app.get("/api/v1/auth/me")
    def expired_session():
        return Response(status_code=401)

    client = TestClient(app)
    client.cookies.set(CSRF_COOKIE_NAME, "existing-session-token")
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.headers["X-CSRF-Token"] == "existing-session-token"
