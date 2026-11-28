# Entervene Video Upload Cheat Sheet

Branch: `ian_dev`. Phase 1 makes legitimate 100 MiB uploads pass through the application middleware while retaining bounded per-file, aggregate, request, and concurrency limits.

## Central limits

The backend source of truth is `backend/app/core/FileUpload.py:15-26`:

- `DOCUMENT_FILE_SIZE_LIMIT = 10 * 1024 * 1024` (10,485,760 bytes).
- `VIDEO_UPLOAD_LIMIT = 100 * 1024 * 1024` (104,857,600 bytes).
- `MAX_ATTACHMENT_COUNT = 10` files per classwork or submission.
- `MAX_AGGREGATE_ATTACHMENT_SIZE = 200 * 1024 * 1024` (209,715,200 bytes), including saved attachments.
- `MAX_ATTACHMENT_MULTIPART_REQUEST_SIZE = 210 * 1024 * 1024` (220,200,960 bytes), including multipart overhead.
- `MAX_CONCURRENT_LARGE_ATTACHMENT_UPLOADS = 4` in-flight uploads per application worker.

Matching frontend constants and user-facing messages are in `frontend/src/lib/classwork-utils.ts:70-77`. External links retain their separate existing validation and do not consume file count or aggregate bytes.

## Route-aware request limits

`RequestLimitsMiddleware` is registered in `backend/app/main.py:95`. Exact route matching is defined by `_ATTACHMENT_UPLOAD_PATHS` and `is_attachment_upload_request` in `backend/app/core/RequestLimits.py:15-23`.

Only multipart `POST` requests to these endpoints receive the 210 MiB request-body allowance:

- `POST /api/v1/classwork-assignments/with-assignments`
- `POST /api/v1/classwork-assignments/classwork/{classwork_id}/attachments`
- `POST /api/v1/submissions/assignment/{assignment_id}/submit`

The decision and enforcement are in `backend/app/core/RequestLimits.py:76-134`. AI routes remain capped at 64 KiB, and all other ordinary requests remain capped at 25 MiB. `Content-Length` is rejected early when too large, while `bounded_receive` independently counts streamed/chunked bodies when the header is absent or untrusted. Large attachment requests (over 25 MiB or without `Content-Length`) are limited to four concurrent requests per worker and return `429` with `Retry-After: 30` when saturated.

## Multipart parsing and collection validation

`AttachmentLimitedRoute` in `backend/app/core/FileUpload.py:103-114` pre-parses multipart forms with `max_files=10`. Both attachment routers use it:

- `backend/app/api/v1/routes/Classworks.py:42`
- `backend/app/api/v1/routes/Submissions.py:49`

`upload_file_size` and `validate_attachment_collection` in `backend/app/core/FileUpload.py:72-101` enforce count and aggregate bytes before file storage. Existing database attachment metadata is included when adding to an existing classwork or submission. An already-existing over-limit record can still be viewed, downloaded, or reduced because validation runs only when new files are supplied.

Service call sites:

- Classwork creation: `create_classwork_wizard_record`, `backend/app/services/classwork/ClassworkService.py:351`, validation at line 753.
- Existing classwork attachment: `add_classwork_attachment`, `backend/app/services/classwork/ClassworkService.py:1560`, cumulative validation at line 1577.
- Submission lifecycle: `submit_student_work`, `backend/app/services/submission/SubmissionService.py:439`, validation at lines 517, 528, and 555. Line 528 includes the current submission's saved attachments.

## File validation and storage

Backend validation is centralized in `backend/app/core/FileUpload.py`:

- `_file_details` at line 45 uses the supported extension to select the 10 MiB document or 100 MiB video limit.
- `_validate_mime_type` at line 59 checks MIME compatibility separately from size classification.
- `_validate_video_header` at line 65 checks WebM EBML or MP4/MOV ISO-BMFF `ftyp` signatures.
- `validate_file` at line 117 and `save_file` at line 139 enforce the exact byte boundary while reading/writing 1 MiB chunks.
- Partial files are deleted if validation or writing fails; database failures retain the existing service rollback cleanup.

