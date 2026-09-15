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
from app.models.ai.AIModelVersion import ModelPurpose
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.ComponentMapper import (
    CanonicalGradingComponent,
    classify_classwork_component,
    normalize_component_token,
)
from app.services.prediction.PredictionFeatureBuilderService import _select_submission
from app.services.student_record.StudentRecordService import _compute_exam_ps, resolve_subject_grading_weights

MODEL_NAME = "entervene_current_period_grade_rf_v1"
MODEL_PURPOSE = ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value
SCHEMA_PATH = Path(__file__).resolve().parents[3] / "data" / "models" / f"{MODEL_NAME}_feature_schema.json"
ARTIFACT_PATH = Path(__file__).resolve().parents[3] / "data" / "models" / f"{MODEL_NAME}.joblib"
COMPONENTS = ("ww", "pt", "qa")
CANONICAL_ASSESSMENT_HPS = 40.0
CANONICAL_COMPONENT_TO_FEATURE = {
    CanonicalGradingComponent.WRITTEN_WORK: "ww",
    CanonicalGradingComponent.PERFORMANCE_TASK: "pt",
    CanonicalGradingComponent.ASSESSMENT: "qa",
}
EXAM_COMPOSITE_SUBTYPES = {"SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"}


@dataclass(frozen=True)
class DomainWarning:
    code: str
    message: str
    feature: str | None = None
    value: Any | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "feature": self.feature,
            "value": self.value,
        }


def load_current_period_feature_schema(schema_path: Path = SCHEMA_PATH) -> dict[str, Any]:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validate_current_period_schema_identity(schema)
    return schema


def validate_current_period_schema_identity(schema: dict[str, Any]) -> None:
    if schema.get("model_name") != MODEL_NAME:
        raise ValueError(f"Unexpected current-period model schema name: {schema.get('model_name')}")
    if schema.get("model_purpose") != MODEL_PURPOSE:
        raise ValueError(f"Unexpected current-period model purpose: {schema.get('model_purpose')}")
    raw_columns = schema.get("raw_feature_columns")
    if not isinstance(raw_columns, list) or not raw_columns:
        raise ValueError("Current-period schema must define raw_feature_columns.")
    if schema.get("raw_feature_count") != len(raw_columns):
        raise ValueError("Current-period schema raw_feature_count does not match raw_feature_columns length.")
    numeric = set(schema.get("numeric_features") or [])
    categorical = set(schema.get("categorical_features") or [])
    if set(raw_columns) != numeric | categorical:
        raise ValueError("Current-period schema raw columns must equal numeric plus categorical features.")
    if categorical != {"subject"}:
        raise ValueError("Current-period v1 expects subject as the only raw categorical feature.")


def _normalize_subject_label(subject: Subject) -> str:
    raw = subject.subject_codename or subject.subject_name or ""
    text = re.sub(r"[^A-Za-z0-9]+", "_", raw).strip("_").upper()
    aliases = {
        "MATH": "MATHEMATICS",
        "SCI": "SCIENCE",
        "ENGLISH": "ENGLISH",
        "MAPEH": "MAPEH",
        "VALUES": "VALUES_EDUCATION",
        "VALUES_ED": "VALUES_EDUCATION",
        "CREATIVE_TECH": "CREATIVE_TECHNOLOGY",
        "PRE_CALCULUS": "MATHEMATICS",
        "PRECALCULUS": "MATHEMATICS",
    }
    return aliases.get(text, text or "UNKNOWN")


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _usable_submission_at_cutoff(submission: StudentSubmission | None, cutoff_at: datetime) -> bool:
    if submission is None:
        return False
    if submission.grade is None:
        return False
    if (submission.status or "").lower() != "graded":
        return False
    observed_at = submission.graded_at or submission.submitted_at
    if observed_at is None:
        return True
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    return observed_at <= cutoff_at


def _component_summary() -> dict[str, dict[str, Any]]:
    return {
        key: {
            "available_activity_count": 0,
            "points_earned_so_far": Decimal("0"),
            "points_possible_so_far": Decimal("0"),
            "score_over_hps_count_so_far": 0,
            "activity_ids": [],
            "submission_ids": [],
        }
        for key in COMPONENTS
    }


