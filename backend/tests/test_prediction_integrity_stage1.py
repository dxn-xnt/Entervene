from copy import deepcopy
from datetime import date
import json
from pathlib import Path
import uuid

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from test_prediction_feature_builder_service import feature_context, add_period_grade, add_classwork_submission
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.people.AcademicStaff import AcademicStaff
from app.services.prediction import PredictionGenerationService as generation
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction
from app.services.prediction.PredictionScopeService import (
    validate_forecast_scope, authorize_generation, authorize_prediction_read,
    authorize_prediction_write, PredictionConflict, latest_prediction_filter, prediction_metadata,
)


@pytest.fixture
def context(feature_context, monkeypatch):
    c = feature_context
    db = c['db']
    for period in c['periods']:
        period.period_type = 'TERM'
        period.total_periods_in_year = 3
        period.period_name = f'Term {period.period_sequence}'
    c['periods'][0].is_active = True
    db.add(StudentClass(student_id=c['student'].student_id, class_id=c['class'].class_id,
                        academic_year_id=c['class'].academic_year_id, enrollment_status='enrolled'))
    db.add(SubjectLoad(class_id=c['class'].class_id, subject_id=c['subject'].subject_id,
                       academic_period_id=c['periods'][0].academic_period_id, staff_id=c['staff'].staff_id, status='active'))
    c['grade'] = add_period_grade(c, c['periods'][0], grade=85, is_finalized=True,
        written_work_percent=85, performance_task_percent=85, quarterly_assessment_percent=85)
    add_classwork_submission(c, period=c['periods'][0], grade=85)
    c['model'] = AIModelVersion(model_name=generation.DEFAULT_MODEL_NAME, model_type='REGRESSOR',
        algorithm='RandomForestRegressor', artifact_path='data/models/entervene_next_period_grade_rf.joblib', is_active=True,
        feature_schema_json=json.loads(Path('data/models/entervene_next_period_grade_rf_feature_schema.json').read_text()))
    db.add(c['model']); db.commit()
    c['scope'] = dict(student_id=c['student'].student_id, class_id=c['class'].class_id,
        subject_id=c['subject'].subject_id, source_period_id=c['periods'][0].academic_period_id,
        target_period_id=c['periods'][1].academic_period_id)
    c['calls'] = []

    def score(db, features, model_name=None, model_version=None):
        c['calls'].append(deepcopy(features))
        value = features['written_work_percent']
        return dict(model_version_id=model_version.model_version_id, model_name=model_version.model_name,
            model_type='REGRESSOR', algorithm='RandomForestRegressor', predicted_period_grade=value,
            risk_score=35, risk_level='NEEDS_MONITORING', data_status='SUFFICIENT',
            reasons=[f'original evidence {value}'], triggered_rules=['test_rule'], recommended_action='Review evidence',
            feature_columns_used=['source_period_grade', 'written_work_percent'], warnings=[],
            execution_trace={'grade_model': {'status': 'EXECUTED', 'model_version_id': model_version.model_version_id,
                'ordered_feature_names': ['source_period_grade', 'written_work_percent'],
                'ordered_model_values': [features['source_period_grade'], value]},
                'risk_engine': {'status': 'EXECUTED', 'inputs': {'source_period_grade': features['source_period_grade']},
                    'triggered_rules': [{'rule_identifier': 'test_rule', 'reason': f'original evidence {value}'}]}})
    monkeypatch.setattr(generation, 'score_student_prediction', score)
    return c


def generate(c, key=None, **kwargs):
    c['db'].commit()
    return run_prediction_generation_transaction(c['scope'], generation.DEFAULT_MODEL_NAME,
        lambda db: generation.generate_from_records(db, c['scope'], generation_request_id=key,
            staff_id=c['staff'].staff_id, **kwargs), bind=c['db'].get_bind(), generation_request_id=key)


def test_valid_active_term1_to_term2_official_and_pinned_contract(context):
    result = generate(context, 'first')
    assert result['prediction_mode'] == 'NEXT_PERIOD_PREDICTION'
    assert result['revision'] == 1
    assert result['evidence_snapshot']['validated_relationship']['source_grade_provenance'] == 'OFFICIAL'
    assert result['evidence_snapshot']['generation']['reason'] == 'MANUAL_GENERATION'
    assert result['evidence_cutoff_at']
    assert 'generation_cutoff' not in result['evidence_snapshot']['scope']


@pytest.mark.parametrize('kind', ['same', 'backward', 'skipped', 'cross_year', 'cross_type', 'unrelated', 'nonexistent', 'last'])
def test_invalid_relationships(context, kind):
    c = context; scope = dict(c['scope']); source, target, last = c['periods']
    if kind == 'same': scope['target_period_id'] = source.academic_period_id
    elif kind == 'backward': scope.update(source_period_id=target.academic_period_id, target_period_id=source.academic_period_id)
    elif kind == 'skipped': scope['target_period_id'] = last.academic_period_id
    elif kind == 'cross_type': target.period_type = 'QUARTER'
    elif kind == 'cross_year':
        year = AcademicYear(year_label='2027-2028', start_date=date(2027,6,1), end_date=date(2028,3,31))
        c['db'].add(year); c['db'].flush(); target.academic_year_id = year.academic_year_id
    elif kind == 'unrelated': target.total_periods_in_year = 4
    elif kind == 'nonexistent': scope['target_period_id'] = 999999
    elif kind == 'last': scope['source_period_id'] = last.academic_period_id
    c['db'].commit()
    with pytest.raises(ValueError): validate_forecast_scope(c['db'], scope)


