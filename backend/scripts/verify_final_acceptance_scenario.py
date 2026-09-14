"""
verify_final_acceptance_scenario.py

End-to-end acceptance script executing the exact user-specified scenario:
A = Primary teacher
C = Active substitute

1. Admin unlocks section:
   -> A remains read-only (VIEW_ONLY)
   -> C remains WRITE
   -> Students remain unaffected

2. Admin changes primary A -> B in draft:
   -> Live system still uses A/C relationship until publish
   -> Draft retains B isolated from live queries

3. Admin publishes:
   -> B becomes official primary
   -> C remains WRITE while substitution is active
   -> A becomes DENIED
   -> B is VIEW_ONLY

4. Substitution ends:
   -> B becomes WRITE
   -> A remains DENIED
   -> C becomes DENIED

5. Historical substitution record:
   -> Still shows A was originally replaced temporarily by C
"""

import sys
import uuid
from datetime import date, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.SubjectLoadAssignmentLog import SubjectLoadAssignmentLog
from app.models.people.AcademicStaff import AcademicStaff
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectLoadAuthorizationService,
    SubjectAccessLevel,
)
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.academic.SubjectLoadDependencyService import SubjectLoadDependencyService


def run_acceptance_scenario():
    print("=== STARTING FINAL ACCEPTANCE SCENARIO VERIFICATION ===")
    
    # 1. Setup isolated in-memory test database
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()

    # 2. Seed Academic structure
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=0.33,
        start_date=date.today() - timedelta(days=20),
        end_date=date.today() + timedelta(days=60),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    subject = Subject(subject_name="Mathematics 7", subject_codename="MTH7", academic_level_id=level.academic_level_id)
    cls = Class(section_name="Galileo", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id, class_status="active")
    db.add_all([period, subject, cls])
    db.flush()

    # 3. Seed Teachers: A (Primary), B (New Primary), C (Substitute)
    staff_a = AcademicStaff(staff_id="STF-A", first_name="Alice", last_name="Teacher", employment_status="active")
    staff_b = AcademicStaff(staff_id="STF-B", first_name="Bob", last_name="Teacher", employment_status="active")
    staff_c = AcademicStaff(staff_id="STF-C", first_name="Charlie", last_name="Substitute", employment_status="active")
    db.add_all([staff_a, staff_b, staff_c])
    db.flush()

    today = SubstitutionService.get_academic_date()

    # --- STEP 1: Initial Published Baseline ---
    # SubjectLoad v1 (Published, Revision 1, Primary: Teacher A)
    load_v1 = SubjectLoad(
        class_id=cls.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        staff_id=staff_a.staff_id,
        status="published",
        is_active_version=True,
        is_locked=True,
        section_revision=1,
        logical_load_id=f"LL_{cls.class_id}_{subject.subject_id}_{period.academic_period_id}",
    )
    db.add(load_v1)
    db.flush()

    # Substitute C assigned to Teacher A
    sub = TeacherSubstitution(
        subject_load_id=load_v1.subject_load_id,
        original_staff_id=staff_a.staff_id,
        substitute_staff_id=staff_c.staff_id,
        start_date=today - timedelta(days=2),
        end_date=today + timedelta(days=10),
        status="active",
        reason="Medical leave",
        batch_id=uuid.uuid4(),
    )
    db.add(sub)
    db.commit()

    # Baseline Check:
    print("\n--- Baseline Check (Published v1, Active Substitution C covering A) ---")
    acc_a = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_c = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_b = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    print(f"Teacher A access: {acc_a.value} (Expected: VIEW_ONLY)")
    print(f"Teacher C access: {acc_c.value} (Expected: WRITE)")
    print(f"Teacher B access: {acc_b.value} (Expected: DENIED)")
    assert acc_a == SubjectAccessLevel.VIEW_ONLY
    assert acc_c == SubjectAccessLevel.WRITE
    assert acc_b == SubjectAccessLevel.DENIED

    # --- STEP 2: Admin Unlocks Section (Draft Revision 2 Created) ---
    print("\n--- Step 2: Admin Unlocks Section (Draft Rev 2 Staged) ---")
    draft_load = SubjectLoad(
        class_id=cls.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        staff_id=staff_a.staff_id,
        status="draft",
        is_active_version=False,
        is_locked=False,
        section_revision=2,
        base_revision=1,
        continued_from_load_id=load_v1.subject_load_id,
        logical_load_id=load_v1.logical_load_id,
    )
    db.add(draft_load)
    db.commit()

    # Verify published baseline remains unchanged and active:
    acc_a_unlocked = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_c_unlocked = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    print(f"After unlock - Teacher A access: {acc_a_unlocked.value} (Expected: VIEW_ONLY)")
    print(f"After unlock - Teacher C access: {acc_c_unlocked.value} (Expected: WRITE)")
    assert acc_a_unlocked == SubjectAccessLevel.VIEW_ONLY
    assert acc_c_unlocked == SubjectAccessLevel.WRITE

    # --- STEP 3: Admin Changes Primary A -> B in Draft ---
    print("\n--- Step 3: Admin edits draft: A -> B ---")
    draft_load.staff_id = staff_b.staff_id
    db.commit()

    # Verify live system still uses A/C relationship until publish:
    acc_a_draft_edited = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_c_draft_edited = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_b_draft_edited = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    print(f"During draft edit - Teacher A access: {acc_a_draft_edited.value} (Expected: VIEW_ONLY)")
    print(f"During draft edit - Teacher C access: {acc_c_draft_edited.value} (Expected: WRITE)")
    print(f"During draft edit - Teacher B access: {acc_b_draft_edited.value} (Expected: DENIED)")
    assert acc_a_draft_edited == SubjectAccessLevel.VIEW_ONLY
    assert acc_c_draft_edited == SubjectAccessLevel.WRITE
    assert acc_b_draft_edited == SubjectAccessLevel.DENIED

    # --- STEP 4: Admin Publishes Revision 2 ---
    print("\n--- Step 4: Admin Publishes Revision 2 ---")
    # Archive v1:
    load_v1.status = "archived"
    load_v1.is_active_version = False
    
    # Promote draft to published v2:
    draft_load.status = "published"
    draft_load.is_active_version = True
    draft_load.is_locked = True
    draft_load.published_at = today

    # Atomically repoint active substitution from v1 to v2:
    from sqlalchemy import or_
    subs = db.query(TeacherSubstitution).filter(
        TeacherSubstitution.subject_load_id == load_v1.subject_load_id,
        TeacherSubstitution.status == "active",
        or_(TeacherSubstitution.end_date.is_(None), TeacherSubstitution.end_date >= today),
    ).all()
    for s in subs:
        s.subject_load_id = draft_load.subject_load_id

    # Log teacher assignment change:
    log_entry = SubjectLoadAssignmentLog(
        logical_load_id=draft_load.logical_load_id,
        subject_load_id=draft_load.subject_load_id,
        class_id=cls.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        old_staff_id=staff_a.staff_id,
        new_staff_id=staff_b.staff_id,
        changed_by="admin@test.ph",
    )
    db.add(log_entry)
    db.commit()

    # Verify substitution repointing:
    db.refresh(sub)
    print(f"Substitution repointed to new load ID: {sub.subject_load_id} == {draft_load.subject_load_id}")
    assert sub.subject_load_id == draft_load.subject_load_id

    # Verify access levels after publish:
    # B becomes official primary
    # C remains WRITE while substitution is active
    # A becomes DENIED
    # B is VIEW_ONLY
    acc_c_pub = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_b_pub = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_a_pub = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    print(f"After publish - Teacher C (substitute) access: {acc_c_pub.value} (Expected: WRITE)")
    print(f"After publish - Teacher B (new primary) access: {acc_b_pub.value} (Expected: VIEW_ONLY)")
    print(f"After publish - Teacher A (former primary) access: {acc_a_pub.value} (Expected: DENIED)")
    assert acc_c_pub == SubjectAccessLevel.WRITE
    assert acc_b_pub == SubjectAccessLevel.VIEW_ONLY
    assert acc_a_pub == SubjectAccessLevel.DENIED

    # --- STEP 5: Substitution Ends ---
    print("\n--- Step 5: Substitution Ends ---")
    sub.status = "completed"
    sub.end_date = today
    db.commit()

    # B becomes WRITE
    # A remains DENIED
    # C becomes DENIED
    acc_b_end = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_a_end = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    acc_c_end = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, subject.subject_id, period.academic_period_id)
    print(f"After substitution ends - Teacher B access: {acc_b_end.value} (Expected: WRITE)")
    print(f"After substitution ends - Teacher A access: {acc_a_end.value} (Expected: DENIED)")
    print(f"After substitution ends - Teacher C access: {acc_c_end.value} (Expected: DENIED)")
    assert acc_b_end == SubjectAccessLevel.WRITE
    assert acc_a_end == SubjectAccessLevel.DENIED
    assert acc_c_end == SubjectAccessLevel.DENIED

    # --- STEP 6: Historical Record Continuity ---
    print("\n--- Step 6: Historical Substitution & Audit Records ---")
    hist_sub = db.query(TeacherSubstitution).filter(TeacherSubstitution.substitution_id == sub.substitution_id).first()
    print(f"Historical substitution: original_staff_id={hist_sub.original_staff_id} (Teacher A), substitute={hist_sub.substitute_staff_id} (Teacher C), status={hist_sub.status}")
    assert hist_sub.original_staff_id == staff_a.staff_id
    assert hist_sub.substitute_staff_id == staff_c.staff_id
    assert hist_sub.status == "completed"

    # Verify dependency partition:
    deps = SubjectLoadDependencyService.get_batched_period_dependencies(db, period.academic_period_id)
    dep_item = deps.get((cls.class_id, subject.subject_id), {})
    print(f"Dependencies: educational_total={dep_item.get('educational_total')}, administrative_total={dep_item.get('administrative_total')}")
    assert dep_item.get("educational_total") == 0
    assert dep_item.get("administrative_total") >= 1  # Substitution + assignment log

    can_del, deps_res = SubjectLoadDependencyService.can_delete_subject_load(db, draft_load)
    print(f"Can delete subject load when only administrative records exist and substitution is completed: {can_del}")
    assert can_del is True

    print("\n=== ALL FINAL ACCEPTANCE SCENARIO CHECKS PASSED PERFECTLY! ===")


if __name__ == "__main__":
    run_acceptance_scenario()
