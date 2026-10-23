"""Synchronous, independent content copying from verified private snapshots."""

from __future__ import annotations

import hashlib
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session, selectinload

from app.core.FileUpload import ALLOWED_EXTENSIONS, UPLOAD_BASE_DIR
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.cloning.ContentCloning import (
    ContentCloneItemMap, ContentCloneOperation, ContentSharePackage,
    ContentSharePackageAsset, ContentSharePackageItem,
)
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.services.grading.ComponentMapper import (
    classify_classwork_component, classify_template_component_name,
)
from app.services.cloning.ContentCloningErrors import ContentCloningError
from app.services.cloning.ContentCloningPackageService import (
    MAX_PACKAGE_ATTACHMENTS_BYTES, MAX_SINGLE_FILE_BYTES, _canonical_json,
)
from app.services.cloning.ContentCloningAuthorizationService import DestinationScope


DEFAULT_STAGING_ROOT = UPLOAD_BASE_DIR / "cloning_staging"
DEFAULT_SOURCE_ROOT = UPLOAD_BASE_DIR / "classworks"
DEFAULT_CLONE_ROOT = UPLOAD_BASE_DIR / "classworks" / "cloned"


@dataclass(frozen=True)
class CloneAsset:
    source_path: Path
    original_filename: str
    media_type: str | None
    byte_size: int
    checksum_sha256: str
    source_ref: str


@dataclass(frozen=True)
class CloneItem:
    item_type: str
    source_entity_id: int
    snapshot: dict[str, Any]
    snapshot_hash: str
    assets: tuple[CloneAsset, ...] = field(default_factory=tuple)


def _conflict(code: str, message: str) -> ContentCloningError:
    return ContentCloningError(status_code=409, code=code, message=message)


def safe_filename(raw: str) -> str:
    name = Path((raw or "").replace("\\", "/")).name
    if (
        not name or name in {".", ".."} or len(name) > 255
        or any(ord(character) < 32 for character in name)
    ):
        raise _conflict("CLONE_ASSET_INVALID", "An attachment has an invalid filename.")
    return name


def checksum_file(path: Path, *, limit: int = MAX_SINGLE_FILE_BYTES) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            count += len(block)
            if count > limit:
                raise _conflict("ATTACHMENT_TOO_LARGE", "An attachment exceeds the allowed size.")
            digest.update(block)
    return count, digest.hexdigest()


def _reject_symlink_ancestors(path: Path) -> None:
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise _conflict(
            "CLONE_ASSET_INVALID",
            "Cloning storage cannot contain a symbolic link.",
        )


def validate_source_path(path: Path, *, root: Path) -> Path:
    path = path.absolute()
    root = root.absolute()
    try:
        _reject_symlink_ancestors(root)
        root_real = root.resolve(strict=True)
        path_real = path.resolve(strict=True)
        if not path_real.is_relative_to(root_real) or not path_real.is_file():
            raise ValueError("outside approved storage")
        current = path
        while current != root:
            if current.is_symlink():
                raise ValueError("symlink")
            current = current.parent
            if current == current.parent and current != root:
                raise ValueError("unrelated storage")
    except (OSError, ValueError) as exc:
        raise _conflict(
            "CLONE_ASSET_INVALID", "A selected attachment is missing or outside approved storage."
        ) from exc
    return path_real


def validate_file_asset(asset: CloneAsset, *, root: Path) -> None:
    path_real = validate_source_path(asset.source_path, root=root)
    size, digest = checksum_file(path_real)
    if size != asset.byte_size or digest != asset.checksum_sha256:
        raise _conflict("CLONE_ASSET_INVALID", "A selected attachment has changed.")
    if Path(safe_filename(asset.original_filename)).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise _conflict("CLONE_ASSET_INVALID", "A selected attachment type is unsupported.")


