# Random Forest defense and readiness audit (Task 4J)

Audited 2026-09-24 using the canonical official-target JHS candidate and Task 4I's leakage-safe whole-workbook predictions. This is offline characterization of the fixed `RandomForestRegressor`, not model selection, runtime integration, current three-term validation, or production approval. Run `cd backend` then `.venv/Scripts/python.exe -m app.ml.CharacterizeOfficialTargetRF4J`; detailed results are in ignored `backend/data/experiments/official_target_rf_4j/characterization_report.json`.

## Verified model, features, and runtime contract

Task 4I's candidate reproduces the original 31-feature V3 pipeline: median imputation for 30 numeric fields, one-hot encoding of canonical subject with unknown categories ignored, and `RandomForestRegressor(n_estimators=300, max_depth=None, max_features=0.5, min_samples_leaf=2, min_samples_split=5, random_state=42, n_jobs=-1)`. The feature schema includes **grade_level as an explicit numeric feature**. It does not contain student identity, Initial Grade, final official grade, or source workbook. One-hot encoding handles the sole categorical input. No RF setting changed.

The 31 features form disjoint reporting groups: **WW** (available count, earned, possible, percent, weighted score, evidence flag, over-HPS count), **PT** (same seven), **QA/examination analogue** (same seven), **aggregate/coverage** (overall available count, observed component weight, overall weighted score, overall partial percent, any-input flag), and **context/weights** (grade level, WW/PT/QA weights, subject). The aggregates are *derived from* component values; reporting groups do not duplicate columns, but their information overlaps, so permutation effects cannot be summed.

`check_current_period_readiness` in `CurrentPeriodFeatureBuilderService.py` returns ready when **all** of these hold: at least **four** available graded activities, WW evidence, PT evidence, at least **70** percent observed component weight, and no unresolved evidence. Seven or more activities plus WW, PT, QA, 100% observed weight, and no unresolved evidence yield `HIGH_EVIDENCE`; otherwise a ready case is `STANDARD_READY`. Three activities with WW and PT may be called `LIMITED_EVIDENCE`, but **is not ready**. Missing activity count, WW, PT, or weight produces explicit reason codes. Core 20/50/30 WW+PT reaches 70%; 20/60/20 reaches 80%, so QA is not required for standard readiness. Live typed Examination QA appears only after ST1/ST2/Term Exam are complete; the historical snapshot's aggregate QA analogue does not prove the same live subpart timing.

The complete generation gate additionally requires same source/target term, no finalized same-term grade, an active period, valid Grade 7–10 student/class/subject scope, active and exactly mapped subject, supported 20/50/30 or 20/60/20 weights, and an exact 31-feature scoring contract. Persistence rechecks active period, finalization, scope, readiness, and schema. The API is development/test only, requires its feature flag and a single inactive development V3 registry entry, and generation requires admin authorization. These DB, time, subpart, and authorization facts cannot be replayed from historical XLSX snapshots. The following is explicitly a **feature-level readiness replay with `unresolved_evidence=False`**, not proof that a historical or current live request would pass every gate.

## Historical readiness replay

| Evidence stage | Ready snapshots | Not ready snapshots | Periods first ready here |
| --- | ---: | ---: | ---: |
| 25% | 509 | 1,356 | 509 |
| 50% | 1,189 | 676 | 680 |
| 75% | 1,736 | 129 | 547 |

There are **3,434 ready** and **2,161 not-ready** snapshots. **1,736/1,865** periods ever reach feature readiness; **129 never do**. All latest-ready selections are at 75%. Not-ready reasons: **2,157** snapshots have insufficient activities alone; three additionally lack PT and sufficient weight, and one additionally lacks WW and sufficient weight. Readiness levels across all snapshots are **1,117 HIGH_EVIDENCE**, **2,317 STANDARD_READY**, **1,088 LIMITED_EVIDENCE**, and **1,073 INSUFFICIENT_EVIDENCE**. Ready snapshot counts by subject: English **441**, Mathematics **1,217**, Science **826**, Creative Technology **644**, ICT **306**. By grade: 7 **441**, 8 **272**, 9 **1,874**, 10 **847**.

