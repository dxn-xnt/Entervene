# Entervene Codex Handoff

## 1. Project Overview

Entervene is a Learning Management System with early-warning and intervention features.

- Backend: FastAPI, SQLAlchemy ORM, PostgreSQL, Alembic, and JWT authentication.
- Frontend: React, TypeScript, and Vite.
- Mobile: Expo React Native.
- Architecture direction: keep Entervene as a clean modular monolith, not microservices.

## 2. Working Branch

```text
Branch: roy-dev
Repository root:
C:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene
```

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

## 7. Latest Verification

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

## 8. Current Task Files

Modified:

```text
backend/app/schemas/Class.py
backend/app/services/classes/ClassStudentService.py
backend/tests/test_class_detail.py
docs/CODEX_HANDOFF.md
```

## 9. Risks And Deferred Work

- User Management listing still returns all matched users without pagination.
- The latest-section batched query loads enrolled rows for returned students and chooses the first per student in Python.
- The student `average` is raw persisted grade points while the frontend displays `%`; do not treat it as an official percentage without a confirmed grading policy.
- Invitation-email failure after commit cannot roll back created user accounts.
- Unassigned-student eligibility does not currently filter account status, archived account status, enrollment status, or assignments associated with archived classes.
- Existing SQLAlchemy, Starlette TestClient, JWT, and dependency deprecation warnings remain.
- Predictions and analytics are still outline-stage modules and should not be prioritized yet.
- Do not introduce microservices or a repository layer.

## 10. Recommended Next Task

Add the Enrolled Students and Add Students tabs to the existing frontend Edit
Student List modal. Reuse `getUnassignedClassStudents()` and extend the frontend
student-list PATCH type with the new `additions` collection.

Inspect:

```text
frontend/src/pages/admin/class-detail.tsx
frontend/src/components/admin/classes/modals/EditStudentListModal.tsx
frontend/src/types/adminClasses.ts
frontend/src/lib/api.ts
```

Preserve the current staged Save Changes and discard-unsaved-changes behavior.