def validate_period_mappings(
    items: list[CloneItem],
    destination_period_id: int,
    mappings: list[dict[str, int]],
    *,
    fallback_source_period_id: int | None = None,
) -> set[int]:
    source_periods = set()
    for item in items:
        period_id = item.snapshot.get("academic_period_id")
        if period_id is None:
            period_id = fallback_source_period_id
        if not isinstance(period_id, int) or isinstance(period_id, bool):
            raise _conflict(
                "SOURCE_PERIOD_UNVERIFIED",
                "The package does not contain a verifiable source term.",
            )
        source_periods.add(period_id)
    proposed = {}
    for mapping in mappings:
        source_id = mapping["source_academic_period_id"]
        if source_id in proposed:
            raise _conflict("PERIOD_MAPPING_INVALID", "A source term is mapped more than once.")
        proposed[source_id] = mapping["destination_academic_period_id"]
    if len(source_periods) > 1 and not proposed:
        raise _conflict(
            "PERIOD_MAPPING_REQUIRED",
            "Select a destination term for every selected source term.",
        )
    if proposed and (
        set(proposed) != source_periods
        or any(target != destination_period_id for target in proposed.values())
    ):
        raise _conflict("PERIOD_MAPPING_INVALID", "The source-to-destination term mapping is invalid.")
    return source_periods


def load_package_items(db: Session, package: ContentSharePackage) -> list[CloneItem]:
    rows = (
        db.query(ContentSharePackageItem)
        .options(selectinload(ContentSharePackageItem.assets))
        .filter(ContentSharePackageItem.package_id == package.package_id)
        .order_by(ContentSharePackageItem.display_order, ContentSharePackageItem.package_item_id)
        .all()
    )
    if not rows:
        raise _conflict("PACKAGE_SNAPSHOT_INVALID", "The package contains no material.")
    manifest = hashlib.sha256()
    items = []
    for row in rows:
        digest = hashlib.sha256(_canonical_json(row.private_snapshot).encode("utf-8")).hexdigest()
        if digest != row.snapshot_hash or row.item_type != row.private_snapshot.get("item_type"):
            raise _conflict("PACKAGE_SNAPSHOT_INVALID", "Package snapshot integrity check failed.")
        manifest.update(row.snapshot_hash.encode("utf-8"))
        assets = tuple(
            CloneAsset(
                source_path=Path(asset.private_staged_path).absolute(),
                original_filename=asset.original_filename,
                media_type=asset.media_type,
                byte_size=asset.byte_size,
                checksum_sha256=asset.checksum_sha256,
                source_ref=f"{row.source_entity_id}:{asset.package_asset_id}",
            )
            for asset in row.assets
        )
        items.append(CloneItem(
            item_type=row.item_type, source_entity_id=row.source_entity_id,
            snapshot=row.private_snapshot, snapshot_hash=row.snapshot_hash,
            assets=assets,
        ))
    if manifest.hexdigest() != package.manifest_hash:
        raise _conflict("PACKAGE_SNAPSHOT_INVALID", "Package manifest integrity check failed.")
    return items


def validate_clone_inputs(
    db: Session,
    *,
    destination: DestinationScope,
    items: list[CloneItem],
    asset_root: Path,
) -> None:
    subject = db.get(Subject, destination.subject_id)
    if subject is None or subject.grading_template is None:
        raise _conflict("GRADING_TEMPLATE_MISSING", "The destination subject has no grading template.")
    if subject.grading_template.status != "active":
        raise _conflict("GRADING_TEMPLATE_INACTIVE", "The destination grading template is unavailable.")
    configured_components = {
        classified
        for component in subject.grading_template.components
        if (classified := classify_template_component_name(component.component_name))
    }
    component_keys = {
        "WRITTEN_WORK": "WW", "PERFORMANCE_TASK": "PT", "ASSESSMENT": "QA",
    }
    total_bytes = 0
    for item in items:
        if item.item_type not in {"COMPETENCY", "LESSON", "CLASSWORK"}:
            raise _conflict("PACKAGE_SNAPSHOT_INVALID", "A selected material type is unsupported.")
        if item.source_entity_id != item.snapshot.get("source_entity_id"):
            raise _conflict("PACKAGE_SNAPSHOT_INVALID", "The selected material identity is inconsistent.")
        if hashlib.sha256(_canonical_json(item.snapshot).encode("utf-8")).hexdigest() != item.snapshot_hash:
            raise _conflict("PACKAGE_SNAPSHOT_INVALID", "Material snapshot integrity check failed.")
        if item.item_type == "CLASSWORK" and item.snapshot.get("is_graded"):
            if item.snapshot.get("classwork_category") not in {
                "WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMS", "QUARTERLY_ASSESSMENT"
            }:
                raise _conflict(
                    "GRADING_CATEGORY_INCOMPATIBLE",
                    "A selected graded activity has an unsupported category.",
                )
            category = classify_classwork_component(
                item.snapshot.get("classwork_type"),
                item.snapshot.get("classwork_category"),
                item.snapshot.get("exam_subtype"),
            )
            if component_keys[category.value] not in configured_components:
                raise _conflict(
                    "GRADING_CATEGORY_INCOMPATIBLE",
                    "The destination template has no matching grading component.",
                )
        for asset in item.assets:
            total_bytes += asset.byte_size
            if total_bytes > MAX_PACKAGE_ATTACHMENTS_BYTES:
                raise _conflict("PACKAGE_ATTACHMENTS_EXCEEDED", "The selected attachments exceed the package limit.")
            validate_file_asset(asset, root=asset_root)


