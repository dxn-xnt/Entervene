# Entervene prediction system: verified implementation and evidence

**Status:** Canonical prediction reference. **Verified:** 2026-10-13. **Scope:** repository and two local configurations inspected read-only; no production deployment or independent school cohort was tested. “Verified” means the stated source path or artifact was inspected, not that the prediction is clinically or educationally valid. All paths and line ranges below are relative to the repository root.

## 1. Executive Summary

**Plain language.** Entervene has more than one prediction path. The usable development demonstration estimates a student's eventual **grade in the same term** from that student's recorded Written Work (WW), Performance Tasks (PT), and examination evidence. A Random Forest produces a number; a separate fixed rule assigns a support band. That band is not a measured probability of failure. The local demo selects an official-historical-target candidate, but it remains a development model with no independent validation on completed current three-term records. The default local configuration disables that development API and has no active next-period model. [Evidence: `backend/app/core/Config.py:L16-L20`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L37-L61`; `backend/app/services/prediction/DevelopmentCurrentTermModelSelection.py:L10-L31`.]

**Technical conclusion.** The corrected candidate is a 31-input `RandomForestRegressor` trained on historical JHS quarter outcomes, not current three-term outcomes. Its strongest reported historical results occur after substantial evidence. The official-target candidate contains **zero** below-75 outcomes, so high-risk detection is unmeasured. A separate older next-period route has a different feature set and a multi-signal risk engine; do not combine its output or accuracy with the development same-term path. [Evidence: `backend/app/ml/TrainCurrentTermDevelopmentModel.py:L50-L98`; `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L31-L98`; `backend/app/services/prediction/ModelScoringService.py:L265-L342`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L16`.]

## 2. Purpose and Scope of the Prediction System

| Path | Question answered | Current access and status |
| --- | --- | --- |
| **Development same-term V3** | “Given recorded work so far, what numeric final grade might this student receive in this same term?” | `POST/GET /api/v1/development/current-term-predictions`; development/test plus feature flag; Admin generates, Admin/authorized Teacher reads. JHS Grades 7–10 only. This is the current demo path, not a production-approved model. [`backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L37-L128`; `backend/app/services/prediction/CurrentTermV3Domain.py:L9-L63`.] |
| **Legacy next-period** | “Given a source period, what might the next-period grade be?” | `/api/v1/predictions` routes and active model lookup. The default local registry has no active `entervene_next_period_grade_rf`; requests needing it cannot score there. Its older risk engine evaluates grade and participation signals. [`backend/app/api/v1/routes/Predictions.py:L272-L389`; `backend/app/services/prediction/ModelScoringService.py:L25-L82,L265-L342`.] |
| **Other artifacts/registry rows** | Earlier current-period or unified experiments | Local artifacts and candidate registry rows exist, but an active row alone does not prove an API uses it. No active route to the `unified_current_term_projection_v2` row was found under `backend/app/`. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L33-L38,L443-L448`; `backend/app/models/ai/AIModelVersion.py:L7-L27`.] |
| **Historical imported predictions** | Stored research/demo records | Existing `ai_prediction` rows can appear in historical dashboard/read paths. Their saved values are not newly scored live evidence; null legacy evidence snapshots must not be retroactively explained. [`backend/app/api/v1/routes/Predictions.py:L141-L213`; `backend/app/services/prediction/PredictionReadService.py:L188-L225`.] |

No automatic blanket prediction of every enrolled learner is established by the active development route. The administrative cohort script is a separate legacy import/scoring path and does not create the audited development V3 rows. [`backend/scripts/score_enrolled_cohort.py:L54-L255`; `docs/tickets/TICKET-2026-PREDICTION-EVIDENCE-STAGE-1-5.md:L5-L14`.]

## 3. Current Implementation and Model Versions

**Runtime selection is configuration-dependent.** `selected_development_model_name()` accepts only `entervene_current_term_development_rf_v3` or `entervene_current_term_official_target_rf_candidate`; unknown names fail closed. The API additionally requires one matching inactive DEVELOPMENT registry row and an exact artifact/schema/hash contract. Default `Config.py` sets `app_environment=production`, feature flag false, and the **legacy V3** selector; environment files can override these defaults. The inspected local `.env` resolves to `development`, flag **false**, selector **legacy V3**. The inspected `.env.demo` resolves to `development`, flag **true**, selector **corrected candidate**. Its registry contains both development rows, inactive and not production validated. The normal local registry has an inactive next-period candidate and an active unified candidate, but no route was found consuming the latter. These observations are local configuration state on the verification date, not deployment assertions. [`backend/app/core/Config.py:L15-L29`; `backend/app/services/prediction/DevelopmentCurrentTermModelSelection.py:L10-L31`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L37-L61`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py:L63-L99`.]

The corrected candidate artifact is locally present and its SHA-256 was recomputed as `f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc`. Its development dataset SHA-256 was recomputed as `789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1`. The schema has the same ordered 31 input names as legacy V3. These ignored local files need trusted provisioning in a fresh checkout; presence here is not proof of deployment elsewhere. [`backend/app/services/prediction/schemas/entervene_current_term_official_target_rf_candidate_feature_schema.json:L1-L56`; `docs/DEVELOPMENT_PREDICTION_ACCEPTANCE_4M.md:L11-L16`.]

The **legacy V3** was trained on mixed target meanings: official historical grades for 20/60/20 records and reconstructed old-interpolation decimals for most 20/50/30 records. The **corrected candidate** uses the stored historical workbook Quarterly Grade for all resolved periods. Earlier Task 4E/4F errors against reconstructed labels must never be quoted as official-grade accuracy. [`docs/V3_TARGET_INTEGRITY_4H.md:L5-L22,L44-L85`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L85-L96`.]