Supported videos remain MP4 (`video/mp4`), WebM (`video/webm`), and MOV (`video/quicktime`). Existing PDF, DOCX, PPT/PPTX, JPG/JPEG, and PNG support remains unchanged.

Frontend classification and validation are in `frontend/src/lib/classwork-utils.ts:92-128`: `isVideoFile`, `attachmentFileSizeLimit`, `validateAttachmentFile`, and `validateAttachmentSelection`. Size selection uses the extension; MIME compatibility is then checked independently.

## Teacher upload paths

- `create-classwork.tsx:addMaterials`, `frontend/src/pages/teacher/forms/create-classwork.tsx:389`, validates all selected files as one collection before creating classwork.
- `edit-classwork.tsx:addEditMaterials`, `frontend/src/pages/teacher/forms/edit-classwork.tsx:644`, includes saved attachment count and bytes plus pending files.
- The backend endpoints are declared at `backend/app/api/v1/routes/Classworks.py:54-55` and `:211-212`.

Teacher validation messages now state the ten-file and 200 MiB combined limits. Removing existing files remains available even when old records exceed the new limits.

## Student submission paths and retry retention

- `SubmissionForm.validateAndSetFiles` and `handleSubmit` are at `frontend/src/components/submission-form.tsx:57-153`. The form clears files and links only after the returned promise resolves; rejection keeps both for retry.
- `SubjectClassworkTab.handleSubmit` is at `frontend/src/pages/student/subjects-view/tabs/subject-classwork-tab.tsx:639-672`. It now propagates backend errors instead of swallowing them, allowing `SubmissionForm` to retain state and show one inline `Alert`.
- The full-page classwork and lesson-tab handlers already propagated rejection and therefore required no Phase 1 retention change.
- The backend multipart endpoint is `backend/app/api/v1/routes/Submissions.py:57-65`.

## DATABASE_ATTACHMENT_CONSTRAINT

The bootstrap schema in `backend/migrations/bootstrap_schema.sql:603-621` and `:725-743` originally created both attachment checks with a 4 MiB ceiling:

- `CLASSWORK_ATTACHMENT_SIZE_CHECK`: `CHECK (file_size <= 4194304)`.
- `STUDENT_ATTACHMENT_SIZE_CHECK`: PostgreSQL constraint `submission_attachment_size_check`, also `CHECK (file_size <= 4194304)`.

That historical PostgreSQL DDL was not represented in the SQLAlchemy models, so the earlier SQLite endpoint tests created unconstrained attachment tables and could not reproduce the production-shaped failure.

## VIDEO_UPLOAD_MIGRATION

Migration `20261128_video_attachment_limits` is in `backend/migrations/versions/20261128_video_attachment_limits.py`. Its revision and parent are at lines 14-15; MIME and byte constants are at lines 24-26; `upgrade` is at line 62 and `downgrade` at line 74.

Both `classwork_attachment_size_check` and `submission_attachment_size_check` now enforce:

```sql
CHECK (
  file_size > 0
  AND file_size <= CASE
    WHEN LOWER(TRIM(COALESCE(file_type, ''))) IN
         ('video/mp4', 'video/webm', 'video/quicktime')
      THEN 104857600
    ELSE 10485760
  END
)
```

The matching model constraints are `ClassworkAttachment.__table_args__` in `backend/app/models/classwork/ClassworkAttachment.py:13-21` and `SubmissionAttachment.__table_args__` in `backend/app/models/submissions/SubmissionAttachment.py:9-17`.

Upgrade validates existing rows and refuses to alter invalid data. Downgrade restores the historical 4 MiB checks only if no attachment exceeds 4 MiB; otherwise it aborts transactionally without deleting, truncating, or modifying attachments.

## DATABASE_ROLLBACK_CLEANUP

