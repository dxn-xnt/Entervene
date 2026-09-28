"""Read-only resolved history reuses stored work and enforces exact scopes."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentPersistentInterventions import router as student_router
from app.api.v1.routes.StudentInterventionReviewers import router as reviewer_router
from app.api.v1.routes.TeacherInterventions import router as teacher_router
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionSupportMaterialService import create_material
from app.services.intervention.TeacherInterventionService import activate_teacher_candidate
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff


def _client(ctx, router, prefix, role, user_id):
    app = FastAPI()
    app.include_router(router, prefix=prefix)
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {"role": role, "sub": str(user_id)}
    return TestClient(app)


def test_resolved_history_is_scoped_read_only_and_preserves_stored_records(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    own_account = UserAccount(user_id=uuid4(), email=f"history-{uuid4().hex[:8]}@example.test")
    other_account = UserAccount(user_id=uuid4(), email=f"classmate-{uuid4().hex[:8]}@example.test")
    other_student = Student(student_id=uuid4(), student_lrn="300000000097", first_name="Other", last_name="Student", user_id=other_account.user_id)
    db.add_all([own_account, other_account, other_student])
    db.flush()
    ctx["student"].user_id = own_account.user_id
    db.add(StudentClass(student_id=other_student.student_id, class_id=ctx["class"].class_id,
                        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled"))
    db.commit()
    teacher = _client(ctx, teacher_router, "/teacher/interventions", "teacher", ctx["staff"].user_id)
    student = _client(ctx, student_router, "/student/interventions", "student", own_account.user_id)
    reviewers = _client(ctx, reviewer_router, "/student/intervention-reviewers", "student", own_account.user_id)
    classmate = _client(ctx, student_router, "/student/interventions", "student", other_account.user_id)
    path = f"/teacher/interventions/resolved/{_id(ctx)}"
    student_path = f"/student/interventions/resolved/{_id(ctx)}"

    assert teacher.get("/teacher/interventions/resolved").json()["total"] == 0
    assert student.get("/student/interventions/resolved").json()["items"] == []
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    assert teacher.get("/teacher/interventions/resolved").json()["total"] == 0

    work = Classwork(title="Targeted practice", classwork_type="QUIZ", subject_id=ctx["subject"].subject_id,
                     created_by_staff_id=_staff(ctx), is_published=True, total_points=Decimal("10"))
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(classwork_id=work.classwork_id, class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id, assigned_by_staff_id=_staff(ctx), is_published=True,
        recipient_student_id=ctx["student"].student_id, source_intervention_id=_id(ctx), remediation_request_id=uuid4())
    db.add(assignment)
    db.flush()
    submission = StudentSubmission(student_id=ctx["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id, status="graded", grade=Decimal("8"))
    db.add(submission)
    draft = create_material(db, _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    row = ctx["candidate"]
    frozen = row.diagnosis_snapshot.copy()
    source_id = row.source_prediction_id
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()

    listed = teacher.get("/teacher/interventions/resolved")
    assert listed.status_code == 200 and listed.json()["total"] == 1
    assert listed.json()["items"][0]["resolution_reason"] == "IMPROVED_PREDICTION"
    detail = teacher.get(path)
    assert detail.status_code == 200
    teacher_data = detail.json()
    assert teacher_data["source_prediction_id"] == source_id
    assert teacher_data["diagnosis_snapshot"] == frozen
    assert teacher_data["resolved_at"] is not None
    assert teacher_data["targeted_activities"][0]["grade"] == 8
    assert teacher_data["sent_reviewer"] is None
    assert teacher.get(f"/teacher/interventions/active/{_id(ctx)}").status_code == 404
    assert teacher.put(f"/teacher/interventions/{_id(ctx)}/remediation", json={}).status_code == 409
    assert teacher.post(f"/teacher/interventions/{_id(ctx)}/materials", json={"kind": "STUDENT_REVIEWER"}).status_code == 409

    own_history = student.get("/student/interventions/resolved").json()["items"]
    assert len(own_history) == 1 and own_history[0]["status"] == "RESOLVED"
    own_detail = student.get(student_path)
    assert own_detail.status_code == 200
    student_data = own_detail.json()
    assert student_data["activities"][0]["grade"] == 8
    assert student_data["resolution_message"] == "Your progress reached the goal for this support."
    assert student_data["reviewer_id"] is None
    assert reviewers.get(f"/student/intervention-reviewers/{draft.material_id}").status_code == 404
    assert not any(key in student_data for key in ("diagnosis_snapshot", "source_prediction_id", "resolution_reason", "resolution_projection"))
    assert student.get(f"/student/interventions/{_id(ctx)}").status_code == 404
    assert classmate.get("/student/interventions/resolved").json()["items"] == []
    assert classmate.get(student_path).status_code == 404

    other_teacher = _other_staff(ctx)
    outsider = _client(ctx, teacher_router, "/teacher/interventions", "teacher", other_teacher.user_id)
    assert outsider.get("/teacher/interventions/resolved").json()["total"] == 0
    assert outsider.get(path).status_code == 404
    admin = _client(ctx, teacher_router, "/teacher/interventions", "admin", ctx["staff"].user_id)
    assert admin.get("/teacher/interventions/resolved").status_code == 403
    assert admin.get(path).status_code == 403

    material = db.get(InterventionSupportMaterial, draft.material_id)
    material.status = "SENT"
    material.sent_at = datetime.now(timezone.utc)
    material.sent_by_staff_id = _staff(ctx)
    material.current_content = {"title": "Review", "introduction": "Read this", "body": "Practice ratios"}
    db.commit()
    assert student.get(student_path).json()["reviewer_id"] == draft.material_id
    assert reviewers.get(f"/student/intervention-reviewers/{draft.material_id}").json()["body"] == "Practice ratios"
    assert teacher.get(path).json()["sent_reviewer"]["body"] == "Practice ratios"
    assert row.diagnosis_snapshot == frozen and row.source_prediction_id == source_id
    assert db.get(StudentSubmission, submission.submission_id).grade == 8