def _record_map(
    db: Session, operation: ContentCloneOperation,
    kind: str, source_ref: str, destination_ref: int,
) -> None:
    db.add(ContentCloneItemMap(
        operation_id=operation.operation_id,
        entity_type=kind,
        source_entity_ref=source_ref,
        destination_entity_ref=str(destination_ref),
    ))


def _copy_asset(asset: CloneAsset, destination_dir: Path) -> tuple[Path, int]:
    extension = Path(safe_filename(asset.original_filename)).suffix.lower()
    destination_dir.mkdir(parents=True, exist_ok=True)
    path = destination_dir / f"{uuid.uuid4().hex}{extension}"
    digest = hashlib.sha256()
    size = 0
    with asset.source_path.open("rb") as source, path.open("xb") as destination:
        while block := source.read(1024 * 1024):
            size += len(block)
            if size > MAX_SINGLE_FILE_BYTES:
                raise _conflict("CLONE_ASSET_INVALID", "An attachment changed during copying.")
            digest.update(block)
            destination.write(block)
    if size != asset.byte_size or digest.hexdigest() != asset.checksum_sha256:
        raise _conflict("CLONE_ASSET_INVALID", "An attachment changed during copying.")
    return path, size


def clone_snapshot_graph(
    db: Session,
    *,
    items: list[CloneItem],
    destination: DestinationScope,
    actor_staff_id: str,
    operation: ContentCloneOperation,
    asset_root: Path,
    output_root: Path = DEFAULT_CLONE_ROOT,
) -> dict[str, int]:
    """Create an independent graph. Caller commits or rolls back and compensates files."""
    validate_clone_inputs(db, destination=destination, items=items, asset_root=asset_root)
    _reject_symlink_ancestors(output_root)
    operation_dir = output_root / str(operation.operation_id)
    mapping: dict[tuple[str, int], int] = {}
    counts = {
        "competency_count": 0, "lesson_count": 0,
        "classwork_count": 0, "attachment_count": 0,
    }
    ordered = sorted(items, key=lambda item: {
        "COMPETENCY": 0, "LESSON": 1, "CLASSWORK": 2
    }[item.item_type])
    for item in ordered:
        snap = item.snapshot
        source_id = item.source_entity_id
        if item.item_type == "COMPETENCY":
            copy = Competency(
                competency_code=snap.get("competency_code"),
                statement=snap["statement"],
                description=snap.get("description"),
                target_hours=snap.get("target_hours"),
                order_index=snap.get("order_index", 1),
                is_archived=False,
                subject_id=destination.subject_id,
                academic_period_id=destination.academic_period_id,
                created_by_staff_id=actor_staff_id,
            )
            db.add(copy)
            db.flush()
            mapping[("COMPETENCY", source_id)] = copy.competency_id
            _record_map(db, operation, "COMPETENCY", str(source_id), copy.competency_id)
            counts["competency_count"] += 1
        elif item.item_type == "LESSON":
            source_comp_id = snap.get("dependency_metadata", {}).get("source_competency_id")
            copy = Lesson(
                title=snap["title"], description=snap.get("description"),
                content=snap.get("content"), order_index=snap.get("order_index", 1),
                competency_id=mapping.get(("COMPETENCY", source_comp_id)),
                subject_id=destination.subject_id,
                created_by_staff_id=actor_staff_id,
                is_archived=False, is_draft=True, is_locked=True, is_published=False,
            )
            db.add(copy)
            db.flush()
            db.add(LessonAssignment(
                lesson_id=copy.lesson_id, class_id=destination.class_id,
                assigned_by_staff_id=actor_staff_id,
                publish_date=None, is_published=False,
            ))
            mapping[("LESSON", source_id)] = copy.lesson_id
            _record_map(db, operation, "LESSON", str(source_id), copy.lesson_id)
            counts["lesson_count"] += 1
        else:
            copy = Classwork(
                title=snap["title"], description=snap.get("description"),
                instructions=snap.get("instructions"),
                classwork_type=snap["classwork_type"],
                classwork_category=snap.get("classwork_category"),
                exam_subtype=snap.get("exam_subtype"),
                activity_mode=snap.get("activity_mode") or "ONLINE",
                is_graded=bool(snap.get("is_graded", True)),
                total_points=(
                    Decimal(str(snap["total_points"]))
                    if snap.get("total_points") is not None else None
                ),
                show_scores=bool(snap.get("show_scores", True)),
                is_locked=True, is_published=False, is_archived=False,
                subject_id=destination.subject_id,
                created_by_staff_id=actor_staff_id,
            )
            db.add(copy)
            db.flush()
            db.add(ClassworkAssignment(
                classwork_id=copy.classwork_id, class_id=destination.class_id,
                academic_period_id=destination.academic_period_id,
                assigned_by_staff_id=actor_staff_id,
                publish_date=None, due_date=None, lock_date=None,
                is_published=False, is_locked=True,
                recipient_student_id=None, source_intervention_id=None,
                remediation_request_id=None, original_exam_assignment_id=None,
            ))
            mapping[("CLASSWORK", source_id)] = copy.classwork_id
            _record_map(db, operation, "CLASSWORK", str(source_id), copy.classwork_id)
            for rubric in snap.get("rubric_levels") or []:
                db.add(ActivityRubricLevel(
                    classwork_id=copy.classwork_id,
                    level_name=rubric["level_name"],
                    description=rubric["description"],
                    points=Decimal(str(rubric["points"])),
                    display_order=rubric["display_order"],
                ))
            quiz_data = snap.get("quiz")
            if quiz_data:
                quiz = Quiz(
                    classwork_id=copy.classwork_id,
                    total_items=quiz_data.get("total_items", len(quiz_data.get("questions", []))),
                    duration_minutes=quiz_data.get("duration_minutes"),
                    status="DRAFT", accessible_at=None,
                )
                db.add(quiz)
                db.flush()
                _record_map(db, operation, "QUIZ", f"classwork:{source_id}", quiz.quiz_id)
                for question_data in quiz_data.get("questions", []):
                    source_lesson_id = question_data.get("source_lesson_id")
                    question = Question(
                        question_text=question_data["question_text"],
                        question_type=question_data["question_type"],
                        points=Decimal(str(question_data["points"])),
                        difficulty_level=question_data.get("difficulty_level"),
                        explanation=question_data.get("explanation"),
                        expected_answer_type=question_data.get("expected_answer_type"),
                        max_file_size_mb=question_data.get("max_file_size_mb"),
                        lesson_id=mapping.get(("LESSON", source_lesson_id)),
                        is_ai_generated=False,
                    )
                    db.add(question)
                    db.flush()
                    order = question_data["display_order"]
                    db.add(QuizQuestion(
                        quiz_id=quiz.quiz_id, question_id=question.question_id,
                        display_order=order,
                    ))
                    qref = f"classwork:{source_id}:question:{question_data.get('source_question_id', order)}"
                    _record_map(db, operation, "QUESTION", qref, question.question_id)
                    for option_data in question_data.get("options", []):
                        option = QuestionOption(
                            question_id=question.question_id,
                            option_text=option_data["option_text"],
                            is_correct=option_data["is_correct"],
                            option_order=option_data["option_order"],
                        )
                        db.add(option)
                        db.flush()
                        oref = f"{qref}:option:{option_data.get('source_option_id', option.option_order)}"
                        _record_map(db, operation, "OPTION", oref, option.option_id)
            setting_data = snap.get("quiz_setting")
            if setting_data:
                release_mode = setting_data.get("summary_release_mode", "IMMEDIATE")
                if release_mode in {"SCHEDULED", "AFTER_DUE_DATE"}:
                    release_mode = "NEVER"
                db.add(QuizSetting(
                    classwork_id=copy.classwork_id,
                    is_shuffle_questions=setting_data.get("is_shuffle_questions", False),
                    enable_per_question_scoring=setting_data.get("enable_per_question_scoring", True),
                    enable_per_question_time_limits=setting_data.get("enable_per_question_time_limits", False),
                    max_attempts=setting_data.get("max_attempts"),
                    show_correct_answers=setting_data.get("show_correct_answers", False),
                    summary_release_mode=release_mode,
                    summary_release_at=None,
                ))
            for asset in item.assets:
                copied_path, copied_size = _copy_asset(asset, operation_dir)
                attachment = ClassworkAttachment(
                    classwork_id=copy.classwork_id,
                    file_name=safe_filename(asset.original_filename),
                    file_path=str(copied_path),
                    file_type=asset.media_type,
                    file_size=copied_size,
                )
                db.add(attachment)
                db.flush()
                _record_map(db, operation, "ATTACHMENT", asset.source_ref, attachment.classwork_attachment_id)
                counts["attachment_count"] += 1
            counts["classwork_count"] += 1
    for item in ordered:
        if item.item_type != "CLASSWORK":
            continue
        copied_id = mapping[("CLASSWORK", item.source_entity_id)]
        dependencies = item.snapshot.get("dependency_metadata") or {}
        for source_lesson_id in set(dependencies.get("linked_lesson_ids") or []):
            lesson_id = mapping.get(("LESSON", source_lesson_id))
            if lesson_id is not None:
                db.add(ClassworkLesson(classwork_id=copied_id, lesson_id=lesson_id))
        for coverage in dependencies.get("active_coverage") or []:
            lesson_id = mapping.get(("LESSON", coverage.get("source_lesson_id")))
            competency_id = mapping.get(("COMPETENCY", coverage.get("source_competency_id")))
            if lesson_id is not None or competency_id is not None:
                db.add(ClassworkCoverage(
                    classwork_id=copied_id, lesson_id=lesson_id,
                    competency_id=competency_id,
                    linked_by_staff_id=actor_staff_id,
                ))
    db.flush()
    return counts