- `delete_file`, `backend/app/core/FileUpload.py:177`, resolves normalized `uploads/...` paths against `UPLOAD_BASE_DIR`, so cleanup no longer depends on the process working directory.
- `ClassworkService.create_classwork_wizard_record` and `add_classwork_attachment` sanitize `IntegrityError` responses at lines 831-834 and 1584-1587.
- `SubmissionService.submit_student_work` performs the same rollback, physical cleanup, and sanitized response at lines 591-594.
- The public error is `ATTACHMENT_SAVE_ERROR` in `backend/app/core/FileUpload.py:24`; SQL statements and database details are not returned.
- Authenticated XHR converts HTTP failures into normal `Response` objects and reserves “Unable to reach the server” for status-zero network/CORS failures in `frontend/src/lib/api.ts:662-681`.
- `sqlalchemy_error_handler` in `backend/app/main.py:101-109` provides a final sanitized response for unexpected SQLAlchemy failures outside the upload-specific cleanup blocks.

The two reported failed paths, `d9a8e1e1f5664ab39b38979799556a88.mp4` and `c97ddbef02984c1bbad8ce99f1483bcc.mp4`, had no database rows and no physical files when inspected. No manual deletion was necessary.

## Playback and cleanup retained from the video feature

- Authorized range playback remains in `protected_file_response`, `backend/app/core/FileUpload.py:206`.
- Shared stored-file playback is in `frontend/src/components/attachment-display.tsx`; local preview is in `frontend/src/components/video-file-preview.tsx` and `frontend/src/components/submission-form.tsx`.
- Object URLs remain revoked on preview close/unmount.
- Existing attachment tables continue using their current path, type, name, and byte-size columns; the migration changes only their size checks.

## Endpoint-level verification

`backend/tests/test_video_upload_integration.py:60-249` exercises the real middleware and multipart endpoints. It covers:

- Actual 100 MiB teacher upload and actual 100 MiB student upload.
- A 100 MiB video plus one byte rejected.
- A 10 MiB document plus one byte rejected.
- Exactly 200 MiB cumulative bytes accepted and one byte above rejected.
- Existing attachment count and parser-level 11-file rejection.
- Ordinary requests above 25 MiB rejected.
- The route-aware 210 MiB multipart cap and unchanged 64 KiB AI cap.
- Actual student multipart submission without `Content-Length` accepted, plus streamed no-header over-limit rejection.

`frontend/src/lib/classwork-utils.video.test.ts:16-51` covers extension/MIME separation and size/count/aggregate boundaries. `frontend/src/components/submission-form.video.test.tsx:6-32` verifies failed-upload retention and retry.

Latest Phase 1 verification:

- Backend relevant suite: 27 passed (13 endpoint integration cases, 10 core/parameterized cases, and four existing rollback/authorization cases).
- Frontend focused suite: 7 passed.
- Frontend TypeScript production build: passed.
- Phase 1 changed-file ESLint: passed.
- Full repository ESLint still reports 143 pre-existing errors and 21 warnings in unrelated files/configuration.

## POSTGRESQL_VERIFICATION

`backend/tests/test_video_upload_postgres.py:228` creates a uniquely named disposable local PostgreSQL database (`entervene_video_upload_test_<uuid>`), runs the complete Alembic chain, verifies upgrade and downgrade, exercises real endpoints and persistence, and drops the database afterward. It verifies:

- Teacher classwork creation with video.
- The exact failing teacher attachment endpoint with 52,161,176 bytes.
- Exact 100 MiB teacher and student videos.
- MP4, WebM, and MOV MIME metadata.
- Video and document over-limit rejection.
- Persisted database records, physical files, authenticated range playback, sanitized forced-constraint failure, and orphan cleanup.
- Concurrent identical first submissions (reuses one `StudentSubmission` row and avoids duplicate attachments).
- Concurrent distinct first submissions with identical filename and byte size but different contents (preserves both files without discarding legitimate deliverables).
- Concurrent teacher and student 10-file attachment count boundaries and 200 MiB aggregate byte boundaries.
- Database delete failures (forced via PL/pgSQL `BEFORE DELETE` triggers on `classwork_attachment` and `submission_attachment`) preserving physical files, and post-commit physical cleanup failures returning HTTP 500 after DB commit.
- Preservation of graded remediation attempt history when a new remediation attempt is submitted.
- Successful downgrade before large files exist and transactional downgrade refusal after they exist.