def _classwork_evidence_rows(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> tuple[list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]], bool]:
    assignments = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.academic_period_id == academic_period_id,
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .order_by(ClassworkAssignment.classwork_assignment_id)
        .all()
    )
    legacy_exists = (
        db.query(ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.academic_period_id.is_(None),
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .first()
        is not None
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
    rows = build_classwork_evidence_rows_for_student(assignments, submissions)
    return rows, legacy_exists


def build_classwork_evidence_rows_for_student(
    assignments: list[tuple[ClassworkAssignment, Classwork]],
    submissions: list[StudentSubmission],
) -> list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]]:
    grouped: dict[int, list[StudentSubmission]] = {}
    for submission in submissions:
        grouped.setdefault(submission.classwork_assignment_id, []).append(submission)
    rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]] = []
    for assignment, classwork in assignments:
        candidates = grouped.get(assignment.classwork_assignment_id, [])
        selected = _select_submission(candidates)
        rows.append((assignment, classwork, selected, bool(candidates and selected is None)))
    return rows


def _is_exam_composite_part(classwork: Classwork) -> bool:
    subtype = normalize_component_token(getattr(classwork, "exam_subtype", None))
    if subtype in EXAM_COMPOSITE_SUBTYPES:
        return True
    category = normalize_component_token(getattr(classwork, "classwork_category", None))
    classwork_type = normalize_component_token(getattr(classwork, "classwork_type", None))
    return category in {"EXAMS", "EXAM", "SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"} or classwork_type == "EXAM"


