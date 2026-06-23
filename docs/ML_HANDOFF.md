# Entervene ML / Prediction Handoff

This document is the ML-specific handoff for the next Codex session. It does not replace `docs/CODEX_HANDOFF.md`; that file still contains broader project context.

## Current Status

ML backend pipeline is complete up to scoring and database persistence.

Ready next:

```text
Task 8: Prediction API Endpoints
```

Not ready yet:

```text
Frontend prediction dashboard
Teacher/student suggestions
Production classifier
Accuracy/AUC/F1 reporting
```

## Core ML Approach

Entervene currently uses a **Random Forest regression prototype**, not an at-risk classifier.

The model predicts:

```text
target_next_period_grade
```

In user-facing language, it predicts:

```text
the learner's possible next grading-period grade
```

It does not directly predict:

```text
AT_RISK / NOT_AT_RISK
```

The current historical E-Class Record dataset contains **zero below-75 target examples**. Because of that:

- Accuracy is not the correct metric.
- AUC is not valid.
- F1 score is not valid.
- SMOTE/SMOTENC should not be used yet.
- A classifier should not be trained yet.

Current valid regression metrics:

```text
MAE: 1.4396
RMSE: 2.0984
R2: 0.6227
```

Layman's explanation:

```text
The model predicts a grade number, like 87.81, not a category like at-risk or not-at-risk. Because of that, we measure how close the predicted grade is to the real next-period grade using MAE, RMSE, and R2. Later, when the system collects real teacher-confirmed intervention labels or real below-threshold outcomes, a classifier can be trained and metrics like Accuracy, AUC, Precision, Recall, and F1 can be used.
```

Also:

```text
The model does not directly say "this student will fail." It predicts a possible next-period grade. Then the risk engine interprets that grade together with academic signals like trend, completion rate, missing activities, and data coverage.
```

## Dataset Context

Local dataset folders:

```text
backend/data/datasets/entervene_interpreted_synthetic_csv_pack
backend/data/datasets/entervene_current_data_ml_optimized
```

These folders are ignored by Git.

Important data-safety notes:

- Student names and LRNs are synthetic placeholders.
- They were created only for development traceability.
- They are not real verified learner identities.
- They must not be imported into production as real students.
- Names/LRNs must not be used as model features.
- `PRIVATE_source_student_identity_map.csv` exists in the normalized pack but must not be printed or shared.

### Dataset Validation Summary

Normalized pack:

```text
00_import_manifest.csv: 12
01_academic_years.csv: 3
02_academic_periods.csv: 12
03_teachers.csv: 2
04_students_synthetic.csv: 289
05_classes.csv: 9
06_student_class_enrollments.csv: 289
07_subjects.csv: 8
08_subject_load_groups.csv: 12
09_subject_loads_by_period.csv: 48
10_assessments.csv: 400
11_student_assessment_scores.csv: 13115
12_student_period_grades.csv: 1564
13_student_final_grades.csv: 391
14_student_subject_period_features.csv: 1564
15_prototype_model_rows.csv: 1169
16_data_quality_issues.csv: 12
17_table_relationships.csv: 16
```

ML optimized pack:

```text
01_training_rows_readable.csv: 1169
02_random_forest_regression_matrix_all.csv: 1169
03_random_forest_regression_train.csv: 938
04_random_forest_regression_test.csv: 231
05_prediction_scoring_template.csv: 1
06_feature_dictionary.csv: 23
07_baseline_feature_importance.csv: 16
08_validation_summary.csv: 14
```

Important validation findings:

```text
ready_for_task_3 = true
below-75 count = 0
below-90 count = 273
train/test student overlap = 0
synthetic names/LRNs excluded from model features
quarterly_assessment_percent mapped to periodical_assessment_percent
period_type, total_periods_in_year, and period_progress_ratio are missing from ML train/test files and should be added later for three-term readiness
```

## Git Ignore Protection

`.gitignore` was updated with:

```gitignore
# Local datasets / ML artifacts
backend/data/datasets/
backend/data/dataset_validation/
backend/data/models/
backend/data/raw_eclass_records/
backend/data/normalized_eclass_records/

# Private traceability files
**/PRIVATE_source_student_identity_map.csv

# Python generated files
__pycache__/
*.py[cod]
.pytest_cache/
```

`git status --short` does not show dataset/model artifacts, and `git check-ignore` confirmed the rules.

