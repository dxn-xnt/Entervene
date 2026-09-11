# Phase 1, Stage 1: source-authority and baseline audit

Status: Stage 1 complete; runtime implementation intentionally not started.  
Audit date: 2026-09-11.  
Scope: current repository plus the configured development PostgreSQL database, inspected read-only.

The frozen characterization data is in [`backend/tests/fixtures/prediction_evidence_stage1_baseline.json`](../../backend/tests/fixtures/prediction_evidence_stage1_baseline.json). It deliberately records current defects as well as valid behavior so later stages can report every semantic difference.

## A. Verified current behavior

| Evidence source | Writers/importers and stored authority | What current prediction extraction does |
| --- | --- | --- |
| Classwork assignments | `ClassworkService.create_classwork_wizard_record`, `assign_classwork_to_classes`, and `ActivityService.create_activity` write `Classwork` plus `ClassworkAssignment`. Quiz import/building also uses these records. An assignment is unique only by `(classwork_id, class_id)` and has no academic-period field. The writers validate a teacher load but do not persist that period; they currently set `publish_date` to null. | `_classwork_rows()` selects all non-archived, grading-enabled, non-reading classwork for class and subject. It does not filter period, publication, assigned/available date, due date, or capture cutoff. Each joined submission becomes a metric row. |
| Student submissions | `SubmissionService.submit_student_work` normally reuses the first row found for assignment/student and increments `attempt_count`; `QuizAttemptService` also reuses one row and replaces answers/score for another attempt. `ActivityService.bulk_update_activity_scores` can update/create score rows from an unordered query. There is no database uniqueness constraint on assignment/student. | Prediction joins every matching row. Multiple rows therefore multiply expected, completed, covered, late, possible-point, and earned-point counts. Status `late` is treated as missing by `_component_features()`, even though the gradebook treats it as completed. |
| Assessment items/scores | `AssessmentItem` has explicit class, subject, and period identity. `StudentAssessmentScore` is unique per assessment/student. No normal production writer or importer was found. Writes exist in tests and `verify_live_endpoints.py`; `ExtractEClassRecords.py` creates CSV datasets, not these database rows. The configured database contains zero rows in both tables. | `_assessment_rows()` is correctly filtered by class, subject, and source period. `RECORDED` with a score counts as completed and covered. `ABSENT`, `MISSING_NOT_ENCODED`, or no score increments “missing.” `NOT_APPLICABLE` remains in the denominator. Unsupported component types remain in the initial expected count and then disappear from component arithmetic. |
| Attendance | `AttendanceService.batch_mark_attendance` upserts one row per student/class/subject/date; a database unique constraint supports that key. QR attendance writes today's row and preserves existing present/excused states. Attendance has a date but no period FK. | `get_risk_adjusted_attendance_rate()` filters student and optional class/subject, but not source-period dates or cutoff. Weights are present 1.0, excused 0.8, late 0.5, absent 0.0 over recorded rows; no rows returns unavailable. Prediction consumes all historical matching rows. |
| Period grades | Adviser submission/finalization upserts the unique student/class/subject/period row and sets `is_finalized`; manual final overrides and grade-submission logs exist. The live gradebook derives assignment results with grading-template weights and DepEd transmutation. | Prediction chooses `final_period_grade`, then `transmuted_grade`, then `initial_grade`, but uses boolean `or` and never checks `is_finalized`. A real zero falls through. If all are absent it equally averages available component percentages and calls that an estimate. Cumulative history includes any non-null final value without checking finalization. |

### Verified gradebook submission selection

`StudentRecordService._submissions_by_student()` is the existing selector and must be reused if Phase 1 proceeds. For each assignment/student it:

1. keeps the first queried row initially;
2. replaces an ungraded row with a row having a non-null grade; and
3. among graded rows, keeps the later `graded_at`, otherwise `submitted_at`, otherwise `created_at`.

It is not highest-score, first-attempt, or teacher-selected-attempt behavior. The query has no ordering, and equal/missing timestamps and multiple ungraded records have no deterministic authority. Prediction currently does **not** use this selector.