Ready snapshot counts by source workbook, in the Task 4H filename order: `CLASSRECORD. 7 - ARISTOTLE` **221**, `CLASSRECORD. 7 -GALILEO` **220**, `CON CHEM 9- Archimedes` **238**, `CON CHEM 9- Copernicus` **231**, Grade 8 Creative Tech Newton/Plato **136/136**, Grade 9 Creative Tech Archimedes/Copernicus **186/186**, `ICT 9 - ARCHIMEDES` **306**, Math 10 Einstein 2023–24/Socrates 2023–24/Einstein 2024–25 **279/248/320**, `MATH 9-ARCHIMEDES` **370**, and `SCIENCE COPERICUS` **357**. The machine-readable report retains the exact filenames and counts.

## First and latest ready accuracy

All predictions are Task 4I's held-out fold predictions, selected once per student-period. The 13 seen-subject folds are the primary historical view; the five exact-live-mapping folds are shown separately. ICT is a single unseen-subject fold and remains separate.

| View and ready point | N periods | RF MAE | RMSE | R² | Signed error | Within ±1 / ±2 / ±3 | Absolute error median / p75 / p90 / max |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Seen subject, **first** | 1,600 | **1.5443** | 2.2143 | 0.6518 | −0.1388 | 48.50% / 70.94% / 84.94% | 1.0598 / 2.2762 / 3.6304 / **13.0860** |
| Seen subject, **latest** | 1,600 | **0.7852** | 1.2055 | 0.8968 | −0.0481 | 74.19% / 91.75% / 97.00% | 0.4828 / 1.0177 / 1.8227 / **10.8380** |
| Exact live, **first** | 611 | **2.0013** | 2.7644 | 0.4644 | −0.3093 | 39.77% / 62.19% / 77.41% | 1.4516 / 2.7906 / 4.7642 / **13.0860** |
| Exact live, **latest** | 611 | **1.1302** | 1.5910 | 0.8226 | −0.3254 | 59.41% / 83.63% / 94.27% | 0.7646 / 1.6088 / 2.4131 / **10.8380** |

Seen-subject first-ready stages: **475 at 25%, 578 at 50%, 547 at 75%**. Exact-live first-ready stages: **217, 243, 151**. The 129 never-ready periods are excluded from these metrics, including 62 of the 673 exact-live periods. Exclusion is caused by the *current feature readiness rule*, not by dropping hard-to-predict rows after observing their errors. The latest ready snapshot includes historical QA; it must not be called an early warning forecast.

| Same-row benchmark | Seen first MAE; RF advantage | Seen latest MAE; RF advantage | Exact-live first MAE; RF advantage | Exact-live latest MAE; RF advantage |
| --- | --- | --- | --- | --- |
| Global training mean | 3.0594; **1.5151 / 49.52%** | 3.0594; **2.2742 / 74.33%** | 3.1399; **1.1386 / 36.26%** | 3.1399; **2.0097 / 64.01%** |
| Subject training mean | 2.8689; **1.3246 / 46.17%** | 2.8689; **2.0837 / 72.63%** | 2.7403; **0.7390 / 26.97%** | 2.7403; **1.6101 / 58.76%** |
| Grade+subject training mean | 2.8160 (N=1,464); **1.3071 / 46.42%** | 2.8160 (N=1,464); **2.0193 / 71.71%** | 2.7407; **0.7394 / 26.98%** | 2.7407; **1.6105 / 58.76%** |
| Linear Regression | 1.6866; **0.1423 / 8.44%** | 1.0147; **0.2295 / 22.62%** | **1.9528; −0.0485 / −2.48%** | 1.1634; **0.0332 / 2.85%** |
| Historical academic provisional | 0.4205 (N=547); **−0.1087 / −25.85%** | 1.0044; **0.2192 / 21.82%** | 1.0861 (N=151); **0.4586 / 42.22%** | 1.3093; **0.1791 / 13.68%** |

