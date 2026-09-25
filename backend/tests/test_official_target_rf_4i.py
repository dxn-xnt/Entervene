import numpy as np
import pandas as pd

from app.ml.EvaluateOfficialTargetRF4I import academic_prediction, folds, measure


def test_fold_plan_separates_students_and_marks_unseen_subject():
    rows = []
    for filename, subject, student in (("A.xlsx", "ENGLISH", "a"), ("B.xlsx", "ENGLISH", "b"),
                                       ("C.xlsx", "ICT", "c")):
        for stage in (0.25, 0.5, 0.75):
            rows.append({"source_file": filename, "subject": subject, "grade_level": 9.0,
                         "raw_student_key": student, "student_period_key": student,
                         "snapshot_fraction": stage})
    plan = folds(pd.DataFrame(rows))
    assert [item["class"] for item in plan] == ["SEEN_SUBJECT_HOLDOUT", "SEEN_SUBJECT_HOLDOUT", "UNSEEN_SUBJECT_HOLDOUT"]
    assert [item["subject_train_periods"] for item in plan] == [1, 1, 0]


def test_historical_academic_baseline_requires_all_components_and_uses_source_table():
    table = [(0.0, 60.0), (80.0, 87.0), (90.0, 95.0), (100.0, 100.0)]
    row = pd.Series({"ww_has_evidence": 1, "pt_has_evidence": 1, "qa_has_evidence": 1,
                     "ww_weight": 20, "pt_weight": 50, "qa_weight": 30,
                     "ww_percent_so_far": 90, "pt_percent_so_far": 90, "qa_percent_so_far": 90})
    assert academic_prediction(row, table) == 95
    row["qa_has_evidence"] = 0
    assert np.isnan(academic_prediction(row, table))
    assert measure([80, 90], [82, 88])["mean_signed_error"] == 0
