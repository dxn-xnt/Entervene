"""
RiskSummaryExportService.py
===========================
Service for generating RFC-4180 compliant CSV exports of student risk summaries
and AI predictions with RBAC scoping and formula injection protection.
"""

from __future__ import annotations

import csv
import io
import re
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.people.Student import Student
from app.services.prediction.DashboardPredictionService import (
    _base_joined_query,
    _build_student_name,
    _build_term_label,
    _valid_class_period_triplets,
    enrolled_student_class_filter,
)
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets


CSV_HEADERS = [
    "Student LRN",
    "Student Name",
    "Grade Level",
    "Class / Section",
    "Subject",
    "Academic Term",
    "Risk Level",
    "Risk Score",
    "Projected Grade",
    "Attendance Rate",
    "Submission Rate",
    "Primary Risk Indicator",
    "Projection Date",
]

RISK_LEVEL_LABELS = {
    "HIGH_RISK": "High Risk",
    "MODERATE_RISK": "Moderate Risk",
    "NEEDS_MONITORING": "Needs Monitoring",
    "LOW_RISK": "Low Risk",
    "INSUFFICIENT_DATA": "Insufficient Data",
}


def _sanitize_csv_value(value: Any) -> str:
    """Neutralize formula injection by prefixing triggering characters with an apostrophe."""
    if value is None:
        return ""
    text = str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{text}"
    return text


def _format_risk_level(level: str | None) -> str:
    if not level:
        return "N/A"
    return RISK_LEVEL_LABELS.get(level.upper(), level.replace("_", " ").title())


def _format_rate(value: Any) -> str:
    if value is None:
        return "N/A"
    try:
        num = float(value)
        return f"{num:.1f}%"
    except (ValueError, TypeError):
        return "N/A"


def _extract_snapshot_rates(snapshot: Any) -> tuple[str, str]:
    """Extract attendance rate and submission completion rate from evidence snapshot."""
    if not isinstance(snapshot, dict):
        return "N/A", "N/A"

    att_rate = "N/A"
    sub_rate = "N/A"

    # Direct keys
    if "attendance_rate" in snapshot and snapshot["attendance_rate"] is not None:
        att_rate = _format_rate(snapshot["attendance_rate"])
    elif "participation_context" in snapshot and isinstance(snapshot["participation_context"], dict):
        p_att = snapshot["participation_context"].get("attendance", {})
        if isinstance(p_att, dict) and p_att.get("attendance_rate") is not None:
            att_rate = _format_rate(p_att["attendance_rate"])

    if "completion_rate" in snapshot and snapshot["completion_rate"] is not None:
        sub_rate = _format_rate(snapshot["completion_rate"])
    elif "submission_rate" in snapshot and snapshot["submission_rate"] is not None:
        sub_rate = _format_rate(snapshot["submission_rate"])
    elif "participation_context" in snapshot and isinstance(snapshot["participation_context"], dict):
        p_sub = snapshot["participation_context"].get("submissions", {})
        if isinstance(p_sub, dict) and p_sub.get("completion_rate") is not None:
            sub_rate = _format_rate(p_sub["completion_rate"])

    return att_rate, sub_rate


def _sanitize_filename_segment(segment: str) -> str:
    clean = re.sub(r"[^\w\s-]", "", segment).strip()
    return re.sub(r"[-\s]+", "_", clean)


