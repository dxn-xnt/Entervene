"""Student-safe persistent Intervention reads alongside the legacy suggestions."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentPersistentInterventions import router
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.services.intervention.InterventionSupportMaterialService import create_material
from app.services.intervention.TeacherInterventionService import activate_teacher_candidate
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _client(ctx, user_id, role="student"):
    app = FastAPI()
    app.include_router(router, prefix="/student/interventions")
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {"role": role, "sub": str(user_id)}
    return TestClient(app)


def test_exact_student_sees_only_active_safe_support(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    own_account = UserAccount(user_id=uuid4(), email=f"target-{uuid4().hex[:8]}@example.test")
    other_account = UserAccount(user_id=uuid4(), email=f"classmate-{uuid4().hex[:8]}@example.test")
    other = Student(student_id=uuid4(), student_lrn="300000000098", first_name="Other", last_name="Student", user_id=other_account.user_id)
    db.add_all([own_account, other_account, other])
    db.flush()
    ctx["student"].user_id = own_account.user_id
    db.add(StudentClass(student_id=other.student_id, class_id=ctx["class"].class_id,
                        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled"))
    db.commit()
    own = _client(ctx, own_account.user_id)
    classmate = _client(ctx, other_account.user_id)
    path = f"/student/interventions/{_id(ctx)}"
    assert own.get("/student/interventions").json()["items"] == []
    assert own.get(path).status_code == 404  # Candidate is teacher-only.
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))

    work = Classwork(title="Focused Mathematics practice", classwork_type="QUIZ", subject_id=ctx["subject"].subject_id,
                     created_by_staff_id=_staff(ctx), is_published=True, total_points=Decimal("10"))
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(classwork_id=work.classwork_id, class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id, assigned_by_staff_id=_staff(ctx), is_published=True,
        recipient_student_id=ctx["student"].student_id, source_intervention_id=_id(ctx), remediation_request_id=uuid4())
    db.add(assignment)
    db.flush()
    db.add(StudentSubmission(student_id=ctx["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id, status="graded", grade=Decimal("10")))
    draft = create_material(db, _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    legacy_before = db.query(StudentSuggestion).count()

    listed = own.get("/student/interventions")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    detail = own.get(path)
    assert detail.status_code == 200
    data = detail.json()
    assert data["status"] == "ACTIVE" and data["subject_name"] == ctx["subject"].subject_name
    assert data["activities"][0]["assignment_id"] == assignment.classwork_assignment_id
    assert data["activities"][0]["grade"] == 10 and data["activities"][0]["total_points"] == 10
    assert data["reviewer_id"] is None
    assert not any(key in data for key in ("diagnosis_snapshot", "source_prediction_id", "remediation_plan"))
    assert classmate.get("/student/interventions").json()["items"] == []
    assert classmate.get(path).status_code == 404
    assert _client(ctx, ctx["staff"].user_id, "teacher").get(path).status_code == 403

    material = db.get(InterventionSupportMaterial, draft.material_id)
    material.status = "SENT"
    material.sent_at = datetime.now(timezone.utc)
    material.sent_by_staff_id = _staff(ctx)
    db.commit()
    assert own.get(path).json()["reviewer_id"] == draft.material_id
    assert classmate.get(path).status_code == 404

    row = ctx["candidate"]
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    assert own.get("/student/interventions").json()["items"] == []
    assert own.get(path).status_code == 404
    assert db.query(StudentSuggestion).count() == legacy_before
