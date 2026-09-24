# Official historical target RF evaluation (Task 4I)

Audited 2026-09-24. This is an offline JHS development experiment. It does not replace or register V3, alter runtime/UI, approve production, score SHS, or start Intervention. Reproduce with `cd backend` and `.venv/Scripts/python.exe -m app.ml.EvaluateOfficialTargetRF4I`; machine-readable results and non-PII held-out predictions are under ignored `backend/data/experiments/official_target_rf_4i/`.

## Input and method

Task 4H rebuild reproduced the exact candidate SHA-256 `789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1` and lineage SHA-256 `9fc13be41410adffcf6ea9048f7e818d1674d3796bd1c75654bf42e95161fb86`. There are **1,865** resolved official-workbook student-periods from **467** pseudonymous students and **14** historical JHS workbooks, with **5,595** rows at the actual snapshot fractions **0.25, 0.50, 0.75**. Each period has exactly three rows and one stored official `AJ` Quarterly Grade target. The 31 model features match V3's schema, hash `6b3ff7c43c9e98ce77763b73edacdf2e0411bb641262d2238cbc3ff255e203aa` (SHA-256 of compact JSON feature list), and exclude names, student keys, workbook IDs, Initial Grade, and final grade. Earlier snapshots have no QA evidence. Official targets: <75 **0**, 75–79 **0**, 80–84 **78**, 85–89 **367**, 90+ **1,420** distinct periods.

The RF uses the exact `rf_pipeline` from `TrainCurrentTermDevelopmentModel.py`: median numeric imputation, unknown-tolerant one-hot encoding of canonical subject, `RandomForestRegressor(n_estimators=300, max_depth=None, max_features=0.5, min_samples_leaf=2, min_samples_split=5, random_state=42, n_jobs=-1)`. Fold prediction uses serial tree summation for byte-reproducible output; fitting and the model hyperparameters are otherwise unchanged. Linear Regression uses the original training module's linear pipeline, including numeric scaling. No tuning was done.

Fourteen leave-one-workbook-out folds hold out every class workbook and all of its students; no student occurs in two workbooks. All preprocessing, global/subject/grade+subject means, Linear Regression, and RF are fitted afresh on the other 13 workbooks in each fold. **13 seen-subject folds** contain 1,729 periods / 5,187 snapshots. The sole ICT workbook is a **136-period / 408-snapshot unseen-subject fold**; it is excluded from the main aggregate. The five exact live-mapping folds (two Grade 7 English, three Grade 10 Mathematics) contain **673 periods / 2,019 snapshots**. Fold membership hash: `028418a5385f16d98a93068ffc710632c3bb9487010a22d637588e13d106bcc0`. These are historical source holdouts, not independent current three-term validation.

## Main metrics

Metrics use held-out rows only. Signed error is prediction minus official target. Each of the 0.25, 0.50, and 0.75 stages contains one row per held-out student-period; **0.75 is the latest available pre-finalization snapshot**, not an early warning result. Percentages in the ± columns are the share within that many grade points.

