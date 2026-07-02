# Entervene Codex Handoff

## 1. Project Overview

Entervene is a Learning Management System with early-warning and intervention features.

- Backend: FastAPI, SQLAlchemy ORM, PostgreSQL, Alembic, and JWT authentication.
- Frontend: React, TypeScript, and Vite.
- Mobile: Expo React Native.
- Architecture direction: keep Entervene as a clean modular monolith, not microservices.

## 2. Working Branch

```text
Current branch: ian_dev
Repository root:
C:\Users\Ian Jhon\School\BSIT III-B\2nd Sem\Capstone\Entervene
```

Sections 3 through 11 preserve the earlier `roy-dev` handoff context. Current
`ian_dev` work is recorded in section 12.

## 3. Completed Class-Management Refactor

`backend/app/api/v1/routes/Classes.py` is a thin route file. Focused class-management logic lives under:

```text
backend/app/services/classes/
|-- __init__.py
|-- ClassShared.py
|-- ClassService.py
|-- ClassImportService.py
|-- ClassStudentService.py
`-- ClassQueryService.py
```

The package preserves the modular-monolith architecture and existing class-management contracts.

## 4. Completed User-Management Refactor

`backend/app/api/v1/routes/Users.py` is now a thin route file containing endpoint declarations, dependencies, request parameters, authorization checks, and service calls. It no longer constructs SQLAlchemy queries or performs transaction mutations directly.

Current package:

```text
backend/app/services/users/
|-- __init__.py
|-- UserShared.py
|-- UserImportService.py
|-- UserQueryService.py
|-- UserAccountService.py
`-- UserInvitationService.py
```

Responsibilities:

- `UserShared.py`: helpers genuinely shared across user services, including account/profile creation, LRN normalization, academic-level resolution, and required-name validation.
- `UserImportService.py`: CSV/XLS/XLSX parsing, validation, duplicate detection, and atomic bulk invitation/profile creation.
- `UserQueryService.py`: listing filters and ordering, batched teacher/student summaries, user details, and the analytics placeholder response.
- `UserAccountService.py`: user edits, role/profile update validation, section assignment updates, and account archiving.
- `UserInvitationService.py`: manual invitation validation and creation plus invitation acceptance.

Preserved upload paths:

- `/api/v1/admin/users/upload-csv`
- `/api/v1/users/upload-csv`

Invitation records are created inside the database transaction. Invitation email is sent only after a successful commit. Email delivery failure after commit cannot roll back created accounts.

## 5. User Listing And Average

`list_users()` remains bounded to no more than four SQL statements regardless of returned user count:

| Area | Query strategy |
| --- | --- |
| Base users | One query |
| Teacher summaries | One batched query |
| Student sections | One batched query |
| Student averages | One grouped query |

The student `average` behavior was preserved unchanged:

- Rounded raw arithmetic mean of graded, non-null `StudentSubmission.grade` values.
- Not normalized against `Classwork.total_points`.
- Not grouped by subject, academic period, or academic year.
- Not an official academic percentage.
- The frontend still displays it with `%`; this semantic ambiguity is deferred work.

## 6. Class Student-List Additions

`PATCH /api/v1/classes/{class_id}/students` now accepts staged additions together with removals and transfers:

```json
{
  "additions": [{"student_id": "student-uuid"}],
  "removals": [{"student_id": "student-uuid"}],
  "transfers": [{"student_id": "student-uuid", "target_class_id": 2}]
}
```

All three collections default to empty lists, so existing removal-only and transfer-only requests remain compatible.

Before writing, `ClassStudentService.update_class_student_assignments()` validates:

- The target class exists and is not archived.
- Every added student exists and belongs to the target class academic level.
- Added students have no `StudentClass` assignment in the target class academic year.
- Additions, removals, and transfers contain no duplicate or overlapping student changes.
- Removed and transferred students are currently assigned to the source class and academic year.
- Transfer targets remain different, same-level, same-year, and active.

The service validates the complete request first, then creates additions with
`build_student_class_assignment()`, applies removals and transfers, and commits
once. Any write or integrity failure rolls back the complete transaction.

The existing unassigned-students endpoint and its filters were not changed.
Account status, archived account status, enrollment status, and archived-class
assignment filtering remain deferred until the business rule is explicitly
defined.

## 7. Edit Student List Frontend

The Admin Classes Edit Student List modal is now a viewport-constrained workspace
with a fixed green modal header, a scrollable central content area, and an always
visible footer. It preserves the retro cream background, black borders, offset
shadows, compact badges, and existing remove/transfer controls.

The modal has two tabs:

- `Enrolled students`: preserves separate enrolled search, select-multiple,
  staged removals, staged transfers, gender panels, transfer selection, and
  discard-unsaved-changes behavior.
