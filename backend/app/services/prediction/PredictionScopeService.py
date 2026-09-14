"""School forecast purpose, record scope and access policy (no scoring rules)."""
from sqlalchemy import and_, or_, tuple_, func, exists
from sqlalchemy.orm import Session
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets


class PredictionConflict(ValueError):
    pass


def authorize_generation(db, scope, *, is_admin=False, staff_id=None):
    if is_admin:
        return
    assigned = get_teacher_assigned_triplets(db, staff_id) if staff_id else set()
    if (int(scope['class_id']), int(scope['subject_id']), int(scope['source_period_id'])) not in assigned:
        raise PermissionError('You are not assigned to the source class, subject and period.')


def prediction_read_filter(db, staff_id):
    assigned = get_teacher_assigned_triplets(db, staff_id) if staff_id else set()
    # Incoming target teachers can inspect the forecast. A source teacher can
    # inspect their own audited handover while still assigned to that source.
    creator = AIPrediction.evidence_snapshot['generation']['staff_id'].as_string()
    return or_(
        tuple_(AIPrediction.class_id, AIPrediction.subject_id, AIPrediction.target_period_id).in_(assigned),
        and_(tuple_(AIPrediction.class_id, AIPrediction.subject_id, AIPrediction.source_period_id).in_(assigned), creator == staff_id),
    ) if staff_id else AIPrediction.prediction_id.is_(None)


def authorize_prediction_read(db, prediction, *, is_admin=False, staff_id=None):
    if not is_admin and not db.query(AIPrediction.prediction_id).filter(
        AIPrediction.prediction_id == prediction.prediction_id, prediction_read_filter(db, staff_id)
    ).first():
        raise PermissionError('You are not authorized to inspect this forecast.')


def authorize_prediction_write(db, prediction, staff_id):
    assigned = get_teacher_assigned_triplets(db, staff_id) if staff_id else set()
    if (prediction.class_id, prediction.subject_id, prediction.target_period_id) not in assigned:
        raise PermissionError('Only the assigned target-period teacher may review or assign interventions.')