@pytest.mark.parametrize('kind', ['provisional', 'estimated', 'target_finalized', 'target_known', 'not_enrolled'])
def test_official_and_unknown_target_required(context, kind):
    c = context
    if kind == 'provisional': c['grade'].is_finalized = False
    elif kind == 'estimated': c['db'].delete(c['grade'])
    elif kind.startswith('target'):
        add_period_grade(c, c['periods'][1], grade=86, is_finalized=kind == 'target_finalized')
    else: c['db'].query(StudentClass).delete()
    c['db'].commit()
    with pytest.raises(ValueError): generate(c)
    assert not c['calls']


def test_replay_never_uses_new_evidence_and_survives_insufficient(context):
    first = generate(context, 'key-a')
    c = context
    submission = c['db'].query(StudentSubmission).one()
    submission.grade = None; submission.status = 'pending'; c['db'].commit()
    second = generate(c, 'key-a')
    for field in ('prediction_id', 'predicted_period_grade', 'risk_level', 'reasons', 'features', 'evidence_summary', 'evidence_snapshot', 'readiness_level'):
        assert second[field] == first[field]
    assert len(c['calls']) == 1


def test_unchanged_alias_replays_original_even_after_successor(context):
    first = generate(context, 'key-a')
    unchanged = generate(context, 'key-b')
    assert unchanged['generation_status'] == 'UNCHANGED'
    assert unchanged['evidence_snapshot'] == first['evidence_snapshot']
    context['db'].query(StudentSubmission).one().grade = 70
    context['db'].commit()
    successor = generate(context, 'key-c')
    assert successor['revision'] == 2
    assert successor['prediction_id'] != first['prediction_id']
    assert generate(context, 'key-b')['prediction_id'] == first['prediction_id']
    assert context['db'].query(AIPrediction).count() == 2
    assert context['db'].query(PredictionGenerationRequest).count() == 3
    assert len(context['calls']) == 2
    latest = context['db'].query(AIPrediction).filter(latest_prediction_filter()).one()
    assert latest.revision == 2
    original = context['db'].get(AIPrediction, first['prediction_id'])
    assert original.evidence_snapshot == first['evidence_snapshot']


def test_same_key_different_scope_conflicts_before_readiness(context):
    generate(context, 'key')
    changed = {**context['scope'], 'target_period_id': context['periods'][2].academic_period_id}
    with pytest.raises(PredictionConflict):
        generation.generate_from_records(context['db'], changed, generation_request_id='key', is_admin=True)


def test_replay_after_model_deactivation(context):
    first = generate(context, 'key')
    context['model'].is_active = False; context['db'].commit()
    assert generate(context, 'key')['evidence_snapshot'] == first['evidence_snapshot']


def test_source_creator_and_target_read_policy(context):
    c = context; first = generate(c, 'key')
    prediction = c['db'].get(AIPrediction, first['prediction_id'])
    authorize_prediction_read(c['db'], prediction, staff_id=c['staff'].staff_id)
    with pytest.raises(PermissionError): authorize_prediction_read(c['db'], prediction, staff_id='unassigned')
    with pytest.raises(PermissionError): authorize_generation(c['db'], c['scope'], staff_id='unassigned')
    with pytest.raises(PermissionError): authorize_prediction_write(c['db'], prediction, c['staff'].staff_id)
    target = AcademicStaff(staff_id='TARGET', first_name='Target', last_name='Teacher')
    c['db'].add(target); c['db'].flush()
    c['db'].add(SubjectLoad(class_id=c['scope']['class_id'], subject_id=c['scope']['subject_id'],
        academic_period_id=c['scope']['target_period_id'], staff_id='TARGET', status='active'))
    c['db'].commit()
    authorize_prediction_read(c['db'], prediction, staff_id='TARGET')
    authorize_prediction_write(c['db'], prediction, 'TARGET')
    with pytest.raises(PermissionError): authorize_generation(c['db'], c['scope'], staff_id='TARGET')


@pytest.mark.parametrize('field', ['predicted_period_grade', 'risk_level', 'evidence_snapshot', 'revision'])
def test_orm_audited_mutation_blocked(context, field):
    first = generate(context)
    prediction = context['db'].get(AIPrediction, first['prediction_id'])
    setattr(prediction, field, {'tampered': True} if field == 'evidence_snapshot' else ('LOW_RISK' if field == 'risk_level' else 99))
    with pytest.raises(ValueError, match='immutable'): context['db'].flush()
    context['db'].rollback()


def test_orm_feature_mutation_blocked(context):
    generate(context)
    row = context['db'].query(AIPredictionFeature).first(); row.feature_value = 1
    with pytest.raises(ValueError, match='immutable'): context['db'].flush()
    context['db'].rollback()


def test_historical_same_period_metadata_is_not_conversion(context):
    p = AIPrediction(**{**context['scope'], 'target_period_id': context['scope']['source_period_id']},
        model_version_id=context['model'].model_version_id, risk_level='LOW_RISK', data_status='SUFFICIENT')
    context['db'].add(p); context['db'].commit()
    metadata = prediction_metadata(p)
    assert metadata['purpose_label'] == 'Historical unvalidated current-period projection'
    assert metadata['validation_status'] == 'LEGACY_UNVALIDATED'
    assert p.source_period_id == p.target_period_id


def test_raw_persistence_fails_closed(context):
    from app.services.prediction.PredictionPersistenceService import score_and_persist_prediction
    with pytest.raises(ValueError, match='Raw feature persistence'):
        score_and_persist_prediction(context['db'], {**context['scope'], 'features': {'source_period_grade': 99}})


def test_readiness_remains_unchanged_without_scoring(context):
    context['db'].query(StudentSubmission).one().grade = None
    context['db'].query(StudentSubmission).one().status = 'pending'
    context['db'].commit()
    result = generate(context)
    assert not result['ready'] and result['predicted_period_grade'] is None
    assert not context['calls'] and context['db'].query(AIPrediction).count() == 0
