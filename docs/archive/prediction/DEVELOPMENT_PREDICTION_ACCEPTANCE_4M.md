# Task 4M — development prediction acceptance

**Result: ACCEPTED_WITH_LIMITATIONS.** The clean isolated database, real FastAPI routes, corrected model, seed rerun, and selector rollback passed. Interactive browser acceptance and provisioning from a checkout without the ignored model artifacts remain open.

## Environment and bootstrap

- Checked configuration before database mutation: `APP_ENVIRONMENT=development`, PostgreSQL host `localhost`, fresh database `Entervene_Demo_4M`, selected model `entervene_current_term_official_target_rf_candidate`.
- The existing `Entervene_Demo` database and demo environment files were left unchanged. The 4M database did not exist before setup. The repository demo script created it, built the current SQLAlchemy schema, stamped Alembic head `20260922_development_immutable`, registered both development models, and seeded 10 synthetic students, one class, and 10 activities. This is the repository's clean database bootstrap path; it does not replay every historical migration from an empty schema.
- The acceptance database remains available for inspection. No prediction rows were copied from `Entervene_Demo`.

## Artifact and registry

- Corrected artifact exists locally at `backend/data/models/entervene_current_term_official_target_rf_candidate.joblib` (42,018,055 bytes). SHA-256: `f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc`.
- `joblib.load` succeeded. The artifact contains a `ColumnTransformer` plus `RandomForestRegressor` pipeline with 300 trees, 31 ordered features, and target `target_final_period_grade`. The artifact, checked-in schema and manifest, and local evaluation report agreed. Full registry schema SHA-256: `36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562`.
- In this database, the corrected model happened to receive registry ID 2 and legacy V3 ID 1. Selection uses model names; these IDs are not configuration. Both rows have purpose `CURRENT_TERM_FINAL_GRADE_PROJECTION`, target `target_final_period_grade`, lifecycle `DEVELOPMENT`, and `is_active=false`, `production_validated=false`, `independent_three_term_validation=false`. No duplicate corrected row appeared on rerun.
- The joblib and evaluation report are ignored by Git via `backend/.gitignore`. A new checkout cannot reproduce the demo until an operator supplies the exact trusted joblib, legacy V3 joblib/schema, and evaluation report under their expected paths. The smallest provisioning path is a versioned internal artifact bundle with a checksum manifest, copied into `backend/data/` before setup and verified by `verified_corrected_package()`. No substitute artifact was downloaded or trained.

## API and persistence

- A FastAPI `TestClient` exercise used the real routes and isolated PostgreSQL database. Corrected POST returned a numeric projected grade, corrected model identity, deterministic grade-derived level, and `model_version_id` matching its registry row. The saved row had the corrected artifact/schema hashes, 31 feature entries, evidence snapshot, correct revision, and null risk score.
- Repeating identical evidence reused the revision. Changing a graded submission through the acceptance test created the next corrected revision; repeating it reused that revision. Seeded evidence had already produced revisions 1 and 2 for one synthetic student.
- Default GET returned nine latest corrected rows for nine distinct students, with no duplicate from legacy history. After generating legacy history, authorized `model_version_id` GET returned that history separately. Teacher GET for the assigned load succeeded; teacher POST and unrelated teacher GET were denied.
- API guards returned blocked results for inactive period, finalized same-term grade, insufficient evidence, unsupported subject, and Grades 11 and 12 (`UNSUPPORTED_GRADE_SCOPE`). An unknown selector failed closed with HTTP 503. The readiness builder still requires at least four available graded activities, written work and performance task evidence, at least 70% observed component weight, and no unresolved evidence; high evidence adds examination evidence and stricter thresholds. No readiness or SHS guard was changed.
- Changing the selector to legacy V3 made POST and default GET use legacy history. Switching it back restored corrected POST/GET and preserved both histories. Separate fresh Python processes also resolved each selector to its intended registry row. This verifies configuration reload, though no long-running server process was restarted.

## Seed rerun, UI, tests, and changes

- After API acceptance, rerunning `seed` preserved counts exactly: **2 model rows, 10 students, 1 class, 10 activities, 16 prediction rows** before and after. It did not duplicate corrected revisions for unchanged evidence. `setup` intentionally creates a new database and baseline schema; seed rerun reuses existing demo entities and predictions.
- Backend Uvicorn and frontend Vite both started with the isolated 4M configuration; `/openapi.json` and the frontend index returned HTTP 200. Both local servers were stopped after the smoke check. Interactive browser acceptance was **not performed**: no browser automation/computer tool or Playwright/Selenium installation was available. Page rendering, browser console, details, filters, and live empty/error/loading states remain unverified in a browser. The existing React panel and API contract were inspected; frontend prediction tests passed (24), and `npm run build` passed.
- Focused backend tests passed (42). The tests cover clean database seed, HTTP routes, selector, registration, scoring, persistence, history/filtering, authorization, readiness/domain guards, rollback, and idempotency. Existing Pydantic deprecation warnings remain.
- Defects fixed: the demo and registration guards rejected any fresh 4M database; the seed's rerun summary reported zero corrected predictions without legacy scopes; older tests assumed the legacy selector and stale revision counts. The code now permits only the two named local demo databases, refuses to replace an existing 4M database, keeps a separate 4M summary, supports setup without rewriting demo environment files, counts corrected students accurately, and tests the selected model explicitly.

## Boundaries and next task

- No changes were made to `backend/.env`, the existing demo environment files, production scoring/model selection, activation flags, or validation flags. No connection to a production/shared database was made. The existing legacy model artifact and historical files were not deleted or moved. Intervention work was not started.
- Remaining prediction-flow gaps: reproducible trusted artifact delivery to a new checkout; an interactive Admin and Teacher browser pass against an isolated running stack; a long-running server restart check if operational deployment requires one. The next task should provision the verified artifact bundle and perform browser acceptance on the same isolated demo flow, with no production activation.
