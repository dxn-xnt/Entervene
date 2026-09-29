import uuid
from typing import Any, Literal
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.users.UserShared import capitalize_name

# READ SIDE OF USER MANAGEMENT
# User data is spread across authentication, role, staff/student profile, class,
# and submission tables. This module combines those records for the admin UI.


ClientRole = Literal["admin", "teacher", "student"]


def role_name_to_client_role(role_name: str | None) -> ClientRole:
    role = {"Admin": "admin", "Teacher": "teacher", "Student": "student"}.get(role_name or "")
    return role or "student"


def display_name(first_name: Any, last_name: Any, fallback: str) -> str:
    return " ".join(filter(None, (capitalize_name(first_name), capitalize_name(last_name)))) or fallback


def _base_user_query(db: Session):
    student_academic_level = aliased(AcademicLevel)
    student_grade_level = aliased(AcademicLevel)
    resolved_grade_level = func.coalesce(
        student_academic_level.grade_level,
        student_grade_level.grade_level,
    ).label("grade_level")

    # UserAccount owns authentication state, while role-specific names and
    # profile fields live in either AcademicStaff or Student.
    return (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.avatar_path.label("avatar"),
            UserAccount.created_at,
            UserAccount.account_status,
            UserAccount.email_status,
            Role.role_name,
            AcademicStaff.staff_id,
            AcademicStaff.first_name.label("staff_first_name"),
            AcademicStaff.middle_name.label("staff_middle_name"),
            AcademicStaff.last_name.label("staff_last_name"),
            AcademicStaff.contact_number.label("staff_contact_number"),
            AcademicStaff.address.label("staff_address"),
            AcademicStaff.employment_status,
            Student.student_id,
            Student.first_name.label("student_first_name"),
            Student.middle_name.label("student_middle_name"),
            Student.last_name.label("student_last_name"),
            Student.contact_number.label("student_contact_number"),
            Student.address.label("student_address"),
            resolved_grade_level,
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
        .outerjoin(student_academic_level, Student.academic_level_id == student_academic_level.academic_level_id)
        .outerjoin(student_grade_level, Student.academic_level_id == student_grade_level.grade_level)
    )


def _teacher_summaries(db: Session, teacher_ids: set[str]) -> dict[str, dict[str, Any]]:
    summaries: dict[str, dict[str, Any]] = {}
    if not teacher_ids:
        return summaries

    teacher_loads = (
        db.query(
            SubjectLoad.staff_id,
            Subject.subject_name,
            SubjectLoad.class_id,
            SubjectLoad.start_time,
            SubjectLoad.end_time,
            SubjectLoad.days_of_week,
        )
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .filter(SubjectLoad.staff_id.in_(teacher_ids))
        .filter(SubjectLoad.is_active_version.is_(True))
        .filter(SubjectLoad.status.in_(["active", "published"]))
        .all()
    )
    for load in teacher_loads:
        summary = summaries.setdefault(
            load.staff_id,
            {"subjects": set(), "class_ids": set(), "weekly_minutes": 0, "load_count": 0},
        )
        if load.subject_name:
            summary["subjects"].add(load.subject_name)
        if load.class_id is not None:
            summary["class_ids"].add(load.class_id)
        summary["load_count"] += 1
        if load.start_time and load.end_time and load.days_of_week:
            days_count = len(load.days_of_week) if isinstance(load.days_of_week, list) else 0
            try:
                sh, sm = map(int, load.start_time.split(":"))
                eh, em = map(int, load.end_time.split(":"))
                dur = (eh * 60 + em) - (sh * 60 + sm)
                if dur > 0:
                    summary["weekly_minutes"] += dur * days_count
            except Exception:
                pass
    return summaries


