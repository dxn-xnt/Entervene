from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.Dependencies import get_current_user

client = TestClient(app)


def test_admin_forbidden_on_state_mutating_interventions():
    # Override get_current_user dependency to simulate Admin user
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "ADM-001", "role": "admin"}

    try:
        # Attempt manual creation as Admin -> should fail with 403 Forbidden
        res_manual = client.post(
            "/api/v1/suggestions/manual",
            json={
                "resource_type": "LESSON",
                "title": "Admin Created Test",
                "priority": "HIGH",
                "student_id": "00000000-0000-0000-0000-000000000000",
                "subject_id": 1,
                "lesson_id": 1,
            },
        )
        assert res_manual.status_code == 403, f"Expected 403, got {res_manual.status_code}"

        # Attempt approve as Admin -> 403 Forbidden
        res_approve = client.patch("/api/v1/suggestions/1/approve")
        assert res_approve.status_code == 403, f"Expected 403, got {res_approve.status_code}"

        # Attempt dismiss as Admin -> 403 Forbidden
        res_dismiss = client.patch("/api/v1/suggestions/1/dismiss")
        assert res_dismiss.status_code == 403, f"Expected 403, got {res_dismiss.status_code}"

        # Attempt archive as Admin -> 403 Forbidden
        res_archive = client.patch("/api/v1/suggestions/1/archive")
        assert res_archive.status_code == 403, f"Expected 403, got {res_archive.status_code}"

        # Attempt assign-intervention as Admin -> 403 Forbidden
        res_assign = client.post(
            "/api/v1/predictions/100/assign-intervention",
            json={"title": "Test Admin Intervention", "resource_type": "LESSON"},
        )
        assert res_assign.status_code == 403, f"Expected 403, got {res_assign.status_code}"

    finally:
        app.dependency_overrides.clear()
