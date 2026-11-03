"""Explicit, audited live-subject scope for the frozen current-term V3 scorer."""

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.people.Student import Student


JHS_GRADES = frozenset({7, 8, 9, 10})
SHS_GRADES = frozenset({11, 12})
SUPPORTED_GRADES = JHS_GRADES | SHS_GRADES

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

CANONICAL_MODEL_SUBJECTS = frozenset({
    "CREATIVE_TECHNOLOGY",
    "ENGLISH",
    "ICT",
    "MATHEMATICS",
    "SCIENCE",
})

UNSUPPORTED_EXPLICIT_SUBJECTS = frozenset()


def detect_canonical_subject(codename: str | None, name: str | None) -> str | None:
    code = (codename or "").strip().upper()
    nm = (name or "").strip().upper()

    if code in CANONICAL_MODEL_SUBJECTS:
        return code
    if nm in CANONICAL_MODEL_SUBJECTS:
        return nm

    combined = f"{code} {nm}"

    # 1. Mathematics
    if any(k in combined for k in (
        "MATH", "CALCULUS", "ALGEBRA", "GEOMETRY", "TRIGONOMETRY",
        "STATISTICS", "STAT", "FINITE", "PRECAL", "BASICAL", "GENMATH"
    )):
        return "MATHEMATICS"

    # 2. Science
    if any(k in combined for k in (
        "SCIENCE", "SCIE", "BIOLOGY", "BIO", "CHEMISTRY", "CHEM", "PHYSICS", "PHYS"
    )):
        return "SCIENCE"

    # 3. English / Communication
    if any(k in combined for k in (
        "ENGLISH", "COMMUNICATION", "LITERATURE", "MABISANG KOMUNIKASYON"
    )) or " ENG" in f" {combined}" or " COMM" in f" {combined}":
        return "ENGLISH"

    # 4. ICT / Technologies
    if any(k in combined for k in (
        "ICT", "COMPUTER", "PROGRAMMING", "ANIMATION",
        "EMPOWERMENT TECHNOLOGIES", "EMPOTECH", "E-TECHNOLOGY", "E-TECH", "ETECH"
    )):
        return "ICT"

    # 5. Creative Technology
    if "CREATIVE TECH" in combined or "CREATIVETECH" in combined:
        return "CREATIVE_TECHNOLOGY"

    return None


def _normalize_subject_string(subject: Subject) -> str:
    code = (subject.subject_codename or "").strip().upper()
    name = (subject.subject_name or "").strip().upper()
    if code in CANONICAL_MODEL_SUBJECTS:
        return code
    if name in CANONICAL_MODEL_SUBJECTS:
        return name
    return code or name


def resolve_v3_academic_scope(db, class_id: int, subject_id: int) -> dict:
    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    if class_ is None or subject is None:
        return {"supported": False, "reason_codes": ["INVALID_ACADEMIC_SCOPE"]}

    level = db.get(AcademicLevel, class_.academic_level_id)
    grade = level.grade_level if level is not None else None
    if grade not in SUPPORTED_GRADES:
        return {"supported": False, "reason_codes": ["UNSUPPORTED_GRADE_SCOPE"], "grade_level": grade}
    if subject.academic_level_id != class_.academic_level_id:
        return {"supported": False, "reason_codes": ["MISMATCHED_GRADE_SCOPE"], "grade_level": grade}
    if subject.status != "active":
        return {"supported": False, "reason_codes": ["UNSUPPORTED_SUBJECT"], "grade_level": grade}

    code = (subject.subject_codename or "").strip().upper()
    name = (subject.subject_name or "").strip()
    if not code and not name:
        return {"supported": False, "reason_codes": ["UNSUPPORTED_SUBJECT"], "grade_level": grade}

    if code in UNSUPPORTED_EXPLICIT_SUBJECTS or name.upper() in UNSUPPORTED_EXPLICIT_SUBJECTS:
        return {
            "supported": False,
            "reason_codes": ["UNSUPPORTED_SUBJECT"],
            "grade_level": grade,
            "is_provisional": False,
            "validation_status": "UNSUPPORTED",
        }

    if grade in JHS_GRADES:
        key = (grade, subject.subject_codename or "", subject.subject_name)
        canonical = VERIFIED_JHS_SUBJECTS.get(key)
        # Exact canonical labels are retained for existing development/demo scopes.
        if canonical is None and key[1:] in {
            ("MATHEMATICS", "Mathematics"),
            ("SCIENCE", "Science"),
            ("ENGLISH", "English"),
        }:
            canonical = key[1]

        if canonical is not None:
            return {
                "supported": True,
                "reason_codes": [],
                "grade_level": grade,
                "canonical_subject": canonical,
                "is_provisional": False,
                "validation_status": "VALIDATED_JHS",
            }

        # Identifiable JHS subject normalized to trained canonical category
        detected = detect_canonical_subject(code, name)
        if detected is not None:
            return {
                "supported": True,
                "reason_codes": [],
                "grade_level": grade,
                "canonical_subject": detected,
                "is_provisional": True,
                "validation_status": "PROVISIONAL",
            }

        # Other valid JHS subject: uses Random Forest unknown-category handling
        normalized_str = _normalize_subject_string(subject)
        return {
            "supported": True,
            "reason_codes": [],
            "grade_level": grade,
            "canonical_subject": normalized_str,
            "is_provisional": True,
            "validation_status": "PROVISIONAL",
        }

    # Senior High School (Grades 11 and 12)
    detected = detect_canonical_subject(code, name)
    canonical = detected if detected is not None else _normalize_subject_string(subject)
    if not canonical:
        return {
            "supported": False,
            "reason_codes": ["UNSUPPORTED_SUBJECT"],
            "grade_level": grade,
            "is_provisional": True,
            "validation_status": "PROVISIONAL_UNVALIDATED_SHS",
        }

    return {
        "supported": True,
        "reason_codes": [],
        "grade_level": grade,
        "canonical_subject": canonical,
        "is_provisional": True,
        "validation_status": "PROVISIONAL_UNVALIDATED_SHS",
    }


def resolve_v3_scope(db, student_id, class_id: int, subject_id: int) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        return {"supported": False, "reason_codes": ["INVALID_ACADEMIC_SCOPE"]}
    scope = resolve_v3_academic_scope(db, class_id, subject_id)
    if not scope["supported"]:
        return scope
    class_ = db.get(Class, class_id)
    if student.academic_level_id != class_.academic_level_id:
        return {
            "supported": False,
            "reason_codes": ["MISMATCHED_GRADE_SCOPE"],
            "grade_level": scope["grade_level"],
            "is_provisional": scope.get("is_provisional", False),
            "validation_status": scope.get("validation_status"),
        }
    return scope


def canonicalize_v3_features(features: dict, scope: dict) -> dict:
    return {**features, "subject": scope["canonical_subject"]}