def _student_summaries(db: Session, student_ids: set[uuid.UUID]) -> dict:
    latest_sections = {}
    if not student_ids:
        return latest_sections

    enrollment_rows = (
        db.query(
            StudentClass.student_id,
            Class.section_name,
            AcademicLevel.grade_level,
        )
        .join(Class, Class.class_id == StudentClass.class_id)
        .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(StudentClass.student_id.in_(student_ids))
        .filter(StudentClass.enrollment_status == "enrolled")
        .order_by(StudentClass.student_id, StudentClass.enrolled_at.desc())
        .all()
    )
    for enrollment in enrollment_rows:
        latest_sections.setdefault(enrollment.student_id, {
            "section_name": enrollment.section_name,
            "grade_level": enrollment.grade_level,
        })
    return latest_sections


def list_users(
    db: Session,
    role: ClientRole | None = None,
    search: str | None = None,
    status: str | None = None,
) -> list[dict]:
    query = _base_user_query(db)
    if role:
        query = query.filter(Role.role_name == role.title())
    if status:
        query = query.filter(func.lower(UserAccount.account_status) == status.strip().lower())
    else:
        query = query.filter(func.lower(UserAccount.account_status) != "archived")
    if search:
        keyword = f"%{search.strip()}%"
        query = query.filter(
            or_(
                UserAccount.email.ilike(keyword),
                AcademicStaff.first_name.ilike(keyword),
                AcademicStaff.last_name.ilike(keyword),
                Student.first_name.ilike(keyword),
                Student.last_name.ilike(keyword),
            )
        )

    users = query.order_by(UserAccount.created_at.desc()).all()
    # Fetch role-specific summaries in batches to avoid per-user queries on the
    # admin list page.
    teacher_ids = {user.staff_id for user in users if user.role_name == "Teacher" and user.staff_id}
    student_ids = {user.student_id for user in users if user.role_name == "Student" and user.student_id}
    teacher_summaries = _teacher_summaries(db, teacher_ids)
    latest_sections = _student_summaries(db, student_ids)
    from app.services.academic.SubstitutionService import SubstitutionService
    leave_summaries = SubstitutionService.get_staff_leave_summary(db, teacher_ids)

    response = []
    for user in users:
        client_role = role_name_to_client_role(user.role_name)
        first_name = user.student_first_name if client_role == "student" else user.staff_first_name
        last_name = user.student_last_name if client_role == "student" else user.staff_last_name
        item = {
            "id": str(user.user_id),
            "name": display_name(first_name, last_name, user.email),
            "email": user.email,
            "avatar": user.avatar,
            "role": client_role,
            "created_at": user.created_at.date().isoformat() if user.created_at else "",
            "account_status": user.account_status,
        }
        if user.account_status == "pending":
            item["email_status"] = getattr(user, "email_status", "sent") or "sent"
        if client_role == "teacher" and user.staff_id:
            summary = teacher_summaries.get(user.staff_id, {"subjects": set(), "class_ids": set(), "weekly_minutes": 0, "load_count": 0})
            item["staff_id"] = user.staff_id
            item["employment_status"] = user.employment_status or ""
            item["subjects"] = sorted(summary["subjects"])
            item["class_count"] = len(summary["class_ids"])
            item["workload_hours"] = round(summary["weekly_minutes"] / 60, 1) if summary.get("weekly_minutes") else 0
            item["load_count"] = summary.get("load_count", 0)
            leave_info = leave_summaries.get(user.staff_id, {"is_on_leave": False, "active_substitutions_count": 0})
            item["is_on_leave"] = leave_info["is_on_leave"]
            item["active_substitutions_count"] = leave_info["active_substitutions_count"]
        if client_role == "student" and user.student_id:
            sec_info = latest_sections.get(user.student_id)
            item["section"] = sec_info["section_name"] if sec_info else None
            item["grade_level"] = sec_info["grade_level"] if (sec_info and sec_info.get("grade_level")) else user.grade_level
        response.append(item)
    return response