## Completed Tasks

### Task 1 - ML Database Foundation

Created models:

```text
backend/app/models/academic/AssessmentItem.py
backend/app/models/academic/StudentAssessmentScore.py
backend/app/models/academic/StudentPeriodGrade.py
backend/app/models/ai/AIModelVersion.py
backend/app/models/ai/RiskThreshold.py
backend/app/models/ai/AIPrediction.py
backend/app/models/ai/AIPredictionFeature.py
backend/app/models/ai/TeacherRiskReview.py
backend/app/models/ai/PredictionOutcome.py
```

Modified:

```text
backend/app/models/academic/AcademicPeriod.py
backend/app/models/academic/__init__.py
backend/app/models/ai/__init__.py
backend/app/models/__init__.py
```

Migration:

```text
backend/migrations/versions/20260621_add_ml_prediction_foundation.py
```

Tables created:

```text
assessment_item
student_assessment_score
student_period_grade
ai_model_version
risk_threshold
ai_prediction
ai_prediction_feature
teacher_risk_review
prediction_outcome
```

Academic period was updated to support:

```text
period_sequence
total_periods_in_year
period_progress_ratio
TERM period type
year/type/sequence uniqueness
```

Note:

```text
class.academic_period_id was left in place because existing models/tests/routes still reference it.
```

Validation:

```text
alembic upgrade head: passed
pytest -q: 161 passed, 5 warnings
```

### Task 2A - Dataset Validation

Created:

```text
backend/app/ml/DatasetPackValidator.py
backend/tests/test_dataset_pack_validator.py
backend/data/dataset_validation/dataset_validation_report.json
```

Modified:

```text
.gitignore
```

Tests:

```text
pytest tests/test_dataset_pack_validator.py -q: 11 passed
pytest -q: 172 passed, 5 warnings
```

Result:

```text
ready_for_task_3 = true
```

### Task 3 - Train RandomForestRegressor

Modified:

```text
backend/app/ml/Train.py
```

Created:

```text
backend/tests/test_ml_train.py
```

Generated ignored artifacts:

```text
backend/data/models/entervene_next_period_grade_rf.joblib
backend/data/models/entervene_next_period_grade_rf_training_report.json
backend/data/models/entervene_next_period_grade_rf_feature_schema.json
backend/data/models/entervene_next_period_grade_rf_feature_importance.csv
```

Training command:

```bash
cd backend
python -m app.ml.Train --ml-dir data/datasets/entervene_current_data_ml_optimized --output-dir data/models --model-name entervene_next_period_grade_rf
```

Training results:

```text
target_column: target_next_period_grade
feature_count: 16
mapped: quarterly_assessment_percent -> periodical_assessment_percent
excluded columns present: row_id, student_id, split, target_next_period_grade
MAE: 1.4396
RMSE: 2.0984
R2: 0.6227
train/test student overlap: 0
ready_for_task_4: true
```

Tests:

```text
pytest tests/test_ml_train.py -q: 7 passed
pytest -q: 179 passed, 5 warnings
```

### Task 4 - Register Model Metadata

Created:

```text
backend/app/ml/RegisterModelVersion.py
backend/app/services/ModelVersionService.py
backend/tests/test_register_model_version.py
```

Modified:

```text
backend/app/models/ai/AIModelVersion.py
```

Reason for model modification:

```text
Added sqlite_where to the active-model partial index so SQLite tests match PostgreSQL intent.
```

Registration command:

```bash
cd backend
python -m app.ml.RegisterModelVersion --training-report data/models/entervene_next_period_grade_rf_training_report.json --feature-schema data/models/entervene_next_period_grade_rf_feature_schema.json --artifact-path data/models/entervene_next_period_grade_rf.joblib --model-name entervene_next_period_grade_rf --activate
```

Registered active model:

```text
model_version_id: 1
model_name: entervene_next_period_grade_rf
model_type: REGRESSOR
algorithm: RandomForestRegressor
artifact_path: data/models/entervene_next_period_grade_rf.joblib
training_row_count: 938
test_row_count: 231
MAE: 1.4396
RMSE: 2.0984
R2: 0.6227
is_active: true
active matching rows: 1
```

Tests:

```text
pytest tests/test_register_model_version.py -q: 10 passed
pytest -q: 189 passed, 5 warnings
```

### Task 5 - Risk Engine

Created:

```text
backend/app/services/RiskEngine.py
backend/tests/test_risk_engine.py
```

No threshold seeder was created.

The engine has:

```text
load_active_thresholds(db)
fallback built-in default rules
risk score clamped to 0-100
```

Risk levels:

```text
INSUFFICIENT_DATA
LOW_RISK
NEEDS_MONITORING
MODERATE_RISK
HIGH_RISK
```

Priority order:

```text
INSUFFICIENT_DATA > HIGH_RISK > MODERATE_RISK > NEEDS_MONITORING > LOW_RISK
```

Default rules:

```text
INSUFFICIENT_DATA:
- missing predicted grade/completion/coverage
- data_coverage_ratio < 0.50
- assessment_completion_rate < 0.50

HIGH_RISK:
- predicted grade < 75
- source grade < 75
- predicted < 80 and trend <= -5
- completion < 0.70 and predicted < 82
- missing_activity_count >= 3 and predicted < 85

MODERATE_RISK:
- predicted 75 to 81.99
- trend <= -7
- completion < 0.75
- missing_activity_count >= 2
- late_submission_count >= 3

NEEDS_MONITORING:
- predicted 82 to 87.99
- trend <= -3
- completion < 0.90
- missing_activity_count == 1
- late_submission_count >= 1
- has_previous_period is false

LOW_RISK:
- predicted >= 88
- completion >= 0.90
- data coverage >= 0.75
- no severe decline
- no missing activities
```

Example result:

```text
predicted_period_grade: 81
risk_level: MODERATE_RISK
data_status: SUFFICIENT
triggered_rules: ["predicted_grade_75_to_81"]
recommended_action: Provide targeted follow-up and monitor the next activities closely.
```

Tests:

```text
pytest tests/test_risk_engine.py -q: 14 passed
pytest -q: 203 passed, 5 warnings
```

### Task 6 - Model Scoring Service

Created:

```text
backend/app/services/ModelScoringService.py
backend/app/ml/ScorePrediction.py
backend/tests/test_model_scoring_service.py
backend/data/models/sample_prediction_input.json
```

The sample JSON is ignored.

Behavior:

```text
active AI_MODEL_VERSION
-> load joblib artifact
-> load feature schema
-> prepare one feature row
-> predict next-period grade
-> call RiskEngine
-> return structured score result
```

Smoke test command:

```bash
cd backend
python -m app.ml.ScorePrediction --model-name entervene_next_period_grade_rf --input-json data/models/sample_prediction_input.json
```

Example output:

```json
{
  "model_version_id": 1,
  "model_name": "entervene_next_period_grade_rf",
  "model_type": "REGRESSOR",
  "algorithm": "RandomForestRegressor",
  "predicted_period_grade": 87.81,
  "risk_level": "NEEDS_MONITORING",
  "risk_score": 37.29,
  "data_status": "SUFFICIENT",
  "triggered_rules": ["predicted_grade_82_to_87"]
}
```

Notes:

```text
Feature count used: 16
Artifact path resolved from: data/models/entervene_next_period_grade_rf.joblib
Runtime-only risk fields are accepted for risk engine but not passed into model unless in feature schema.
Identity/leakage fields such as student_id are ignored for scoring.
```

Tests:

```text
pytest tests/test_model_scoring_service.py -q: 12 passed
pytest -q: 215 passed, 5 warnings
```

### Task 7 - Prediction Persistence

Created:

```text
backend/app/services/PredictionPersistenceService.py
backend/app/ml/SavePrediction.py
backend/tests/test_prediction_persistence_service.py
backend/data/models/sample_prediction_persist_input.json
```

The sample JSON is ignored.

Main function:

```text
score_and_persist_prediction(...)
```

Tables written:

```text
ai_prediction
ai_prediction_feature
```

Duplicate handling:

```text
Same student/class/subject/source period/target period/model version returns existing prediction by default.
replace_existing=True deletes old feature rows and updates/replaces the prediction safely.
```

Rollback:

```text
Transaction rollback is handled and covered by a failing feature insert test.
```

Smoke test command:

```bash
cd backend
python -m app.ml.SavePrediction --model-name entervene_next_period_grade_rf --input-json data/models/sample_prediction_persist_input.json --replace-existing
```

Smoke test result:

```json
{
  "prediction_id": 1,
  "model_version_id": 1,
  "predicted_period_grade": 87.81,
  "risk_level": "NEEDS_MONITORING",
  "risk_score": 37.29,
  "data_status": "SUFFICIENT",
  "feature_rows_created": 20
}
```