### Current metric and execution flow

1. Assessment rows and classwork/submission join rows are concatenated conceptually; their row counts form one expected denominator.
2. Completion is submitted rows / expected rows; coverage is recorded/graded rows / expected rows. When expected is zero, both become numeric `0`.
3. Submitted-but-ungraded classwork counts as completed, but its possible points remain in the component denominator, producing a zero contribution.
4. Lateness scans all published class/subject assignments separately. Every joined submission with a due date is counted; an unsubmitted due-dated assignment is included in the denominator but not the late numerator, so it becomes “on time.”
5. Participation combines available attendance (40%), on-time rate (35%), and completion (25%), redistributing missing weights. Because no-activity completion is forced to zero, a completely empty scope produces participation `0`, not unavailable.
6. Readiness requires a source grade and completion and coverage of at least 0.50. Coverage determines `MINIMUM`, `GOOD`, or `STRONG` above that gate.
7. A not-ready record path skips the model and returns `INSUFFICIENT_DATA`. A ready estimate can still fail model validation because `cumulative_period_grade_avg` is required but not emitted when no final period-grade row exists.

## B. Authority decisions

| Disputed case | Authoritative source established by current system | Evidence | Unresolved cases |
| --- | --- | --- | --- |
| Period attribution | Assessment items and period grades: their explicit `academic_period_id`. Attendance: recorded date can be compared with authoritative period bounds, although current prediction does not. | Model FKs and unique constraints. | Classwork has no period identity. Due, assigned, and created timestamps exist but the gradebook explicitly declines to use its unused `_assignment_in_period()` heuristic. Existing classwork cannot be assigned to a period without policy/data reconciliation. |
| Assignment eligibility | For parity with the current gradebook: class/subject match, not archived, `is_graded`, and not `READING`. | `StudentRecordService._classwork_assignments()` and its comment deliberately select all such assignments until period identity exists. | This is current application behavior, not proof of school policy. Publication versus offline-record eligibility and availability/cutoff rules are not established. |
| Completion | For classwork UI parity: gradebook statuses `submitted`, `graded`, and `late`; submitted-after-due is normalized to late. | `_status_for_assignment()` and `COMPLETED_STATUSES`. | Assessment completion authority is absent because there is no production writer. A missing score row or `MISSING_NOT_ENCODED` proves missing encoding, not student non-completion. |
| Grade coverage | For classwork gradebook parity: the selected submission has a non-null grade and the activity has total points, regardless of whether status has already advanced to graded. Assessment `RECORDED` plus non-null raw score is structurally clear. | `_metrics_for_student()` and assessment status constraints. | A combined denominator across both tables is not authoritative while source identity is unknown. |
| Attempt selection | Existing gradebook selector described above. | `_submissions_by_student()` is the only shared display/calculation behavior found. | Equal timestamps, absent timestamps, and multiple ungraded rows are unordered. No new tie-break may be invented. |
| Lateness | Due date and submission time are the recorded facts. Gradebook and prediction both infer late when submission is after due. | `_is_late()` and `_late_submission_count()`. | Submission service can preserve `submitted` for an excused late submission, while both readers infer late again from timestamps. Whether an approved exemption removes lateness is an unresolved policy conflict. First versus selected attempt lateness is also unresolved. |
| Grade-source precedence | Current display/extraction precedence is first non-null final, transmuted, initial. A finalized final grade is the only source explicitly made official by the adviser workflow. | `_official_period_grade()`, `build_prediction_features_from_records()`, and finalization services. | Non-final values must retain exact stage/provenance; current code does not establish that a non-final `final_period_grade` is official. The equal-component fallback is only an estimate, not the gradebook calculation. |
| Assessment versus classwork | Keep them as separate populations. No cross-table identity or foreign key exists. | Independent primary keys and writers; neither schema references the other. Live inspected database has no assessment rows from which cardinality could be demonstrated. | Whether any two records describe the same academic activity is `UNRESOLVED`. Titles, timestamps, component, or score similarity cannot establish equivalence. Any required combined metric must therefore be unavailable and dependent scoring skipped. |