def _get_teacher_handled_data(db: Session, staff_id: str) -> dict[str, Any]:
    teacher_loads = (
        db.query(
            SubjectLoad.subject_load_id,
            SubjectLoad.class_id,
            SubjectLoad.subject_id,
            SubjectLoad.start_time,
            SubjectLoad.end_time,
            SubjectLoad.days_of_week,
            Subject.subject_name,
            Subject.subject_codename,
            Subject.is_core,
            Class.section_name,
            AcademicLevel.grade_level,
            Class.adviser_staff_id,
        )
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(SubjectLoad.staff_id == staff_id)
        .filter(SubjectLoad.is_active_version.is_(True))
        .filter(SubjectLoad.status.in_(["active", "published"]))
        .all()
    )

    class_ids = sorted({load.class_id for load in teacher_loads if load.class_id is not None})
    class_student_counts: dict[int, int] = {}
    if class_ids:
        counts = (
            db.query(StudentClass.class_id, func.count(StudentClass.student_id))
            .filter(StudentClass.class_id.in_(class_ids))
            .filter(StudentClass.enrollment_status == "enrolled")
            .group_by(StudentClass.class_id)
            .all()
        )
        class_student_counts = {cid: cnt for cid, cnt in counts}

    total_weekly_minutes = 0
    subjects_dict: dict[int, dict[str, Any]] = {}
    classes_dict: dict[int, dict[str, Any]] = {}

    for load in teacher_loads:
        dur_mins = 0
        if load.start_time and load.end_time and load.days_of_week:
            days_count = len(load.days_of_week) if isinstance(load.days_of_week, list) else 0
            try:
                sh, sm = map(int, load.start_time.split(":"))
                eh, em = map(int, load.end_time.split(":"))
                dur = (eh * 60 + em) - (sh * 60 + sm)
                if dur > 0:
                    dur_mins = dur * days_count
                    total_weekly_minutes += dur_mins
            except Exception:
                pass

        sid = load.subject_id
        if sid not in subjects_dict:
            subjects_dict[sid] = {
                "subject_id": sid,
                "subject_name": load.subject_name,
                "subject_code": load.subject_codename or "",
                "is_core": bool(load.is_core),
                "grade_levels": set(),
                "sections": set(),
                "weekly_minutes": 0,
                "load_count": 0,
            }
        s_entry = subjects_dict[sid]
        s_entry["load_count"] += 1
        s_entry["weekly_minutes"] += dur_mins
        if load.grade_level:
            s_entry["grade_levels"].add(f"Grade {load.grade_level}")
        if load.section_name:
            s_entry["sections"].add(load.section_name)

        cid = load.class_id
        if cid not in classes_dict:
            classes_dict[cid] = {
                "class_id": cid,
                "section_name": load.section_name,
                "grade_level": load.grade_level,
                "student_count": class_student_counts.get(cid, 0),
                "is_adviser": load.adviser_staff_id == staff_id,
                "subjects": set(),
                "schedule_slots": [],
            }
        c_entry = classes_dict[cid]
        c_entry["subjects"].add(load.subject_name)
        if load.days_of_week and load.start_time and load.end_time:
            days_str = "/".join(load.days_of_week) if isinstance(load.days_of_week, list) else str(load.days_of_week)
            c_entry["schedule_slots"].append(f"{load.subject_name} ({days_str} {load.start_time}-{load.end_time})")

    adviser_classes = (
        db.query(Class.class_id, Class.section_name, AcademicLevel.grade_level)
        .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Class.adviser_staff_id == staff_id)
        .all()
    )
    for adv_class in adviser_classes:
        if adv_class.class_id not in classes_dict:
            st_cnt = (
                db.query(func.count(StudentClass.student_id))
                .filter(StudentClass.class_id == adv_class.class_id)
                .filter(StudentClass.enrollment_status == "enrolled")
                .scalar()
            ) or 0
            classes_dict[adv_class.class_id] = {
                "class_id": adv_class.class_id,
                "section_name": adv_class.section_name,
                "grade_level": adv_class.grade_level,
                "student_count": st_cnt,
                "is_adviser": True,
                "subjects": set(),
                "schedule_slots": [],
            }

    handled_subjects = []
    for sid, sinfo in subjects_dict.items():
        handled_subjects.append({
            "subject_id": sid,
            "subject_name": sinfo["subject_name"],
            "subject_code": sinfo["subject_code"],
            "is_core": sinfo["is_core"],
            "grade_levels": sorted(sinfo["grade_levels"]),
            "sections": sorted(sinfo["sections"]),
            "class_count": len(sinfo["sections"]),
            "weekly_hours": round(sinfo["weekly_minutes"] / 60, 1),
            "load_count": sinfo["load_count"],
        })
    handled_subjects.sort(key=lambda s: s["subject_name"])

    handled_classes = []
    for cid, cinfo in classes_dict.items():
        handled_classes.append({
            "class_id": cid,
            "section_name": cinfo["section_name"],
            "grade_level": cinfo["grade_level"],
            "student_count": cinfo["student_count"],
            "is_adviser": cinfo["is_adviser"],
            "subjects": sorted(cinfo["subjects"]),
            "schedule_slots": cinfo["schedule_slots"],
        })
    handled_classes.sort(key=lambda c: (c["grade_level"] or 0, c["section_name"]))

    return {
        "handled_subjects": handled_subjects,
        "handled_classes": handled_classes,
        "total_weekly_hours": round(total_weekly_minutes / 60, 1),
        "load_count": len(teacher_loads),
        "class_count": len(classes_dict),
        "subjects": [s["subject_name"] for s in handled_subjects],
        "class_ids": list(classes_dict.keys()),
        "subject_ids": list(subjects_dict.keys()),
    }