def _apply_canonical_exam_composite(
    assessment_rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission]],
    seen_assignment_ids: list[int],
    summary: dict[str, dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    if not seen_assignment_ids:
        return
    complete: dict[str, tuple[float, ClassworkAssignment, StudentSubmission]] = {}
    incomplete_parts: list[int] = []
    for assignment, classwork, submission in assessment_rows:
        subtype = normalize_component_token(getattr(classwork, "exam_subtype", None))
        if subtype not in EXAM_COMPOSITE_SUBTYPES:
            title = normalize_component_token(getattr(classwork, "title", None))
            category = normalize_component_token(getattr(classwork, "classwork_category", None))
            if "SUMMATIVE_1" in {title, category} or "SUMMATIVE_1" in title or "SUMMATIVE_1" in category:
                subtype = "SUMMATIVE_1"
            elif "SUMMATIVE_2" in {title, category} or "SUMMATIVE_2" in title or "SUMMATIVE_2" in category:
                subtype = "SUMMATIVE_2"
            elif any(token in title or token in category for token in ("TERM_EXAM", "PERIODICAL_EXAM", "QUARTERLY_EXAM", "FINAL_EXAM")):
                subtype = "TERM_EXAM"
        if subtype in EXAM_COMPOSITE_SUBTYPES:
            complete[subtype] = (float(submission.grade), assignment, submission)  # type: ignore[arg-type]
        else:
            incomplete_parts.append(assignment.classwork_assignment_id)

    missing = sorted(EXAM_COMPOSITE_SUBTYPES - set(complete))
    if missing or incomplete_parts:
        warnings.append({
            "code": "QA_PARTIAL_COMPONENTS_AVAILABLE",
            "message": "Exam/QA subcomponents exist, but the complete 30/30/40 assessment composite is not yet available for the current-period v1 model.",
            "feature": "qa_has_evidence",
            "value": {
                "available_subtypes": sorted(complete),
                "missing_subtypes": missing,
                "unclassified_assessment_assignment_ids": incomplete_parts,
                "assessment_assignment_ids": seen_assignment_ids,
            },
        })
        return

    ordered_subtypes = ["SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"]
    scores = [complete[subtype][0] for subtype in ordered_subtypes]
    assignments = [complete[subtype][1] for subtype in ordered_subtypes]
    submissions = [complete[subtype][2] for subtype in ordered_subtypes]
    _, _, _, composite_percent = _compute_exam_ps(scores, assignments)
    if composite_percent is None:
        return
    earned = round(float(composite_percent) / 100.0 * CANONICAL_ASSESSMENT_HPS, 4)
    bucket = summary["qa"]
    bucket["available_activity_count"] = 1
    bucket["points_earned_so_far"] = Decimal(str(earned))
    bucket["points_possible_so_far"] = Decimal(str(CANONICAL_ASSESSMENT_HPS))
    bucket["score_over_hps_count_so_far"] = 1 if earned > CANONICAL_ASSESSMENT_HPS else 0
    bucket["activity_ids"] = [assignment.classwork_assignment_id for assignment in assignments]
    bucket["submission_ids"] = [submission.submission_id for submission in submissions]


def _component_weight_pattern(features: dict[str, Any]) -> str:
    return f"WW{int(round(features['ww_weight']))}_PT{int(round(features['pt_weight']))}_QA{int(round(features['qa_weight']))}"


def _readiness(features: dict[str, Any]) -> dict[str, Any]:
    overall_count = int(features["overall_available_activity_count"])
    ww = int(features["ww_has_evidence"])
    pt = int(features["pt_has_evidence"])
    qa = int(features["qa_has_evidence"])
    observed_weight = float(features["observed_component_weight_sum"])
    reasons: list[str] = []
    if overall_count < 4:
        reasons.append("At least 4 graded activities are required for STANDARD_READY.")
    if ww != 1:
        reasons.append("Written Works graded evidence is required.")
    if pt != 1:
        reasons.append("Performance Task graded evidence is required.")
    if observed_weight < 70:
        reasons.append("At least 70% observed component weight is required.")
    standard = overall_count >= 4 and ww == 1 and pt == 1 and observed_weight >= 70
    high = standard and overall_count >= 7 and qa == 1 and observed_weight == 100
    limited = not standard and overall_count >= 3 and ww == 1 and pt == 1
    if high:
        level = "HIGH_EVIDENCE"
    elif standard:
        level = "STANDARD_READY"
    elif limited:
        level = "LIMITED_EVIDENCE"
    else:
        level = "INSUFFICIENT_EVIDENCE"
    return {
        "ready": level in {"STANDARD_READY", "HIGH_EVIDENCE"},
        "readiness_level": level,
        "reasons": [] if level in {"STANDARD_READY", "HIGH_EVIDENCE"} else reasons,
    }


def validate_current_period_feature_contract(features: dict[str, Any], schema: dict[str, Any] | None = None) -> None:
    schema = schema or load_current_period_feature_schema()
    validate_current_period_schema_identity(schema)
    raw_columns = list(schema["raw_feature_columns"])
    actual_columns = list(features.keys())
    if actual_columns != raw_columns:
        missing = [name for name in raw_columns if name not in features]
        extra = [name for name in actual_columns if name not in raw_columns]
        raise ValueError(f"Current-period raw feature schema mismatch. missing={missing}; extra={extra}")
    numeric = set(schema["numeric_features"])
    for name in raw_columns:
        value = features[name]
        if value is None:
            raise ValueError(f"Missing required current-period feature: {name}")
        if name in numeric:
            if isinstance(value, bool):
                raise ValueError(f"Boolean is not a valid numeric current-period feature value: {name}")
            try:
                float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Non-numeric current-period feature value for {name}: {value!r}") from exc
        elif name == "subject" and not isinstance(value, str):
            raise ValueError("Current-period subject feature must be a string.")


def domain_warnings(features: dict[str, Any], schema: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[DomainWarning] = []
    supported_subjects = set(schema.get("encoded_feature_names", []))
    subject_token = f"cat__subject_{features['subject']}"
    if subject_token not in supported_subjects:
        warnings.append(DomainWarning("UNSUPPORTED_SUBJECT", "Subject is outside the current-period model training support.", "subject", features["subject"]))
    pattern = _component_weight_pattern(features)
    if pattern not in set(schema.get("validated_weight_combinations") or []):
        warnings.append(DomainWarning("UNSUPPORTED_WEIGHT_PATTERN", "Component weight combination is outside the current-period model training support.", "component_weights", pattern))
    envelopes = schema.get("feature_support_envelopes") or {}
    for name, envelope in envelopes.items():
        if name not in features:
            continue
        value = features[name]
        if not isinstance(value, (int, float)):
            continue
        minimum = envelope.get("min")
        maximum = envelope.get("max")
        if minimum is not None and value < float(minimum):
            warnings.append(
                DomainWarning(
                    "FEATURE_BELOW_TRAINING_RANGE",
                    "Feature value is below observed training support; inference may proceed under current policy but remains outside observed training support and carries a domain warning.",
                    name,
                    value,
                )
            )
        if maximum is not None and value > float(maximum):
            warnings.append(
                DomainWarning(
                    "FEATURE_ABOVE_TRAINING_RANGE",
                    "Feature value is above observed training support; inference may proceed under current policy but remains outside observed training support and carries a domain warning.",
                    name,
                    value,
                )
            )
    return [warning.as_dict() for warning in warnings]


def build_current_period_features_from_records(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    *,
    cutoff_at: datetime | None = None,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    schema = schema or load_current_period_feature_schema()
    cutoff_at = cutoff_at or datetime.now(timezone.utc)
    if cutoff_at.tzinfo is None:
        cutoff_at = cutoff_at.replace(tzinfo=timezone.utc)
    student = db.get(Student, student_id)
    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    period = db.get(AcademicPeriod, academic_period_id)
    if student is None:
        raise ValueError("Referenced student was not found.")
    if class_ is None:
        raise ValueError("Referenced class was not found.")
    if subject is None:
        raise ValueError("Referenced subject was not found.")
    if period is None:
        raise ValueError("Referenced academic period was not found.")

    grade_level = getattr(getattr(student, "academic_level", None), "grade_level", None)
    if grade_level is None and getattr(class_, "academic_level", None) is not None:
        grade_level = class_.academic_level.grade_level
    if grade_level is None:
        raise ValueError("Current-period features require a grade level.")

    weights = resolve_subject_grading_weights(db, subject_id, getattr(class_, "academic_level_id", None))
    rows, legacy_classwork_exists = _classwork_evidence_rows(db, student_id, class_id, subject_id, academic_period_id)
    return calculate_current_period_features_from_evidence(
        subject=subject,
        grade_level=float(grade_level),
        weights=weights,
        schema=schema,
        rows=rows,
        legacy_classwork_exists=legacy_classwork_exists,
        academic_period_id=academic_period_id,
        cutoff_at=cutoff_at,
    )


def calculate_current_period_features_from_evidence(
    *,
    subject: Subject,
    grade_level: float,
    weights: Any,
    schema: dict[str, Any],
    rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]],
    legacy_classwork_exists: bool,
    academic_period_id: int,
    cutoff_at: datetime,
) -> dict[str, Any]:
    weight_by_component = {
        "ww": round(float(weights.ww_weight) * 100.0, 4),
        "pt": round(float(weights.pt_weight) * 100.0, 4),
        "qa": round(float(weights.qa_weight) * 100.0, 4),
    }
    summary = _component_summary()
    unresolved_assignment_ids: list[int] = []
    ignored_ungraded_assignment_ids: list[int] = []
    ignored_future_submission_ids: list[int] = []
    ignored_outside_component_ids: list[int] = []
    current_period_warnings: list[dict[str, Any]] = []
    exam_composite_rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission]] = []
    exam_composite_assignment_ids: list[int] = []

    for assignment, classwork, submission, unresolved in rows:
        canonical_component = classify_classwork_component(classwork.classwork_type, classwork.classwork_category, getattr(classwork, "exam_subtype", None))
        component = CANONICAL_COMPONENT_TO_FEATURE.get(canonical_component)
        if component is None:
            ignored_outside_component_ids.append(assignment.classwork_assignment_id)
            continue
        is_exam_composite_part = canonical_component == CanonicalGradingComponent.ASSESSMENT and _is_exam_composite_part(classwork)
        if is_exam_composite_part:
            exam_composite_assignment_ids.append(assignment.classwork_assignment_id)
        if unresolved:
            unresolved_assignment_ids.append(assignment.classwork_assignment_id)
            continue
        if not _usable_submission_at_cutoff(submission, cutoff_at):
            if submission is not None and submission.grade is not None:
                ignored_future_submission_ids.append(submission.submission_id)
            else:
                ignored_ungraded_assignment_ids.append(assignment.classwork_assignment_id)
            continue
        possible = Decimal(str(classwork.total_points or 0))
        if possible <= 0:
            ignored_ungraded_assignment_ids.append(assignment.classwork_assignment_id)
            continue
        if is_exam_composite_part:
            exam_composite_rows.append((assignment, classwork, submission))  # type: ignore[arg-type]
            continue
        earned = Decimal(str(submission.grade))  # type: ignore[arg-type]
        bucket = summary[component]
        bucket["available_activity_count"] += 1
        bucket["points_earned_so_far"] += earned
        bucket["points_possible_so_far"] += possible
        if earned > possible:
            bucket["score_over_hps_count_so_far"] += 1
        bucket["activity_ids"].append(assignment.classwork_assignment_id)
        bucket["submission_ids"].append(submission.submission_id)  # type: ignore[union-attr]

    _apply_canonical_exam_composite(exam_composite_rows, exam_composite_assignment_ids, summary, current_period_warnings)

    raw: dict[str, Any] = {}
    raw["grade_level"] = float(grade_level)
    for component in COMPONENTS:
        raw[f"{component}_weight"] = weight_by_component[component]
    overall_count = 0
    observed_component_weight_sum = 0.0
    overall_weighted_score = 0.0
    for component in COMPONENTS:
        bucket = summary[component]
        count = int(bucket["available_activity_count"])
        earned = float(bucket["points_earned_so_far"])
        possible = float(bucket["points_possible_so_far"])
        percent = (earned / possible * 100.0) if possible > 0 else 0.0
        weighted = percent * weight_by_component[component] / 100.0 if count else 0.0
        has_evidence = 1.0 if count > 0 else 0.0
        raw[f"{component}_available_activity_count"] = float(count)
        if component == "qa":
            # overall count is placed after the three component counts by schema order.
            pass
        overall_count += count
        raw[f"{component}_points_earned_so_far"] = round(earned, 4)
        raw[f"{component}_points_possible_so_far"] = round(possible, 4)
        raw[f"{component}_percent_so_far"] = round(percent, 4)
        raw[f"{component}_weighted_score_so_far"] = round(weighted, 4)
        raw[f"{component}_has_evidence"] = has_evidence
        raw[f"{component}_score_over_hps_count_so_far"] = float(bucket["score_over_hps_count_so_far"])
        if count:
            observed_component_weight_sum += weight_by_component[component]
            overall_weighted_score += weighted
    raw["overall_available_activity_count"] = float(overall_count)
    raw["observed_component_weight_sum"] = round(observed_component_weight_sum, 4)
    raw["overall_weighted_score_so_far"] = round(overall_weighted_score, 4)
    raw["overall_partial_percent"] = round((overall_weighted_score / observed_component_weight_sum * 100.0), 4) if observed_component_weight_sum else 0.0
    raw["has_any_input_evidence"] = 1.0 if overall_count > 0 else 0.0
    raw["subject"] = _normalize_subject_label(subject)

    # Reorder to the registered raw schema exactly.
    features = {name: raw[name] for name in schema["raw_feature_columns"]}
    validate_current_period_feature_contract(features, schema)
    readiness = _readiness(features)
    warnings = current_period_warnings + domain_warnings(features, schema)
    if legacy_classwork_exists:
        warnings.append({
            "code": "LEGACY_PERIODLESS_CLASSWORK_EXCLUDED",
            "message": "Classwork without academic_period_id was excluded from current-period evidence.",
            "feature": None,
            "value": None,
        })
    return {
        "model_purpose": MODEL_PURPOSE,
        "model_name": MODEL_NAME,
        "schema_version": "v1",
        "features": features,
        "ready": readiness["ready"],
        "readiness_level": readiness["readiness_level"],
        "readiness_reasons": readiness["reasons"],
        "domain_warnings": warnings,
        "evidence_summary": {
            "evidence_source": "LIVE_CLASSWORK_SUBMISSIONS",
            "cutoff_at": cutoff_at.isoformat(),
            "academic_period_id": academic_period_id,
            "component_activity_ids": {component: summary[component]["activity_ids"] for component in COMPONENTS},
            "component_submission_ids": {component: summary[component]["submission_ids"] for component in COMPONENTS},
            "ignored_ungraded_assignment_ids": ignored_ungraded_assignment_ids,
            "ignored_future_submission_ids": ignored_future_submission_ids,
            "unresolved_assignment_ids": unresolved_assignment_ids,
            "ignored_outside_component_ids": ignored_outside_component_ids,
            "grading_template_id": getattr(weights, "template_id", None),
            "grading_template_name": getattr(weights, "template_name", None),
            "student_period_grade_used": False,
            "attendance_used": False,
        },
    }


def prepare_current_period_frame(features: dict[str, Any], schema: dict[str, Any] | None = None) -> pd.DataFrame:
    schema = schema or load_current_period_feature_schema()
    validate_current_period_feature_contract(features, schema)
    return pd.DataFrame([{name: features[name] for name in schema["raw_feature_columns"]}], columns=schema["raw_feature_columns"])


def score_current_period_staging(features: dict[str, Any], *, schema: dict[str, Any] | None = None, artifact_path: Path = ARTIFACT_PATH) -> float:
    schema = schema or load_current_period_feature_schema()
    frame = prepare_current_period_frame(features, schema)
    artifact = joblib.load(artifact_path)
    model = artifact.get("pipeline") if isinstance(artifact, dict) else artifact
    if model is None:
        model = artifact.get("model") if isinstance(artifact, dict) else artifact
    prediction = model.predict(frame)
    return float(prediction[0])

