# Content Cloning API Contract (Entervene)

This is the authoritative backend/frontend contract for the Content Cloning & Repost feature.
- **Backend PR A (Implemented & Available)**: Publishes domain models, Alembic migration, lifecycle/expiration logic, destination/owner authorization, Pydantic schemas, and the 5 request-foundation endpoints.
- **Backend PR B (Planned - Not Routed in PR A)**: Implements owner material picker persistence, immutable snapshot packaging, package preview query, and requester acceptance/decline decisions.
- **Backend PR C (Planned - Not Routed in PR A)**: Implements independent deep-copy cloning engine, file asset duplication, quiz scheduling resets, and self-cloning execution.

---

## 1. Global Conventions

- **Base Path:** `/api/v1/content-cloning`
- **Authentication:** Teacher session with authenticated academic staff identity (`staff_id`).
- **Authorization:** Direct primary active/published load in active version required. Substitutions or audit-only read access never grant cloning, request, packaging, or acceptance authority.
- **Timestamps:** ISO-8601 UTC instants (e.g. `2026-10-27T04:00:00Z`). All expiration math is authoritative UTC.
- **Two Independent 7-Day Expiration Windows:**
  1. **Owner Response Window:** Request creation starts 7 days (`expires_at = now + 7 days`).
  2. **Requester Decision Window:** Owner package transmission starts a fresh 7 days (`expires_at = now + 7 days`).
  - Read/action-time evaluation ensures immediate expiration without background cron dependency.
- **Idempotency:**
  - Mutation endpoints require header `Idempotency-Key` (1–128 characters).
  - Repeated identical submissions return HTTP 201/200 with header `X-Idempotent-Replay: true`.
  - Reusing a key with a conflicting payload returns HTTP 409 (`IDEMPOTENCY_KEY_REUSED`).
- **Optimistic Concurrency:**
  - Mutation actions require integer `expected_version` in the payload body.
  - Concurrent mutations or outdated states return HTTP 409 (`REQUEST_VERSION_CONFLICT`).
- **Standardized Error Structure:**
  ```json
  {
    "detail": {
      "code": "STABLE_ERROR_CODE",
      "message": "Human-readable safe explanation.",
      "field": "optional_field_name",
      "retryable": false
    }
  }
  ```
  - Authorization / non-enumerating concealment: HTTP 404 (`DESTINATION_SCOPE_FORBIDDEN`, `REQUEST_NOT_FOUND`).
  - Validation failures: HTTP 422 (`SOURCE_FILTER_INVALID`, `DESTINATION_SUBJECT_MISMATCH`).
  - State conflicts / expiration: HTTP 409 (`DUPLICATE_OPEN_REQUEST`, `REQUEST_EXPIRED`, `REQUEST_STATE_CONFLICT`).

---

## 2. Source Filter Modes (`source_scope_mode`)

Requesters specify the source search scope to locate eligible material owners:

| `source_scope_mode` | `source_academic_year_id` | `source_academic_period_id` | Matching Semantics |
|---|---|---|---|
| `ANY` | `null` | `null` | Matches owners who possess owned content and an active direct primary load for the subject in any term. |
| `ALL_TERMS` | `integer` (required) | `null` | Matches owners who possess owned content and a primary load within any term of the specified academic year. |
| `PERIOD` | `integer` (required) | `integer` (required) | Matches owners strictly within the specified academic period. Period must belong to the specified academic year. |

*Note: Filtering narrows source-teacher eligibility only; it never exposes private catalog items or unshared source IDs to the requester.*

---

## 3. Destination Eligibility & Prepared Future Years

Destinations are validated on direct load authority and academic year lifecycle:
- **`ACTIVE`:** The single currently active academic year.
- **`PREPARED_FUTURE`:** Inactive future academic year whose `start_date` follows the active year's `end_date`, with complete periods and valid subject offering pathways.
- **Rejected:** Historical inactive years (`DESTINATION_YEAR_INACTIVE`), closed years, or classes with mismatched offering pathways (`DESTINATION_SCOPE_FORBIDDEN`).

