from datetime import date, timedelta
from sqlalchemy.orm import joinedload

from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.auth.Role import Role
from app.services.academic.ConflictDetectorService import times_overlap, parse_time_to_minutes


def scheduled(load):
    start = parse_time_to_minutes(load.start_time)
    end = parse_time_to_minutes(load.end_time)
    return bool(load.days_of_week and start is not None and end is not None and end > start)


def bounds(load, start, end):
    return (max(start, load.period.start_date, load.effective_from or date.min),
            min(end or date.max, load.period.end_date, load.effective_to or date.max))


def overlap(a, b, a_dates, b_dates):
    start, end = max(a_dates[0], b_dates[0]), min(a_dates[1], b_dates[1])
    if start > end or not times_overlap(a.start_time, a.end_time, b.start_time, b.end_time):
        return False
    days = {d.upper() for d in (a.days_of_week or [])} & {d.upper() for d in (b.days_of_week or [])}
    return any((start + timedelta(days=i)).strftime('%A').upper() in days
               for i in range(min(7, (end - start).days + 1)))


def availability(db, loads, start, end):
    original_ids = {load.staff_id for load in loads}
    teachers = (db.query(AcademicStaff).join(UserAccount, AcademicStaff.user_id == UserAccount.user_id)
                .join(UserRoles, UserRoles.user_id == UserAccount.user_id)
                .join(Role, Role.role_id == UserRoles.role_id)
                .filter(UserAccount.account_status == 'active', Role.role_name == 'teacher').all())
    schedules = db.query(SubjectLoad).options(joinedload(SubjectLoad.period)).filter(SubjectLoad.is_active_version.is_(True),
                                            SubjectLoad.status.in_(['published', 'active'])).all()
    substitutions = db.query(TeacherSubstitution).filter(TeacherSubstitution.status == 'active').all()
    load_map = {load.subject_load_id: load for load in schedules}
    selected_ids = {load.subject_load_id for load in loads}
    result = []
    for teacher in teachers:
        if teacher.staff_id in original_ids:
            continue
        reason = None
        unknown = any(not scheduled(load) for load in loads)
        commitments = [(load, bounds(load, start, end)) for load in schedules
                       if load.staff_id == teacher.staff_id and load.subject_load_id not in selected_ids]
        for sub in substitutions:
            load = load_map.get(sub.subject_load_id)
            if load is None:
                continue
            dates = bounds(load, max(start, sub.start_date), min(end or date.max, sub.end_date or date.max))
            if dates[0] > dates[1]:
                continue
            if sub.subject_load_id in selected_ids:
                reason = 'A selected load already has substitute coverage for these dates.'
            if sub.substitute_staff_id == teacher.staff_id:
                commitments.append((load, dates))
        for index, target in enumerate(loads):
            target_dates = bounds(target, start, end)
            for other, dates in commitments + [(item, bounds(item, start, end)) for item in loads[:index]]:
                if max(target_dates[0], dates[0]) > min(target_dates[1], dates[1]):
                    continue
                if not scheduled(other):
                    unknown = True
                if overlap(target, other, target_dates, dates):
                    reason = 'Schedule conflict with an existing or selected teaching load.'
        result.append({'staff_id': teacher.staff_id,
                       'status': 'conflict' if reason else 'unverified' if unknown else 'recommended',
                       'reason': reason or ('Schedule cannot be verified: a teaching load has no fixed schedule.' if unknown else None)})
    return sorted(result, key=lambda item: (item['status'] != 'recommended', item['status'] == 'conflict', item['staff_id']))
