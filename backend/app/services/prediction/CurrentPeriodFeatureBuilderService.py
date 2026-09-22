from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

import joblib
import pandas as pd
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.grading.ExaminationCalculator import (
    EXAM_SUBTYPES,
    ExaminationObservation,
    compute_examination_component,
)
from app.services.student_record.StudentRecordService import resolve_subject_grading_weights


MODEL_NAME = "entervene_current_period_grade_rf_v1"
MODEL_PURPOSE = "CURRENT_PERIOD_FINAL_GRADE_PROJECTION"
MODEL_TYPE = "REGRESSOR"
MODELS_DIR = Path(__file__).resolve().parents[3] / "data" / "models"
SCHEMA_PATH = MODELS_DIR / f"{MODEL_NAME}_feature_schema.json"
MODEL_PATH = MODELS_DIR / f"{MODEL_NAME}.joblib"


@dataclass
class ComponentAccumulator:
    earned: float = 0.0
    possible: float = 0.0
    count: int = 0
    over_hps_count: int = 0

    @property
    def percent(self) -> float:
        if self.possible <= 0 or self.count <= 0:
            return 0.0
        return round((self.earned / self.possible) * 100.0, 4)

    @property
    def has_evidence(self) -> float:
        return 1.0 if self.count > 0 else 0.0


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _normalize_subject(subject: Subject) -> str:
    label = subject.subject_codename or subject.subject_name or "UNKNOWN"
    text = re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_").upper()
    return text or "UNKNOWN"


def _evidence_time(submission: StudentSubmission) -> datetime | None:
    return submission.graded_at or submission.submitted_at or submission.created_at


def _select_submission(
    submissions: list[StudentSubmission],
    *,
    cutoff_at: datetime | None,
) -> tuple[StudentSubmission | None, bool]:
    if cutoff_at is not None:
        cutoff = _as_utc(cutoff_at)
        submissions = [
            submission for submission in submissions
            if _evidence_time(submission) is not None and _as_utc(_evidence_time(submission)) <= cutoff
        ]
    if not submissions:
        return None, False
    graded = [submission for submission in submissions if submission.grade is not None]
    if not graded:
        return None, False
    if len(graded) == 1:
        return graded[0], False
    timestamps = [_evidence_time(submission) for submission in graded]
    if any(value is None for value in timestamps):
        return None, True
    latest = max(_as_utc(value) for value in timestamps if value is not None)
    if sum(_as_utc(value) == latest for value in timestamps if value is not None) != 1:
        return None, True
    return graded[[_as_utc(value) for value in timestamps].index(latest)], False


def _classwork_rows(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    cutoff_at: datetime | None,
) -> tuple[list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]], bool]:
    assignments = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            Classwork.subject_id == subject_id,
            ClassworkAssignment.academic_period_id == source_period_id,
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .order_by(ClassworkAssignment.classwork_assignment_id)
        .all()
    )
    assignment_ids = [assignment.classwork_assignment_id for assignment, _ in assignments]
    submissions = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.student_id == student_id,
            StudentSubmission.classwork_assignment_id.in_(assignment_ids),
        )
        .all()
        if assignment_ids
        else []
    )
    grouped: dict[int, list[StudentSubmission]] = {}
    for submission in submissions:
        grouped.setdefault(submission.classwork_assignment_id, []).append(submission)

    rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]] = []
    unresolved = False
    for assignment, classwork in assignments:
        selected, is_unresolved = _select_submission(
            grouped.get(assignment.classwork_assignment_id, []),
            cutoff_at=cutoff_at,
        )
        unresolved = unresolved or is_unresolved
        rows.append((assignment, classwork, selected, is_unresolved))
    return rows, unresolved


def _add_score(accumulator: ComponentAccumulator, score: float | None, possible: float | None) -> None:
    if score is None or possible is None or possible <= 0:
        return
    accumulator.earned += score
    accumulator.possible += possible
    accumulator.count += 1
    if score > possible:
        accumulator.over_hps_count += 1


