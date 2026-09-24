# Grade transmutation contract (Task 4G)

Audited 2026-09-24. This audit separates the current client ECR grading rule from historical V3 targets and model validation. No V3 training, registry activation, historical grade migration, or Intervention work was performed.

## Current client ECR evidence

| Reference | Lookup evidence | WW/PT/EX and Examination evidence |
| --- | --- | --- |
| [Grades 2–10 EPP/TLE per component](https://docs.google.com/spreadsheets/d/1ncbFGVpqf-xVKgXMgOHSbUQOHNSGHr6X/edit) | `HELPER!B8:D48` contains 41 descending Initial Grade minimum/maximum/Term Grade rows. `TERM 1 ICT!AC18` uses `INDEX`/descending `MATCH` on the minima; it does not interpolate. The first and last rows are 99.50–100 → 100 and 0–4.67 → 60. | ICT and AFA Term 1 headers show 20/60/20 and ST1/ST2/TE 30/30/40 within EX. |
| [Grades 2–10 core](https://docs.google.com/spreadsheets/d/1zqSsW7vNz3H1NhYebMDXRxG8cnPVpvGq/edit) | The readable `HELPER` sheet's 41 numeric rows exactly match the EPP/TLE per-component rows. Its populated example has Initial Grade 87.9 and Term Grade 90. | Core subjects use 20/50/30; the example uses ST1/ST2/TE. |
| [SHS Grade 12 corrected](https://docs.google.com/spreadsheets/d/1lIQzUmFdUlJzbfCglpzg5PIMA9mepprR/edit) | `HELPER!B7:D47` has 41 rows. All minimum, maximum, and Term Grade entries match both Grades 2–10 references when read to two decimal places. `Term 1!AM17` uses `XLOOKUP` with both minimum and maximum comparisons against the helper rows. Some underlying helper limits contain Excel floating-point artifacts (for example a displayed 88.87 maximum is stored as 88.86999999999999); the two-decimal contract is identical. | The dynamic SHS track groups are core 25/50/25; academic except immersion 25/45/30; work immersion/culminating 35/40/25; TVL/sports/arts and design 20/60/20. All four helper rows specify ST1/ST2/TE 30/30/40. |
| [SSHS corrected](https://docs.google.com/spreadsheets/d/1HFAP4_n-mhfv2Bt5G3IhNYcGYGUipPKU/edit) | `HELPER!B7:D47` has the same 41 two-decimal minimum/maximum/Term Grade rows as the other three references. `Term 1!AM17` uses `XLOOKUP` with both minimum and maximum comparisons. The helper also contains underlying floating-point artifacts in some displayed limits. | Its 139 listed courses have several weight patterns: 20/50/30, 20/60/20, 15/65/20, 15/70/15, 20/80 with no EX, and 40/60 with no EX. The helper assigns ST1/ST2/TE 30/30/40 to 122 courses, TE-only 0/0/100 to 9, and no Examination split to 8 courses. |

The verified Grades 2–10 lookup is represented by all 41 minimum bounds in `backend/app/services/grading/CurrentThreeTermTransmutation.py`. The complete interval pairs are independently enumerated in `backend/tests/test_current_three_term_transmutation.py`. In the source, 87.70–88.87 maps to **90**, so **87.9 → 90**. Decimal inputs are compared to the minimum bound; the gradebook rounds its calculated Initial Grade to two decimal places before lookup.

**Cross-scope result: IDENTICAL at the stated two-decimal grade precision.** Grades 2–10 core, EPP/TLE, SHS G12, and SSHS have identical 41 two-decimal interval rows, with no differing displayed ranges. This establishes `CURRENT_THREE_TERM_TRANSMUTATION_CONTRACT` for the supplied Grades 7–12 formats. The raw SHS and SSHS helper values differ numerically from K–10 at 12 minima and 20 maxima because of Excel floating-point artifacts; their Transmuted Grade entries are identical. The SHS `XLOOKUP` checks both bounds, so exact boundary behavior in Excel deserves workbook quality review where a stored maximum is microscopically below its displayed two-decimal value. The application uses the explicit two-decimal intervals. A shared lookup does not establish matching component weights, Examination structures, subjects, curriculum, or V3 validity.

The complete two-decimal interval table extracted from each reference is:

| Initial Grade | Term Grade | Initial Grade | Term Grade |
| --- | ---: | --- | ---: |
| 0.00–4.67 | 60 | 4.68–9.34 | 61 |
| 9.35–14.00 | 62 | 14.01–18.67 | 63 |
| 18.68–23.34 | 64 | 23.35–28.00 | 65 |
| 28.01–32.67 | 66 | 32.68–37.33 | 67 |
| 37.34–42.00 | 68 | 42.01–46.66 | 69 |
| 46.67–51.33 | 70 | 51.34–56.00 | 71 |
| 56.01–60.66 | 72 | 60.67–65.33 | 73 |
| 65.34–69.99 | 74 | 70.00–71.17 | 75 |
| 71.18–72.35 | 76 | 72.36–73.53 | 77 |
| 73.54–74.71 | 78 | 74.72–75.89 | 79 |
| 75.90–77.07 | 80 | 77.08–78.25 | 81 |
| 78.26–79.43 | 82 | 79.44–80.61 | 83 |
| 80.62–81.79 | 84 | 81.80–82.97 | 85 |
| 82.98–84.15 | 86 | 84.16–85.33 | 87 |
| 85.34–86.51 | 88 | 86.52–87.69 | 89 |
| 87.70–88.87 | 90 | 88.88–90.05 | 91 |
| 90.06–91.23 | 92 | 91.24–92.41 | 93 |
| 92.42–93.59 | 94 | 93.60–94.77 | 95 |
| 94.78–95.95 | 96 | 95.96–97.13 | 97 |
| 97.14–98.31 | 98 | 98.32–99.49 | 99 |
| 99.50–100.00 | 100 | | |

## Entervene calculation and correction

The backend `_deped_grade` computes WW and PT percentages from earned/possible scores, obtains EX from `ExaminationCalculator`, applies resolved subject grading-template weights, sums and rounds the weighted Initial Grade to two decimals, then calls `_deped_transmuted`. Template resolution prefers the subject default, then subject/level assignment, then active core template, with a 30/50/20 fallback. The EX helper has configurable `ExamSubsplitWeights`; its default is ST1/ST2/Term Exam **30/30/40**. SSHS proves that default is not universal: some subjects have TE-only 0/0/100, and others have no EX component. Current gradebook calls use the default split rather than resolving the SSHS helper row, so those special SSHS configurations remain a separate grading-template gap; Task 4G did not redesign Examination calculation. The teacher UI displays backend grades and does not duplicate the lookup. Class-record export uses the same backend `_deped_transmuted` fallback. The frontend and backend send routes compare the displayed/recomputed grade; finalized grades remain stored in `StudentPeriodGrade` and `GradeSubmissionLog`.

Before Task 4G, `_deped_transmuted` linearly interpolated an older anchor list, giving **87.9 → 93.32**. That is the exact mismatch: interpolation and the old 10-point floor, while the current client file uses integer interval lookup and a 60-point floor. The function now delegates to one decimal-safe, exact-bound lookup. This affects new backend calculations and export fallbacks; it does not migrate finalized database rows. The frontend has no parallel transmutation formula.

## Historical V3 target trace

The raw historical workbooks have an **Initial Grade** cell and a stored **Quarterly Grade** cell. For example, `CLASSRECORD. 7 - ARISTOTLE.xlsx`, `ENGLISH_Q1`, row 12 has `AI12 = ROUND(SUM(R12,AE12,AH12),2)` cached as **82.11** and `AJ12 = VLOOKUP(AI12,TRANSMUTATION_TABLE,4,TRUE)` cached as **88**. Its named historical lookup is `'DO NOT DELETE'!G2:J42`; it has 0–3.99 → 60 and 100 → 100, with different boundaries from the current 2026 table. The raw parser reads the cached final-grade column directly, but the default development builder instead loads `backend/data/processed/unified_v3_official_ecr_candidate_with_tle.csv`. That source's target origin must be assessed from actual values, not only its `target_source` label.

All **1,865** processed student-period targets were matched to their raw workbook, sheet, and row across **14** workbooks. The **20/60/20** group is directly read: **656/656 periods**, **5 workbooks**, all equal the stored official Quarterly Grade. The **20/50/30** group is reconstructed: **1,205/1,209 periods**, **9 workbooks**, differ from the stored official grade. Its labels often have decimals (only 38/1,209 integers), whereas all corresponding stored grades are integers. The source-generation script is not present; 883/1,209 reconstructed targets can be reproduced exactly by applying the former Entervene interpolation to the raw cached component percentages at 20/50/30. The remaining 326 need their transformation lineage recovered before declaring a single exact reconstruction algorithm.

For the reconstructed group versus stored official grade, mean signed difference is **+0.1838**, mean absolute difference **1.5258**, median absolute difference **1.36**, and maximum absolute difference **10.31** points. At the student-period level, **201/1,209** risk-band labels differ using the fixed <75, <85, <90 thresholds. Reconstructed target bands are high 1, moderate 124, monitoring 298, low 786; stored official bands are high 0, moderate 69, monitoring 290, low 850. The development dataset retains three snapshots per period, so **3,615** development snapshots inherit a target different from the raw official grade, and **603** inherit a changed band. Historical workbook grades and V3 artifacts remain untouched.

The V3 target scale is **OTHER / mixed**: stored official historical transmuted grades for 20/60/20, reconstructed decimal targets for 20/50/30. It is **NOT_DIRECTLY_COMPARABLE** as a whole to the current 2026 official Term Grade. The risk rule applies <75 / <85 / <90 to the model's numeric projected target; it is not applying those thresholds to a new raw Initial Grade, but the mixed target semantics mean its displayed “Projected Final Term Grade” and bands need correction before production interpretation. Grades 11–12 remain `UNSUPPORTED_GRADE_SCOPE` for V3; common grading rules cannot validate SHS model predictions.

## Baseline and next step

**BASELINE_STILL_NOT_COMPARABLE** across the Task 4F folds. All five held-out English/Mathematics workbooks use the reconstructed 20/50/30 target source. At early snapshots EX is absent, and this target is neither the stored official grade nor consistently reproducible by one verified historical conversion. The reported V3 fold metrics therefore measure accuracy against these reconstructed labels, not demonstrated accuracy against official workbook grades. Task 4H should first recover or replace the 20/50/30 target construction under a source-documented label and decide whether to evaluate against stored historical grades or a deliberately reconstructed grade. Then define a source-appropriate provisional baseline using observed component percentages, actual subject weights, and the matching historical lookup, and rerun the same held-out workbook folds. Do not apply the 2026 lookup retroactively to historical outcomes.
