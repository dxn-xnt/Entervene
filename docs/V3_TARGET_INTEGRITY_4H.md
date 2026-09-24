# V3 historical target integrity (Task 4H)

Audited 2026-09-24 from the repository's 14 raw JHS E-Class Record workbooks, both processed V3 CSVs, the frozen development snapshots, the raw parser and builder, and Git history. The seven newly supplied local three-term XLSX files are current grading templates, not these historical V3 outcomes. This task did not retrain or activate a model, change runtime/UI, rewrite finalized grades, or start Intervention.

## Target lineage and reconstruction

The raw historical period sheets each have an **Initial Grade** column `AI` and a **Quarterly Grade** column `AJ`. For all 14 workbooks, a sampled `AJ` learner row contains a `VLOOKUP` formula against the workbook's `TRANSMUTATION_TABLE` named range (`'DO NOT DELETE'!G2:J42`), and its cached result is numeric. The named historical table differs from the current 2026 three-term lookup. We use the **stored `AJ` Quarterly Grade**, without applying the 2026 rule to history.

The [raw parser](../backend/app/ml/EClassRecordRawParser.py) reads the cached final-grade column and labels it `final_quarterly_grade_column`. The actual [development builder](../backend/app/ml/BuildCurrentTermDevelopmentDataset.py) normally bypasses that parser when the processed CSV exists: it loads `unified_v3_official_ecr_candidate_with_tle.csv`, projects its existing features, drops 0%-evidence rows, and makes the 25%/50%/75% snapshots. The preceding `unified_v3_official_ecr_candidate.csv` has **4,533 rows**, and those ordered rows match the 20/50/30 subset of the later **6,993-row** with-TLE source field for field. The latter adds the 20/60/20 records. Both processed CSVs are under the repository's ignored `backend/data/` directory. Git history tracks the parser/builder and the former interpolation implementation, but no script, notebook, or commit generating those processed CSVs was found. The original *authoring artifact* is therefore unavailable.

The old 20/50/30 transformation itself is **mathematically recovered, 1,209/1,209 periods**. For each WW/PT/QA component, sum the raw scored activity points and their HPS, calculate the unrounded component percentage, form `0.20×WW + 0.50×PT + 0.30×QA`, round that Initial Grade to two decimals using Python's `round`, then apply the pre-4G Entervene anchor interpolation and round the result to two decimals. This exactly reproduces every processed target. Using workbook-cached component PS values reproduces only **883/1,209** because some cached PS values differ from recalculation; using separately rounded raw component percentages reproduces **1,153/1,209**. Those failed approximations explain the incomplete Task 4G reconstruction. The exact routine now exists only as an **audit** in [BuildCurrentTermOfficialTargetCandidate.py](../backend/app/ml/BuildCurrentTermOfficialTargetCandidate.py); candidate targets never use it.

## Independent old-target check

| Source pattern | Periods | Old target equals stored `AJ` | Old target differs | Classification |
| --- | ---: | ---: | ---: | --- |
| 20/60/20 | 656 | 656 | 0 | `OFFICIAL_WORKBOOK_GRADE` |
| 20/50/30 | 1,209 | 4 coincidental matches | 1,205 | `RECONSTRUCTED_TARGET` |
| **Total** | **1,865** | **660** | **1,205** | Mixed |

The reconstructed group's old minus official difference has mean **+0.183846**, mean absolute **1.525782**, median absolute **1.36**, and maximum absolute **10.31** grade points. **201** periods cross one of the fixed <75, <85, <90 risk bands. The affected development rows are **3,615** changed target snapshots and **603** changed band snapshots. These reproduce Task 4G's counts. The old development dataset has **5,595** snapshots and **467** pseudonymous students.

## Workbook-level evidence

Each listed file has four quarter sheets (Q1–Q4), cached official targets in the `AJ` Quarterly Grade column, and all its listed periods resolved. `Match` and `Changed` compare the **old V3 target** with cached `AJ`; a coincidental match does not make a reconstructed target authoritative.