Advantage is benchmark MAE minus RF MAE; percentages divide that by benchmark MAE. For grade+subject and first-ready academic comparisons, the RF advantage is computed on **exactly those eligible rows**. Grade+subject lacks a training group in the Grade 9 Mathematics holdout. The academic formula is available only at 75%, so its first-ready subset is the periods that *first* become ready at 75%; it is not a comparison over all first-ready cases. On that seen subset the formula is better than RF. The separate unseen ICT fold has first/latest RF MAE **1.3340/1.2033**, but one workbook cannot validate unseen-subject transfer.

At ready points, RF signed error by actual official range (seen folds) remains consistent with regression toward the mean: **80–84: +2.8812 first, +1.4059 latest** (74 periods); **85–89: +0.9014, +0.2301** (351); **90+: −0.6397, −0.2228** (1,175). In the exact-live view, lower-grade overprediction is stronger at first readiness: **+3.8195** for the 30 observed 80–84 periods. There are **zero official outcomes below 75 or at 75–79** anywhere in the canonical candidate; failing-student sensitivity is **NOT EVALUABLE**.

## Held-out explanation, ablation, and stability

Permutation importance is **increase in held-out MAE** after shuffling a feature or a disjoint column group within each held-out workbook, averaged over two fixed repeats and 13 seen-subject folds. It describes predictive contribution, **not causation**. Important caveat: subject, grade, and weights are constant within an individual workbook, so within-fold permutation yields zero for them regardless of their between-workbook value; subject is assessed by a separate drop-column ablation. Correlated derived grade fields can also hide one another's importance.

| Feature at stage | Mean MAE increase | Across-fold SD | Positive folds / 13 | Top-5 rank folds / 13 | Stability |
| --- | ---: | ---: | ---: | ---: | --- |
| `overall_partial_percent`, 25% / 50% / 75% | **0.4414 / 0.5028 / 1.5507** | 0.2028 / 0.2182 / 0.3019 | 13 / 13 / 13 | 13 / 13 / 13 | **STABLE_IMPORTANCE** |
| `ww_weighted_score_so_far`, 25% / 50% / 75% | **0.1425 / 0.2071 / 0.1740** | 0.1584 / 0.1709 / 0.0969 | 13 / 12 / 13 | 12 / 12 / 13 | **STABLE_IMPORTANCE** |
| `ww_percent_so_far`, 25% / 50% / 75% | **0.1171 / 0.1720 / 0.1605** | 0.1490 / 0.1540 / 0.0896 | 11 / 12 / 13 | 11 / 12 / 13 | **STABLE_IMPORTANCE** |
| `overall_weighted_score_so_far`, 75% | **0.3642** | 0.1488 | 13 | 13 | **STABLE_IMPORTANCE** late |
| `pt_weighted_score_so_far`, 75% | 0.0367 | 0.0357 | 11 | 6 | **MODERATELY_STABLE** |
| `qa_percent_so_far`, 75% | 0.0138 | 0.0104 | 13 | 1 | **MODERATELY_STABLE** positive, low rank |

The top three fields are important across the evaluated class folds; the exact magnitudes vary. The aggregate partial percentage gains importance as QA and other evidence enter. QA's low individual importance does **not** show that exams are irrelevant: aggregate features contain QA information and can substitute for it in the model.