- `Add students`: displays the existing unassigned-students endpoint response in
  one full-width searchable list. Additions remain visible with `Added` and
  `Pending save` states and can be undone before saving.

The modal tracks additions, removals, and transfers independently across tab
switches. The Save Changes count includes all three categories. A successful
atomic PATCH clears staged changes, refreshes the enrolled response and available
students, updates class detail when available, and keeps the modal open with a
success banner. PATCH failures preserve all staged changes.

`UpdateClassStudentListRequest` now includes:

```ts
additions: Array<{ student_id: string }>;
```

Available students are loaded with the existing `getUnassignedClassStudents()`
helper when the modal opens. No duplicate API helper or frontend eligibility
filter was added.

## 8. Latest Verification

Focused Class Student-List tests:

```text
tests/test_class_detail.py: 33 passed
tests/test_classes_phase_one.py: 8 passed
tests/test_class_batch_create.py: 16 passed
tests/test_student_class_integrity.py: 10 passed
```

Full backend suite:

```text
134 passed
```

`git diff --check` passed with only LF-to-CRLF working-copy notices.
Existing SQLAlchemy and pytest-cache warnings remain.

Frontend verification:

```text
Targeted ESLint for all touched frontend files: passed
npm run build: blocked by two pre-existing unused variables in
  src/pages/student/Subjects/tabs/SubjectLessonTab.tsx
npm run lint: blocked by existing unrelated lint errors and warnings
```

Interactive manual review is blocked because no running authenticated frontend,
backend, or realistic 20+ male and 20+ female student test dataset was available
in this session. The responsive layout and staged-state behavior were reviewed
from the implementation, but the requested browser walkthrough was not claimed
as completed.

## 9. Current Task Files

Modified:

```text
frontend/src/components/admin/classes/modals/EditStudentListModal.tsx
frontend/src/components/admin/classes/modals/ModalShell.tsx
frontend/src/pages/admin/class-detail.tsx
frontend/src/types/adminClasses.ts
docs/CODEX_HANDOFF.md
```

## 10. Risks And Deferred Work

- User Management listing still returns all matched users without pagination.
- The latest-section batched query loads enrolled rows for returned students and chooses the first per student in Python.
- The student `average` is raw persisted grade points while the frontend displays `%`; do not treat it as an official percentage without a confirmed grading policy.
- Invitation-email failure after commit cannot roll back created user accounts.
- Unassigned-student eligibility does not currently filter account status, archived account status, enrollment status, or assignments associated with archived classes.
- Existing SQLAlchemy, Starlette TestClient, JWT, and dependency deprecation warnings remain.
- Predictions and analytics are still outline-stage modules and should not be prioritized yet.
- Do not introduce microservices or a repository layer.

## 11. Recommended Next Task

Resolve the existing frontend TypeScript and ESLint baseline errors, then perform
the interactive Edit Student List walkthrough with realistic large-section data.

## 12. Current Branch Update: ian_dev

### June 15, 2026

Classwork material upload and attachment viewing were expanded across the teacher
classwork flow:

- Teachers can select multiple PDF, DOCX, PPTX, JPG, JPEG, or PNG materials while
  creating classwork.
- The classwork form validates supported extensions, enforces a 4 MB limit per
  file, prevents duplicate selections, and allows selected files to be removed
  before submission.
- Selected materials are uploaded after classwork creation and before assignment.
- Classwork reference files now use the shared `AttachmentDisplay` component with
  the classwork download endpoint.
- PDF previews request inline content while retaining the normal attachment URL
  for downloads.
- JPG, JPEG, and PNG files can be previewed from authenticated blob URLs. Preview
  requests retry once after refreshing an expired session, and generated object
  URLs are revoked when closed or replaced.
- The backend classwork attachment download endpoint now accepts `inline=true`,
  authenticates using bearer headers, session cookies, or the existing token
  query fallback, and controls the response content disposition accordingly.

Classwork route typing and defensive handling were also cleaned up:

- The FastAPI `Request` parameter is now required instead of being declared as a
  non-optional type with a `None` default.
- Assignment lookup returns `404 Classwork not found` when its referenced
  classwork record is missing.
- The legacy SQLAlchemy `Class.section_name` value is cast to the response
  schema's expected runtime string type.
- An unused `Badge` import was removed from the admin system settings page.

Current verification:

```text
backend/app/api/v1/routes/Classworks.py: py_compile passed
backend/app/api/v1/routes/Classworks.py: AST parse passed
FastAPI Classworks router import: passed, 13 routes imported
git diff --check for Classworks.py: passed with an LF-to-CRLF notice
Backend pytest suite: not run because pytest is not installed in backend/venv
Frontend build/lint: not run for the current ian_dev changes
```