The disposable PostgreSQL suite passed (`33 passed` across `test_video_upload.py`, `test_video_upload_integration.py`, and `test_video_upload_postgres.py` with `RUN_POSTGRES_VIDEO_UPLOAD_TEST=1`). The local development database `new_entervene_db` was backed up to `backend/backups/new_entervene_db_pre_video_attachment_limits_20261128.dump` and upgraded to revision `20261128_video_attachment_limits`. Its live checks match the SQL above.

## Phase 2: Concurrency, Cancellation, Rollback, and Deletion Safety

### CONCURRENT_UPLOAD & ATTACHMENT_QUOTA_LOCK

- **Classwork attachment locking**: `add_classwork_attachment` (`backend/app/services/classwork/ClassworkService.py:1627`) and `remove_classwork_attachment` (`ClassworkService.py:1708`) lock the parent `classwork` row via `SELECT ... FOR UPDATE`.
- **Submission locking**: `submit_student_work` (`backend/app/services/submission/SubmissionService.py:540`) and `assert_student_can_modify_submission` (`SubmissionService.py:488`, used by `unsubmit_student_work`, `remove_submission_attachment`, and `clear_submission_files`) lock the parent `classwork_assignment` row via `SELECT ... FOR UPDATE`, matching `_student_reading_scope`.
- **No event-loop deadlock**: Both `async def` upload handlers (`add_classwork_attachment` and `submit_student_work`) perform a fast non-locking pre-check, stream/stage incoming files to disk *before* acquiring `FOR UPDATE`, and then run `db.expire_all()`, acquire `FOR UPDATE`, re-read fresh attachment/submission rows from PostgreSQL, enforce `validate_saved_attachment_collection` (`backend/app/core/FileUpload.py:107`), and `db.commit()` with **zero `await` points** while holding the lock. This prevents synchronous SQLAlchemy lock waits from deadlocking the asyncio event loop while another coroutine holds the lock across `await save_file(...)`.
- **Lock granularity & tradeoff**: Classwork locks are per-`Classwork` row (unrelated classworks are never blocked). Submission locks are per-`ClassworkAssignment` row so concurrent first submissions (before any `StudentSubmission` row exists) are serialized; different students submitting to the same assignment contend only during the short post-upload DB commit window (milliseconds) rather than during file streaming. Classwork endpoints lock only `Classwork` and submission endpoints lock only `ClassworkAssignment`, avoiding cross-table lock cycles.

### DUPLICATE_SUBMISSION & SUBMISSION_IDEMPOTENCY

- **Replay detection**: `_is_duplicate_submission_replay` (`backend/app/services/submission/SubmissionService.py:122`) runs inside the locked critical section of `submit_student_work` for already-submitted (`submitted` / `late`) submissions. It requires exact normalized link equality AND exact sorted multiset equality of `(file_name, file_size, sha256)` using `file_sha256` (`backend/app/core/FileUpload.py:226`).
- **Deliverable safety**: Same filename and byte size with different file contents, same links with different files, same files with different links, or legitimate additional attachments are **not** treated as replays. Reordered identical attachments are recognized as replays, and the newly staged duplicate files on disk are cleaned up before returning the existing submission. If an existing stored file cannot be hashed from disk, replay detection conservatively returns `False`.
- **Remediation attempt preservation**: Graded remediation submissions bypass replay detection and create a new `StudentSubmission` row with `attempt_count = existing.attempt_count + 1`, preserving prior graded attempts.
- **Concurrency protection vs. durable idempotency (limitation)**: Content-fingerprint replay detection protects against concurrent double-submits and identical retries without requiring a database migration, but it is **not** durable request-level idempotency. True exact-once idempotency across arbitrary retries or ambiguous network failures requires a persisted client `Idempotency-Key` table (unique per student/assignment/key with response snapshot), which requires a schema migration and API contract update and is deferred pending approval.