def get_user_detail(db: Session, user_id: uuid.UUID) -> dict[str, Any]:
    user = _base_user_query(db).filter(UserAccount.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    client_role = role_name_to_client_role(user.role_name)
    first_name = user.student_first_name if client_role == "student" else user.staff_first_name
    middle_name = user.student_middle_name if client_role == "student" else user.staff_middle_name
    last_name = user.student_last_name if client_role == "student" else user.staff_last_name
    item: dict[str, Any] = {
        "id": str(user.user_id),
        "name": display_name(first_name, last_name, user.email),
        "email": user.email,
        "avatar": user.avatar,
        "role": client_role,
        "created_at": user.created_at.date().isoformat() if user.created_at else "",
        "account_status": user.account_status,
        "email_status": getattr(user, "email_status", "sent") or "sent",
        "first_name": capitalize_name(first_name),
        "middle_name": capitalize_name(middle_name),
        "last_name": capitalize_name(last_name),
        "contact_number": (user.staff_contact_number if client_role != "student" else user.student_contact_number) or "",
        "address": (user.staff_address if client_role != "student" else user.student_address) or "",
    }

    # Add role-specific fields only after the common account/profile data exists.
    if client_role == "teacher" and user.staff_id:
        tdata = _get_teacher_handled_data(db, user.staff_id)
        item["staff_id"] = user.staff_id
        item["employment_status"] = user.employment_status or ""
        item["subjects"] = tdata["subjects"]
        item["class_count"] = tdata["class_count"]
        item["workload_hours"] = tdata["total_weekly_hours"]
        item["load_count"] = tdata["load_count"]
        item["handled_subjects"] = tdata["handled_subjects"]
        item["handled_classes"] = tdata["handled_classes"]

    if client_role == "student" and user.student_id:
        class_row = (
            db.query(Class.section_name)
            .join(StudentClass, Class.class_id == StudentClass.class_id)
            .filter(StudentClass.student_id == user.student_id)
            .filter(StudentClass.enrollment_status == "enrolled")
            .order_by(StudentClass.enrolled_at.desc())
            .first()
        )
        average = (
            db.query(func.avg(StudentSubmission.grade))
            .filter(StudentSubmission.student_id == user.student_id)
            .filter(StudentSubmission.status == "graded")
            .filter(StudentSubmission.grade.isnot(None))
            .scalar()
        )
        student_obj = db.query(Student.prior_gwa).filter(Student.student_id == user.student_id).first()
        active_ay = db.query(AcademicYear.academic_year_id).filter(AcademicYear.is_active.is_(True)).first()
        has_computed = False
        if active_ay is not None:
            has_computed = bool(
                db.query(
                    db.query(StudentPeriodGrade.period_grade_id)
                    .join(Class, Class.class_id == StudentPeriodGrade.class_id)
                    .filter(StudentPeriodGrade.student_id == user.student_id)
                    .filter(Class.academic_year_id < active_ay[0])
                    .filter(
                        or_(
                            StudentPeriodGrade.final_period_grade.isnot(None),
                            StudentPeriodGrade.transmuted_grade.isnot(None),
                            StudentPeriodGrade.initial_grade.isnot(None),
                        )
                    )
                    .exists()
                ).scalar()
            )

        item["student_id"] = str(user.student_id)
        item["section"] = class_row.section_name if class_row else None
        item["grade_level"] = user.grade_level
        item["student_status"] = "No Section Assigned" if not class_row else user.account_status
        item["graduation_year"] = None
        item["last_grade_level"] = user.grade_level
        item["last_section"] = class_row.section_name if class_row else None
        item["average"] = round(float(average)) if average is not None else None
        item["prior_gwa"] = float(student_obj.prior_gwa) if student_obj and student_obj.prior_gwa is not None else None
        item["has_computed_gwa"] = has_computed
    return item


def get_user_analytics(db: Session, user_id: uuid.UUID) -> dict:
    user = _base_user_query(db).filter(UserAccount.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    client_role = role_name_to_client_role(user.role_name)
    if client_role == "student" and user.student_id:
        try:
            return _student_user_analytics(db, user.student_id)
        except Exception:
            return {
                "summary": None,
                "subject_mastery": [],
                "score_trend": [],
                "historical_performance": [],
                "period_performance": [],
                "quarterly_performance": [],
                "subject_breakdown": [],
                "activity_feed": [],
                "classwork": [],
                "lms_behavior": None,
            }
    if client_role == "teacher" and user.staff_id:
        try:
            return _teacher_user_analytics(db, user.staff_id)
        except Exception:
            return {
                "summary": None,
                "subject_mastery": [],
                "score_trend": [],
                "historical_performance": [],
                "period_performance": [],
                "quarterly_performance": [],
                "subject_breakdown": [],
                "activity_feed": [],
                "classwork": [],
                "lms_behavior": None,
            }
    return {
        "summary": None,
        "subject_mastery": [],
        "score_trend": [],
        "historical_performance": [],
        "period_performance": [],
        "quarterly_performance": [],
        "subject_breakdown": [],
        "activity_feed": [],
        "classwork": [],
        "lms_behavior": None,
    }


def _teacher_user_analytics(db: Session, staff_id: str) -> dict:
    tdata = _get_teacher_handled_data(db, staff_id)
    class_ids = tdata["class_ids"]
    subject_ids = tdata["subject_ids"]

    total_students = 0
    if class_ids:
        total_students = (
            db.query(func.count(func.distinct(StudentClass.student_id)))
            .filter(StudentClass.class_id.in_(class_ids))
            .filter(StudentClass.enrollment_status == "enrolled")
            .scalar()
        ) or 0

    avg_grade = None
    if class_ids and subject_ids:
        raw_avg = (
            db.query(func.avg((StudentSubmission.grade / func.nullif(Classwork.total_points, 0)) * 100))
            .join(ClassworkAssignment, ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id)
            .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
            .filter(ClassworkAssignment.class_id.in_(class_ids))
            .filter(Classwork.subject_id.in_(subject_ids))
            .filter(StudentSubmission.status == "graded")
            .filter(StudentSubmission.grade.isnot(None))
            .filter(Classwork.total_points > 0)
            .scalar()
        )
        if raw_avg is not None:
            avg_grade = round(float(raw_avg), 1)

    if avg_grade is None and class_ids:
        period_grade_avg = (
            db.query(func.avg(StudentPeriodGrade.final_period_grade))
            .filter(StudentPeriodGrade.class_id.in_(class_ids))
            .filter(StudentPeriodGrade.final_period_grade.isnot(None))
            .scalar()
        )
        if period_grade_avg is not None:
            avg_grade = round(float(period_grade_avg), 1)

    subject_breakdown = []
    if class_ids:
        for subj in tdata["handled_subjects"]:
            sid = subj["subject_id"]
            sname = subj["subject_name"]
            subj_avg = (
                db.query(func.avg((StudentSubmission.grade / func.nullif(Classwork.total_points, 0)) * 100))
                .join(ClassworkAssignment, ClassworkAssignment.classwork_assignment_id == StudentSubmission.classwork_assignment_id)
                .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
                .filter(ClassworkAssignment.class_id.in_(class_ids))
                .filter(Classwork.subject_id == sid)
                .filter(StudentSubmission.status == "graded")
                .filter(StudentSubmission.grade.isnot(None))
                .filter(Classwork.total_points > 0)
                .scalar()
            )
            val = round(float(subj_avg), 1) if subj_avg is not None else 0
            subject_breakdown.append({"subject": sname, "value": val})

    period_performance = []
    if class_ids:
        periods = (
            db.query(AcademicPeriod.period_code, func.avg(StudentPeriodGrade.final_period_grade))
            .join(StudentPeriodGrade, StudentPeriodGrade.academic_period_id == AcademicPeriod.academic_period_id)
            .filter(StudentPeriodGrade.class_id.in_(class_ids))
            .filter(StudentPeriodGrade.final_period_grade.isnot(None))
            .group_by(AcademicPeriod.period_code, AcademicPeriod.period_order)
            .order_by(AcademicPeriod.period_order.asc())
            .all()
        )
        for p_code, p_avg in periods:
            period_performance.append({
                "period": p_code or "Period",
                "score": round(float(p_avg), 1),
            })

    activity_feed = []
    if subject_ids:
        recent_cw = (
            db.query(Classwork.title, Subject.subject_name, Classwork.created_at)
            .join(Subject, Subject.subject_id == Classwork.subject_id)
            .filter(Classwork.subject_id.in_(subject_ids))
            .order_by(Classwork.created_at.desc())
            .limit(5)
            .all()
        )
        for cw in recent_cw:
            time_str = cw.created_at.strftime("%b %d, %I:%M %p") if cw.created_at else "Recently"
            activity_feed.append({
                "title": f"New classwork added: {cw.title} ({cw.subject_name})",
                "timestamp": time_str,
            })

    return {
        "summary": {
            "workloadHours": tdata["total_weekly_hours"],
            "loadCount": tdata["load_count"],
            "classesHandled": tdata["class_count"],
            "subjectsHandled": len(tdata["handled_subjects"]),
            "totalStudents": total_students,
            "classPerformance": avg_grade if avg_grade is not None else "N/A",
        },
        "handled_subjects": tdata["handled_subjects"],
        "handled_classes": tdata["handled_classes"],
        "subject_mastery": [],
        "score_trend": [],
        "historical_performance": [],
        "period_performance": period_performance,
        "quarterly_performance": period_performance,
        "subject_breakdown": subject_breakdown,
        "activity_feed": activity_feed,
        "classwork": [],
        "lms_behavior": None,
    }


def _student_user_analytics(db: Session, student_id: uuid.UUID) -> dict:
    enrollment = _latest_student_enrollment(db, student_id)
    assignment_rows = _student_assignment_rows(db, student_id)
    submissions_by_assignment = _student_submissions_by_assignment(db, student_id)
    metrics = _student_metric_summary(assignment_rows, submissions_by_assignment)
    return {
        "summary": {
            "writtenWorksAverage": metrics["written_work_average"],
            "performanceAverage": metrics["performance_average"],
            "completionRate": metrics["completion_rate"],
            "failureRisk": "Unavailable - prediction module has no saved result",
            "modelConfidence": "Unavailable",
        },
        "subject_mastery": _student_subject_mastery(assignment_rows, submissions_by_assignment),
        "score_trend": _student_score_trend(db, student_id),
        "historical_performance": [],
        "period_performance": [],
        "quarterly_performance": [],
        "subject_breakdown": [],
        "activity_feed": [],
        "classwork": _student_classwork_rows(assignment_rows, submissions_by_assignment),
        "lms_behavior": {
            "totalLogins": "Unavailable",
            "averageSession": "Unavailable",
            "missedActivities": metrics["missing_count"],
            "onTimeSubmissions": (
                f"{metrics['on_time_rate']}%" if metrics["on_time_rate"] is not None else "Unavailable"
            ),
            "note": "Login/session tracking is not available yet.",
            "section": enrollment[1].section_name if enrollment else None,
        },
    }


def _latest_student_enrollment(db: Session, student_id: uuid.UUID):
    return (
        db.query(StudentClass, Class)
        .join(Class, Class.class_id == StudentClass.class_id)
        .filter(StudentClass.student_id == student_id)
        .filter(StudentClass.enrollment_status == "enrolled")
        .order_by(StudentClass.enrolled_at.desc())
        .first()
    )


def _student_assignment_rows(db: Session, student_id: uuid.UUID) -> list[tuple[ClassworkAssignment, Classwork, Subject]]:
    class_ids = [
        row.class_id
        for row in db.query(StudentClass.class_id)
        .filter(StudentClass.student_id == student_id)
        .filter(StudentClass.enrollment_status == "enrolled")
        .all()
    ]
    if not class_ids:
        return []
    return (
        db.query(ClassworkAssignment, Classwork, Subject)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Subject, Subject.subject_id == Classwork.subject_id)
        .filter(ClassworkAssignment.class_id.in_(class_ids))
        .filter(or_(ClassworkAssignment.recipient_student_id.is_(None), ClassworkAssignment.recipient_student_id == student_id))
        .filter(Classwork.is_archived.is_(False))
        .filter(Classwork.is_graded.is_(True))
        .filter(Classwork.classwork_type != "READING")
        .order_by(ClassworkAssignment.due_date.asc().nullslast(), Classwork.created_at.asc())
        .all()
    )


def _student_submissions_by_assignment(
    db: Session,
    student_id: uuid.UUID,
) -> dict[int, StudentSubmission]:
    submissions = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.student_id == student_id)
        .order_by(StudentSubmission.submitted_at.desc().nullslast(), StudentSubmission.submission_id.desc())
        .all()
    )
    grouped: dict[int, StudentSubmission] = {}
    for submission in submissions:
        grouped.setdefault(submission.classwork_assignment_id, submission)
    return grouped


