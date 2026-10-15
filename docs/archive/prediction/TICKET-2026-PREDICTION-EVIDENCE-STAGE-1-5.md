# Stage 1.5 decision record

Status: verified; approved Stage 2 migrations applied on 2026-09-11.

## Concurrency

Chosen design: a transaction-scoped PostgreSQL advisory lock keyed by SHA-256 of the canonical `(student, class, subject, source period, target period, model name)` scope, inside a dedicated `REPEATABLE READ` SQLAlchemy session.

This works with the repository because PostgreSQL 18.1 is the configured database, `SessionLocal(bind=engine.execution_options(isolation_level="REPEATABLE READ"))` creates the generation transaction before any evidence query, and `pg_advisory_xact_lock` is its first SQL statement. The API persistence routes and `app/ml/SavePrediction.py` now use this boundary; persistence receives `commit=False`, so no helper commits before the outer transaction. Model scoring loads a local artifact and performs no network/API wait. Direct verification confirmed same-scope serialization, repeatable-read isolation, and lock release after rollback.

The candidate deferred database logical-scope key is `(student_id, class_id, subject_id, source_period_id, target_period_id, model_version_id)`. Its current duplicate count is `0`. It is sufficient for the present one-result semantics, but is not added here because it is not one of the approved minimum migrations and would require an explicit null/model-version policy. `generation_request_id` is now nullable and unique for retry idempotency.

The legacy administrative `scripts/score_enrolled_cohort.py` bulk seeder still writes historical baseline rows directly. It is not a normal generation route and cannot produce Phase 1 evidence snapshots; it must not be used to create audited Phase 1 predictions. Its replacement is deferred rather than silently treating its rows as audited executions.

## Supported sources

| Source | Phase 1 status | Rule |
| --- | --- | --- |
| Period grade | Supported | Finalized final = `OFFICIAL`; other stored stages = provisional; equal-component fallback = `ESTIMATED`; null checks preserve zero. |
| Attendance | Supported | Filter by student, class, subject, source-period dates, and capture cutoff; preserve existing weights. |
| Classwork | Supported for new attributed assignments only | New writers require a validated `academic_period_id`; legacy null rows are `UNRESOLVED / UNAVAILABLE`. Reuse the gradebook selector only if unambiguous. |
| Assessment | Separate observation only | A non-null `RECORDED` score is structurally observable; no production writer establishes student-completion or missing-work authority. |
| Combined assessment/classwork metric | Unsupported | `UNRESOLVED` and skip dependent readiness/model stages. |

## Readiness/model contract correction

This is a readiness-contract bug. The active model schema requires `cumulative_period_grade_avg`, while the builder emits it only when a non-null final period-grade row exists. An estimated source grade can therefore be marked `READY` and then fail model preparation.

Before returning ready, the builder must validate the complete feature vector against the selected model version's registered feature schema using the same shared preparation/validation path as scoring. A missing/invalid required value becomes a readiness reason and model/risk are skipped. This preserves the model artifact and every existing readiness threshold.

## Safe migrations applied

- Nullable `classwork_assignment.academic_period_id` with FK and `(academic_period_id, class_id)` index.
- Nullable `ai_prediction.evidence_snapshot`.
- Nullable unique `ai_prediction.generation_request_id`.

New wizard, assignment, and manual-activity writers require a period that matches the class academic year and an active teacher/class/subject/period load. No legacy assignment was backfilled.
