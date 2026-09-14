"""ORM safety net. PostgreSQL triggers additionally cover bulk/direct SQL writes."""
from sqlalchemy import event, select
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature


def _prediction_has_snapshot(connection, prediction_id):
    return connection.scalar(select(AIPrediction.evidence_snapshot).where(AIPrediction.prediction_id == prediction_id)) is not None


@event.listens_for(AIPrediction, 'before_update')
def guard_prediction_update(mapper, connection, target):
    if _prediction_has_snapshot(connection, target.prediction_id):
        from sqlalchemy import inspect
        if any(inspect(target).attrs[column.key].history.has_changes() for column in mapper.column_attrs):
            raise ValueError('Audited predictions are immutable.')


@event.listens_for(AIPrediction, 'before_delete')
def guard_prediction_delete(mapper, connection, target):
    if _prediction_has_snapshot(connection, target.prediction_id):
        raise ValueError('Audited predictions are immutable.')


@event.listens_for(AIPredictionFeature, 'before_insert')
@event.listens_for(AIPredictionFeature, 'before_update')
@event.listens_for(AIPredictionFeature, 'before_delete')
def guard_feature(mapper, connection, target):
    from sqlalchemy import inspect
    ids = {target.prediction_id}
    ids.update(inspect(target).attrs.prediction_id.history.deleted)
    if any(snapshot is not None for snapshot in connection.scalars(
        select(AIPrediction.evidence_snapshot).where(AIPrediction.prediction_id.in_(ids))
    )):
        raise ValueError('Audited prediction features are immutable.')