def _student_metric_summary(
    assignment_rows: list[tuple[ClassworkAssignment, Classwork, Subject]],
    submissions_by_assignment: dict[int, StudentSubmission],
) -> dict[str, Any]:
    category_points: dict[str, dict[str, Decimal]] = {}
    completed_count = 0
    missing_count = 0
    on_time_count = 0
    turned_in_count = 0
    now = datetime.now(timezone.utc)

    for assignment, classwork, _ in assignment_rows:
        if not getattr(classwork, "is_graded", True) or (getattr(classwork, "classwork_type", "") or "").upper() == "READING":
            continue
        submission = submissions_by_assignment.get(assignment.classwork_assignment_id)
        status = _submission_status(assignment, submission, now)
        if status in {"submitted", "graded", "late"}:
            completed_count += 1
            turned_in_count += 1
            if status != "late":
                on_time_count += 1
        if status == "missing":
            missing_count += 1
        if submission and submission.status == "graded" and submission.grade is not None and classwork.total_points:
            category = classwork.classwork_category or "UNCATEGORIZED"
            bucket = category_points.setdefault(category, {"earned": Decimal("0"), "possible": Decimal("0")})
            bucket["earned"] += Decimal(str(submission.grade))
            bucket["possible"] += Decimal(str(classwork.total_points))

    return {
        "written_work_average": _bucket_percent(category_points.get("WRITTEN_WORK")),
        "performance_average": _bucket_percent(category_points.get("PERFORMANCE_TASK")),
        "completion_rate": _ratio(completed_count, len(assignment_rows)),
        "missing_count": missing_count,
        "on_time_rate": _ratio(on_time_count, turned_in_count),
    }