## 4. End-to-End Prediction Workflow

**Development path, in order:**

1. A teacher records graded classwork/submission results; typed ST1, ST2 and Term Exam results are consolidated when complete. A guarded, post-commit refresh is called by activity, submission and quiz grading services **only** with the corrected selector and enabled development API. Admins may also generate explicitly with POST. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L79-L153,L236-L331`; `backend/app/services/prediction/DevelopmentGradeRefreshService.py:L23-L65`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L63-L103`.]
2. The API resolves the selected inactive development model and validates source term = target term, active period, no finalized same-term grade, real student/class/subject scope, JHS grade, exact subject mapping, supported component-weight pattern, and evidence readiness. [`backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L45-L103`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionService.py:L113-L235`; `backend/app/services/prediction/CurrentTermV3Domain.py:L26-L63`.]
3. The feature builder reads the student's eligible graded, non-archived, non-reading classwork in that class, subject and period. It selects a graded submission at the capture cutoff, handles remedial exams, maps each item to WW/PT/QA, resolves template weights, constructs exactly 31 features and emits warnings for out-of-training envelopes. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L79-L165,L236-L439`.]
4. The scorer checks the exact schema and artifact metadata, loads the selected joblib pipeline, and returns one finite floating-point projected grade. It does not compute a failure probability. [`backend/app/services/prediction/DevelopmentCurrentTermScoringService.py:L22-L109`.]
5. A separate deterministic rule maps a valid 0–100 projected grade to a support band. Ineligible or unavailable projections receive `INTERVENTION_NOT_ASSESSED`; contextual attendance/engagement fields are recorded as supporting context only. [`backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L18-L98`.]
6. A serialized transaction rechecks the domain and evidence, saves an immutable feature/evidence snapshot with model and artifact hashes, and creates a revision only if the relevant evidence or model contract changed. GET selects the latest revision **within the chosen model version**. [`backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py:L102-L294,L298-L376`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionReadService.py:L209-L335`.]
7. The development panel displays the numeric projection, support band, model name/version, readiness and historical-final-grade context. It provides Admin generation and Teacher read access. [`frontend/src/components/predictions/development-current-term-panel.tsx:L39-L56,L181-L206,L258-L318`; `frontend/src/lib/prediction-api.ts:L149-L193`.]

**Older next-period path:** `/api/v1/predictions/from-records` builds a distinct feature vector from period grades, classwork, assessment observations and attendance; readiness requires source grade and at least 50% completion and coverage. If ready, it resolves an **active** model, scores a next-period grade, applies `RiskEngine`, then saves a separate `ai_prediction` result. Despite a builder string `CURRENT_PERIOD_PROJECTION` in some same-period scopes, that route still defaults to the next-period model; the string alone does not create a distinct current-period scorer. [`backend/app/api/v1/routes/Predictions.py:L303-L389`; `backend/app/services/prediction/PredictionFeatureBuilderService.py:L486-L550,L606-L850`; `backend/app/services/prediction/ModelScoringService.py:L265-L342`.]

## 5. Data Sources and Student Eligibility

Development V3 uses student, class, subject, academic-period, grading-template, classwork-assignment and graded submission records. The strict live catalog mapping is `MATH7`, `SCI7`, `ENG7`, `ENG8`, `ENG9`, `MATH10`, `SCI10` with exact grade/name; canonical demo labels also have a fallback. Enhanced Mathematics/Science are unverified, TLE-to-ICT needs client confirmation, and SHS Grades 11–12 are rejected. A supported map means the runtime accepts the scope; only ENG7 and MATH10 have matching historical grade–subject workbook holdouts. [`backend/app/services/prediction/CurrentTermV3Domain.py:L9-L63`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L85-L92`.]

Minimum readiness is **at least four graded available activities**, WW and PT evidence, observed component weight **at least 70%**, and no unresolved evidence. Seven or more activities, WW/PT/QA, all 100% weight, and no unresolved evidence produce `HIGH_EVIDENCE`; three activities with WW/PT is `LIMITED_EVIDENCE` and **cannot score**. Finalized same-term grades block generation; no scoreable evidence yields no development prediction row. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L191-L234`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionService.py:L125-L221`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py:L298-L356`.]

Historical candidate training used **14 JHS quarter workbooks**, **1,865 student-periods**, **467 pseudonymous students**, and **5,595 correlated snapshots** at 25%, 50% and 75% activity-column evidence. The source is older quarterly ECR, with aggregate QA rather than live typed ST1/ST2/Term Exam. Snapshot stages are approximate evidence order, not observed dates. No current completed three-term independent validation cohort was found. [`docs/V3_TARGET_INTEGRITY_4H.md:L5-L22,L44-L78`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L16`.]

## 6. Complete Feature and Variable Inventory

