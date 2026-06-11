# Entervene Codex Handoff

## 1. Project Overview

Entervene is a Learning Management System with early-warning and intervention features.

- Backend: FastAPI, SQLAlchemy ORM, PostgreSQL, Alembic, and JWT authentication.
- Frontend: React, TypeScript, and Vite.
- Mobile: Expo React Native.
- Architecture direction: keep Entervene as a clean modular monolith, not microservices.

## 2. Working Branch and Repository Location

```text
Branch: roy-dev
Repository root:
C:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene
```

## 3. Completed Class-Management Refactor

`backend/app/api/v1/routes/Classes.py` was converted into a thin route file.

Current package:

```text
backend/app/services/classes/
├── __init__.py
├── ClassShared.py
├── ClassService.py
├── ClassImportService.py
├── ClassStudentService.py
└── ClassQueryService.py
```

Responsibilities:

- `ClassShared.py`: shared class-management errors, exception handling, active academic-year resolution, adviser queries, text normalization, and student sorting.
- `ClassService.py`: class creation, archive, update, and reusable student-class assignment construction.
- `ClassImportService.py`: class CSV parsing, validation, grouping, and import-preview response construction.
- `ClassStudentService.py`: student removal and transfer validation plus transaction handling.
- `ClassQueryService.py`: read-only class listing, details, form options, unassigned students, class students, and transfer options.

`backend/app/services/ClassManagement.py` was removed. No backend imports still reference the removed module.

`Classes.py` contains only route declarations, dependencies, request parameters, response models, and thin service calls. Class-management tests pass.

## 4. Completed User-Import Refactor

Current package:

```text
backend/app/services/users/
├── __init__.py
├── UserShared.py
└── UserImportService.py
```

- `UserImportService.py` handles CSV, XLS, and XLSX parsing, validation, duplicate detection, and atomic bulk account/profile creation.
- `UserShared.py` contains helpers genuinely shared between bulk import and manual invitation creation, including pending-account creation, profile attachment, LRN normalization, academic-level resolution, and required-name validation.

Existing upload endpoint paths remain unchanged:

- `/api/v1/admin/users/upload-csv`
- `/api/v1/users/upload-csv`

Invitations are created within the database transaction and invitation emails are sent only after a successful commit. Database failures roll back the full batch, so partial database imports are not possible.

## 5. Completed User-Listing Optimization

The confirmed `list_users()` N+1 issue in `backend/app/api/v1/routes/Users.py` was fixed.

Previous behavior:

- One subject-load query per teacher.
- One enrollment query per student.
- One average-grade query per student.

Current strategy:

| Area | Before | After |
| --- | --- | --- |
| Base users | One query | One query |
| Teacher summaries | One query per teacher | One batched query |
| Student sections | One query per student | One batched query |
| Student averages | One query per student | One grouped query |

The endpoint now executes no more than four SQL statements regardless of the returned user count.

`backend/tests/test_user_list.py` verifies mixed teacher/student response behavior and includes a query-count regression test that enforces the bounded query count.

## 6. Latest Verified Test Results

```powershell
python -m pytest -q
```

Latest confirmed result:

```text
124 passed
```

```powershell
git diff --check
```

Latest confirmed result:

```text
Passed, with only existing LF-to-CRLF notices.
```

Existing SQLAlchemy, Starlette TestClient, JWT, and dependency deprecation warnings remain.

## 7. Files Recently Created

```text
backend/app/services/classes/ClassShared.py
backend/app/services/classes/ClassService.py
backend/app/services/classes/ClassImportService.py
backend/app/services/classes/ClassStudentService.py
backend/app/services/classes/ClassQueryService.py
backend/app/services/users/UserShared.py
backend/app/services/users/UserImportService.py
backend/tests/test_user_list.py
```

## 8. Files Recently Modified

```text
backend/app/api/v1/routes/Classes.py
backend/app/api/v1/routes/Users.py
backend/app/main.py
backend/tests/test_class_adviser_integrity.py
backend/tests/test_class_batch_create.py
backend/tests/test_class_detail.py
backend/tests/test_class_import_validation.py
backend/tests/test_class_list.py
backend/tests/test_classes_phase_one.py
backend/tests/test_student_class_integrity.py
backend/tests/test_user_student_import.py
backend/tests/test_user_list.py
```

Current uncommitted working-tree changes verified before this handoff:

```text
M backend/app/api/v1/routes/Users.py
?? backend/tests/test_user_list.py
```

## 9. Current Risks and Deferred Work

- `list_users()` still returns all matched users without pagination.
- The latest-section batched query loads enrolled rows for returned students and chooses the first per student in Python.
- Existing SQLAlchemy, Starlette TestClient, JWT, and dependency deprecation warnings remain.
- Invitation-email failure after commit cannot roll back created user accounts.
- Predictions and analytics are still outline-stage modules and should not be prioritized yet.
- Do not introduce microservices.
- Do not add a repository layer unless repeated query reuse genuinely requires it.

## 10. Recommended Next Task

```text
Add backend and frontend pagination for User Management listing.
```

The next Codex session must inspect the frontend consumer before editing the backend contract.

Likely relevant files:

```text
backend/app/api/v1/routes/Users.py
backend/tests/test_user_list.py
frontend/src/pages/admin/users.tsx
frontend/src/lib/api.ts
```

The next session must verify the actual frontend files before making changes.

The pagination task should preserve:

- Role filtering.
- Status filtering.
- Search filtering.
- Archived-account behavior.
- Ordering.
- Existing user fields.
- Teacher summaries.
- Student section and average fields.
- Authorization.
- Bounded query count.

## 11. Recommended Next-Session Prompt

```text
Read docs/CODEX_HANDOFF.md first.

Then:
1. Inspect the current git status and diff.
2. Confirm the working branch is roy-dev.
3. Inspect the backend user-listing endpoint in backend/app/api/v1/routes/Users.py.
4. Inspect the actual frontend User Management API consumer, especially frontend/src/pages/admin/users.tsx and frontend/src/lib/api.ts.
5. Propose a pagination request/response contract before editing.
6. Keep all changes scoped to backend and frontend User Management pagination.
7. Preserve filters, archived-account behavior, ordering, user fields, role-specific summaries, authorization, and bounded query count.
8. Run focused backend/frontend tests before the full suite.
9. Avoid unrelated refactoring, microservices, and repository-layer changes.
```

## 12. Git Checkpoint Instructions

```powershell
git status
git add .
git commit -m "document codex handoff after user listing optimization"
git push origin roy-dev
```