def _student_subject_mastery(
    assignment_rows: list[tuple[ClassworkAssignment, Classwork, Subject]],
    submissions_by_assignment: dict[int, StudentSubmission],
) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, Any]] = {}
    for assignment, classwork, subject in assignment_rows:
        if not getattr(classwork, "is_graded", True) or (getattr(classwork, "classwork_type", "") or "").upper() == "READING":
            continue
        submission = submissions_by_assignment.get(assignment.classwork_assignment_id)
        if not submission or submission.status != "graded" or submission.grade is None or not classwork.total_points:
            continue
        bucket = buckets.setdefault(
            subject.subject_id,
            {"subject": subject.subject_name, "earned": Decimal("0"), "possible": Decimal("0")},
        )
        bucket["earned"] += Decimal(str(submission.grade))
        bucket["possible"] += Decimal(str(classwork.total_points))
    return [
        {"subject": bucket["subject"], "value": _bucket_percent(bucket)}
        for bucket in sorted(buckets.values(), key=lambda item: str(item["subject"]).lower())
        if _bucket_percent(bucket) is not None
    ]


def _student_score_trend(db: Session, student_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (
        db.query(StudentPeriodGrade, AcademicPeriod)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == StudentPeriodGrade.academic_period_id)
        .filter(StudentPeriodGrade.student_id == student_id)
        .order_by(AcademicPeriod.start_date.asc(), AcademicPeriod.period_sequence.asc())
        .all()
    )
    trend = []
    for grade, period in rows:
        score = _official_grade_value(grade)
        if score is not None:
            trend.append({"month": period.period_name, "score": score})
    return trend