def _weight_pattern(weights: dict[str, float]) -> str:
    return f"WW{int(round(weights['ww']))}_PT{int(round(weights['pt']))}_QA{int(round(weights['qa']))}"


def load_current_period_feature_schema() -> dict[str, Any]:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def prepare_current_period_frame(features: dict[str, Any], schema: dict[str, Any] | None = None) -> pd.DataFrame:
    schema = schema or load_current_period_feature_schema()
    columns = list(schema["raw_feature_columns"])
    missing = [column for column in columns if column not in features]
    unexpected = [column for column in features if column not in columns]
    if missing:
        raise ValueError(f"Missing current-period model features: {', '.join(missing)}")
    if unexpected:
        raise ValueError(f"Unexpected current-period model features: {', '.join(unexpected)}")
    frame = pd.DataFrame([{column: features[column] for column in columns}], columns=columns)
    for column in schema.get("numeric_features", []):
        frame[column] = pd.to_numeric(frame[column], errors="raise")
    for column in schema.get("categorical_features", []):
        if frame[column].isna().any() or str(frame.iloc[0][column]).strip() == "":
            raise ValueError(f"Missing categorical current-period model feature: {column}")
    return frame


def check_current_period_readiness(features: dict[str, Any], unresolved_evidence: bool = False) -> dict[str, Any]:
    reason_codes: list[str] = []
    if unresolved_evidence:
        reason_codes.append("UNRESOLVED_EVIDENCE")
    if features["overall_available_activity_count"] < 4:
        reason_codes.append("INSUFFICIENT_AVAILABLE_ACTIVITIES")
    if features["ww_has_evidence"] != 1.0:
        reason_codes.append("MISSING_WRITTEN_WORK_EVIDENCE")
    if features["pt_has_evidence"] != 1.0:
        reason_codes.append("MISSING_PERFORMANCE_TASK_EVIDENCE")
    if features["observed_component_weight_sum"] < 70.0:
        reason_codes.append("INSUFFICIENT_OBSERVED_COMPONENT_WEIGHT")

    high = (
        features["overall_available_activity_count"] >= 7
        and features["ww_has_evidence"] == 1.0
        and features["pt_has_evidence"] == 1.0
        and features["qa_has_evidence"] == 1.0
        and features["observed_component_weight_sum"] == 100.0
        and not unresolved_evidence
    )
    standard = (
        features["overall_available_activity_count"] >= 4
        and features["ww_has_evidence"] == 1.0
        and features["pt_has_evidence"] == 1.0
        and features["observed_component_weight_sum"] >= 70.0
        and not unresolved_evidence
    )
    limited = (
        features["overall_available_activity_count"] == 3
        and features["ww_has_evidence"] == 1.0
        and features["pt_has_evidence"] == 1.0
        and not unresolved_evidence
    )
    if high:
        level = "HIGH_EVIDENCE"
    elif standard:
        level = "STANDARD_READY"
    elif limited:
        level = "LIMITED_EVIDENCE"
    else:
        level = "INSUFFICIENT_EVIDENCE"
    return {"ready": standard or high, "readiness_level": level, "reason_codes": reason_codes}


