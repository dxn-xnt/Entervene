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

## 6. Latest Verification

Focused User Management tests:

```text
tests/test_user_list.py: 2 passed
tests/test_user_manual_create.py + tests/test_user_student_import.py: 16 passed
```

Full backend suite:

```text
124 passed
```

`git diff --check` passed with only the existing LF-to-CRLF notice. Existing SQLAlchemy and pytest-cache warnings remain.

## 7. Current Refactor Files

Created:

```text
backend/app/services/users/UserQueryService.py
backend/app/services/users/UserAccountService.py
backend/app/services/users/UserInvitationService.py
```

Modified:

```text
backend/app/api/v1/routes/Users.py
docs/CODEX_HANDOFF.md
```

## 8. Risks And Deferred Work

- User Management listing still returns all matched users without pagination.
- The latest-section batched query loads enrolled rows for returned students and chooses the first per student in Python.
- The student `average` is raw persisted grade points while the frontend displays `%`; do not treat it as an official percentage without a confirmed grading policy.
- Invitation-email failure after commit cannot roll back created user accounts.
- Existing SQLAlchemy, Starlette TestClient, JWT, and dependency deprecation warnings remain.
- Predictions and analytics are still outline-stage modules and should not be prioritized yet.
- Do not introduce microservices or a repository layer.

## 9. Recommended Next Task

Add backend and frontend pagination for User Management listing.

Inspect:

```text
backend/app/api/v1/routes/Users.py
backend/app/services/users/UserQueryService.py
backend/tests/test_user_list.py
frontend/src/pages/admin/users.tsx
frontend/src/lib/api.ts
```

Pagination must preserve filters, archived-account behavior, ordering, response fields, teacher summaries, student section and raw-average fields, authorization, and the bounded query count.

## 10. Next-Session Checklist

1. Read this handoff and inspect the current Git status and diff.
2. Confirm the branch is `roy-dev`.
3. Inspect the thin route and `UserQueryService.py`.
4. Inspect the actual frontend User Management API consumer.
5. Propose a pagination request/response contract before editing.
6. Preserve the current raw student-average behavior; do not silently normalize or rename it.
7. Run focused backend/frontend tests before the full suite.
8. Avoid unrelated refactoring, microservices, and repository-layer changes.
