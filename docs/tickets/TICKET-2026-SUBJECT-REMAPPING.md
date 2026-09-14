# TICKET-2026-SUBJECT-REMAPPING: Historical Generic Seed Subject Remapping to DepEd Curriculum Catalog

**Status**: Open / Backlog  
**Severity**: Medium (Data Integrity & Historical Attribution)  
**Component**: Prediction Engine / Database Migration / Seeding Pipeline  
**Target Release**: Post-Dynamic-Dashboard Milestone  

---

## 1. Problem Statement
During initial ML dataset seeding (`backend/scripts/SeedLivePredictions.py`), 13,421 prediction rows were generated using generic subject IDs (`18` through `32`) derived from raw Kaggle/CSV training dumps:
- `18`: Creative Technology
- `19`: Electronics
- `20`: ICT
- `21`: Mathematics (Generic)
- `22`: Science (Generic)
- `23`: Values Education
- `24`: Arts
- `25`: English (Generic)
- `26`: Health
- `27`: Music
- `28`: Physical Education
- `29`: Advanced Physics
- `30`: Conceptual Chemistry
- `31`: Personal Development
- `32`: Pre-Calculus (Generic)

Because these subject IDs (`18`–`32`) do not exist in the official DepEd curriculum catalog (`subject_load`, `subject_offering`), the unified triplet resolver correctly classifies them as `HISTORICAL_UNMAPPED`. Consequently:
1. They display the badge **"Historical Record (Unmapped Subject)"** in the dashboard and prediction detail views.
2. Subject-specific teacher filtering for these historical predictions cannot resolve to official DepEd subject teachers without explicit curriculum remapping.

---

## 2. Proposed Migration: Mapping Matrix
A data migration script should be executed to remap predictions from `(grade_level, generic_subject_id)` to the corresponding `specific_subject_id` in the active curriculum catalog:

| Generic Subject Name | Generic ID | Grade Level | Target Subject Name | Target Subject ID |
|---|---|---|---|---|
| Mathematics (Generic) | 21 | 7 | Mathematics 7 | 2 |
| Mathematics (Generic) | 21 | 8 | Enhanced Math 8 | 5 |
| Mathematics (Generic) | 21 | 9 | Enhanced Math 9 | 7 |
| Mathematics (Generic) | 21 | 10 | Mathematics 10 | 9 |
| Science (Generic) | 22 | 7 | Science 7 | 3 |
| Science (Generic) | 22 | 8 | Enhanced Sci 8 | 6 |
| Science (Generic) | 22 | 9 | Enhanced Sci 9 | 8 |
| Science (Generic) | 22 | 10 | Science 10 | 10 |
| English (Generic) | 25 | 7 | English 7 | 4 |
| English (Generic) | 25 | 8 | English 8 | 49 |
| English (Generic) | 25 | 9 | English 9 | 45 |
| English (Generic) | 25 | 10 | English 10 | 33 |
| Values Education | 23 | 8 | Values Ed 8 | 55 |
| Values Education | 23 | 9 | Values Ed 9 | 42 |
| Advanced Physics | 29 | 11/12 | General Physics | 13 |
| Conceptual Chemistry | 30 | 11/12 | General Chemistry | 15 |
| Pre-Calculus (Generic) | 32 | 11 | Pre-Calculus | 11 |

---

## 3. Implementation Steps
1. **Create Alembic Data Migration or Standalone Script**:
   - `backend/alembic/versions/xxxx_remap_historical_prediction_subjects.py` or `backend/scripts/RemapHistoricalPredictionSubjects.py`.
   - Update `ai_prediction.subject_id` based on the student's enrolled grade level via `AcademicClass.grade_level` / `AcademicLevel.grade_level`.
2. **Handle Non-Curriculum Electives**:
   - Electives without a 1:1 match in Junior High School (e.g. `Arts`, `Health`, `Music` separated from `MAPEH`) should either be mapped to composite `MAPEH` (`51` for Grade 8, `41` for Grade 9) or retained as legacy elective entries with an explicit note.
3. **Verify Resolver Resolution**:
   - After remapping, predictions will naturally match `subject_load` entries, transitioning from `TeacherStatusLabel.HISTORICAL_UNMAPPED` to `TeacherStatusLabel.ASSIGNED` or `TeacherStatusLabel.NO_CONFIRMED_TEACHER`.

---

## 4. Subject Picker Hiding & Studio Exclusion (Legacy IDs 18–32)
While the generic seed subjects (`18` through `32`) must be retained in the `subject` table for foreign key integrity and historical auditability, they should be excluded from all administrative subject pickers to prevent accidental new assignments:
1. **Subject Load Studio**:
   - In `backend/app/api/v1/routes/SubjectLoads.py` (`/studio-data`), exclude `Subject.subject_id.in_(LEGACY_IMPORT_SUBJECT_IDS)` (or filter `status != 'archived'`) so that "Mathematics (Generic)", "Science (Generic)", etc., do not appear in the load assignment palette.
2. **Subject Catalog & Offerings Pickers**:
   - In `backend/app/services/subjects/SubjectQueryService.py` (`list_subjects_data`), flag or archive legacy IDs (`status = 'archived'`) or hide them from default active dropdowns so teachers and admins only select official DepEd catalog subjects for new offerings and schedules.
3. **Prevent Accidental 2026+ Load Creation**:
   - Add a validation rule rejecting new `SubjectLoad` or `SubjectOffering` creations referencing `LEGACY_IMPORT_SUBJECT_IDS`.

---

## 5. Acceptance Criteria
- [ ] Migration script runs idempotently on `ai_prediction`.
- [ ] No regression on historical confidence scores or model feature attribution columns.
- [ ] Dashboard filters for Math/Science/English in Grade 7 show correct teacher attribution.
- [ ] Legacy subjects (`18`–`32`) are hidden from the Subject Load Studio subject selector dropdown.
- [ ] Admin subject catalog hides or explicitly flags generic subjects as archived/read-only.
- [ ] API validation rejects creation of new `SubjectLoad` records using generic subject IDs.