def build_current_period_features_from_records(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    *,
    cutoff_at: datetime | None = None,
) -> dict[str, Any]:
    student = db.get(Student, student_id)
    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    period = db.get(AcademicPeriod, source_period_id)
    if not student or not class_ or not subject or not period:
        raise ValueError("Current-period feature scope references a missing student, class, subject, or period.")

    weights = resolve_subject_grading_weights(db, subject_id, getattr(class_, "academic_level_id", None))
    weight_values = {
        "ww": round(weights.ww_weight * 100.0, 4),
        "pt": round(weights.pt_weight * 100.0, 4),
        "qa": round(weights.qa_weight * 100.0, 4),
    }
    accumulators = {
        "ww": ComponentAccumulator(),
        "pt": ComponentAccumulator(),
    }
    plain_qa = ComponentAccumulator()
    exam_observations: list[ExaminationObservation] = []
    domain_warnings: list[dict[str, Any]] = []

    rows, unresolved = _classwork_rows(db, student_id, class_id, subject_id, source_period_id, cutoff_at)
    for _assignment, classwork, submission, is_unresolved in rows:
        component = classify_classwork_component(
            classwork.classwork_type,
            classwork.classwork_category,
            getattr(classwork, "exam_subtype", None),
        )
        if is_unresolved:
            domain_warnings.append({"code": "UNRESOLVED_SUBMISSION", "classwork_id": classwork.classwork_id})
            continue
        score = _to_float(submission.grade) if submission and submission.grade is not None else None
        possible = _to_float(classwork.total_points)
        if component == CanonicalGradingComponent.WRITTEN_WORK:
            _add_score(accumulators["ww"], score, possible)
        elif component == CanonicalGradingComponent.PERFORMANCE_TASK:
            _add_score(accumulators["pt"], score, possible)
        else:
            if getattr(classwork, "exam_subtype", None):
                exam_observations.append(
                    ExaminationObservation(
                        score=score,
                        possible=possible,
                        exam_subtype=getattr(classwork, "exam_subtype", None),
                        title=getattr(classwork, "title", None),
                        category=getattr(classwork, "classwork_category", None),
                        unresolved=False,
                        administered=True,
                    )
                )
            else:
                _add_score(plain_qa, score, possible)

    exam_result = compute_examination_component(exam_observations, require_complete_for_percent=True)
    domain_warnings.extend(exam_result.warnings)
    qa = ComponentAccumulator()
    if exam_observations:
        qa.over_hps_count = exam_result.score_over_hps_count
        if exam_result.examination_percent is not None:
            qa.count = 1
            qa.possible = 40.0
            qa.earned = round((exam_result.examination_percent / 100.0) * qa.possible, 4)
    elif plain_qa.count:
        qa = plain_qa

    subject_label = _normalize_subject(subject)
    grade_level = getattr(getattr(student, "academic_level", None), "grade_level", None)
    if grade_level is None and getattr(class_, "academic_level", None) is not None:
        grade_level = class_.academic_level.grade_level
    grade_level = float(grade_level) if grade_level is not None else 0.0

    component_data = {
        "ww": accumulators["ww"],
        "pt": accumulators["pt"],
        "qa": qa,
    }
    weighted_scores = {
        key: round(component_data[key].percent * weight_values[key] / 100.0, 4)
        for key in component_data
    }
    observed_component_weight_sum = round(
        sum(weight_values[key] for key, accumulator in component_data.items() if accumulator.count > 0),
        4,
    )
    overall_weighted_score = round(
        sum(weighted_scores[key] for key, accumulator in component_data.items() if accumulator.count > 0),
        4,
    )
    overall_partial_percent = round(
        (overall_weighted_score / observed_component_weight_sum) * 100.0,
        4,
    ) if observed_component_weight_sum else 0.0

    features = {
        "grade_level": grade_level,
        "ww_weight": weight_values["ww"],
        "pt_weight": weight_values["pt"],
        "qa_weight": weight_values["qa"],
        "ww_available_activity_count": float(accumulators["ww"].count),
        "pt_available_activity_count": float(accumulators["pt"].count),
        "qa_available_activity_count": float(qa.count),
        "overall_available_activity_count": float(accumulators["ww"].count + accumulators["pt"].count + qa.count),
        "ww_points_earned_so_far": round(accumulators["ww"].earned, 4),
        "ww_points_possible_so_far": round(accumulators["ww"].possible, 4),
        "ww_percent_so_far": accumulators["ww"].percent,
        "ww_weighted_score_so_far": weighted_scores["ww"],
        "pt_points_earned_so_far": round(accumulators["pt"].earned, 4),
        "pt_points_possible_so_far": round(accumulators["pt"].possible, 4),
        "pt_percent_so_far": accumulators["pt"].percent,
        "pt_weighted_score_so_far": weighted_scores["pt"],
        "qa_points_earned_so_far": round(qa.earned, 4),
        "qa_points_possible_so_far": round(qa.possible, 4),
        "qa_percent_so_far": qa.percent,
        "qa_weighted_score_so_far": weighted_scores["qa"],
        "observed_component_weight_sum": observed_component_weight_sum,
        "overall_weighted_score_so_far": overall_weighted_score,
        "overall_partial_percent": overall_partial_percent,
        "ww_has_evidence": accumulators["ww"].has_evidence,
        "pt_has_evidence": accumulators["pt"].has_evidence,
        "qa_has_evidence": qa.has_evidence,
        "has_any_input_evidence": 1.0 if observed_component_weight_sum > 0 else 0.0,
        "ww_score_over_hps_count_so_far": float(accumulators["ww"].over_hps_count),
        "pt_score_over_hps_count_so_far": float(accumulators["pt"].over_hps_count),
        "qa_score_over_hps_count_so_far": float(qa.over_hps_count),
        "subject": subject_label,
    }

    schema = load_current_period_feature_schema()
    feature_support = schema.get("feature_support_envelopes", {})
    for feature_name, envelope in feature_support.items():
        value = features.get(feature_name)
        if isinstance(value, (int, float)) and (
            value < float(envelope["min"]) or value > float(envelope["max"])
        ):
            domain_warnings.append({
                "code": "FEATURE_ABOVE_TRAINING_RANGE" if value > float(envelope["max"]) else "FEATURE_BELOW_TRAINING_RANGE",
                "feature": feature_name,
                "value": value,
                "training_min": envelope["min"],
                "training_max": envelope["max"],
            })
    if subject_label not in set(schema.get("validated_subjects") or []):
        domain_warnings.append({"code": "UNSUPPORTED_SUBJECT", "subject": subject_label})
    if _weight_pattern(weight_values) not in set(schema.get("validated_weight_combinations") or []):
        domain_warnings.append({"code": "UNSUPPORTED_WEIGHT_PATTERN", "weights": weight_values})

    ordered_features = {column: features[column] for column in schema["raw_feature_columns"]}
    try:
        prepare_current_period_frame(ordered_features, schema)
    except Exception as exc:
        domain_warnings.append({"code": "SCHEMA_INVALID_FEATURE_SET", "message": str(exc)})
        unresolved = True

    readiness = check_current_period_readiness(ordered_features, unresolved)
    return {
        "model_name": MODEL_NAME,
        "model_type": MODEL_TYPE,
        "model_purpose": MODEL_PURPOSE,
        "source_period_id": source_period_id,
        "target_period_id": source_period_id,
        "features": ordered_features,
        "ready": readiness["ready"],
        "readiness_level": readiness["readiness_level"],
        "readiness_reason_codes": readiness["reason_codes"],
        "domain_warnings": domain_warnings,
        "evidence_summary": {
            "cutoff_at": cutoff_at.isoformat() if cutoff_at else None,
            "examination": {
                "examination_percent": exam_result.examination_percent if exam_observations else qa.percent if qa.count else None,
                "subtype_percentages": exam_result.subtype_percentages,
                "complete": exam_result.complete,
                "missing_subtypes": sorted(exam_result.missing_subtypes),
                "unresolved_subtypes": sorted(exam_result.unresolved_subtypes),
            },
        },
    }


def score_current_period_staging(features: dict[str, Any]) -> float:
    schema = load_current_period_feature_schema()
    frame = prepare_current_period_frame(features, schema)
    artifact = joblib.load(MODEL_PATH)
    model = artifact["pipeline"] if isinstance(artifact, dict) and "pipeline" in artifact else artifact
    return float(model.predict(frame)[0])