| Disjoint feature group | 25% mean MAE increase / positive folds | 50% | 75% |
| --- | --- | --- | --- |
| Aggregate/coverage | **0.4851 / 13** | **0.6145 / 13** | **2.3438 / 13** |
| WW | **0.4767 / 13** | **0.5875 / 13** | **0.4857 / 13** |
| PT | 0.1400 / 11 | 0.0905 / 9 | 0.0874 / 11 |
| QA | 0 / 0 | 0 / 0 | 0.0537 / 12 |
| Context/weights | 0 / 0 | 0 / 0 | 0 / 0* |

*Context fields are fold-constant, so this permutation result is structurally uninformative. The model's useful structure is chiefly recorded performance and its accumulated partial-grade aggregates; group effects are **not additive** because derived features overlap in information.

The following drop-group **RF ablations retrain the same architecture on each training fold**, then score the same first/latest-ready held-out periods. Positive delta means removing a group worsens MAE. These characterize dependence; they are not feature-selection instructions.

| Removed features | First MAE vs full 1.5443 | Delta | Latest MAE vs full 0.7852 | Delta |
| --- | ---: | ---: | ---: | ---: |
| Aggregate/coverage | **1.6551** | **+0.1108** | **0.9795** | **+0.1943** |
| PT | 1.5870 | +0.0427 | 0.7960 | +0.0108 |
| QA | 1.5358 | −0.0085 | 0.7854 | +0.0002 |
| WW | 1.5400 | −0.0043 | 0.7593 | −0.0259 |
| Context/weights | 1.5443 | 0 | 0.7828 | −0.0024 |
| **Subject alone** | **1.5329** | **−0.0114** | **0.7820** | **−0.0032** |

On these same held-out folds the categorical subject field provides **no measurable positive MAE contribution**; omitting it gives slightly lower error. It remains in the fixed candidate and runtime schema. Removing WW/QA alone can be compensated by retained derived aggregate fields, so these small negative deltas do not imply WW or QA has no academic value. Do not infer causality or change the schema from this audit.

Against the **benchmark** Linear Regression, RF's seen-fold first/latest MAE gains are **0.1423/0.2295**, but exact-live first readiness favors Linear Regression by **0.0485** and exact-live latest favors RF by only **0.0332**. This is evidence of useful RF modeling in the broader held-out data and a late-stage advantage, **not proof** that a nonlinear mechanism caused the gain or that RF is uniformly best. The early exact-live result is a material caveat.

Fixed architecture seed diagnostic on the same 13 folds, with no seed chosen from the results:

| Seed | First MAE / RMSE | Latest MAE / RMSE |
| ---: | --- | --- |
| 42 (candidate) | 1.5443 / 2.2143 | 0.7852 / 1.2055 |
| 43 | 1.5402 / 2.2127 | 0.7832 / 1.1970 |
| 44 | 1.5387 / 2.2065 | 0.7826 / 1.1994 |
| 45 | 1.5327 / 2.2020 | 0.7767 / 1.1884 |
| 46 | 1.5342 / 2.2077 | 0.7789 / 1.1900 |

Diagnostic tree counts with seed 42 give first/latest MAE: **100 trees 1.5549/0.7894; 200 trees 1.5426/0.7837; 300 trees 1.5443/0.7852; 500 trees 1.5390/0.7823**. The differences around 300 trees are small relative to error; **300 remains fixed**, and no held-out fold was used to select a new count or seed.

## Live mapping evidence and claim boundaries

Current exact JHS mappings in `CurrentTermV3Domain.py` are: `ENG7` English 7 and `MATH10` Mathematics 10 (**EXACT_GRADE_SUBJECT_EVIDENCE**); `MATH7` Mathematics 7, `SCI7` Science 7, `ENG8` English 8, `ENG9` English 9, and `SCI10` Science 10 (**CROSS_GRADE_SUBJECT_EVIDENCE** only). None of these seven lacks all direct canonical-subject history, but five lack an exact grade–subject source. Grade level is an **EXPLICIT_FEATURE**, which lets RF split by grade, but cannot create missing within-grade training evidence. Enhanced Mathematics/Science, TLE→ICT, and Creative Technology remain unmapped or unverified; no mapping changed.