| View / method | N | MAE | RMSE | R² | Signed | ±1 | ±2 | ±3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Seen, all stages: RF | 5,187 | **1.6007** | 2.2333 | 0.6396 | −0.1229 | 45.67% | 70.27% | 84.33% |
| Seen, all: global mean | 5,187 | 3.0187 | 3.7610 | −0.0221 | +0.1446 | 19.49% | 40.25% | 56.28% |
| Seen, all: subject mean | 5,187 | 2.8987 | 3.6100 | 0.0583 | +0.0043 | 21.23% | 41.30% | 60.21% |
| Seen, all: grade+subject mean | **4,779** | 2.8524 | 3.5885 | 0.0719 | −0.0017 | 22.72% | 42.25% | 60.51% |
| Seen, all: Linear Regression | 5,187 | **1.6664** | 2.2288 | 0.6411 | −0.0594 | 41.68% | 68.52% | 84.69% |
| Seen, latest: RF | 1,729 | **0.7670** | 1.1883 | 0.8980 | −0.0473 | 74.96% | 92.08% | 97.11% |
| Seen, latest: Linear Regression | 1,729 | 1.0355 | 1.3978 | 0.8588 | −0.0621 | 60.21% | 86.93% | 96.36% |
| Seen, latest: historical academic provisional | 1,729 | 1.1012 | 1.6445 | 0.8046 | −0.7553 | 70.27% | 85.14% | 96.01% |
| Exact live, all: RF | 2,019 | **1.8698** | 2.5616 | 0.5260 | −0.3489 | 39.08% | 65.13% | 80.39% |
| Exact live, all: global mean | 2,019 | 3.0373 | 3.7648 | −0.0239 | +0.0180 | 18.13% | 37.59% | 53.94% |
| Exact live, all: subject mean | 2,019 | 2.7333 | 3.4566 | 0.1369 | −0.0143 | 23.03% | 45.17% | 65.97% |
| Exact live, all: grade+subject mean | 2,019 | 2.7330 | 3.4601 | 0.1352 | +0.0001 | 23.03% | 45.17% | 65.97% |
| Exact live, all: Linear Regression | 2,019 | **1.7797** | 2.4074 | 0.5813 | +0.0518 | 41.21% | 65.78% | 82.71% |
| Exact live, latest: RF | 673 | **1.0913** | 1.5618 | 0.8238 | −0.2830 | 60.62% | 84.55% | 94.50% |
| Exact live, latest: Linear Regression | 673 | 1.1325 | 1.5942 | 0.8164 | +0.0062 | 61.52% | 82.47% | 93.02% |
| Exact live, latest: historical academic provisional | 673 | 1.4294 | 1.9196 | 0.7338 | −0.9361 | 60.33% | 79.35% | 94.06% |

Grade+subject mean has no training support for the single Grade 9 Mathematics workbook, so its seen aggregate excludes **136 periods / 408 snapshots**. On its **same 4,779 eligible snapshots**, RF MAE is **1.6138** versus grade+subject mean **2.8524**; the all-fold RF MAE must not be used for that comparison. ICT has no training ICT mean: in its separate unseen-subject fold, RF MAE is **1.4114**, Linear Regression **1.3745**, and global mean **2.5272** over 408 snapshots. It is one class and provides no credible unseen-subject generalization claim.

| View / RF stage | N | MAE | RMSE | R² | Signed | ±1 | ±2 | ±3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Seen 25% | 1,729 | 2.1463 | 2.7569 | 0.4508 | −0.2492 | 28.86% | 56.33% | 75.01% |
| Seen 50% | 1,729 | 1.8887 | 2.4394 | 0.5700 | −0.0723 | 33.20% | 62.41% | 80.86% |
| Seen 75% | 1,729 | 0.7670 | 1.1883 | 0.8980 | −0.0473 | 74.96% | 92.08% | 97.11% |
| Exact live 25% | 673 | 2.4521 | 3.1623 | 0.2776 | −0.4490 | 25.71% | 50.52% | 69.39% |
| Exact live 50% | 673 | 2.0659 | 2.6919 | 0.4766 | −0.3149 | 30.91% | 60.33% | 77.27% |
| Exact live 75% | 673 | 1.0913 | 1.5618 | 0.8238 | −0.2830 | 60.62% | 84.55% | 94.50% |

At 25% Linear Regression beats RF in both views (seen MAE **2.0741** versus 2.1463; exact live **2.1947** versus 2.4521). At 50% the seen methods are effectively tied (1.8895 versus 1.8887), while Linear Regression is better in exact live (2.0120 versus 2.0659). RF is strongest at 75%. Snapshot rows are correlated within period; all-stage metrics are descriptive, while latest-stage rows provide one observation per period.

## Historical academic baseline

All 14 raw workbooks include their own `TRANSMUTATION_TABLE` (`'DO NOT DELETE'!G2:J42`). Applying each source table to its cached `AI` Initial Grade reproduces **1,865/1,865** cached `AJ` official Quarterly Grades. The baseline uses only a snapshot's observed WW/PT/QA percentages and its source weights to form a provisional Initial Grade, rounds to two decimals, and applies that source workbook's historical lookup. It does **not** use cached AI/AJ as input or apply the 2026 three-term lookup. At 25% and 50%, QA has no evidence, so **0** provisional predictions are comparable; the 75% snapshot has all three components for every period. The 75% comparison is an assumption that available component rates persist, not a known future-grade calculation or a current three-term benchmark. Source workbook selects a historical table only for this offline comparator; it is not a model feature.

## Grade ranges, bands, bias, and coverage

The following are **seen-subject held-out folds**. No official target below 80 exists anywhere in the candidate, so <75 and 75–79 have N=0 and are **NOT EVALUABLE**.