## C. Frozen baseline behavior

The deterministic scoring control returns 84 only when current model input validation succeeds. It is used to keep this characterization independent of model artifact drift.

| Fixture | Completion | Coverage | Attendance | Participation | Current source grade | Readiness / model | Predicted | Risk |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | --- |
| Genuine 0 of 10 | 0/10 = 0% | 0/10 = 0% | unavailable | 0 | 82 final | insufficient / skipped | — | `INSUFFICIENT_DATA` (0) |
| No activities/evidence | 0/0 forced to 0% | 0/0 forced to 0% | unavailable | 0 | unavailable | insufficient / skipped | — | `INSUFFICIENT_DATA` (0) |
| Completed, ungraded | 1/1 = 100% | 0/1 = 0% | unavailable | 100 | 82 final | insufficient / skipped | — | `INSUFFICIENT_DATA` (0) |
| Two submission rows, one assignment | 2/2 = 100% | 2/2 = 100% | unavailable | 100 | 82 final | strong / executed | 84 | `NEEDS_MONITORING` (41) |
| Legitimate final grade 0 | 10/10 = 100% | 10/10 = 100% | unavailable | 100 | **82 transmuted** | strong / executed | 84 | `NEEDS_MONITORING` (41) |
| Finalized grade 83 | 10/10 = 100% | 10/10 = 100% | unavailable | 100 | 83 final | strong / executed | 84 | `NEEDS_MONITORING` (41) |
| Provisional row with final value 83 | 10/10 = 100% | 10/10 = 100% | unavailable | 100 | **83 final** | strong / executed | 84 | `NEEDS_MONITORING` (41) |
| Estimated grade, no period-grade row | 3/3 = 100% | 3/3 = 100% | unavailable | 100 | 85 equal-average estimate | strong / **model input error** | — | not evaluated |
| Other-period classwork + absence | 2/2 = 100% | 2/2 = 100% | 0 | 38.46 | 82 final | strong / executed | 84 | `HIGH_RISK` (92.5) |
| Future/unavailable assignment | 1/2 = 50% | 1/2 = 50% | unavailable | 79.17 | 82 final | minimum / executed | 84 | `MODERATE_RISK` (74) |
| Present/excused/late/absent | 10/10 = 100% | 10/10 = 100% | 57.5 | 73.85 | 82 final | strong / executed | 84 | `MODERATE_RISK` (67.5) |
| Potential assessment/classwork overlap | 2/2 = 100% | 2/2 = 100% | unavailable | 100 | 82 final | strong / executed | 84 | `NEEDS_MONITORING` (41) |
| Ambiguous overlap + ungraded classwork | 2/2 = 100% | 1/2 = 50% | unavailable | 100 | 82 final | minimum / executed | 84 | `NEEDS_MONITORING` (41) |

The last two rows are observations of unsafe current behavior, not approved expectations. Correct Phase 1 behavior is `UNRESOLVED / UNAVAILABLE`, followed by skipped dependent scoring.

## D. Required corrections

### Bugs that must change in later Phase 1 stages

- Use explicit null checks for zero-valued grades and require truthful finalized/provisional/estimated provenance.
- Scope classwork and attendance to the verified source period and capture cutoff; old unmapped classwork remains unavailable rather than heuristically assigned.
- Select one authoritative submission per assignment before computing any metric; unresolved selector ties make affected evidence unavailable.
- Distinguish verified zero completion/coverage from no expected items and missing observations.
- Treat gradebook-completed `late` classwork as completed. Do not count unsubmitted work as on time.
- Exclude `NOT_APPLICABLE` and unsupported/unresolved items from a trusted denominator with an explicit reason.
- Do not turn submitted-but-ungraded possible points into a zero grade observation.
- Do not combine assessment and classwork populations unless their relationship and source authority are proven.
- Align readiness with the actual registered model input contract so “ready” cannot lead directly to a missing-input error.