**Interpretation of the table.** Each row below is a model input in both V3 31-column schemas and the runtime `features` object. Numeric fields are floating-point; counts/flags are stored numerically. `0` can mean no observed component, **not** a real zero grade. The runtime requires every named key; the fitted preprocessing has median imputation for numeric nulls, but the live builder normally supplies numeric zero and readiness blocks weak evidence. Nominal grades/percentages are 0–100, yet the builder does not generally clip over-HPS scores; training support envelopes produce warnings, not universal hard bounds. `subject` is a non-empty categorical string. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L42-L58,L155-L189,L337-L439`; `backend/app/services/prediction/DevelopmentCurrentTermScoringService.py:L41-L92`; `backend/app/services/prediction/schemas/entervene_current_term_official_target_rf_candidate_feature_schema.json:L1-L56`.]

| Exact input name | Source / calculation | Type and practical range | Other use |
| --- | --- | --- | --- |
| `grade_level` | Student academic level, fallback class level | Numeric; V3 supported 7–10 | Scope gate; model |
| `ww_weight`, `pt_weight`, `qa_weight` | Resolved subject template fractions ×100 | Numeric percentages; accepted combinations 20/50/30 or 20/60/20 | Domain gate; model; weighted derivatives |
| `ww_available_activity_count` | Count of usable scored WW items | Nonnegative count | Readiness through aggregate; model |
| `pt_available_activity_count` | Count of usable scored PT items | Nonnegative count | Readiness through aggregate; model |
| `qa_available_activity_count` | Count of usable QA items; complete typed exam is one aggregate | Nonnegative count | Readiness through aggregate; model |
| `overall_available_activity_count` | Sum of WW, PT, QA counts | Nonnegative count | ≥4 readiness, ≥7 high evidence; model |
| `ww_points_earned_so_far`, `ww_points_possible_so_far` | Sum of selected WW score and positive HPS | Numeric grade points, nonnegative by intended records; no scorer bound | Model |
| `ww_percent_so_far` | 100 × WW earned / HPS, or 0 without usable WW | Numeric percent; over-HPS can exceed 100 | Model; derivative |
| `ww_weighted_score_so_far` | WW percent × WW weight / 100 | Numeric initial-grade points | Model; aggregate |
| `pt_points_earned_so_far`, `pt_points_possible_so_far` | PT analog of WW sums | Numeric grade points | Model |
| `pt_percent_so_far` | PT analog of WW percent | Numeric percent | Model; derivative |
| `pt_weighted_score_so_far` | PT percent × PT weight / 100 | Numeric initial-grade points | Model; aggregate |
| `qa_points_earned_so_far`, `qa_points_possible_so_far` | Complete typed exam percent represented against synthetic 40 HPS, or aggregate untyped QA scores | Numeric grade points; live typed QA is an aggregate representation | Model |
| `qa_percent_so_far` | QA earned / HPS ×100; zero until complete typed set | Numeric percent | Model; derivative |
| `qa_weighted_score_so_far` | QA percent × QA weight / 100 | Numeric initial-grade points | Model; aggregate |
| `observed_component_weight_sum` | Sum of weights of components with a usable score | Numeric percent, 0–100 for accepted weights | ≥70 readiness; model |
| `overall_weighted_score_so_far` | Sum of observed component weighted scores | Numeric initial-grade points | Model; derivative |
| `overall_partial_percent` | 100 × overall weighted score / observed weight; 0 if none | Numeric normalized percent; can exceed 100 for over-HPS | Model |
| `ww_has_evidence`, `pt_has_evidence`, `qa_has_evidence` | 1 when corresponding usable component count >0, else 0 | Binary numeric | WW/PT readiness, QA high evidence; model |
| `has_any_input_evidence` | 1 when observed weight >0, else 0 | Binary numeric | Model |
| `ww_score_over_hps_count_so_far`, `pt_score_over_hps_count_so_far`, `qa_score_over_hps_count_so_far` | Count selected scores greater than item HPS | Nonnegative count | Model / data-quality signal |
| `subject` | Exact mapped canonical Mathematics, Science, English etc. | Non-empty category; one-hot encoded | Domain gate; model |

These are **31 columns**, counting each comma-separated name individually. Full ordered list is in `backend/app/services/prediction/schemas/entervene_current_term_official_target_rf_candidate_feature_schema.json`; assembly is in `backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L337-L420`. Grade trend, prior grade, attendance, punctuality, missing work, and behavioral engagement are **not** V3 model inputs. Supporting-context fields in `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L18-L29` are not used to assign its grade-derived band. The older next-period model and risk engine do use some of those variables; see §10. Database existence alone never implies V3 model use.

## 7. Grade Components, Percentages, and Accuracy

**Direct answer:** grading component weights are direct V3 inputs **and** change its derived weighted-score inputs. The gradebook also uses resolved WW/PT/EX weights to compute an Initial Grade, rounds it to two decimals and applies a lookup to obtain the current Term Grade. Subject-specific 20/50/30 versus 20/60/20 therefore changes the meaning of both features and official grade targets. This mathematical effect does **not** establish that one weight pattern makes the model more accurate. No controlled, same-student weight-swap accuracy experiment was found. Historical subgroup errors confound weights with subject/cohort. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L246-L253,L337-L420`; `backend/app/services/student_record/StudentRecordService.py:L585-L677,L734-L774`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L70-L84`.]

**Illustration, not a measured learner:** WW 80%, PT 90%, EX 70% gives Initial Grade `0.20×80 + 0.50×90 + 0.30×70 = 82.00` for core weights, and `0.20×80 + 0.60×90 + 0.20×70 = 84.00` for EPP/TLE weights. The current lookup maps these to Term Grades **85** and **86**, respectively. This was checked against `transmute_current_three_term_grade()`. It does not predict a student's future grade and says nothing causal about model accuracy. [`backend/app/services/grading/CurrentThreeTermTransmutation.py:L7-L28`; `backend/app/services/student_record/StudentRecordService.py:L759-L769`.]

Template resolution uses subject default, subject-linked, level-linked, then active Core Subjects; absent/invalid templates fall back to **30/50/20**, which the development scorer rejects as an unsupported V3 pattern. The gradebook's no-component calculation contributes zero for that component; V3's `overall_partial_percent` divides by **observed weight**, so these are different quantities. Typed EX uses ST1/ST2/Term Exam default 30/30/40 internally and is hidden from V3 until all three are available. The documented SHS TE-only and no-EX exceptions lack verified runtime configuration parity. Incorrect templates can distort features and official grades; whether and by how much that changes predictive error is unmeasured. [`backend/app/services/student_record/StudentRecordService.py:L565-L677,L734-L774`; `backend/app/services/grading/ExaminationCalculator.py:L16-L36,L109-L172`; `backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L292-L329,L353-L365`; `docs/GRADE_TRANSMUTATION_CONTRACT_4G.md:L44-L60`.]

The corrected candidate uses historical **official quarter grades**, while live gradebook calculations use the supplied current **three-term** transmutation table. The lookup table has been verified at two-decimal precision, but that does not make older quarterly training targets equivalent to current three-term outcomes. This domain shift is a production validation blocker. [`docs/V3_TARGET_INTEGRITY_4H.md:L44-L78`; `docs/GRADE_TRANSMUTATION_CONTRACT_4G.md:L5-L49`.]

## 8. Prediction Algorithm and Model Training

**Plain language.** Random Forest combines many decision trees to estimate a numeric grade from the student's recorded academic pattern. It is a regression model, not a classifier.

**Technical.** The corrected candidate retains the V3 architecture: 300-tree `RandomForestRegressor`, `max_features=0.5`, `min_samples_leaf=2`, `min_samples_split=5`, seed 42; median numeric imputation and unknown-tolerant one-hot subject encoding. The target is `target_final_period_grade`, now the historical workbook's stored official Quarterly Grade. The candidate's offline 14-fold evaluation refits a new pipeline while holding out one whole workbook and its students per fold; it is **not** an evaluation of the deployed demo artifact on an unseen current school. The old V3 train/validation/test split was 3,903/840/852 snapshots by student, but its mixed/reconstructed target prevents official-grade interpretation. [`backend/app/ml/TrainCurrentTermDevelopmentModel.py:L19-L25,L50-L98,L125-L171`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L16`; `docs/V3_TARGET_INTEGRITY_4H.md:L5-L22`.]

