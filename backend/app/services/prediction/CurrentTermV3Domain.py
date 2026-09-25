"""Explicit, audited live-subject scope for the frozen current-term V3 scorer."""

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.people.Student import Student


SUPPORTED_GRADES = frozenset({7, 8, 9, 10})

# Grade, exact live code, exact live name -> frozen model label. Enhanced
# subjects, TLE composites, and SHS subjects need separate client evidence.
VERIFIED_JHS_SUBJECTS = {
    (7, "MATH7", "Mathematics 7"): "MATHEMATICS",
    (7, "SCI7", "Science 7"): "SCIENCE",
    (7, "ENG7", "English 7"): "ENGLISH",
    (8, "ENG8", "English 8"): "ENGLISH",
    (9, "ENG9", "English 9"): "ENGLISH",
    (10, "MATH10", "Mathematics 10"): "MATHEMATICS",
    (10, "SCI10", "Science 10"): "SCIENCE",
}

UNVERIFIED_ENHANCED_SUBJECTS = frozenset({"EMATH8", "ESCIE8", "MATH9", "SCI9"})


def resolve_v3_scope(db, student_id, class_id: int, subject_id: int) -> dict:
    student = db.get(Student, student_id)
    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    if student is None or class_ is None or subject is None:
        return {"supported": False, "reason_codes": ["INVALID_ACADEMIC_SCOPE"]}

    level = db.get(AcademicLevel, class_.academic_level_id)
    grade = level.grade_level if level is not None else None
    if grade not in SUPPORTED_GRADES:
        return {"supported": False, "reason_codes": ["UNSUPPORTED_GRADE_SCOPE"], "grade_level": grade}
    if student.academic_level_id != class_.academic_level_id or subject.academic_level_id != class_.academic_level_id:
        return {"supported": False, "reason_codes": ["MISMATCHED_GRADE_SCOPE"], "grade_level": grade}
    if subject.status != "active":
        return {"supported": False, "reason_codes": ["UNSUPPORTED_SUBJECT"], "grade_level": grade}

    key = (grade, subject.subject_codename or "", subject.subject_name)
    canonical = VERIFIED_JHS_SUBJECTS.get(key)
    # Exact canonical labels are retained for existing development/demo scopes.
    if canonical is None and key[1:] in {
        ("MATHEMATICS", "Mathematics"),
        ("SCIENCE", "Science"),
        ("ENGLISH", "English"),
    }:
        canonical = key[1]
    if canonical is None:
        if key[1] in {"TLE8", "TLE9"}:
            reason = "CLIENT_CONFIRMATION_REQUIRED"
        elif key[1] in UNVERIFIED_ENHANCED_SUBJECTS:
            reason = "MAPPING_UNVERIFIED"
        else:
            reason = "UNSUPPORTED_SUBJECT"
        return {"supported": False, "reason_codes": [reason], "grade_level": grade}
    return {"supported": True, "reason_codes": [], "grade_level": grade, "canonical_subject": canonical}


def canonicalize_v3_features(features: dict, scope: dict) -> dict:
    return {**features, "subject": scope["canonical_subject"]}