| Actual official grade | Periods | Snapshots | RF snapshot MAE / RMSE / signed | RF latest MAE / RMSE / signed |
| --- | ---: | ---: | --- | --- |
| 80–84 | 78 | 234 | 2.8049 / 3.7029 / **+2.7156** | 1.6673 / 2.4684 / **+1.4807** |
| 85–89 | 360 | 1,080 | 1.7615 / 2.3508 / **+0.9308** | 0.9787 / 1.3358 / **+0.2411** |
| 90+ | 1,291 | 3,873 | 1.4830 / 2.0762 / **−0.5883** | 0.6536 / 1.0127 / **−0.2201** |

RF overpredicts lower official grades and slightly underpredicts the highest, showing regression toward the mean. Across seen folds, actual grades range **80–100**, RF predictions approximately **81.77–98.93**; actual versus predicted standard deviations are **3.72 versus 3.23**. The 2024–25 subgroup is just one 129-period Grade 10 Mathematics workbook, so its larger error does not establish a year effect.

At the latest snapshot, the deterministic risk-band confusion matrix below is in **distinct student-periods**. Rows are actual, columns predicted.

| Actual / predicted | HIGH <75 | MODERATE 75–<85 | MONITOR 85–<90 | LOW ≥90 | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| HIGH <75 | 0 | 0 | 0 | 0 | **NOT EVALUABLE** |
| MODERATE 75–<85 | 0 | 60 | 17 | 1 | 76.92% |
| MONITOR 85–<90 | 0 | 28 | 314 | 18 | 87.22% |
| LOW ≥90 | 0 | 0 | 121 | 1,170 | 90.63% |

Actual counts are **0 / 78 / 360 / 1,291**; predicted counts **0 / 88 / 452 / 1,189**. Overall agreement is **89.30%**. All observed moderate cases are **80–84**, with none at 75–79. HIGH_RISK recall cannot be measured; 89.30% agreement must not be used as a failing-student detection claim.

| Group | Periods | RF all-stage MAE | RF latest MAE |
| --- | ---: | ---: | ---: |
| Grade 7 / 8 / 9 / 10 | 296 / 272 / 784 / 377 | 1.3678 / 1.4953 / 1.4062 / 2.2639 | 0.5822 / 0.4314 / 0.6051 / 1.4910 |
| English / Mathematics / Science / Creative Technology | 296 / 513 / 400 / 520 | 1.3678 / 2.0473 / 1.2951 / 1.5276 | 0.5822 / 1.2713 / 0.6383 / 0.4737 |
| 2023–24 / 2024–25 / 2025–26 | 784 / 129 / 816 | 1.5750 / 2.5857 / 1.4696 | 0.8626 / 1.7926 / 0.5130 |
| 20/50/30 / 20/60/20 | 1,209 / 520 | 1.6321 / 1.5276 | 0.8931 / 0.4737 |

Historical ICT adds 136 Grade 9 periods at 20/60/20 and is reported separately because it is an unseen-subject fold. Full candidate coverage is Grade 7/8/9/10 **296/272/920/377** periods; English/Mathematics/Science/ICT/Creative Technology **296/513/400/136/520**; years 2023–24/2024–25/2025–26 **920/129/816**.

## Current live scope, decision, and preservation

`CurrentTermV3Domain.py` currently accepts seven exact JHS catalog tuples. **HISTORICALLY_SUPPORTED:** Grade 7 `ENG7` English 7 and Grade 10 `MATH10` Mathematics 10, each with same-grade, same-subject workbook holdouts. **PARTIALLY_SUPPORTED:** Grade 7 `MATH7` Mathematics 7, Grade 7 `SCI7` Science 7, Grade 8 `ENG8` English 8, Grade 9 `ENG9` English 9, and Grade 10 `SCI10` Science 10: their canonical subject has historical evaluation, but their exact grade–subject pair does not. For these five exact live mappings there is **NO MATCHING HISTORICAL EVALUATION** at the exact grade–subject level. The domain also retains a canonical code/name fallback for development/demo scopes; it does not establish an audited live catalog mapping. Enhanced `EMATH8`, `ESCIE8`, `MATH9`, `SCI9` remain unverified; `TLE8`/`TLE9`→ICT remains client-confirmation-required; Creative Technology has no verified live mapping. No mapping was added.

