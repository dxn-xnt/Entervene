"""Append-only prediction revisions and immutable audited executions.

Legacy ordering is bookkeeping, never reconstructed execution provenance.
"""
from alembic import op
import sqlalchemy as sa

revision = '20260914_prediction_integrity'
down_revision = '20260913_api_usage_guard'
branch_labels = None
depends_on = None

SCOPE = ['student_id', 'class_id', 'subject_id', 'source_period_id', 'target_period_id']


def upgrade():
    op.add_column('ai_prediction', sa.Column('revision', sa.Integer(), nullable=True))
    op.execute('''WITH ordered AS (
      SELECT prediction_id, row_number() OVER (
        PARTITION BY student_id,class_id,subject_id,source_period_id,target_period_id,model_version_id
        ORDER BY generated_at ASC NULLS FIRST,prediction_id ASC) AS n FROM ai_prediction
    ) UPDATE ai_prediction p SET revision=ordered.n FROM ordered WHERE p.prediction_id=ordered.prediction_id''')
    op.alter_column('ai_prediction', 'revision', nullable=False, server_default='1')
    op.create_check_constraint('ck_ai_prediction_revision_positive', 'ai_prediction', 'revision > 0')
    op.create_index('uq_prediction_scope_revision', 'ai_prediction', SCOPE + ['model_version_id', 'revision'], unique=True)
    op.create_index('uq_prediction_legacy_scope_revision', 'ai_prediction', SCOPE + ['revision'], unique=True, postgresql_where=sa.text('model_version_id IS NULL'))
    op.create_table('prediction_generation_request',
        sa.Column('request_id', sa.String(100), primary_key=True),
        sa.Column('request_fingerprint', sa.String(64), nullable=False),
        sa.Column('prediction_id', sa.Integer(), sa.ForeignKey('ai_prediction.prediction_id', ondelete='RESTRICT'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.execute('''CREATE FUNCTION guard_audited_prediction() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.evidence_snapshot IS NOT NULL AND OLD.evidence_snapshot::jsonb <> 'null'::jsonb THEN
        IF TG_OP = 'DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
          RAISE EXCEPTION 'Audited predictions are immutable' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$''')
    op.execute('CREATE TRIGGER immutable_audited_prediction BEFORE UPDATE OR DELETE ON ai_prediction FOR EACH ROW EXECUTE FUNCTION guard_audited_prediction()')
    op.execute('''CREATE FUNCTION guard_audited_prediction_feature() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM ai_prediction p WHERE
        ((TG_OP <> 'INSERT' AND p.prediction_id=OLD.prediction_id) OR
         (TG_OP <> 'DELETE' AND p.prediction_id=NEW.prediction_id))
        AND p.evidence_snapshot IS NOT NULL AND p.evidence_snapshot::jsonb <> 'null'::jsonb) THEN
        RAISE EXCEPTION 'Audited prediction features are immutable' USING ERRCODE='23514';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END $$''')
    op.execute('CREATE TRIGGER immutable_audited_prediction_feature BEFORE INSERT OR UPDATE OR DELETE ON ai_prediction_feature FOR EACH ROW EXECUTE FUNCTION guard_audited_prediction_feature()')


def downgrade():
    # Keep rows/IDs/payloads and their children; only Stage 1 metadata/guards go.
    # Old code cannot safely write multi-revision scopes: rollback is read-only
    # operationally until a compatible writer is restored.
    op.execute('DROP TRIGGER immutable_audited_prediction_feature ON ai_prediction_feature')
    op.execute('DROP FUNCTION guard_audited_prediction_feature()')
    op.execute('DROP TRIGGER immutable_audited_prediction ON ai_prediction')
    op.execute('DROP FUNCTION guard_audited_prediction()')
    op.drop_table('prediction_generation_request')
    op.drop_index('uq_prediction_legacy_scope_revision', table_name='ai_prediction')
    op.drop_index('uq_prediction_scope_revision', table_name='ai_prediction')
    op.drop_constraint('ck_ai_prediction_revision_positive', 'ai_prediction', type_='check')
    op.drop_column('ai_prediction', 'revision')