Current working-tree notes:

- The attachment/classwork changes are not yet committed.
- `frontend/package.json` and `frontend/package-lock.json` currently contain an
  unstaged Vite upgrade from `^7.3.1` to `^8.0.16`; validate Node compatibility
  and the frontend build before including it in the attachment work.
- Untracked planning documents and the `screens/` directory remain outside this
  handoff update.

## 13. Admin Subjects Redesign And Grading Template Handoff

### July 2, 2026

This section is the current handoff for the Entervene Admin Subjects work.

Current repository root used in this session:

```text
C:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene
```

### Completed Work

The Admin Subjects module was redesigned in phases:

- Audited the existing Admin Subjects frontend, API helpers, backend routes,
  services, schemas, and models for Subjects, Subject Offerings, and Grading
  Templates.
- Created reusable frontend foundation components under
  `frontend/src/pages/admin/subjects/components/`:
  - `SubjectContextBanner`
  - `SubjectModuleTabs`
  - `CurriculumFilters`
  - `EmptyStateCard`
  - `SubjectPicker`
  - `TemplateSubjectPicker`
  - `CurriculumPlanTable`
- Replaced the large repeated Subject Offering cards with a compact Curriculum
  Plan table.
- Simplified the Add/Edit Subject Offering modal:
  - Academic Year is hidden by default.
  - Current setup context is shown read-only.
  - An Advanced checkbox reveals the Academic Year selector.
  - Grade controls the available pathway choices.
  - Grades 7 to 10 lock pathway to `general`.
  - Grades 11 to 12 support `both`, `stem_medical`, and `stem_engineering`.
  - Terms use checkbox/chip style selection.
  - Subjects use a searchable picker.
- Replaced the Grading Template long subject dropdown with a searchable
  single-subject picker.
- Added frontend read-only UX for inactive or previous academic years.
- Added backend read-only enforcement for Subject Offerings:
  - create, update, archive, restore, and import are blocked when
    `academic_year.is_active` is false.
  - listing and detail viewing remain allowed.
  - future terms inside the active academic year remain editable.
- Added Subject Offering copy-forward:
  - Endpoint: `POST /api/v1/subject-offerings/copy-academic-year`
  - Copies subject offerings from a source academic year to an active target
    academic year.
  - Maps periods by `period_sequence`, not source `academic_period_id`.
  - Skips duplicates by default.
  - `overwrite_existing: true` updates exact target matches.
  - Does not copy teachers, classes, grades, students, submissions,
    predictions, or subject loads.
  - Frontend button/modal label: `Copy Previous Year Setup`.

### Files Changed In This Completed Work

Backend:

```text
backend/app/api/v1/routes/SubjectOfferings.py
backend/app/schemas/SubjectOffering.py
backend/app/services/subject_offerings/SubjectOfferingImportService.py
backend/app/services/subject_offerings/SubjectOfferingService.py
backend/app/services/subject_offerings/SubjectOfferingShared.py
backend/tests/test_subject_offering_admin_api.py
backend/tests/test_subject_offering_import_api.py
```

Frontend:

```text
frontend/src/lib/api.ts
frontend/src/pages/admin/forms/add-grading-component.tsx
frontend/src/pages/admin/subjects.tsx
frontend/src/pages/admin/subjects/components/
```

Docs:

```text
docs/CODEX_HANDOFF.md
```

### Current Subject Offering Behavior

- Subject Catalog is reusable and should not be recreated every academic year.
- Subject Offerings are academic-year scoped.
- Subject Offerings do not assign teachers or schedules.
- Teacher assignment belongs in Classes / Subject Load.
- Admins can add/edit/archive/restore offerings only for an active academic
  year.
- Admins can still list and inspect offerings from inactive academic years.
- Future terms inside the active academic year are editable even if Term 1 is
  the currently live term.
- Do not add term-based read-only rules.

### Current Read-Only Rule

The read-only lock is academic-year based only:

```text
if academic_year.is_active is false:
  block Subject Offering create/update/archive/restore/import mutations
else:
  allow active-year setup, including future terms
```

Do not use `academic_period.is_active` to decide whether Subject Offering setup
can be edited.

### Current Copy-Forward Behavior

Endpoint:

```text
POST /api/v1/subject-offerings/copy-academic-year
```

Request shape:

```json
{
  "source_academic_year_id": 1,
  "target_academic_year_id": 2,
  "overwrite_existing": false
}
```

Response shape:

```json
{
  "source_academic_year_id": 1,
  "target_academic_year_id": 2,
  "created_count": 20,
  "updated_count": 0,
  "skipped_count": 3,
  "skipped": [
    {
      "subject_id": 12,
      "source_subject_offering_id": 44,
      "reason": "Matching target period not found for period_sequence 3."
    }
  ]
}
```

