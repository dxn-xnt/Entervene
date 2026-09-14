"""One record-based generation workflow; persisted responses never use live data."""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json

from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.services.prediction.ModelScoringService import (
    DEFAULT_MODEL_NAME, get_active_model_version, score_student_prediction, artifact_digest,
)
from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records, insufficient_prediction_response
from app.services.prediction.PredictionPersistenceService import validate_references, build_prediction_feature_rows
from app.services.prediction.PredictionEvidenceSnapshotService import build_evidence_snapshot
from app.services.prediction.PredictionScopeService import (
    PredictionConflict, authorize_generation, validate_forecast_scope, prediction_metadata,
)


def canonical_hash(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str, allow_nan=False).encode()).hexdigest()


def _canonical_unordered(value):
    if isinstance(value, dict):
        return {key: _canonical_unordered(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        normalized = [_canonical_unordered(item) for item in value]
        return sorted(normalized, key=lambda item: json.dumps(item, sort_keys=True, default=str))
    return value


def request_fingerprint(scope, model_name):
    return canonical_hash({'scope': {k: str(scope[k]) for k in ('student_id', 'class_id', 'subject_id', 'source_period_id', 'target_period_id')},
                           'model_name': model_name, 'purpose': 'NEXT_PERIOD_PREDICTION', 'reason': 'MANUAL_GENERATION'})


def build_current_evidence_contract(db, scope, *, model_name=DEFAULT_MODEL_NAME, model_version=None, relationship=None):
    model = model_version or get_active_model_version(db, model_name)
    built = build_prediction_features_from_records(db, **scope, model_name=model_name, model_version=model)
    summary = deepcopy(built['evidence_summary'])
    summary.pop('generation_cutoff_date', None)  # date advancing alone is not new source evidence
    digest = artifact_digest(model.artifact_path)
    evidence_fingerprint = canonical_hash({
        'features': built['features'],
        'summary': _canonical_unordered(summary),
        'relationship': relationship,
        'model_version_id': model.model_version_id,
        'artifact_sha256': digest,
        'contract': 'prediction-evidence-v2',
    })
    return {
        'built': built,
        'model': model,
        'artifact_sha256': digest,
        'evidence_fingerprint': evidence_fingerprint,
    }


def persisted_prediction_response(prediction, status='REPLAYED'):
    snapshot = prediction.evidence_snapshot or {}
    contract = snapshot.get('response_contract')
    if contract is not None:
        result = deepcopy(contract)
    else:
        # Older contracts remain readable without inventing or rebuilding evidence.
        risk = snapshot.get('risk_engine') or {}
        readiness = snapshot.get('readiness') or {}
        model = snapshot.get('grade_model') or {}
        result = {
            'ready': readiness.get('status') == 'READY', 'readiness_level': readiness.get('level', 'UNKNOWN'),
            'features': {name: item.get('raw_observed_value') for name, item in snapshot.get('observed_evidence', {}).items()},
            'evidence_summary': {}, 'warnings': ['Historical contract: some execution metadata is unavailable.'],
            'reasons': [rule['reason'] for rule in risk.get('triggered_rules', []) if rule.get('reason')],
            'triggered_rules': [rule['rule_identifier'] for rule in risk.get('triggered_rules', []) if rule.get('rule_identifier')],
            'feature_columns_used': model.get('ordered_feature_names', []),
        }
    result.update({
        **prediction_metadata(prediction), 'prediction_mode': prediction_metadata(prediction)['prediction_purpose'],
        'prediction_id': prediction.prediction_id, 'model_version_id': prediction.model_version_id,
        'student_id': str(prediction.student_id), 'class_id': prediction.class_id, 'subject_id': prediction.subject_id,
        'source_period_id': prediction.source_period_id, 'target_period_id': prediction.target_period_id,
        'predicted_period_grade': float(prediction.predicted_period_grade) if prediction.predicted_period_grade is not None else None,
        'risk_score': float(prediction.risk_score) if prediction.risk_score is not None else None,
        'risk_level': prediction.risk_level, 'data_status': prediction.data_status,
        'generated_at': prediction.generated_at, 'evidence_snapshot': deepcopy(prediction.evidence_snapshot),
        'evidence_cutoff_at': snapshot.get('evidence_cutoff_at'),
        'generation_status': status, 'duplicate': status != 'CREATED',
    })
    return result


def _record_request(db, key, fingerprint, prediction):
    if key:
        db.add(PredictionGenerationRequest(request_id=key, request_fingerprint=fingerprint, prediction_id=prediction.prediction_id))
        db.flush()


def generate_from_records(db, scope, *, model_name=DEFAULT_MODEL_NAME, generation_request_id=None,
                          is_admin=False, staff_id=None, preview=False):
    """Run inside run_prediction_generation_transaction, including for preview."""
    scope = validate_references(db, scope)
    authorize_generation(db, scope, is_admin=is_admin, staff_id=staff_id)
    if model_name != DEFAULT_MODEL_NAME:
        raise ValueError('This school forecast workflow only supports the registered next-period model.')
    if generation_request_id is not None and not generation_request_id.strip():
        raise ValueError('generation_request_id cannot be blank.')
    fingerprint = request_fingerprint(scope, model_name)
    if generation_request_id and not preview:
        prior = db.get(PredictionGenerationRequest, generation_request_id)
        if prior:
            if prior.request_fingerprint != fingerprint:
                raise PredictionConflict('generation_request_id was already used for a different logical request.')
            return persisted_prediction_response(db.get(AIPrediction, prior.prediction_id))
        # Compatibility with pre-ledger keys: compare identifiers/model, not live evidence.
        old = db.query(AIPrediction).filter(AIPrediction.generation_request_id == generation_request_id).one_or_none()
        if old:
            old_scope = {k: getattr(old, k) for k in scope}
            old_name = old.model_version.model_name if old.model_version else None
            if request_fingerprint(old_scope, old_name) != fingerprint:
                raise PredictionConflict('generation_request_id was already used for a different logical request.')
            _record_request(db, generation_request_id, fingerprint, old)
            return persisted_prediction_response(old)

    relationship = validate_forecast_scope(db, scope)
    model = get_active_model_version(db, model_name)
    if model.feature_schema_json.get('target_column') != 'target_next_period_grade':
        raise ValueError('Registered model target is incompatible with next-period forecasting.')
    cutoff = db.info.get('prediction_evidence_cutoff_at') or datetime.now(timezone.utc).isoformat()
    contract = build_current_evidence_contract(db, scope, model_name=model_name, model_version=model, relationship=relationship)
    built = contract['built']
    digest = contract['artifact_sha256']
    evidence_fingerprint = contract['evidence_fingerprint']
    latest = db.query(AIPrediction).filter(
        *(getattr(AIPrediction, k) == v for k, v in scope.items()),
        AIPrediction.model_version_id == model.model_version_id,
    ).order_by(AIPrediction.revision.desc()).first()
    if not preview and latest and (latest.evidence_snapshot or {}).get('evidence_fingerprint') == evidence_fingerprint:
        _record_request(db, generation_request_id, fingerprint, latest)
        return persisted_prediction_response(latest, 'UNCHANGED')
    if not built['ready']:
        return {**insufficient_prediction_response(built), 'generation_status': 'NOT_READY'}
    scoring = score_student_prediction(db, built['features'], model_name=model_name, model_version=model)
    response = {**scoring, 'ready': built['ready'], 'readiness_level': built['readiness_level'],
        'prediction_mode': 'NEXT_PERIOD_PREDICTION', 'features': deepcopy(built['features']),
        'evidence_summary': deepcopy(built['evidence_summary']),
        'warnings': [*built.get('warnings', []), *scoring.get('warnings', [])]}
    response.pop('execution_trace', None)
    if preview:
        return {**response, 'generation_status': 'PREVIEW', 'evidence_cutoff_at': cutoff}
    prediction = AIPrediction(**scope, model_version_id=model.model_version_id,
        revision=(latest.revision + 1 if latest else 1),
        predicted_period_grade=Decimal(str(scoring['predicted_period_grade'])) if scoring['predicted_period_grade'] is not None else None,
        risk_score=Decimal(str(scoring['risk_score'])) if scoring['risk_score'] is not None else None,
        risk_level=scoring['risk_level'], data_status=scoring['data_status'], generation_request_id=generation_request_id)
    db.add(prediction)
    db.flush()
    feature_rows = build_prediction_feature_rows(prediction, built['features'], scoring)
    db.add_all(feature_rows)
    db.flush()  # seal the snapshot only after all feature rows exist
    response['feature_rows_created'] = len(feature_rows)
    snapshot = build_evidence_snapshot(db, scope=scope, model_name=model_name, built=built,
                                      scoring_result=scoring, generation_request_id=generation_request_id)
    snapshot.update({'snapshot_version': 'prediction-evidence-v2', 'evidence_contract_version': 'stage1-integrity-v1',
        'prediction_purpose': 'NEXT_PERIOD_PREDICTION', 'validated_relationship': relationship,
        'revision': prediction.revision, 'evidence_cutoff_at': cutoff,
        'database_snapshot': db.info.get('prediction_database_snapshot'),
        'evidence_fingerprint': evidence_fingerprint, 'response_contract': response,
        'generation': {'reason': 'MANUAL_GENERATION', 'staff_id': staff_id, 'role': 'admin' if is_admin else 'teacher'}})
    snapshot['scope']['request_fingerprint'] = fingerprint
    snapshot['scope']['attendance_cutoff_date'] = snapshot['scope'].pop('generation_cutoff', None)
    prediction.evidence_snapshot = snapshot
    db.flush()
    _record_request(db, generation_request_id, fingerprint, prediction)
    return persisted_prediction_response(prediction, 'CREATED')