The older next-period Random Forest has its own target `target_next_period_grade` and 20-feature training report. Its local report lists 1,580 training rows, 395 test rows, MAE **1.4892** and RMSE **2.0559** against its own historical target. The default local registry row is inactive, and these metrics cannot be transferred to V3 or to current three-term learners. [`backend/app/ml/Train.py:L19-L29,L184-L200`; `backend/data/models/entervene_next_period_grade_rf_training_report.json`; `backend/app/services/prediction/ModelScoringService.py:L25-L82`.]

## 9. Prediction Output, Range, and Interpretation

| Quantity | Meaning and implementation | Range / caution |
| --- | --- | --- |
| Development `projected_final_term_grade` | Raw float from the selected regressor, persisted as `Numeric(6,2)` | **Nominal grade-point scale 0–100.** Scorer checks finite only, without clipping; the downstream band refuses out-of-range values and successful persistence requires an assessed band. No guaranteed prediction bound is enforced by the model call. [`backend/app/services/prediction/DevelopmentCurrentTermScoringService.py:L94-L109`; `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L65-L84`; `backend/app/models/ai/DevelopmentCurrentTermPrediction.py:L14-L38`.] |
| Development support band | Deterministic rule from the raw projected grade | Four bands in §10; not a probability or model confidence. Saved `risk_score` is always null. [`backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L78-L98`; `backend/app/models/ai/DevelopmentCurrentTermPrediction.py:L9-L13`.] |
| Older next-period `predicted_period_grade` | Regressor float rounded to two decimals for API/saving | No model-side clipping is shown; may be suppressed to null on insufficient data. [`backend/app/services/prediction/ModelScoringService.py:L225-L227,L265-L342`.] |
| Older next-period `risk_score` | Heuristic severity score from §10 | 0–100, larger means more concern; null on scorer-level insufficiency. **Not** a failure probability. [`backend/app/services/prediction/RiskEngine.py:L212-L242`; `backend/app/services/prediction/ModelScoringService.py:L311-L326`.] |

The current three-term gradebook transmutation maps Initial Grade to Term Grade 60–100 using intervals; that is a **grade calculation**, not model postprocessing. An estimated term grade is neither a finalized grade nor a probability. [`backend/app/services/grading/CurrentThreeTermTransmutation.py:L7-L28`; `backend/app/services/student_record/StudentRecordService.py:L734-L774`.]

## 10. Risk Scoring and At-Risk Classification

