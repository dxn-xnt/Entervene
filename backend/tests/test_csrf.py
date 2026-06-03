from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import CSRF_COOKIE_NAME
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