**Supported claims:** RF is the selected numeric same-term official historical-grade projection model; it beats training-only means on whole-workbook seen-subject holdouts; its error improves markedly as evidence accumulates; recorded performance and partial-grade aggregates contribute to held-out prediction. **Limited claims:** early-stage and exact-live-mapping accuracy are internal historical estimates; cross-grade transfer and 75%-stage formula comparison depend on available subjects, source timing proxies, and historical grading semantics. **Unsupported claims:** reliable below-75/high-risk detection; SHS prediction; dropout or behavior prediction; causal feature effects; independently validated current three-term performance; production readiness. Risk/support bands remain deterministic downstream interpretation, not RF probabilities.

The candidate remains **DEVELOPMENT, inactive, production_validated=false, independent_three_term_validation=false**. The old V3 runtime artifact, raw workbooks, mixed-target data, Task 4E/4F evidence, Task 4H candidate, and Task 4I files remain untouched. Runtime still scores with the old V3 artifact. The 4H builder still reads the legacy snapshots for feature rows, and current scoring/tests still use the legacy V3 artifact; retain them for reproducibility and until an authorized integration changes dependencies.

### Panel answers

1. **Why Random Forest?** Its fixed ensemble handles mixed tabular academic features and interactions; on seen-subject held-out classes it beats training means, and its latest-ready MAE is 0.7852. The exact-live first-ready caveat is stated above.
2. **Why regression?** The target is a numeric same-term official grade. Support bands are derived afterward from that estimate.
3. **Why not Linear Regression?** It is a strong benchmark, especially early. RF is the selected capstone model and has better seen-fold first/latest MAE and a larger latest-stage gain; it is not uniformly better in exact-live early cases.
4. **Why not just the grading formula?** A historical provisional formula requires QA, so it is unavailable at 25%/50%. At latest-ready seen folds RF MAE is 0.7852 versus formula 1.0044; for the 547 periods first ready only at 75%, the formula is better on those same rows.
5. **Why 300 trees?** It is the unchanged V3 architecture. Diagnostics from 100–500 trees change MAE only slightly around 300; no count was chosen from holdout results.
6. **How was memorization prevented?** Each held-out workbook and all its students are absent from training, and identifiers are absent from features. This limits class/student memorization in evaluation, although it is not external validation.
7. **Which features matter?** Held-out permutation shows partial-grade aggregates and WW performance repeatedly contribute most; PT and QA contribute more modestly, with correlated features sharing information.
8. **Is importance causal?** No. It measures held-out predictive dependence under a specific permutation/ablation, not what causes grades.
9. **When trust it most?** More evidence yields lower historical error: seen-fold MAE 1.5443 at first readiness versus 0.7852 at latest. No threshold establishes production trust.
10. **Can it identify failing students?** **Not empirically established:** zero official historical outcomes are below 75; high-risk recall is not evaluable.
11. **Why improve later?** More graded WW/PT evidence and historical QA narrow uncertainty; the 75% snapshot contains substantially more of the eventual grade ingredients.
12. **Why are some JHS mappings indirect?** Only Grade 7 English and Grade 10 Mathematics have exact grade–subject sources; the other five have canonical-subject data at different grades. Grade is a feature but cannot replace missing examples.
13. **Why no SHS?** Grades 11–12 lack representative completed current-pathway three-term ML outcomes and remain outside V3 scope.
14. **Production ready?** No. The model is inactive development research; current three-term external validation and failing-outcome evidence are absent.

**Next DEVELOPMENT task:** design a reviewable, clearly labeled development-only integration plan for the corrected candidate, including how to retire mixed-target V3 from demonstrations, preserve all legacy artifacts, present first-ready versus latest-ready evidence honestly, and keep current readiness/production guards intact. Do not switch runtime or implement Intervention without a separate authorized task.
