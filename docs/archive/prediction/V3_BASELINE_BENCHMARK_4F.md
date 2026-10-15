# V3 grouped baseline benchmark (Task 4F)

Audited 2026-09-24. This is **internal** JHS robustness evidence, not independent three-term production validation. The frozen official V3 artifact and all runtime, UI, registry, and Intervention behavior remain unchanged.

## Exact Task 4E protocol and reproduction

Reused the same five verified live-mapping source workbooks: two Grade 7 English and three Grade 10 Mathematics. In each fold, held out one complete workbook and all its students, trained a temporary `rf_pipeline` with the same 31 features/preprocessor/hyperparameters on the other V3 development rows, and predicted only that workbook. The test set is **2,019 snapshots, 673 student-periods, 169 students**; each student occurs in one workbook. No test-fold target entered training or its baselines. Task 4E reproduced **exactly**: MAE **2.0891**, RMSE **3.0215**, R² **0.6199**, ±1/±2/±3 **41.51%/61.86%/73.95%**. These are temporary fold-model results, not evaluation of the already-fitted `.joblib` on unseen external data.

For each fold, baseline A predicts the **mean target of all training rows**. Baseline B predicts the **mean target of training rows for that row's canonical subject**; English and Mathematics both occur in every fold's training rows, so no subject fallback was used. The held-out targets are not used to fit either mean. The student-period analysis selects the **75% evidence snapshot**, the latest available pre-finalization snapshot, once per `student_period_key`; it does not average correlated snapshots. The 75% stage already includes the historical aggregate QA analogue, so its unusually low V3 error is a **late-evidence** result, not an early-term forecast claim.

## Direct comparison

| Unit and method | N | MAE | RMSE | R² | ±1 | ±2 | ±3 | Baseline MAE minus V3 MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Snapshots: V3 Random Forest | 2,019 | **2.0891** | **3.0215** | **0.6199** | 41.51% | 61.86% | 73.95% | — |
| Snapshots: training mean | 2,019 | 4.0436 | 4.9763 | −0.0309 | 13.67% | 27.93% | 40.56% | **1.9545** |
| Snapshots: subject training mean | 2,019 | 3.4834 | 4.4394 | 0.1796 | 17.98% | 34.62% | 52.75% | **1.3943** |
| Snapshots: academic provisional estimate | **0 comparable** | — | — | — | — | — | — | — |
| Latest 75% period: V3 Random Forest | 673 | **0.5613** | **0.8736** | **0.9682** | 83.21% | 95.99% | 98.96% | — |
| Latest 75% period: training mean | 673 | 4.0436 | 4.9763 | −0.0309 | 13.67% | 27.93% | 40.56% | **3.4823** |
| Latest 75% period: subject training mean | 673 | 3.4834 | 4.4394 | 0.1796 | 17.98% | 34.62% | 52.75% | **2.9221** |
| Latest 75% period: academic provisional estimate | **0 comparable** | — | — | — | — | — | — | — |

## Target-grade ranges

Each cell is **MAE / mean signed error** in grade points; signed error is prediction minus actual. Counts are snapshots / distinct student-periods.

| Actual grade | N snapshots / periods | V3 | Training mean | Subject mean |
| --- | ---: | ---: | ---: | ---: |
| <75 | 3 / **1** | 9.94 / +9.94 | 18.38 / +18.38 | 16.71 / +16.71 |
| 75–79 | 42 / 14 | 5.40 / +5.38 | 13.63 / +13.63 | 12.00 / +12.00 |
| 80–84 | 168 / 56 | 3.02 / +2.91 | 9.05 / +9.05 | 7.98 / +7.98 |
| 85–89 | 402 / 134 | 2.12 / +1.07 | 4.02 / +4.02 | 3.48 / +3.48 |
| ≥90 | 1,404 / 468 | 1.85 / −1.06 | 3.13 / −2.76 | 2.66 / −2.07 |

For the **one latest 75% snapshot per period**, the corresponding MAE / signed-error comparison is:

| Actual grade | N periods | V3 | Training mean | Subject mean |
| --- | ---: | ---: | ---: | ---: |
| <75 | 1 | 5.73 / +5.73 | 18.38 / +18.38 | 16.71 / +16.71 |
| 75–79 | 14 | 2.14 / +2.07 | 13.63 / +13.63 | 12.00 / +12.00 |
| 80–84 | 56 | 0.81 / +0.73 | 9.05 / +9.05 | 7.98 / +7.98 |
| 85–89 | 134 | 0.62 / +0.05 | 4.02 / +4.02 | 3.48 / +3.48 |
| ≥90 | 468 | 0.46 / −0.16 | 3.13 / −2.76 | 2.66 / −2.07 |

At the **latest 75% snapshot**, the one actual below-75 case is **73.66**. V3 predicts **79.39**, training mean **92.04**, and subject mean **90.37**. Across all three snapshots of that same case, V3 predictions are **85.48, 85.93, 79.39** (mean signed error +9.94). **ONE CASE IS INSUFFICIENT TO ESTABLISH FAILURE-DETECTION PERFORMANCE.** The other low-grade bands also show positive signed error despite V3 beating both means.

## Why the academic provisional row is unavailable

The candidate arithmetic initial-grade expression is `Σ_c w_c × (observed_score_c / observed_HPS_c × 100)`. Its WW/PT/EX ingredients are incomplete at the 25% and 50% snapshots: there is no exam evidence, so those **1,346** rows are `BASELINE_NOT_READY`, not zero-filled. All three components have evidence in the **673** latest snapshots, but comparing their arithmetic **initial grade** to a final **term-grade target** requires a verified, source-appropriate transmutation. That parity is not established for the reconstructed historical targets. There is also a concrete current-contract discrepancy: the [client core ECR example](https://docs.google.com/spreadsheets/d/1zqSsW7vNz3H1NhYebMDXRxG8cnPVpvGq/edit) shows initial **87.9 → term 90**, whereas the backend's `_deped_transmuted(87.9)` yields **93.32**. Applying that backend function here would give an unjustified like-for-like final-grade baseline. No provisional final-grade MAE is reported. The gradebook's missing-component-as-zero current calculation and the feature builder's observed-weight normalized percentage are also **current-state measures**, not automatically final-term projections.

## Decision and defense

**D. RESULT_INCONCLUSIVE** for the broad question of Random Forest versus *all* simple academic methods. V3 **clearly beats the two training-only mean baselines** on identical workbook folds (snapshot MAE gains 1.95 and 1.39), so it provides measured value beyond constant means. The more meaningful academic provisional comparator cannot yet be scored honestly, and the source-group evaluation remains internal. This classification does not diminish the demonstrated mean-baseline result or imply production readiness.

Panel answer to **“Why Random Forest?”**: “With whole historical workbooks and their students held out, the Random Forest approach achieved 2.09-point MAE versus 4.04 for a training mean and 3.48 for a subject mean. This demonstrates value beyond those simple constants on existing JHS sources. We have not yet established superiority to a verified academic-grade baseline or independent current three-term performance.”

Panel answer to **“Can it reliably identify failing students?”**: “We cannot claim that. The held-out data contains only one genuine below-75 student-period; V3 still predicted it above 75 even at the latest snapshot. More real failing cases are required.”

**Next task:** audit the official client ECR initial-to-term transmutation against Entervene and the historical reconstructed targets, then rerun this *same* five-fold benchmark with a source-valid provisional baseline only if parity is demonstrated. Do not change V3, SHS scope, or Intervention during that audit.