**Development V3:** the rule is `grade <75 → HIGH_RISK`, `75≤grade<85 → MODERATE_RISK`, `85≤grade<90 → NEEDS_MONITORING`, `grade≥90 → LOW_RISK`, provided the raw grade is finite and between 0 and 100. No grade or blocked readiness means `INTERVENTION_NOT_ASSESSED`. Attendance and engagement are only contextual in this rule. Thresholds are hardcoded in `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L65-L98`, not learned or configured. Despite the field name `intervention_level`, this is a downstream band, not an empirical diagnosis or probability. [`backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L31-L98`.]

**Older next-period:** `RiskEngine` uses the predicted grade **plus** source grade, trend, completion, coverage, missing and late work, previous-period status, and participation score. It evaluates rule triggers; severity priority is `INSUFFICIENT_DATA` above HIGH above MODERATE above MONITOR above LOW. Missing prediction, completion or coverage, or completion/coverage below 0.50, triggers insufficient data. Other high-risk triggers include predicted grade <75, source grade <75, predicted <80 with trend ≤−5, completion <0.70 with predicted <82, or ≥3 missing items with predicted <85. Behavioral engagement <60 also triggers high risk; 60–<75 moderate, 75–<85 monitoring. See the code for the complete moderate/monitor rule set and exact boundary operators. Active `risk_threshold` rows are loaded into the trace but **do not override** these hardcoded defaults. [`backend/app/services/prediction/RiskEngine.py:L12-L52,L98-L209,L244-L287`.]

For the older path, the numeric score is **base** `0/10/35/60/85` for insufficient/low/monitor/moderate/high, plus capped penalties: `min(20,max(0,88−predicted)×1.5)` if predicted <88; `min(10,|negative trend|)`; `min(10,(0.90−completion)×25)` if completion <.90; `min(8,missing×2.5)`; `min(5,late×1.5)`; and `min(5,max(0,trigger_count−1)×1.5)`. It is then clipped to its level's score interval and 0–100. `INSUFFICIENT_DATA` returns **0** from the direct risk engine, yet the older scorer suppresses its exposed score to **null**. This is a rule-based priority, not model confidence. [`backend/app/services/prediction/RiskEngine.py:L28-L34,L212-L242`; `backend/app/services/prediction/ModelScoringService.py:L310-L326`.]

Teachers can submit a review for an older saved prediction; that review is a separate record and does not retrain the model or change its saved score. The development panel does not expose a verified grade override in its prediction response. [`backend/app/api/v1/routes/Predictions.py:L514-L551`; `backend/app/services/prediction/TeacherRiskReviewService.py:L12-L67`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L63-L128`.]

## 11. Risk Thresholds and Worked Examples

| Illustrative input | Actual rule result | Why |
| --- | --- | --- |
| Development projection **74.99** | HIGH_RISK | Strictly below 75. |
| Development projection **75.00** | MODERATE_RISK | 75 included; below 85. |
| Development projection **85.00** | NEEDS_MONITORING | 85 included; below 90. |
| Development projection **90.00** | LOW_RISK | 90 included. |
| Development with no score, or score outside 0–100 | INTERVENTION_NOT_ASSESSED | No valid band is assigned. |
| Older next-period: predicted 84, source 88, trend 0, completion .80, coverage .80, no missing/late, prior period present, no participation signal | NEEDS_MONITORING; score **45.0/100** | Triggers predicted 82–<88 and completion <.90. Base 35 + grade penalty 6 + completion penalty 2.5 + second-trigger penalty 1.5. Checked by calling `evaluate_risk()` with these values. |
| Older next-period: prediction, completion and coverage all missing | INSUFFICIENT_DATA; direct engine score **0**; scorer response score **null** | Missing-data rules outrank other levels. Checked by calling `evaluate_risk()`. |

These are rule exercises, not observed students. A predicted grade of 84 alone does **not** fully determine the older path's risk: other triggered signals can raise it. [`backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L65-L98`; `backend/app/services/prediction/RiskEngine.py:L125-L242`.]

## 12. Student-Level Personalization

**Yes, within the represented academic data.** Both feature builders query a particular student, class, subject and period. V3 uses that student's own graded WW/PT/QA submissions and the class's subject weights; new eligible grades may change the projection and create another development revision. The older path may also use the student's period grade, previous grade/trend, classwork completion, attendance and participation. The same trained model and risk rules are shared across learners, while input values are individualized. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L236-L439`; `backend/app/services/prediction/DevelopmentGradeRefreshService.py:L23-L65`; `backend/app/services/prediction/PredictionFeatureBuilderService.py:L606-L850`.]

This is **statistical personalization**, not holistic knowledge of a learner's circumstances. V3 does not consume personal context, history, attendance or improvement trend as model inputs. Old next-period history can influence its model/rules, but an absent prior grade or thin activity record limits it. Teacher review can append context to an older alert; it is not a model feature or automatic correction. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L370-L415`; `backend/app/services/prediction/ModelScoringService.py:L265-L342`; `backend/app/services/prediction/TeacherRiskReviewService.py:L12-L67`.]

## 13. Fairness, Bias, and Data Sufficiency