def validate_forecast_scope(db: Session, scope):
    source = db.get(AcademicPeriod, scope['source_period_id'])
    target = db.get(AcademicPeriod, scope.get('target_period_id')) if scope.get('target_period_id') else None
    if source is None or target is None:
        raise ValueError('Source and target academic periods must exist; an explicit target is required.')
    if source.academic_period_id == target.academic_period_id:
        raise ValueError('CURRENT_PERIOD_PROJECTION is unvalidated and disabled for this model.')
    if source.period_sequence >= source.total_periods_in_year:
        raise ValueError('NO_NEXT_PERIOD: the source is the final period of its sequence.')
    if (source.academic_year_id != target.academic_year_id or source.period_type != target.period_type
        or source.total_periods_in_year != target.total_periods_in_year
        or target.period_sequence != source.period_sequence + 1
        or target.period_sequence > target.total_periods_in_year
        or source.end_date >= target.start_date):
        raise ValueError('Target must be the immediate next period in the same academic year and period-type sequence.')
    class_ = db.get(Class, scope['class_id'])
    if class_ is None or class_.academic_year_id != source.academic_year_id:
        raise ValueError('Class does not belong to the source academic year.')
    if not db.query(StudentClass).filter(
        StudentClass.student_id == scope['student_id'], StudentClass.class_id == scope['class_id'],
        StudentClass.academic_year_id == source.academic_year_id,
        func.lower(func.coalesce(StudentClass.enrollment_status, 'enrolled')) == 'enrolled',
    ).first():
        raise ValueError('Student is not enrolled in this class and academic year.')
    if not db.query(SubjectLoad).filter(
        SubjectLoad.class_id == scope['class_id'], SubjectLoad.subject_id == scope['subject_id'],
        SubjectLoad.academic_period_id == source.academic_period_id, SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(['active', 'published']),
    ).first():
        raise ValueError('No valid source class/subject load exists.')
    grade_scope = (StudentPeriodGrade.student_id == scope['student_id'], StudentPeriodGrade.class_id == scope['class_id'], StudentPeriodGrade.subject_id == scope['subject_id'])
    grade = db.query(StudentPeriodGrade).filter(*grade_scope, StudentPeriodGrade.academic_period_id == source.academic_period_id).one_or_none()
    if grade is None or not grade.is_finalized or grade.final_period_grade is None:
        raise ValueError('An OFFICIAL finalized source period grade is required for this next-period model.')
    target_grade = db.query(StudentPeriodGrade).filter(*grade_scope, StudentPeriodGrade.academic_period_id == target.academic_period_id).one_or_none()
    known_outcome = db.query(PredictionOutcome.outcome_id).join(AIPrediction, PredictionOutcome.prediction_id == AIPrediction.prediction_id).filter(
        AIPrediction.student_id == scope['student_id'], AIPrediction.class_id == scope['class_id'],
        AIPrediction.subject_id == scope['subject_id'], AIPrediction.target_period_id == target.academic_period_id,
        PredictionOutcome.actual_period_grade.isnot(None),
    ).first()
    if (target_grade is not None and (target_grade.is_finalized or target_grade.final_period_grade is not None)) or known_outcome:
        raise ValueError('Target outcome is already finalized or known; new forecasting is not permitted.')
    return {
        'prediction_purpose': 'NEXT_PERIOD_PREDICTION',
        'academic_year_id': source.academic_year_id, 'period_type': source.period_type,
        'source_period_id': source.academic_period_id, 'target_period_id': target.academic_period_id,
        'source_sequence': source.period_sequence, 'target_sequence': target.period_sequence,
        'total_periods_in_year': source.total_periods_in_year, 'source_grade_provenance': 'OFFICIAL',
    }


def prediction_metadata(prediction):
    same = prediction.source_period_id == prediction.target_period_id
    snapshot = prediction.evidence_snapshot or {}
    audited_next = snapshot.get('snapshot_version') == 'prediction-evidence-v2' and not same
    return {
        'revision': prediction.revision,
        'prediction_purpose': 'CURRENT_PERIOD_PROJECTION' if same else 'NEXT_PERIOD_PREDICTION',
        'validation_status': 'NEXT_PERIOD_PROTOTYPE' if audited_next else 'LEGACY_UNVALIDATED',
        'purpose_label': 'Historical unvalidated current-period projection' if same else ('Next-period grade forecast' if audited_next else 'Historical unvalidated forecast'),
        'revision_origin': 'GENERATED' if audited_next else 'LEGACY_ORDERING',
    }


def latest_prediction_filter():
    """Latest within each exact scope, including a separate null-model legacy series."""
    from sqlalchemy.orm import aliased
    newer = aliased(AIPrediction)
    return ~exists().where(
        *(getattr(newer, field) == getattr(AIPrediction, field) for field in
          ('student_id', 'class_id', 'subject_id', 'source_period_id', 'target_period_id')),
        newer.model_version_id.is_not_distinct_from(AIPrediction.model_version_id),
        newer.revision > AIPrediction.revision,
    )


def dashboard_preferred_prediction_filter():
    """Prefer audited v2 forecasts over legacy rows for the same logical scope."""
    from sqlalchemy.orm import aliased
    audited = aliased(AIPrediction)
    current_is_audited = AIPrediction.evidence_snapshot['snapshot_version'].as_string() == 'prediction-evidence-v2'
    audited_exists = exists().where(
        *(getattr(audited, field) == getattr(AIPrediction, field) for field in
          ('student_id', 'class_id', 'subject_id', 'source_period_id', 'target_period_id')),
        audited.evidence_snapshot['snapshot_version'].as_string() == 'prediction-evidence-v2',
    )
    return or_(current_is_audited, ~audited_exists)
