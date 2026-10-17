import re, sys

files = [
    "tests/test_classwork_submission_authorization.py",
    "tests/test_intervention_practice_treatment.py",
    "tests/test_prediction_outcome_service.py",
    "tests/test_student_period_grade_finalization.py",
    "tests/test_subject_admin_api.py",
    "tests/test_subject_archive_guard.py",
    "tests/test_subject_import_api.py",
    "tests/test_subject_loads_and_settings.py",
    "tests/test_targeted_gradebook_integrity.py",
    "tests/test_targeted_remedial_classwork.py",
    "tests/test_teacher_dashboard_health.py",
]

for f in files:
    print(f"\n==================== {f} ====================")
    try:
        with open(f, "r", encoding="utf-8", errors="replace") as fp:
            lines = fp.readlines()
        for idx, line in enumerate(lines, 1):
            if re.search(r"SubjectGroup|subject_group|default_grading_template|subject-groups", line, re.IGNORECASE):
                # Clean line for printing
                clean = line.rstrip().encode("ascii", errors="replace").decode("ascii")
                print(f"{idx:4d}: {clean}")
    except Exception as e:
        print("ERROR:", e)