---

## 4. Status Lifecycle Matrices

### Content Share Request (`ContentShareRequest.status`)
- `PENDING_OWNER`: Request submitted by teacher; waiting for owner to package or decline (expires in 7 days).
- `PACKAGE_SENT`: Owner prepared and sent package; waiting for requester acceptance or decline (expires in 7 days).
- `ACCEPTED`: Requester accepted package; triggers independent cloning operation.
- `DECLINED_BY_OWNER`: Owner explicitly declined request.
- `DECLINED_BY_REQUESTER`: Requester explicitly declined sent package.
- `EXPIRED`: Authoritative UTC expiration reached prior to response/decision.

### Content Clone Operation (`ContentCloneOperation.status`)
- `PENDING`: Operation queued for deep copying.
- `RUNNING`: Content graph duplication and asset transfer in progress.
- `SUCCEEDED`: Independent copies created, remapped, locked, and initially unpublished.
- `FAILED`: Operation aborted; compensation executed.

---

## 5. Endpoints Available (Implemented in PR A)

### `GET /scopes` (Implemented in PR A)
Returns caller's authorized destination classes/subjects.
- **Response `200 OK`:**
  ```json
  [
    {
      "class_id": 20,
      "section_name": "Newton",
      "subject_id": 5,
      "subject_name": "Mathematics",
      "academic_period_id": 22,
      "period_name": "Term 2",
      "academic_year_id": 2,
      "academic_year_label": "2025-2026",
      "year_state": "ACTIVE"
    }
  ]
  ```

### `GET /source-teachers` (Implemented in PR A)
Discovers eligible exact content owners for destination scope.
- **Query Parameters:**
  - `destination_class_id` (required, int)
  - `destination_subject_id` (required, int)
  - `destination_academic_period_id` (required, int)
  - `source_scope_mode` (optional, default `"ANY"`)
  - `source_academic_year_id` (optional, int)
  - `source_academic_period_id` (optional, int)
- **Response `200 OK`:**
  ```json
  [
    {
      "staff_id": "T-100",
      "display_name": "Olivia Owner"
    }
  ]
  ```
  *Excludes requester, non-owners, substitutes, and owners without verified primary load in matching source period.*

### `POST /requests` (Implemented in PR A)
Submits a material share request from one teacher to an eligible content owner.
- **Headers:** `Idempotency-Key: <string>` (required)
- **Body:**
  ```json
  {
    "source_owner_staff_id": "T-100",
    "subject_id": 5,
    "source_scope_mode": "ALL_TERMS",
    "source_academic_year_id": 1,
    "source_academic_period_id": null,
    "destination_class_id": 20,
    "destination_subject_id": 5,
    "destination_academic_period_id": 22,
    "message": "Could you share your Grade 8 math competencies and activities?"
  }
  ```
- **Response `201 Created`:**
  - Header: `X-Idempotent-Replay: false` (or `true` on replay)
  - Body:
    ```json
    {
      "request_id": "d3b07384-d113-494b-9c8e-a9b31d02a001",
      "requester_name": "Rina Requester",
      "source_owner_name": "Olivia Owner",
      "subject_id": 5,
      "subject_name": "Mathematics",
      "source_scope_mode": "ALL_TERMS",
      "source_academic_year_id": 1,
      "source_academic_period_id": null,
      "destination_class_id": 20,
      "destination_section_name": "Newton",
      "destination_subject_id": 5,
      "destination_academic_period_id": 22,
      "destination_period_name": "Term 2",
      "status": "PENDING_OWNER",
      "message": "Could you share your Grade 8 math competencies and activities?",
      "expires_at": "2026-10-27T04:00:00Z",
      "version": 1,
      "created_at": "2026-10-20T04:00:00Z",
      "updated_at": "2026-10-20T04:00:00Z"
    }
    ```

### `GET /requests` (Implemented in PR A)
Lists requests for the caller's inbox (`box=incoming`, owner view) or outbox (`box=outgoing`, requester view).
- **Query Parameters:**
  - `box` (`incoming` | `outgoing`, required)
  - `page` (int, default 1)
  - `page_size` (int, default 25, max 100)