**Safeguards verified:** common V3 feature schema and hardcoded grade-band boundaries; strict JHS/domain gates; readiness and no-final-grade gates; per-student evidence snapshots; explicit insufficient-evidence result; whole-workbook/student holdouts in offline research. These improve consistency and traceability but do not prove equitable outcomes. [`backend/app/services/prediction/DevelopmentCurrentTermPredictionService.py:L113-L243`; `backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L191-L234`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L16`.]

**Measured limitations:** 4I's canonical official-target candidate has zero actual outcomes below 75 and zero at 75–79. Thus high-risk recall, false-negative rate on failing learners, and calibration are **not evaluable**. The seen-fold 80–84 group is overpredicted on average (+2.7156 across snapshots, +1.4807 at latest); these are historical aggregate tendencies, not proof of any protected-group disparity. First-ready errors exceed latest-ready errors. [`docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L53-L83`; `docs/RANDOM_FOREST_DEFENSE_4J.md:L27-L51`.]

**Unresolved fairness risks:** fewer recorded activities can block scoring or bias the information available; missing scores are represented differently from genuinely low scores; typed exams appear only as a complete aggregate; template differences and teacher recording practices change features; five of seven mapped live grade–subject pairs lack exact-grade historical holdouts; no current three-term cohort or subgroup fairness analysis (for example by grade, program, socioeconomic status or protected group) establishes comparable error or access. The older path's attendance/participation and missing-work rules can raise severity independently of grades. Teacher review exists for older alerts but does not validate fairness. No evidence supports claiming the system is unbiased or fair for deployment. [`backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L79-L165,L191-L234,L292-L329`; `backend/app/services/prediction/RiskEngine.py:L125-L204`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L85-L96`.]

## 14. Accuracy, Validation, and Reliability

**What is measured.** 4I/4J provide internal, whole-workbook held-out historical JHS **regression** error, with no student overlap between each fold's train and test workbook. The candidate official-target dataset and artifact hashes above match local files. Metrics refer to fold-fitted temporary models with the candidate architecture; they are **not** a blind external test of the demo artifact or current three-term learners. All-stage snapshot rows are correlated, so per-period latest/first-ready views are also needed. `MAE`/`RMSE` are grade points; `R²` is variance fit, not classification accuracy. [`docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L49`; `docs/RANDOM_FOREST_DEFENSE_4J.md:L15-L51`.]

| Official-target historical comparison | N | RF MAE | Comparator | Meaning |
| --- | ---: | ---: | --- | --- |
| 13 seen-subject folds, all stages | 5,187 snapshots | **1.6007** | Linear Regression 1.6664; global mean 3.0187 | RF's overall linear advantage is small; 25% stage favors linear. |
| 13 seen-subject folds, latest 75% | 1,729 periods | **0.7670** | Linear Regression 1.0355; source-valid provisional 1.1012 | Late evidence includes historical QA; cannot advertise as early-term accuracy. |
| Five exact live mapping folds, all stages | 2,019 snapshots | **1.8698** | Linear Regression 1.7797 | Linear is better on this all-stage exact-live subset. |
| Five exact live mapping folds, latest 75% | 673 periods | **1.0913** | Linear Regression 1.1325; provisional 1.4294 | Only ENG7 and MATH10 among mapped live pairs have exact grade–subject sources. |
| Seen-subject **first feature-ready** | 1,600 periods | **1.5443** | Linear Regression 1.6866 | Readiness replay assumes no unresolved evidence; not full live gate replay. |
| Exact-live **first feature-ready** | 611 periods | **2.0013** | Linear Regression **1.9528** | Linear is better at first readiness here. |

The historic provisional formula is comparable only at 75% because earlier snapshots lack QA. No controlled experiment varies grading percentages for the same academic records. Old 4E/4F legacy-V3 results are **Historical** and measure the old reconstructed/mixed target. The separate current-period v1 and next-period reports are other targets/paths. No precision, recall, F1 or ROC-AUC for high-risk failure can be inferred from these regression errors; the candidate has no failing actuals. [`docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L13-L96`; `docs/V3_BASELINE_BENCHMARK_4F.md:L11-L52`; `docs/RANDOM_FOREST_DEFENSE_4J.md:L27-L51`.]

**Reliability status:** corrected artifact load and demo API contract were previously exercised in isolated 4M acceptance. In this audit, its artifact/dataset hashes, selector/registry flags, and focused source tests were checked; no full model retraining, independent current-cohort validation, live data mutation or fresh interactive browser acceptance was performed. A fresh checkout lacks ignored artifacts unless provisioned. [`docs/DEVELOPMENT_PREDICTION_ACCEPTANCE_4M.md:L11-L33`.]

## 15. Backend and Frontend Integration

The main router mounts `/api/v1/predictions` and `/api/v1/development`; the latter is hidden with 404 outside enabled development/test. Admin generates a V3 row; authorized Admin/Teacher reads the selected version's latest revision. The React panel displays a two-decimal projected grade, band, model information and final official grade if later available. Its “Intervention Level” label is the existing UI wording for a deterministic grade band, not model confidence. Historical `ai_prediction` dashboards are separate and can include old records without an audited evidence snapshot. [`backend/app/main.py:L100-L101`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L37-L128`; `frontend/src/components/predictions/development-current-term-panel.tsx:L258-L318`; `backend/app/services/prediction/PredictionReadService.py:L188-L225`.]

## 16. Prediction Persistence and Recalculation