Tests:

```text
pytest tests/test_prediction_persistence_service.py -q: 10 passed
pytest -q: 225 passed, 5 warnings
```

## Current ML Flow

```text
1. Historical E-Class Record workbooks were converted into normalized CSVs.
2. Normalized CSVs preserve students, classes, subjects, assessments, scores, and period grades.
3. Optimized ML CSVs turn the normalized grade data into train/test matrices.
4. Train.py trains RandomForestRegressor to predict target_next_period_grade.
5. RegisterModelVersion.py stores model metadata into ai_model_version.
6. ModelScoringService.py loads the active model and predicts a next-period grade.
7. RiskEngine.py converts predicted grade and academic evidence into risk level.
8. PredictionPersistenceService.py saves the result into ai_prediction and ai_prediction_feature.
```

## Important Commands

General:

```bash
cd backend
alembic upgrade head
pytest -q
```

Dataset validation:

```bash
python -m app.ml.DatasetPackValidator --normalized-dir data/datasets/entervene_interpreted_synthetic_csv_pack --ml-dir data/datasets/entervene_current_data_ml_optimized --output-dir data/dataset_validation
```

Training:

```bash
python -m app.ml.Train --ml-dir data/datasets/entervene_current_data_ml_optimized --output-dir data/models --model-name entervene_next_period_grade_rf
```

Register model:

```bash
python -m app.ml.RegisterModelVersion --training-report data/models/entervene_next_period_grade_rf_training_report.json --feature-schema data/models/entervene_next_period_grade_rf_feature_schema.json --artifact-path data/models/entervene_next_period_grade_rf.joblib --model-name entervene_next_period_grade_rf --activate
```

Score only:

```bash
python -m app.ml.ScorePrediction --model-name entervene_next_period_grade_rf --input-json data/models/sample_prediction_input.json
```

Score and save:

```bash
python -m app.ml.SavePrediction --model-name entervene_next_period_grade_rf --input-json data/models/sample_prediction_persist_input.json --replace-existing
```

Tests:

```bash
pytest tests/test_dataset_pack_validator.py -q
pytest tests/test_ml_train.py -q
pytest tests/test_register_model_version.py -q
pytest tests/test_risk_engine.py -q
pytest tests/test_model_scoring_service.py -q
pytest tests/test_prediction_persistence_service.py -q
pytest -q
```

Latest full test result:

```text
pytest -q: 225 passed, 5 warnings
```

## Current Limitations

```text
1. The model is regression only, not classification.
2. No below-75 target examples exist in the current dataset.
3. Accuracy, AUC, F1, Precision, Recall are not valid yet.
4. Synthetic names/LRNs are development placeholders only.
5. Current ML pack is quarter-based.
6. period_type, total_periods_in_year, and period_progress_ratio are recommended future ML features for DepEd three-term readiness.
7. No frontend UI has been implemented for predictions yet.
8. No API endpoints have been implemented yet.
9. Teacher suggestions and student suggestions are not generated yet.
10. Prediction persistence exists, but production use should require real verified student/class/subject/period records.
```

## Next Recommended Task

The next task should be **Task 8: Prediction API Endpoints**.

Do not implement it in this handoff.

Task 8 should create backend API routes for:

```text
1. score-only prediction preview
2. score-and-save prediction
3. get latest prediction for student/class/subject
4. list class risk predictions
5. optionally list prediction feature explanations
```

Suggested files for next task:

```text
backend/app/api/v1/routes/Predictions.py
backend/app/schemas/Prediction.py
backend/tests/test_prediction_routes.py
```

Important Task 8 rules:

```text
- Use existing ModelScoringService for preview.
- Use PredictionPersistenceService for save.
- Do not retrain the model.
- Do not use synthetic identities as production students.
- Protect endpoints using existing auth/dependency style.
- Restrict access based on roles if the project already has role dependencies.
- Keep frontend for later Task 9.
```

Task 8 output should expose backend endpoints only.

## Final Summary

Current status:

```text
ML backend pipeline is complete up to scoring and database persistence.
```

Ready next:

```text
Build Prediction API endpoints.
```

Not ready yet:

```text
Frontend prediction dashboard, teacher/student suggestions, production classifier, Accuracy/AUC/F1 reporting.
```