def cleanup_clone_files(operation_id: uuid.UUID, *, root: Path = DEFAULT_CLONE_ROOT) -> None:
    """Compensate only the UUID-scoped directory produced by this operation."""
    if not isinstance(operation_id, uuid.UUID):
        raise ValueError("operation ID must be a UUID")
    _reject_symlink_ancestors(root)
    target = root / str(operation_id)
    root_real = root.resolve()
    if target.resolve().parent != root_real:
        raise ValueError("clone cleanup target escaped its storage root")
    if target.exists():
        shutil.rmtree(target)


def cleanup_orphan_storage(
    db: Session,
    *,
    clone_root: Path = DEFAULT_CLONE_ROOT,
    staging_root: Path = DEFAULT_STAGING_ROOT,
    now: datetime | None = None,
    minimum_age: timedelta = timedelta(hours=24),
) -> dict[str, int]:
    """Explicit maintenance hook; never called during an active clone request.

    Only UUID directories older than the grace period and absent from committed
    package/operation rows are removed. Operators must run it during quiet time.
    """
    current = now or datetime.now(timezone.utc)
    result = {"clone_directories": 0, "staging_directories": 0}
    for root, model, column, key in (
        (clone_root, ContentCloneOperation, ContentCloneOperation.operation_id, "clone_directories"),
        (staging_root, ContentSharePackage, ContentSharePackage.package_id, "staging_directories"),
    ):
        _reject_symlink_ancestors(root)
        if not root.exists():
            continue
        candidates = []
        for path in root.iterdir():
            if not path.is_dir() or path.is_symlink():
                continue
            try:
                identifier = uuid.UUID(path.name)
            except ValueError:
                continue
            modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            if current - modified >= minimum_age:
                candidates.append((identifier, path))
        if not candidates:
            continue
        existing = {
            identifier for (identifier,) in db.query(column).filter(
                column.in_([identifier for identifier, _ in candidates])
            ).all()
        }
        for identifier, path in candidates:
            if identifier not in existing:
                if path.resolve().parent != root.resolve():
                    raise ValueError("orphan cleanup target escaped storage root")
                shutil.rmtree(path)
                result[key] += 1
    return result