### UPLOAD_CANCELLATION, TRANSACTION_ROLLBACK, AMBIGUOUS_COMMIT & ORPHAN_FILE_RISK

- **Stream cancellation**: `save_file` (`backend/app/core/FileUpload.py:160`) catches `asyncio.CancelledError` and `Exception`, unlinks the partial file inside a guarded `try/except` so cleanup errors never mask the original exception, rewinds the upload, and re-raises.
- **Multi-file cancellation and pre-commit failures**: `create_classwork_wizard_record` (`ClassworkService.py:401`), `add_classwork_attachment` (`ClassworkService.py:1627`), and `submit_student_work` (`SubmissionService.py:540`) track `saved_paths`, `commit_attempted`, and `committed`. Failures before `db.commit()` safely roll back via `_safe_rollback` and remove all staged files in `saved_paths` via `_safe_delete_files` without touching pre-existing attachments.
- **Ambiguous commit outcome**: If `db.commit()` raises (`commit_attempted=True, committed=False`), `_cleanup_uncommitted_classwork_files` (`ClassworkService.py:113`) and `_cleanup_uncommitted_submission_files` (`SubmissionService.py:93`) query the database to verify which paths were committed. Confirmed-uncommitted paths are deleted; committed paths are preserved. If the verification query itself fails (e.g., lost DB connection), staged files are **retained conservatively** and logged with `AMBIGUOUS_COMMIT ORPHAN_FILE_RISK` so a potentially committed attachment is never deleted.
- **Post-commit failures**: Once `committed=True`, failures during post-commit notifications or response serialization never trigger rollback file cleanup.

### FILE_DELETION & POST_COMMIT_CLEANUP

- **Post-commit deletion order**: `remove_classwork_attachment` (`ClassworkService.py:1708`), `remove_submission_attachment` (`SubmissionService.py:944`), and `clear_submission_files` (`SubmissionService.py:987`) delete the database row(s) and `db.commit()` **before** removing physical files via `delete_file` (`FileUpload.py:242`).
- **Rollback preservation**: If database deletion fails, the transaction rolls back and physical files remain untouched on disk.
- **Observable cleanup failures**: If physical file deletion returns `False` after a committed DB delete, `clear_submission_files` still attempts to delete every remaining file (no short-circuit), logs `POST_COMMIT_CLEANUP ORPHAN_FILE_RISK`, and raises HTTP 500 (`FILE_DELETION_ERROR`). Residual orphan files from ambiguous commits or post-commit unlink failures require out-of-band reconciliation rather than automatic uploads-directory sweeps.

## Phase 3: User Experience, Playback Fallback, Downloads, and Upload Cancellation

### VIDEO_ATTACHMENT_UI

- **Shared attachment cards**: `AttachmentDisplay` (`frontend/src/components/attachment-display.tsx:41`) uses a responsive stacked-to-row card layout (`flex-col sm:flex-row`), displays a `Video` badge alongside formatted file size, truncates long filenames with full `title` tooltips, and separates `Preview` (for videos) / `View` (for documents & images), `Download`, and optional `action` controls without overlap.
- **Teacher Create & Edit Classwork material cards**: `create-classwork.tsx:1259-1315` and `edit-classwork.tsx:1706-1820` replaced cramped `h-32 w-28` absolute-positioned cards with responsive `w-full sm:w-44` cards featuring a dedicated top row (`Video`/`File` badge on left, `Remove` button on right), truncated filename with `title` + `formatFileSize`, and a dedicated bottom row for `VideoFilePreview` (pending videos) or `StoredVideoPreviewButton` (saved videos in Edit Classwork).
- **Student selected file rows**: `SubmissionForm` (`frontend/src/components/submission-form.tsx:272-320`) displays a `Video` badge, `title={file.name}`, formatted file size, and non-overlapping `Preview`/`View` and `Remove` controls on mobile and desktop.

### VIDEO_PREVIEW & VIDEO_CODEC_FALLBACK