Rules:

- Source academic year may be active or inactive.
- Target academic year must be active.
- Source and target cannot be the same.
- Matching target periods are found by `period_sequence`.
- Existing exact duplicates are skipped by default.
- With `overwrite_existing: true`, exact target matches have their status
  updated.
- Extra target offerings are not deleted.
- `SubjectOffering` has no `hours` column; subject hours remain on the reusable
  Subject Catalog record.

### Validation Already Passed

```text
backend/.venv/Scripts/python.exe -m pytest tests/test_subject_offering_admin_api.py
backend/.venv/Scripts/python.exe -m pytest tests/test_subject_offering_import_api.py
backend/.venv/Scripts/python.exe -m pytest
npm.cmd run build
git diff --check
```

`git diff --check` passed with only LF-to-CRLF working-copy warnings.

### Remaining Grading Template Problem

Grading template copy-forward is not ready yet because grading templates are not
safely academic-year scoped.

Current limitations:

- Backend currently supports one optional `subject_id`.
- True multi-subject grading template assignment is not supported.
- `TemplateSubjectPicker` should remain single-select for now.
- Do not fake multi-subject assignment.
- Do not loop-create multiple templates unless that design is explicitly chosen
  later.

### Recommended Next-Session Plan

Start with an audit-only task:

```text
Task: Audit Grading Template Academic-Year Scoping
```

Inspect backend files:

```text
backend/app/api/v1/routes/GradingTemplates.py
backend/app/schemas/GradingTemplate.py
backend/app/services/grading_templates/GradingTemplateService.py
backend/app/services/grading_templates/GradingTemplateQueryService.py
backend/app/services/grading_templates/GradingTemplateShared.py
backend/app/models/academic/GradingTemplate.py
backend/app/models/academic/GradingTemplateComponent.py
backend/app/models/academic/AcademicYear.py
backend/tests/test_grading_template_admin_api.py
```

Inspect frontend files:

```text
frontend/src/pages/admin/subjects.tsx
frontend/src/pages/admin/forms/add-grading-component.tsx
frontend/src/pages/admin/subjects/components/TemplateSubjectPicker.tsx
frontend/src/lib/api.ts
```

Determine:

- Whether grading templates should become academic-year scoped.
- Whether templates should remain reusable global definitions with
  academic-year-scoped assignments.
- Whether a separate join/assignment table is needed later.
- What migration would be required, if any.
- How copy-forward should work without duplicating unsafe or global data.

### Exact Next Implementation Prompt For Codex

```text
Proceed with audit only.

Task Name:
Audit Grading Template Academic-Year Scoping

Goal:
Inspect the current grading template backend and frontend design before making
schema or endpoint changes. Do not implement yet. Do not create migrations yet.
Do not touch Subject Offerings unless fixing a regression. Do not touch
mobile-app.

Business context:
- Subject Catalog is reusable.
- Subject Offerings are academic-year scoped and already support copy-forward.
- Previous/inactive academic years are read-only.
- Future terms inside the active academic year remain editable.
- Grading Templates / Grading Components should eventually support safe
  copy-forward, but current schema may not be academic-year scoped.
- Backend currently supports one optional subject_id only.
- True multi-subject template assignment is not supported yet.

Inspect:
- backend/app/api/v1/routes/GradingTemplates.py
- backend/app/schemas/GradingTemplate.py
- backend/app/services/grading_templates/GradingTemplateService.py
- backend/app/services/grading_templates/GradingTemplateQueryService.py
- backend/app/services/grading_templates/GradingTemplateShared.py
- backend/app/models/academic/GradingTemplate.py
- backend/app/models/academic/GradingTemplateComponent.py
- backend/app/models/academic/AcademicYear.py
- backend/tests/test_grading_template_admin_api.py
- frontend/src/pages/admin/subjects.tsx
- frontend/src/pages/admin/forms/add-grading-component.tsx
- frontend/src/pages/admin/subjects/components/TemplateSubjectPicker.tsx
- frontend/src/lib/api.ts

Produce:
1. Current grading template data model summary
2. Current frontend behavior summary
3. Whether templates are global, subject-scoped, year-scoped, or mixed
4. Risks of copying current templates forward as-is
5. Recommended schema/API direction
6. Files that would need changes later
7. Tests that should be added later
8. Blockers/questions before implementation

Stop after the audit and plan.
```

### Warnings For The Next Session

- Do not touch Subject Offerings unless fixing regressions.
- Do not add many-to-many grading templates yet.
- Do not add term-based read-only locking.
- Do not copy grades, students, classes, teachers, submissions, predictions, or
  subject loads.
- Do not touch `mobile-app`.