| Historical workbook | Year | Grade | Subject | Weights | Periods | Match | Changed | Old target source |
| --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- |
| `CLASSRECORD. 7 - ARISTOTLE.xlsx` | 2025–26 | 7 | English | 20/50/30 | 148 | 1 | 147 | Reconstructed |
| `CLASSRECORD. 7 -GALILEO.xlsx` | 2025–26 | 7 | English | 20/50/30 | 148 | 1 | 147 | Reconstructed |
| `CON CHEM 9- Archimedes.xlsx` | 2023–24 | 9 | Science | 20/50/30 | 136 | 1 | 135 | Reconstructed |
| `CON CHEM 9- Copernicus.xlsx` | 2023–24 | 9 | Science | 20/50/30 | 132 | 1 | 131 | Reconstructed |
| `GRADE-8 NEWTON (CREATIVE TECH).xlsx` | 2025–26 | 8 | Creative Technology | 20/60/20 | 136 | 136 | 0 | Official workbook |
| `GRADE-8 PLATO (CREATIVE TECH).xlsx` | 2025–26 | 8 | Creative Technology | 20/60/20 | 136 | 136 | 0 | Official workbook |
| `GRADE-9 ARCHIMEDES (CREATIVE TECH).xlsx` | 2025–26 | 9 | Creative Technology | 20/60/20 | 124 | 124 | 0 | Official workbook |
| `GRADE-9 COPERNICUS (CREATIVE TECH).xlsx` | 2025–26 | 9 | Creative Technology | 20/60/20 | 124 | 124 | 0 | Official workbook |
| `ICT 9 - ARCHIMEDES.xlsx` | 2023–24 | 9 | ICT | 20/60/20 | 136 | 136 | 0 | Official workbook |
| `MATH 10 - EINSTEIN (2023 - 2024).xlsx` | 2023–24 | 10 | Mathematics | 20/50/30 | 124 | 0 | 124 | Reconstructed |
| `MATH 10 - SOCRATES (2023 - 2024).xlsx` | 2023–24 | 10 | Mathematics | 20/50/30 | 124 | 0 | 124 | Reconstructed |
| `MATH 10 -EINSTEIN 24-25.xlsx` | 2024–25 | 10 | Mathematics | 20/50/30 | 129 | 0 | 129 | Reconstructed |
| `MATH 9-ARCHIMEDES.xlsx` | 2023–24 | 9 | Mathematics | 20/50/30 | 136 | 0 | 136 | Reconstructed |
| `SCIENCE COPERICUS.xlsx` | 2023–24 | 9 | Science | 20/50/30 | 132 | 0 | 132 | Reconstructed |

## Canonical rule and candidate dataset

**Canonical historical target:** use the cached official period grade from that historical workbook's `AJ` Quarterly Grade column when it exists and is a finite 0–100 number. Otherwise exclude the student-period and mark it unresolved. Never substitute the current 2026 table, the old interpolation, a raw Initial Grade, or a guessed value. All **1,865/1,865** periods here resolve; **0** are excluded. This is historical official-grade evidence, not independent current three-term validation.

The offline builder generated [target_lineage.csv](../backend/data/datasets/current_term_official_target_candidate/target_lineage.csv) with one pseudonymous row per period and [current_term_official_target_candidate_snapshots.csv](../backend/data/datasets/current_term_official_target_candidate/current_term_official_target_candidate_snapshots.csv) with **5,595** rows. Run `cd backend` followed by `.venv/Scripts/python.exe -m app.ml.BuildCurrentTermOfficialTargetCandidate` to rebuild them. It copied every existing feature, snapshot fraction, student key, source provenance, and train/validation/test split; only `target_final_period_grade` and `target_source` changed. The old dataset was not overwritten. The audit has no learner name, LRN, contact field, or identifying free text. These generated files live under ignored `backend/data/` and remain local unless explicitly committed or shared.