### Behavior that must remain numerically identical

- Existing gradebook weights, template resolution, exam splits, transmutation, finalization, and manual override behavior.
- Existing model artifact, feature order, preprocessing for valid supported inputs, readiness thresholds, and risk rules/thresholds.
- Attendance weights and participation weight normalization when the same measurements are genuinely available.
- Existing gradebook submission-selection outcomes where that selector produces an unambiguous result.
- Prediction and risk outputs for complete, correctly scoped, non-overlapping evidence after equivalent inputs are established.

### Unresolved domain-policy questions

- How legacy classwork is assigned to a period, and what new assignment event defines period membership.
- Eligibility of unpublished offline teacher records versus unavailable online work at capture cutoff.
- Whether assessment tables are intended to become a live authoritative source, and who writes/finalizes their statuses.
- Whether approved/excused late submissions remain “late” for prediction evidence.
- Tie-breaking for equal-timestamp or ungraded-only duplicate submission rows.
- Whether any assessment and classwork rows are two representations of one activity; no title/time similarity matching is acceptable.
- Whether `MISSING_NOT_ENCODED`, no score row, `ABSENT`, `pending`, and `missed` establish completion, missing work, coverage, or only unknown recording state.

## E. Phase 1 feasibility blockers

1. **No exact stable scope-row lock exists.** Prediction code has no row/advisory locks. `AIPrediction` has no logical-scope uniqueness and may not exist yet; `StudentPeriodGrade` may not exist; `SubjectLoad` is non-unique and versioned; `StudentClass` is unique/stable but lacks subject and period. A student row could serialize all predictions for that student, but that is an over-broad new design and other evidence writers do not take the same lock. The plan's existing-scope-lock assumption is unsupported.
2. **Current multi-query extraction is not a consistent evidence snapshot.** The engine does not configure a stronger isolation level, so PostgreSQL defaults apply. Attendance, submissions, grades, and assignments can be committed between extraction queries. A row lock that evidence writers do not honor cannot fix this; a consistent-read transaction design must be established and tested.
3. **Legacy classwork cannot be truthfully period-scoped.** There is no period FK and no approved deterministic backfill. Phase 1 can support newly attributed rows, but old rows must remain unresolved until reconciled.
4. **Assessment authority cannot be validated against live behavior.** No production writer/importer and no configured database rows were found. The schema expresses status and period, but not operational ownership or finalization.
5. **Cross-source identity cannot be represented.** There is no assessment-to-classwork relationship. Per the Phase 1 boundary, populations must remain separate and any required combined metric must be unavailable.
6. **Submission cardinality is unenforced.** Normal writers try to reuse a row, but the database permits duplicates and one bulk writer can encounter/update an arbitrary duplicate. The gradebook selector handles only some conflicts and is nondeterministic for ties.
7. **Snapshot history cannot be reconstructed from mutable source rows.** Existing evidence records are not revisioned. A new snapshot can preserve values at capture, but cannot truthfully replay historical state before that feature exists.
8. **Configured development data is not representative enough for production-impact claims.** It contains 2 classwork rows, 1 assignment, and no submissions, assessment items/scores, attendance, or period grades. All 616 saved predictions are `INSUFFICIENT_DATA`; all have null predicted/source/attendance values and zero completion/coverage/participation. The frozen edge cases are therefore synthetic characterization fixtures, not a historical-production validation set.

### Stage 2 gate

Do not start Stage 2 under the current locking assumption. Before migrations or persistence changes, the team must choose and validate a concurrency strategy (for example, a dedicated unique logical-scope lock/claim or an explicitly accepted broader lock plus a consistent transaction), and must decide which evidence populations Phase 1 supports when classwork period or cross-source identity is unresolved. Those are design/domain decisions, not implementation conveniences.

No migrations, models, services, formulas, thresholds, persistence behavior, or teacher UI were modified by this audit.