def export_student_risk_summary_csv(
    db: Session,
    *,
    academic_period_id: int | None = None,
    class_id: int | None = None,
    subject_id: int | None = None,
    grade_level: int | None = None,
    risk_level: str | None = None,
    search: str | None = None,
    current_user: dict[str, Any],
    staff_id: str | None = None,
) -> tuple[str, str]:
    """Generate an RFC-4180 CSV export of student risk summaries with authorization and formula protection."""
    role = (current_user.get("role") or "").lower()

    if role == "student":
        raise HTTPException(status_code=403, detail="Students are not authorized to export risk summaries.")

    is_admin = role == "admin"
    assigned_triplets: list[tuple[int, int, int]] | None = None

    if not is_admin:
        if not staff_id:
            raise HTTPException(status_code=403, detail="Teacher profile is required for prediction export.")
        raw_triplets = get_teacher_assigned_triplets(db, staff_id, academic_period_id=academic_period_id)
        assigned_triplets = _valid_class_period_triplets(db, raw_triplets)

        # Validate explicit class/subject requests against assigned scope
        if class_id is not None:
            assigned_classes = {t[0] for t in (assigned_triplets or [])}
            if class_id not in assigned_classes:
                raise HTTPException(status_code=403, detail="Access denied. You are not assigned to this class scope.")
        if subject_id is not None:
            assigned_subjects = {t[1] for t in (assigned_triplets or [])}
            if subject_id not in assigned_subjects:
                raise HTTPException(status_code=403, detail="Access denied. You are not assigned to this subject scope.")

    # 1. First attempt to query AIPrediction
    rows: list[dict[str, Any]] = []

    if is_admin or (assigned_triplets and len(assigned_triplets) > 0):
        base = _base_joined_query(db, enrolled_only=True)

        if not is_admin and assigned_triplets is not None:
            base = base.filter(
                tuple_(AIPrediction.class_id, AIPrediction.subject_id, AIPrediction.target_period_id).in_(assigned_triplets)
            )
        if class_id is not None:
            base = base.filter(AIPrediction.class_id == class_id)
        if subject_id is not None:
            base = base.filter(AIPrediction.subject_id == subject_id)
        if academic_period_id is not None:
            base = base.filter(AIPrediction.target_period_id == academic_period_id)
        if grade_level is not None:
            base = base.filter(AcademicLevel.grade_level == grade_level)
        if risk_level and risk_level.strip():
            base = base.filter(func.upper(AIPrediction.risk_level) == risk_level.strip().upper())
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            base = base.filter(
                (Student.first_name.ilike(pattern))
                | (Student.last_name.ilike(pattern))
                | (Student.student_lrn.ilike(pattern))
            )

        ai_predictions = base.order_by(
            Student.last_name.asc(),
            Student.first_name.asc(),
            Student.student_lrn.asc(),
            AIPrediction.prediction_id.asc(),
        ).all()

        pred_ids = [pred.prediction_id for pred, *_ in ai_predictions]
        features_by_pred: dict[int, list[AIPredictionFeature]] = {}
        if pred_ids:
            all_features = (
                db.query(AIPredictionFeature)
                .filter(AIPredictionFeature.prediction_id.in_(pred_ids))
                .order_by(AIPredictionFeature.feature_rank.asc().nullslast())
                .all()
            )
            for feat in all_features:
                features_by_pred.setdefault(feat.prediction_id, []).append(feat)

        for pred, student, class_, subject, period, level in ai_predictions:
            feats = features_by_pred.get(pred.prediction_id, [])
            top_feat_name = "N/A"
            if feats:
                risk_feats = [f for f in feats if f.direction == "INCREASES_RISK"]
                chosen = risk_feats[0] if risk_feats else feats[0]
                top_feat_name = (chosen.feature_name or "N/A").replace("_", " ").title()
            elif pred.intervention_basis:
                top_feat_name = pred.intervention_basis.replace("_", " ").title()

            att_rate, sub_rate = _extract_snapshot_rates(pred.evidence_snapshot)

            rows.append({
                "lrn": student.student_lrn or "N/A",
                "name": _build_student_name(student),
                "grade": f"Grade {level.grade_level}" if level and level.grade_level else "N/A",
                "section": class_.section_name,
                "subject": subject.subject_name,
                "term": period.period_name or f"Term {period.period_sequence}",
                "risk_level": _format_risk_level(pred.risk_level),
                "risk_score": f"{float(pred.risk_score):.2f}" if pred.risk_score is not None else "N/A",
                "projected_grade": f"{float(pred.predicted_period_grade):.2f}" if pred.predicted_period_grade is not None else "N/A",
                "attendance_rate": att_rate,
                "submission_rate": sub_rate,
                "primary_indicator": top_feat_name,
                "projection_date": pred.generated_at.strftime("%Y-%m-%d") if pred.generated_at else "N/A",
            })

    # 2. If no AIPrediction rows found, query DevelopmentCurrentTermPrediction
    if not rows and (is_admin or (assigned_triplets and len(assigned_triplets) > 0)):
        dev_base = (
            db.query(
                DevelopmentCurrentTermPrediction,
                Student,
                Class,
                Subject,
                AcademicPeriod,
                AcademicLevel,
            )
            .join(Student, DevelopmentCurrentTermPrediction.student_id == Student.student_id)
            .join(Class, DevelopmentCurrentTermPrediction.class_id == Class.class_id)
            .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
            .join(Subject, DevelopmentCurrentTermPrediction.subject_id == Subject.subject_id)
            .join(AcademicPeriod, DevelopmentCurrentTermPrediction.source_period_id == AcademicPeriod.academic_period_id)
            .join(
                StudentClass,
                (StudentClass.student_id == DevelopmentCurrentTermPrediction.student_id)
                & (StudentClass.class_id == DevelopmentCurrentTermPrediction.class_id)
                & (StudentClass.academic_year_id == Class.academic_year_id)
                & enrolled_student_class_filter(),
            )
        )

        if not is_admin and assigned_triplets is not None:
            dev_base = dev_base.filter(
                tuple_(
                    DevelopmentCurrentTermPrediction.class_id,
                    DevelopmentCurrentTermPrediction.subject_id,
                    DevelopmentCurrentTermPrediction.source_period_id,
                ).in_(assigned_triplets)
            )
        if class_id is not None:
            dev_base = dev_base.filter(DevelopmentCurrentTermPrediction.class_id == class_id)
        if subject_id is not None:
            dev_base = dev_base.filter(DevelopmentCurrentTermPrediction.subject_id == subject_id)
        if academic_period_id is not None:
            dev_base = dev_base.filter(DevelopmentCurrentTermPrediction.source_period_id == academic_period_id)
        if grade_level is not None:
            dev_base = dev_base.filter(AcademicLevel.grade_level == grade_level)
        if risk_level and risk_level.strip():
            dev_base = dev_base.filter(func.upper(DevelopmentCurrentTermPrediction.intervention_level) == risk_level.strip().upper())
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            dev_base = dev_base.filter(
                (Student.first_name.ilike(pattern))
                | (Student.last_name.ilike(pattern))
                | (Student.student_lrn.ilike(pattern))
            )

        dev_predictions = dev_base.order_by(
            Student.last_name.asc(),
            Student.first_name.asc(),
            DevelopmentCurrentTermPrediction.prediction_id.asc(),
        ).all()

        for pred, student, class_, subject, period, level in dev_predictions:
            att_rate, sub_rate = _extract_snapshot_rates(pred.evidence_snapshot)
            top_indicator = (pred.intervention_basis or "N/A").replace("_", " ").title()

            rows.append({
                "lrn": student.student_lrn or "N/A",
                "name": _build_student_name(student),
                "grade": f"Grade {level.grade_level}" if level and level.grade_level else "N/A",
                "section": class_.section_name,
                "subject": subject.subject_name,
                "term": period.period_name or f"Term {period.period_sequence}",
                "risk_level": _format_risk_level(pred.intervention_level),
                "risk_score": f"{float(pred.risk_score):.2f}" if pred.risk_score is not None else "N/A",
                "projected_grade": f"{float(pred.predicted_period_grade):.2f}" if pred.predicted_period_grade is not None else "N/A",
                "attendance_rate": att_rate,
                "submission_rate": sub_rate,
                "primary_indicator": top_indicator,
                "projection_date": pred.generated_at.strftime("%Y-%m-%d") if pred.generated_at else "N/A",
            })

    # 3. Construct CSV
    output = io.StringIO()
    output.write("\ufeff")  # UTF-8 BOM
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(CSV_HEADERS)

    for item in rows:
        writer.writerow([
            _sanitize_csv_value(item["lrn"]),
            _sanitize_csv_value(item["name"]),
            _sanitize_csv_value(item["grade"]),
            _sanitize_csv_value(item["section"]),
            _sanitize_csv_value(item["subject"]),
            _sanitize_csv_value(item["term"]),
            _sanitize_csv_value(item["risk_level"]),
            _sanitize_csv_value(item["risk_score"]),
            _sanitize_csv_value(item["projected_grade"]),
            _sanitize_csv_value(item["attendance_rate"]),
            _sanitize_csv_value(item["submission_rate"]),
            _sanitize_csv_value(item["primary_indicator"]),
            _sanitize_csv_value(item["projection_date"]),
        ])

    # 4. Generate filename
    scope_part = "School_Wide"
    if class_id is not None:
        cls_obj = db.get(Class, class_id)
        if cls_obj:
            scope_part = _sanitize_filename_segment(cls_obj.section_name)
    elif grade_level is not None:
        scope_part = f"Grade_{grade_level}"

    term_part = "All_Terms"
    if academic_period_id is not None:
        period_obj = db.get(AcademicPeriod, academic_period_id)
        if period_obj:
            term_part = _sanitize_filename_segment(period_obj.period_name or f"Term_{period_obj.period_sequence}")

    filename = f"Risk_Summary_{scope_part}_{term_part}.csv"
    return output.getvalue(), filename