- **Stored video preview**: `AttachmentDisplay.openVideoPreview` (`frontend/src/components/attachment-display.tsx:260`) and `StoredVideoPreviewButton` (`frontend/src/components/video-file-preview.tsx:102`) render native `<video controls playsInline preload="metadata">` (no autoplay) with HTTP byte-range seeking and a metadata loading indicator.
- **Stored codec fallback**: On `<video onError>`, both components display `STORED_VIDEO_PLAYBACK_ERROR_MESSAGE` (`frontend/src/components/video-file-preview.tsx:12`): `"This video cannot be played in your browser. Download the file to open it using a compatible video player."` alongside an authorized `Download video` button directly in the fallback state and in `Dialog.Footer`.
- **Local video preview & fallback**: `VideoFilePreview` (`frontend/src/components/video-file-preview.tsx:15`) and `SubmissionForm` (`frontend/src/components/submission-form.tsx:433-453`) create temporary `URL.createObjectURL` previews, revoke object URLs on close and unmount, and on `<video onError>` display `LOCAL_VIDEO_PREVIEW_UNAVAILABLE_MESSAGE` (`frontend/src/components/video-file-preview.tsx:9`) without rejecting or removing the selected file.

### VIDEO_DOWNLOAD

- **Memory-efficient authenticated downloads**: `AttachmentDisplay.handleDownload` (`frontend/src/components/attachment-display.tsx:217`) and `StoredVideoPreviewButton.handleDownload` (`frontend/src/components/video-file-preview.tsx:134`) avoid `response.blob()` memory buffering for videos. They send a 1-byte authenticated `Range: bytes=0-0` probe via `apiFetch` (which refreshes expired HttpOnly `access_token` cookies on 401 and surfaces 403/404/500 errors inline), then trigger a native browser `<a href={resolvedDownloadUrl} download={fileName}>` download backed by the existing HttpOnly cookie auth and backend `Content-Disposition: attachment; filename*=UTF-8''...` response. No bearer token is placed in the URL, and existing document/image blob downloads remain unchanged.

### UPLOAD_PROGRESS, UPLOAD_PROCESSING_STATE, UPLOAD_CANCELLATION, UPLOAD_RETRY & UPLOAD_ERROR_HANDLING

- **XHR cancellation & error formatting**: `xhrUpload` (`frontend/src/lib/api.ts:699`) and `apiUpload` (`frontend/src/lib/api.ts:763`) accept `UploadOptions = { onProgress, signal }` (`AbortSignal`), aborting the underlying `XMLHttpRequest` cleanly and rejecting with `AbortError` (`isUploadCancelledError`, `api.ts:653`). `formatUploadErrorResponse` (`api.ts:664`) formats HTTP `429` with `Retry-After` wait times, HTTP `413`, and backend validation/error messages consistently without exposing SQL or stack traces.
- **Processing state & duplicate prevention**: `SubmissionForm` (`submission-form.tsx:118`, `376-417`), `create-classwork.tsx:1620-1695`, and `edit-classwork.tsx:1837-1869` display `"Uploading... X%"` while bytes transfer, switch to `"Processing upload on server..."` when progress reaches `100%` (preventing premature success), disable duplicate submit/save actions while pending, and expose a `Cancel upload` button.
- **Cancellation, reconciliation & retry**: Cancelling an upload distinguishes cancellation (`Alert status="warning"`) from network/server errors, retains selected files/links for retry, and reconciles server state where supported:
  - Student submissions use `hasSubmissionAdvanced` (`frontend/src/lib/classwork-utils.ts:137`) inside `onReconcileAfterCancel` (`classwork-view.tsx`, `subject-classwork-tab.tsx`, `student-classwork-detail-modal.tsx`) so a pre-existing graded remediation attempt or prior submission is never mistaken for the cancelled upload.
  - Edit Classwork (`edit-classwork.tsx:1045`, `1341-1370`) snapshots `preUploadAttachmentIds` before uploading and reconciles only *newly persisted* attachment IDs from `GET /api/v1/classwork-assignments/classwork/{id}` so pre-existing attachments with matching filenames/sizes cannot drop newly selected files.
  - Create Classwork (`create-classwork.tsx:820-825`) warns the teacher to verify the classwork list before retrying after an ambiguous cancellation.
  - Active uploads are also aborted on component unmount.