def _student_classwork_rows(
    assignment_rows: list[tuple[ClassworkAssignment, Classwork, Subject]],
    submissions_by_assignment: dict[int, StudentSubmission],
) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    rows = []
    for assignment, classwork, subject in assignment_rows[:20]:
        submission = submissions_by_assignment.get(assignment.classwork_assignment_id)
        status = _submission_status(assignment, submission, now)
        rows.append({
            "name": classwork.title,
            "type": classwork.classwork_type,
            "subject": subject.subject_name,
            "status": _display_status(status),
            "score": (
                f"{float(submission.grade):g}/{float(classwork.total_points):g}"
                if submission and submission.grade is not None and classwork.total_points is not None
                else "Not graded"
            ),
        })
    return rows


def _submission_status(
    assignment: ClassworkAssignment,
    submission: StudentSubmission | None,
    now: datetime,
) -> str:
    if submission:
        status = (submission.status or "pending").lower()
        if status == "submitted" and _is_late(assignment, submission):
            return "late"
        if status == "missed":
            return "missing"
        return status
    if assignment.due_date and _as_aware(assignment.due_date) < now:
        return "missing"
    return "pending"


def _is_late(assignment: ClassworkAssignment, submission: StudentSubmission) -> bool:
    if not assignment.due_date or not submission.submitted_at:
        return False
    return _as_aware(submission.submitted_at) > _as_aware(assignment.due_date)


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _official_grade_value(row: StudentPeriodGrade) -> float | None:
    for value in (row.final_period_grade, row.transmuted_grade, row.initial_grade):
        if value is not None:
            return round(float(value), 2)
    return None


def _bucket_percent(bucket: dict[str, Decimal] | None) -> float | None:
    if not bucket or bucket["possible"] <= 0:
        return None
    return round(float((bucket["earned"] / bucket["possible"]) * Decimal("100")), 2)


def _ratio(part: int, whole: int) -> float | None:
    if whole <= 0:
        return None
    return round((part / whole) * 100, 2)


def _display_status(status: str) -> str:
    labels = {
        "graded": "Graded",
        "submitted": "Submitted",
        "late": "Late",
        "missing": "Missing",
        "pending": "Pending",
    }
    return labels.get(status, status.replace("_", " ").title())