| Target band | Distinct periods | Snapshots |
| --- | ---: | ---: |
| <75 | **0** | **0** |
| 75–79 | 0 | 0 |
| 80–84 | 78 | 234 |
| 85–89 | 367 | 1,101 |
| 90+ | 1,420 | 4,260 |

For the requested risk grouping: **<75 0; 75–<85 78; 85–<90 367; ≥90 1,420** periods. Snapshot counts are respectively **0, 234, 1,101, 4,260**. The former lone below-75 case was a reconstructed-label artifact; the canonical historical candidate has no failing-grade case, so it cannot establish failure-detection performance.

| Coverage | Distinct periods | Snapshots |
| --- | ---: | ---: |
| Grade 7 | 296 | 888 |
| Grade 8 | 272 | 816 |
| Grade 9 | 920 | 2,760 |
| Grade 10 | 377 | 1,131 |
| English | 296 | 888 |
| Mathematics | 513 | 1,539 |
| Science | 400 | 1,200 |
| ICT | 136 | 408 |
| Creative Technology | 520 | 1,560 |
| 2023–24 | 920 | 2,760 |
| 2024–25 | 129 | 387 |
| 2025–26 | 816 | 2,448 |
| 20/50/30 | 1,209 | 3,627 |
| 20/60/20 | 656 | 1,968 |

The student split remains **3,903 train / 840 validation / 852 test snapshots**. No student crosses splits. The 31 existing model features are byte-for-byte unchanged per row; official grade, Initial Grade, source identifiers, and student identifiers are absent from `FEATURE_COLUMNS`. Early 25% and 50% rows still have no QA evidence, and each retained period has consistent targets across all three snapshots. These checks preserve the existing component-column-order snapshot policy; they do not turn that policy into measured assessment dates.

## Current V3 damage and prior experiments

Across all 1,865 periods, **660 labels are unchanged and 1,205 changed**; snapshot counts are **1,980 unchanged and 3,615 changed**. The old/new label MAE is **0.9891** grade points across all periods, with maximum shift **10.31**. Changed labels are English **294**, Mathematics **513**, and Science **398** periods. The 201 band changes affect 603 snapshots. The old dataset's only below-75 period disappears. Classification: **`TARGET_SEMANTICS_SEVERELY_COMPROMISED`** for interpreting the current trained V3 as a predictor of official grades. This is a target-integrity finding, not a new model-performance estimate.

Task 4E's grouped-evaluation **numeric scores are `MUST_BE_RECOMPUTED`** against canonical official targets. Its whole-workbook/student holdout method remains valid as a method. Task 4F's V3 MAE **2.0891**, training-mean and subject-mean results, grade-range errors, and below-75 case finding are all **`MUST_BE_RECOMPUTED`** for official-grade claims: all five held-out English/Mathematics workbooks use the reconstructed source, and 671 of their 673 period labels change. The old reports remain historical evidence for performance against their *old reconstructed labels* only. None demonstrates performance on independent current three-term records. Current Grade 11–12 V3 scoring stays `UNSUPPORTED_GRADE_SCOPE`.

The current [three-term transmutation](../backend/app/services/grading/CurrentThreeTermTransmutation.py) remains separate and unchanged. SSHS TE-only and no-EX subjects remain a separate current grading-runtime configuration gap; this target audit does not solve it.

## Verification and next task

The offline candidate builder ran twice on the actual 14 workbooks with identical hashes: candidate SHA-256 `789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1`; lineage SHA-256 `9fc13be41410adffcf6ea9048f7e818d1674d3796bd1c75654bf42e95161fb86`. Focused synthetic tests cover extraction, official 20/60/20 preservation, 20/50/30 replacement, unresolved exclusion, snapshot consistency, no direct PII, no leakage, and deterministic rebuild.

**Next task:** evaluate a *new* JHS candidate model on these official historical labels, using the same leakage-safe whole-workbook holdouts and fitting all baselines only on each fold's training data. Reassess subject/grade scope and the absence of below-75 outcomes before any production decision. Task 4H performs no training or runtime change.