- **Response `200 OK`:**
  ```json
  {
    "items": [
      {
        "request_id": "d3b07384-d113-494b-9c8e-a9b31d02a001",
        "requester_name": "Rina Requester",
        "source_owner_name": "Olivia Owner",
        "subject_id": 5,
        "subject_name": "Mathematics",
        "source_scope_mode": "ALL_TERMS",
        "source_academic_year_id": 1,
        "source_academic_period_id": null,
        "destination_class_id": 20,
        "destination_section_name": "Newton",
        "destination_subject_id": 5,
        "destination_academic_period_id": 22,
        "destination_period_name": "Term 2",
        "status": "PENDING_OWNER",
        "message": "Please share prior material.",
        "expires_at": "2026-10-27T04:00:00Z",
        "version": 1,
        "created_at": "2026-10-20T04:00:00Z",
        "updated_at": "2026-10-20T04:00:00Z"
      }
    ],
    "total": 1,
    "page": 1,
    "page_size": 25,
    "badges": {
      "pending": 1,
      "package_sent": 0,
      "expired": 0
    }
  }
  ```

### `POST /requests/{request_id}/decline` (Implemented in PR A)
Owner explicitly declines an incoming pending request.
- **Body:** `{"expected_version": 1}`
- **Response `200 OK`:** Status becomes `DECLINED_BY_OWNER`, `version` incremented to 2. Repeated calls are idempotent.

---

## 6. Reconciled Contract for Backend PR B & PR C (Planned - Not Routed in PR A)

*Note: The following endpoints represent the agreed contract for subsequent pull requests. They are NOT available or routed in PR A.*

### Endpoint Classification Table
| Endpoint | Stage | Purpose |
|---|---|---|
| `GET /requests/{request_id}/eligible-materials` | Planned for PR B | Owner material picker with revision tokens |
| `POST /requests/{request_id}/package` | Planned for PR B | Owner package creation & immutable snapshot |
| `GET /requests/{request_id}/package` | Planned for PR B | Requester preview (safe titles & counts only) |
| `POST /requests/{request_id}/package-decision` | Planned for PR B | Unified requester accept/decline action |
| `POST /requests/{request_id}/accept` | Planned for PR B | (Alias) Direct accept action |
| `POST /requests/{request_id}/decline-by-requester` | Planned for PR B | (Alias) Direct decline action |
| `POST /clone-operations/self` | Planned for PR C | Teacher self-clone execution |
| `POST /my-content/clones` | Planned for PR C | (Alias) Self-clone convenience route |
| `GET /clone-operations/{operation_id}` | Planned for PR C | Clone operation polling & status |

---

### Detailed Planned Specifications

#### `GET /requests/{request_id}/eligible-materials` (Planned for PR B)
Owner picker endpoint. Returns owned materials matching request subject and scope.
- **Response `200 OK`:**
  ```json
  {
    "request_id": "d3b07384-d113-494b-9c8e-a9b31d02a001",
    "total": 3,
    "items": [
      {
        "item_type": "COMPETENCY",
        "source_entity_id": 101,
        "safe_title": "Solves quadratic equations by factoring",
        "academic_period_id": 11,
        "academic_period_name": "Term 1",
        "source_revision_token": "rev_comp_101_e3b0c442"
      },
      {
        "item_type": "LESSON",
        "source_entity_id": 204,
        "safe_title": "Lesson 1.1: Factoring Trinomials",
        "academic_period_id": 11,
        "academic_period_name": "Term 1",
        "source_revision_token": "rev_les_204_f1a2389b"
      },
      {
        "item_type": "CLASSWORK",
        "source_entity_id": 305,
        "safe_title": "Quadratic Practice Quiz",
        "academic_period_id": 11,
        "academic_period_name": "Term 1",
        "source_revision_token": "rev_cw_305_9a8c7b6d"
      }
    ]
  }
  ```
  *Each item provides `source_revision_token` for optimistic concurrency verification during packaging.*