V3 persistence stores student/class/subject/source=target/model version/revision, two-decimal grade, band, null risk score, generated time and evidence snapshot. Same model and unchanged feature/exam/schema/artifact values reuse a revision; changed values append a new one. GET returns the latest revision of **that model version**, so a selector switch does not erase or blend previous model histories. It checks finalized grades and active periods again before saving. The post-grade refresh is conditional on the corrected selector and successful grade-commit callers; no general scheduled refresh was found. [`backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py:L102-L294,L298-L376`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionReadService.py:L209-L335`; `backend/app/services/prediction/DevelopmentGradeRefreshService.py:L23-L65`.]

The older `ai_prediction` path has its own idempotency key, evidence snapshot for newly audited rows and read behavior; legacy null snapshots remain limited. `GET /latest` sorts by generation time then ID, while class risk-list route returns rows in order and does not itself collapse all revisions in that handler. Do not describe every historical row as a fresh live prediction. [`backend/app/services/prediction/PredictionPersistenceService.py:L210-L275`; `backend/app/api/v1/routes/Predictions.py:L394-L459`; `backend/app/services/prediction/PredictionReadService.py:L188-L225`.]

## 17. Limitations and Known Issues

1. **No independent current three-term validation or failing outcomes.** This blocks school-grade accuracy and high-risk detection claims. [`docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L16,L53-L96`.]
2. **Live scope is narrow.** Five of seven accepted catalog mappings lack exact grade–subject historical tests; SHS and several subjects are out of scope. [`backend/app/services/prediction/CurrentTermV3Domain.py:L9-L63`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L85-L92`.]
3. **Historical timing is approximate.** Snapshot stages use column order, not known assessment timestamps. Real cutoff accuracy is unverified. [`docs/PREDICTION_STRATEGY_4E.md:L5-L11`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md:L5-L16`.]
4. **Model output is not numerically clipped** before the development band validates 0–100. This is an explicit edge-contract gap, not evidence that observed candidate outputs left the range. [`backend/app/services/prediction/DevelopmentCurrentTermScoringService.py:L94-L109`; `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L65-L84`.]
5. **Grade policy parity remains conditional.** Current three-term transmutation is implemented, but some SHS exam structures and independent source-to-target parity remain untested. [`docs/GRADE_TRANSMUTATION_CONTRACT_4G.md:L44-L60`.]
6. **Operational availability differs by configuration.** Default local development API disabled; demo API enabled and corrected candidate selected. Ignored local artifacts require trusted provisioning. No active next-period model in inspected default registry. [`backend/app/core/Config.py:L15-L29`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L37-L61`; `docs/DEVELOPMENT_PREDICTION_ACCEPTANCE_4M.md:L11-L16`.]
7. **Legacy documents conflict with code.** Historical `ML_HANDOFF.md` claims a dual-purpose roster endpoint and current-period files/components that are absent from the inspected active code; the data dictionary calls risk score probabilistic 0–1, while `RiskEngine` uses 0–100 heuristic severity. The older enrolled-cohort ticket's numeric cohort/accuracy/“100% confidence” claims are dated, unverified and not deployment evidence. [`backend/app/services/prediction/RiskEngine.py:L212-L242`; `backend/app/models/ai/AIPrediction.py:L40-L59`; `docs/DATA_DICTIONARY.md:L1349-L1399`.]

## 18. Verified Versus Unverified Claims

| Finding | Status | Basis |
| --- | --- | --- |
| V3 is a 31-input Random Forest numeric same-term grade estimator; bands are downstream rules | **Verified** | Scorer, schema, builder, risk code and focused tests. |
| Demo selector resolves corrected candidate with inactive DEVELOPMENT registry entry | **Verified for local `.env.demo` on 2026-10-13** | Configuration and read-only registry query; hashes checked. |
| Historical official-target fold metrics in §14 describe this architecture/dataset | **Partially verified** | Machine-readable report and hashes present; focused report tests passed; full 14-fold retraining was not rerun. |
| Candidate is accurate on independent current three-term students or detects failing students | **Unverified** | No such validation cohort; official historical target has zero failing cases. |
| Weights directly and indirectly change V3 inputs and computed grades | **Verified** | Builder and gradebook formulas. |
| Changing weights improves or worsens predictive accuracy | **Unverified** | No controlled paired weight experiment. |
| Fairness across protected/subgroup populations | **Unverified** | No suitable subgroup cohort or metrics. |
| 4E/4F old V3 metrics establish official-target accuracy | **Historical / contradicted** | 4H target-lineage correction. |
| Dual-purpose production roster/automatic next-period flow in former `ML_HANDOFF.md` | **Historical / unsupported** | Claimed endpoint/components absent; inspected next-period registry inactive. |
| Phase 1 prediction evidence snapshot and teacher presentation are implemented | **Partially verified** | Code/test paths exist; full release and legacy coverage still need current end-to-end audit. |

## 19. Remaining Prediction-Only Tickets

