"""One teacher-approved reviewer reaches only its Intervention student."""

from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentInterventionReviewers import router as student_router
from app.api.v1.routes.TeacherInterventions import router as teacher_router
from app.db.Session import get_db
from app.models.auth.UserAccount import UserAccount
from app.models.intervention.Intervention import Intervention
from app.models.notifications.Notification import Notification
from app.models.people.Student import Student
from app.schemas.InterventionSupportMaterial import MaterialUpdate
from app.services.NotificationService import get_notifications_for_user
from app.services.intervention.InterventionSupportMaterialService import create_material, update_material
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff


CONTENT = {"title": "Mathematics review", "introduction": "Your teacher prepared a review for you.",
           "body": "Read the examples, try the practice, and ask about unclear steps."}


def _client(ctx, role: str, user_id):
    app = FastAPI()
    app.include_router(teacher_router, prefix="/teacher")
    app.include_router(student_router, prefix="/student")
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {"role": role, "sub": str(user_id)}
    return TestClient(app)


def _setup(ctx):
    db = ctx["db"]
    staff_id = _staff(ctx)
    account = UserAccount(user_id=uuid4(), email=f"reviewer-student-{uuid4().hex[:8]}@example.test", account_status="active")
    db.add(account)
    db.flush()
    ctx["student"].user_id = account.user_id
    row = ctx["candidate"]
    row.status = "ACTIVE"
    row.activated_at = datetime.now(timezone.utc)
    row.activated_by_staff_id = staff_id
    db.commit()
    material = create_material(db, staff_id, _id(ctx), "STUDENT_REVIEWER")
    return material, account


def test_send_is_atomic_private_and_immutable(candidate_context, monkeypatch):
    ctx = candidate_context
    db = ctx["db"]
    material, student_account = _setup(ctx)
    teacher = _client(ctx, "teacher", ctx["staff"].user_id)
    student = _client(ctx, "student", student_account.user_id)
    path = f"/teacher/{_id(ctx)}/materials/{material.material_id}/send"
    assert student.get("/student").json()["total"] == 0
    assert student.get(f"/student/{material.material_id}").status_code == 404

    row = db.get(Intervention, _id(ctx))
    source_id = row.source_prediction_id
    diagnosis = deepcopy(row.diagnosis_snapshot)
    original_basis = deepcopy(material.evidence_basis)
    material_row = db.get(type(row.support_materials[0]), material.material_id)
    material_row.generated_content = {**CONTENT, "body": "Original AI draft."}
    db.commit()
    update_material(db, _staff(ctx), _id(ctx), material.material_id, MaterialUpdate.model_validate({"content": CONTENT}))

    async def no_ai(*args, **kwargs):
        raise AssertionError("Sending must not call AI")

    monkeypatch.setattr("app.services.ai.Provider.generate_text", no_ai)
    sent = teacher.post(path)
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "SENT"
    assert sent.json()["sent_at"]
    assert sent.json()["current_content"] == CONTENT
    assert sent.json()["generated_content"]["body"] == "Original AI draft."
    assert sent.json()["evidence_basis"] == original_basis
    assert teacher.post(path).status_code == 409
    alerts = db.query(Notification).filter_by(notification_type="intervention_reviewer_available").all()
    assert len(alerts) == 1
    assert alerts[0].user_id == student_account.user_id
    assert alerts[0].action_url == f"/student/interventions?reviewer={material.material_id}"
    assert "risk" not in alerts[0].body.lower()
    inbox = get_notifications_for_user(db, student_account.user_id)
    assert [item.notification_type for item in inbox.notifications] == ["intervention_reviewer_available"]
    assert teacher.put(f"/teacher/{_id(ctx)}/materials/{material.material_id}", json={"content": {**CONTENT, "title": "Changed"}}).status_code == 409

    assert student.get("/student").json()["total"] == 1
    visible = student.get(f"/student/{material.material_id}")
    assert visible.status_code == 200
    assert visible.json()["body"] == CONTENT["body"]
    assert "generated_content" not in visible.json()
    assert "evidence_basis" not in visible.json()
    assert db.get(Intervention, _id(ctx)).source_prediction_id == source_id
    assert db.get(Intervention, _id(ctx)).diagnosis_snapshot == diagnosis

    other_account = UserAccount(user_id=uuid4(), email=f"other-student-{uuid4().hex[:8]}@example.test")
    other_student = Student(student_id=uuid4(), student_lrn="300000000099", first_name="Other", last_name="Student", user_id=other_account.user_id)
    db.add_all([other_account, other_student])
    db.commit()
    other = _client(ctx, "student", other_account.user_id)
    assert other.get("/student").json()["total"] == 0
    assert other.get(f"/student/{material.material_id}").status_code == 404

    row = db.get(Intervention, _id(ctx))
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    assert student.get(f"/student/{material.material_id}").status_code == 200


def test_send_rejects_wrong_state_kind_and_roles(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    material, account = _setup(ctx)
    teacher = _client(ctx, "teacher", ctx["staff"].user_id)
    path = f"/teacher/{_id(ctx)}/materials/{material.material_id}/send"
    assert teacher.post(path).status_code == 409  # Empty reviewer.
    assert db.query(Notification).filter_by(notification_type="intervention_reviewer_available").count() == 0
    assessment = create_material(db, _staff(ctx), _id(ctx), "REMEDIAL_ASSESSMENT")
    assert teacher.post(f"/teacher/{_id(ctx)}/materials/{assessment.material_id}/send").status_code == 409
    other = _other_staff(ctx)
    assert _client(ctx, "teacher", other.user_id).post(path).status_code == 404
    assert _client(ctx, "admin", ctx["staff"].user_id).post(path).status_code == 403
    assert _client(ctx, "student", account.user_id).post(path).status_code == 403
    update_material(db, _staff(ctx), _id(ctx), material.material_id, MaterialUpdate.model_validate({"content": CONTENT}))
    row = db.get(Intervention, _id(ctx))
    row.status = "CANDIDATE"
    db.commit()
    assert teacher.post(path).status_code == 409
    assert _client(ctx, "student", account.user_id).get("/student").json()["total"] == 0
    row = db.get(Intervention, _id(ctx))
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    assert teacher.post(path).status_code == 409
    assert _client(ctx, "student", account.user_id).get("/student").json()["total"] == 0