#### `POST /requests/{request_id}/package` (Planned for PR B)
Owner submits selected items to freeze one immutable package.
- **Headers:** `Idempotency-Key: <string>`
- **Body:**
  ```json
  {
    "expected_version": 1,
    "items": [
      {
        "item_type": "COMPETENCY",
        "source_entity_id": 101,
        "source_revision_token": "rev_comp_101_e3b0c442"
      },
      {
        "item_type": "LESSON",
        "source_entity_id": 204,
        "source_revision_token": "rev_les_204_f1a2389b"
      }
    ]
  }
  ```
- **Validation:**
  - Owner must own every item.
  - Every item's `source_revision_token` must match current live source state; rejection with HTTP 409 (`SOURCE_CONTENT_CHANGED`) if any item was updated.
  - Creates immutable snapshot and stages assets.
  - Starts fresh 7-day decision window for requester.

#### `GET /requests/{request_id}/package` (Planned for PR B)
Requester package preview.
- **Response `200 OK`:**
  ```json
  {
    "package_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "request_id": "d3b07384-d113-494b-9c8e-a9b31d02a001",
    "status": "PACKAGE_SENT",
    "sent_at": "2026-10-20T04:15:00Z",
    "expires_at": "2026-10-27T04:15:00Z",
    "summary": {
      "competency_count": 1,
      "lesson_count": 1,
      "classwork_count": 0,
      "attachment_count": 2
    },
    "items": [
      {
        "item_type": "COMPETENCY",
        "safe_title": "Solves quadratic equations by factoring",
        "display_order": 1
      },
      {
        "item_type": "LESSON",
        "safe_title": "Lesson 1.1: Factoring Trinomials",
        "display_order": 2
      }
    ]
  }
  ```
  *CRITICAL PRIVACY RULE: Exposes ONLY safe titles, item types, and counts. NEVER exposes private lesson body texts, quiz questions, options, answer keys, source database IDs, or file paths.*

#### `POST /requests/{request_id}/package-decision` (Planned for PR B)
Requester accepts or declines the received package. (Aliases `POST /requests/{request_id}/accept` and `POST /requests/{request_id}/decline-by-requester` are planned for PR B).
- **Headers:** `Idempotency-Key: <string>`
- **Body (Accept):**
  ```json
  {
    "decision": "ACCEPT",
    "expected_version": 2
  }
  ```
  *Triggers independent cloning into destination. Returns `200 OK` with `ContentCloneOperationResponse`.*
- **Body (Decline):**
  ```json
  {
    "decision": "DECLINE",
    "expected_version": 2
  }
  ```
  *Transitions request status to `DECLINED_BY_REQUESTER`.*

#### `POST /clone-operations/self` (Planned for PR C)
Teacher clones their own materials from prior academic periods into an authorized destination without cross-teacher request. (Alias `POST /my-content/clones` is planned for PR C).
- **Headers:** `Idempotency-Key: <string>`
- **Body:**
  ```json
  {
    "destination_class_id": 20,
    "destination_subject_id": 5,
    "destination_academic_period_id": 22,
    "items": [
      {
        "item_type": "COMPETENCY",
        "source_entity_id": 101,
        "source_revision_token": "rev_comp_101_e3b0c442"
      }
    ]
  }
  ```
- **Response `201 Created`:**
  ```json
  {
    "operation_id": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "mode": "SELF",
    "status": "PENDING",
    "destination_class_id": 20,
    "destination_subject_id": 5,
    "destination_academic_period_id": 22,
    "summary": {
      "competency_count": 1,
      "lesson_count": 0,
      "classwork_count": 0,
      "attachment_count": 0
    },
    "error_code": null,
    "created_at": "2026-10-20T04:30:00Z",
    "completed_at": null
  }
  ```

#### `GET /clone-operations/{operation_id}` (Planned for PR C)
Monitors status of a running or completed clone operation.
- **Response `200 OK`:** Same structure as `ContentCloneOperationResponse`, reflecting current `status` (`PENDING` | `RUNNING` | `SUCCEEDED` | `FAILED`).