- **Phase 3 & 4 tests**: `frontend/src/components/submission-form.video.test.tsx` (5 cases), `frontend/src/components/video-attachment.phase3.test.tsx` (3 cases), and `frontend/src/lib/classwork-utils.video.test.ts` (7 cases, including `hasSubmissionAdvanced` regression checks) — all 15 Vitest tests, changed-file ESLint (0 new errors), and `npm run build` (`tsc -b && vite build`) pass. Backend `test_video_upload_integration.py` additionally verifies the 1-byte `Range: bytes=0-0` cookie-authenticated preflight (`206`, `Content-Length: 1`) and `Content-Disposition: attachment` native download response.

## Phase 4: Deployment Requirements, Limitations, and Manual Verification

- **Verified behavior**: All Phase 1 limits, Phase 2 PostgreSQL locks/cleanup/replay detection, and Phase 3 preview/fallback/1-byte-probe downloads/cancellation/reconciliation are verified across 34 backend video/Postgres tests, 99 runnable backend regression tests, and 15 frontend tests.
- **Remaining limitations & deferred enhancements**:
  - Durable request-level idempotency (`Idempotency-Key` table + migration + API header) is deferred; content-fingerprint replay detection handles concurrent identical retries without a migration.
  - Exact-size 100 MiB replay verification computes SHA-256 synchronously (~535 ms per 100 MiB file on this host); normal non-replay uploads incur 0 ms hashing.
  - Residual orphan files logged with `ORPHAN_FILE_RISK` (ambiguous DB commit or failed post-commit unlink) require out-of-band reconciliation rather than an automatic uploads-directory sweep.
  - No server-side transcoding/FFmpeg or external object storage is implemented; unsupported browser codecs rely on the verified download fallback.
  - 48 unrelated ML-backed intervention/remediation tests require gitignored `backend/data/experiments/official_target_rf_4i/evaluation_report.json` and remain unverified in this workspace.
- **Deployment requirements**:
  - Configure reverse-proxy/hosting body limit ≥ `210 MiB` (e.g., Nginx `client_max_body_size 215m;`) and upload/read timeouts ≥ 180–300s for slow 100 MiB uploads.
  - Provision writable temporary multipart storage (`/tmp` or `TMPDIR` ≥ 1 GiB per worker) and persistent shared/mounted storage for `backend/uploads/` across restarts (multi-instance deployments require shared storage or future object storage).
  - `MAX_CONCURRENT_LARGE_ATTACHMENT_UPLOADS = 4` is enforced **per application worker** (`RequestLimitsMiddleware`); total cluster concurrency scales with worker count.
  - Native `<a download>` and `<video src>` rely on HttpOnly `access_token` cookie auth (`cookie_samesite="lax"` by default in `backend/app/core/Config.py:35`); same-site deployment is required unless `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` (HTTPS) or a future short-lived download ticket is used.
  - Run `alembic upgrade head` (applying `20261128_video_attachment_limits`) after taking a local backup (`*.dump` is gitignored; consider also adding `backend/backups/` to `.gitignore` or `.git/info/exclude`).
- **Manual browser verification checklist** (not executed interactively in this automated session):
  - Teacher: Create classwork with MP4, edit classwork to add video, observe transfer + 100% processing state, cancel + retry, preview/seek/download/remove video on desktop and mobile.
  - Student: Play teacher video, submit video-only and mixed video+document+link deliverables, cancel + retry, unsubmit + resubmit, verify teacher playback of submitted video, and verify long filenames/theme contrast/codec fallback.

The default `backend/pytest_temp_dir` is ACL-locked in this workspace, so backend verification used isolated directories under the preserved `.tmp/` tree.