| Ticket or issue | Classification as of verification | Required next evidence/action |
| --- | --- | --- |
| `TICKET-2026-PREDICTION-EVIDENCE-AUDIT.md` | **Partially implemented roadmap.** Phase 1 pieces exist; append-only general series, source reconciliation and full compatibility gates are not established. | Audit current Phase 1 semantics against code/tests before deciding later prediction work. |
| `TICKET-2026-PREDICTION-EVIDENCE-PHASE-1.md` | **Partially implemented / stale status text.** Snapshot, catalog, idempotency and teacher view code exist; its header still says presentation pending. | Reconcile acceptance and release gates with current implementation; retain as dated design record. |
| `TICKET-2026-PREDICTION-EVIDENCE-STAGE-1-REPORT.md` and `STAGE-1-5.md` | **Completed historical audit/decision records.** | Preserve for baseline and design provenance. |
| `TICKET-2026-PREDICTION-EVIDENCE-STAGE-6-REPORT.md` | **Historical acceptance snapshot; not a current release certificate.** | Recheck original blockers. On this audit, `alembic heads` shows one head, while the frontend build remains broken by unrelated TypeScript issues. |
| Archived [TICKET-2026-ENROLLED-STUDENT-SCORING.md](archive/prediction/TICKET-2026-ENROLLED-STUDENT-SCORING.md) | **Superseded proposal / partially open principle.** It proposes an event-driven cohort scorer; the actual script still has a separate write path and its historical numeric claims are unverified. | No fabricated evidence; decide a bounded, audited prediction generation path for real students only after eligibility/model validation. |
| Trusted model artifact provisioning and browser acceptance from 4M | **Open** | Provision checksum-verified artifacts on a clean checkout and exercise Admin/Teacher UI against isolated test data. |
| Current three-term external validation, real lower-grade cases, cutoff timing, exact subject/weight parity | **Open; blocks accuracy and production decision** | Obtain de-identified, completed records and compare frozen candidate, Linear Regression and a source-valid academic baseline. |

The unrelated subject-remapping ticket remains in `docs/tickets/` unchanged. Its direct dependency on prediction interpretation is noted, but subject catalog migration is not part of this documentation task.

## 20. Prediction Completion and Acceptance Criteria

Prediction is **not complete for production**. To advance beyond an isolated development demonstration, require all of the following with reviewable evidence:

1. Exact artifact, schema, registry and configured selector can be provisioned and reproduced from a clean checkout; every supported live subject, grade and weight has an explicit contract.
2. Completed, de-identified **current three-term** outcomes independent of the historical training workbooks, with assessment availability dates, official grading configuration, student/workbook overlap control and naturally occurring low-grade cases.
3. Predeclared grouped evaluation on frozen candidate, Linear Regression and a verified academic baseline, reported by evidence stage and supported grade/subject/weight, with MAE/RMSE and band confusion; actual high-risk sensitivity must be measurable before any failure-detection claim.
4. Gradebook/template/exam/transmutation parity against supplied official completed records; resolve SHS exceptions separately before any SHS scope.
5. Documented data-sufficiency and fairness analysis: who is excluded, error and alert rates across relevant cohorts, teacher review process and response to missing/late evidence. No unsupported fairness certification.
6. Focused backend/frontend/browser tests, persistence/revision and authorization checks, and current repository release gates pass or have explicitly bounded, documented exceptions. Activation and live use require a separate decision after this evidence.

## 21. Future Phase: Intervention (Brief Boundary Only)

Existing prediction code exposes support bands and some persistence hooks, but this document does **not** validate an intervention workflow. Phase 2 may use verified prediction outputs only after the Phase 1 acceptance conditions above are met. No intervention code or policy was changed in this audit. [`backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py:L38-L60,L247-L285`.]

## 22. Code References and Supporting Evidence

| Authority | Key locations |
| --- | --- |
| Runtime routing and model gate | `backend/app/main.py:L100-L101`; `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py:L37-L128`; `backend/app/services/prediction/DevelopmentCurrentTermModelSelection.py:L10-L31` |
| Live data, feature formulas, readiness and scope | `backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py:L79-L165,L191-L234,L236-L439`; `backend/app/services/prediction/CurrentTermV3Domain.py:L9-L63` |
| V3 scoring, band and persistence | `backend/app/services/prediction/DevelopmentCurrentTermScoringService.py:L41-L109`; `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py:L31-L98`; `backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py:L102-L376` |
| Other prediction path | `backend/app/api/v1/routes/Predictions.py:L272-L459`; `backend/app/services/prediction/PredictionFeatureBuilderService.py:L486-L850`; `backend/app/services/prediction/ModelScoringService.py:L265-L342`; `backend/app/services/prediction/RiskEngine.py:L125-L287` |
| Gradebook and frontend | `backend/app/services/student_record/StudentRecordService.py:L585-L677,L734-L774`; `backend/app/services/grading/ExaminationCalculator.py:L109-L172`; `frontend/src/components/predictions/development-current-term-panel.tsx:L258-L318` |
| Dataset, target and evaluation provenance | `backend/app/ml/BuildCurrentTermOfficialTargetCandidate.py`; `backend/app/ml/EvaluateOfficialTargetRF4I.py`; `backend/app/ml/CharacterizeOfficialTargetRF4J.py`; `docs/V3_TARGET_INTEGRITY_4H.md`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md`; `docs/RANDOM_FOREST_DEFENSE_4J.md` |

## 23. Documentation Version and Verification Date

**Version:** 1.0, **2026-10-13**. Source audit covered all files under `docs/` and prediction-relevant code, schemas, local artifacts and focused tests. Historical reports remain dated evidence; this document governs claims about the current implementation. Verification was read-only against database/model data. No application code, trained model, dataset, migration or intervention behavior was modified for this documentation task. Local database registry state and ignored artifacts may differ in another environment; recheck them before deployment claims.