Old V3 Task 4E/4F five-fold MAE **2.0891** snapshots and **0.5613** latest used mixed/reconstructed labels. The new **same-five-source** official-target RF MAEs are **1.8698** and **1.0913**. **These metrics are not directly comparable because target labels changed.** The old V3 artifact and reports remain historical old-label evidence.

RF value classification: **`C. RF_DOES_NOT_MATERIALLY_OUTPERFORM_SIMPLE_BASELINES`** across the relevant partial-term question. It beats training-only global and subject means, and at 75% beats both Linear Regression and the historical provisional formula. Across all seen snapshots its MAE advantage over Linear Regression is only **0.0657** points; Linear Regression has slightly better RMSE/R², beats RF at 25%, and beats RF across the five exact-live folds overall. Candidate status: **`C. INSUFFICIENT_EVIDENCE_FOR_CURRENT_VERIFIED_SCOPE`**. It is a valid official-target historical development artifact, but five of seven exact live mappings lack exact-grade historical evaluation, current three-term independent validation is absent, and historical failure outcomes are absent. It is suitable for an explicitly limited historical research demonstration, not a broad live-accuracy or production claim.

The new model is saved separately as ignored local `backend/data/models/entervene_current_term_official_target_rf_candidate.joblib`, with `lifecycle=DEVELOPMENT`, `is_active=false`, `production_validated=false`, and `independent_three_term_validation=false` in its artifact metadata. It was loaded and produced finite predictions. No DB registry row was inserted and runtime still points to legacy V3. The original mixed-target `backend/data/datasets/current_term_development/current_term_development_snapshots.csv`, its processed `unified_v3_official_ecr_candidate_with_tle.csv` source, the original V3 `.joblib`/schema/report, Task 4E/4F reports, and all raw workbooks were preserved. `TrainCurrentTermDevelopmentModel.py`, `BuildCurrentTermDevelopmentDataset.py`, the V3 scoring service, and some scoring/registry tests still depend on the legacy data or artifact. Keep the artifact while runtime depends on it; keep versioned, checksum-identified legacy data/report copies for reproducibility even after a later controlled migration. Task 4H's builder also currently needs the old snapshots as source feature rows, so they cannot yet be archived out of reach.

Focused tests cover fold subject classification, provisional-baseline readiness/source lookup, metric signed-error handling, and Task 4H extraction/consistency/determinism: **4 passed**. Two full evaluation runs after serializing RF fold inference produced identical held-out prediction CSV SHA-256 `21868f8aebc57e849ca37e026fd4819ffdfbf736c20c808943a389781bc24d57` and saved artifact SHA-256 `f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc`.

### Defense answers

1. **Why RF?** It improves on training-only global/subject means and performs best at the 75% stage, but its advantage over Linear Regression is modest overall and absent at 25%.
2. **What does it predict?** A numeric projection of the same historical quarter's stored official final grade from partial WW/PT/QA evidence; support bands are downstream deterministic interpretations, not RF classes or probabilities.
3. **How was leakage prevented?** Each test class workbook and all its students are held out; preprocessing and every fitted comparator use training folds only; final outcome, Initial Grade, identity, and workbook are excluded from RF features; early snapshots contain no future QA.
4. **Why partial snapshots?** They test how performance changes as evidence accumulates. They use activity-column order, not verified assessment dates, so they are a proxy for time.
5. **Earlier versus later?** Seen-subject RF MAE is **2.1463 / 1.8887 / 0.7670** at 25%/50%/75%; exact-live RF MAE is **2.4521 / 2.0659 / 1.0913**. The 75% result must not be advertised as early accuracy.
6. **Can it identify failing students?** Empirical failing-student performance **cannot be established**: there are **zero** official historical targets below 75, making HIGH_RISK recall not evaluable.
7. **Why not grading formula alone?** At 75%, the verified historical provisional formula has MAE **1.1012** versus RF **0.7670** on seen folds and **1.4294** versus **1.0913** on exact-live folds. The formula cannot make a source-comparable estimate at the 25%/50% stages because QA evidence is absent. Linear Regression is competitive at those stages.

**Next task:** acquire and audit completed independent current three-term JHS records for each exact live grade–subject mapping, with real low-grade outcomes and assessment dates where available; then evaluate the frozen candidate, Linear Regression, and the current source-valid provisional formula on the same untouched external cohorts. Do not promote or replace runtime V3 until that evidence supports it.
