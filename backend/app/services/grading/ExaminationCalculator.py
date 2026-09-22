from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


EXAM_SUBTYPE_SUMMATIVE_1 = "SUMMATIVE_1"
EXAM_SUBTYPE_SUMMATIVE_2 = "SUMMATIVE_2"
EXAM_SUBTYPE_TERM_EXAM = "TERM_EXAM"
EXAM_SUBTYPES = (
    EXAM_SUBTYPE_SUMMATIVE_1,
    EXAM_SUBTYPE_SUMMATIVE_2,
    EXAM_SUBTYPE_TERM_EXAM,
)


@dataclass(frozen=True)
class ExamSubsplitWeights:
    sum1_weight: float = 0.30
    sum2_weight: float = 0.30
    term_weight: float = 0.40

    def by_subtype(self) -> dict[str, float]:
        return {
            EXAM_SUBTYPE_SUMMATIVE_1: self.sum1_weight,
            EXAM_SUBTYPE_SUMMATIVE_2: self.sum2_weight,
            EXAM_SUBTYPE_TERM_EXAM: self.term_weight,
        }


DEFAULT_EXAM_SUBSPLIT = ExamSubsplitWeights()


@dataclass(frozen=True)
class ExaminationObservation:
    score: float | None
    possible: float | None
    exam_subtype: str | None = None
    title: str | None = None
    category: str | None = None
    unresolved: bool = False
    administered: bool = True


@dataclass(frozen=True)
class ExaminationComponentResult:
    examination_percent: float | None
    subtype_percentages: dict[str, float | None]
    subtype_has_evidence: dict[str, bool]
    missing_subtypes: set[str]
    unresolved_subtypes: set[str]
    administered_subtypes: set[str]
    complete: bool
    active_weight: float
    warnings: list[dict[str, Any]] = field(default_factory=list)
    score_over_hps_count: int = 0


def _upper(value: Any) -> str:
    return str(value or "").upper().strip()


def categorize_exam_subtype(
    exam_subtype: str | None = None,
    title: str | None = None,
    category: str | None = None,
) -> str:
    subtype = _upper(exam_subtype)
    if subtype in EXAM_SUBTYPES:
        return subtype

    title_text = _upper(title)
    category_text = _upper(category)
    combined = f"{title_text} {category_text}"

    if any(key in combined for key in ("SUMMATIVE 1", "SUMMATIVE_1", "SUMMATIVE ASSESSMENT 1", "SUMMATIVE TEST 1", "SUMMATIVE-1")):
        return EXAM_SUBTYPE_SUMMATIVE_1
    if any(key in combined for key in ("SUMMATIVE 2", "SUMMATIVE_2", "SUMMATIVE ASSESSMENT 2", "SUMMATIVE TEST 2", "SUMMATIVE-2")):
        return EXAM_SUBTYPE_SUMMATIVE_2
    if any(key in combined for key in ("TERM EXAM", "PERIODICAL EXAM", "QUARTERLY EXAM", "QUARTER EXAM", "TERM_EXAM", "PERIODICAL_EXAM", "FINAL EXAM")):
        return EXAM_SUBTYPE_TERM_EXAM
    return "UNSPECIFIED_EXAM"


def _percent(observations: list[ExaminationObservation]) -> tuple[float | None, int]:
    possible = 0.0
    earned = 0.0
    valid_count = 0
    over_hps_count = 0
    for observation in observations:
        if observation.unresolved or not observation.administered:
            continue
        if observation.possible is None or observation.possible <= 0:
            continue
        if observation.score is None:
            continue
        score = float(observation.score)
        hps = float(observation.possible)
        earned += score
        possible += hps
        valid_count += 1
        if score > hps:
            over_hps_count += 1
    if possible <= 0 or valid_count == 0:
        return None, over_hps_count
    return round((earned / possible) * 100.0, 2), over_hps_count


def compute_examination_component(
    observations: list[ExaminationObservation],
    *,
    subsplit: ExamSubsplitWeights = DEFAULT_EXAM_SUBSPLIT,
    require_complete_for_percent: bool = False,
) -> ExaminationComponentResult:
    grouped = {subtype: [] for subtype in EXAM_SUBTYPES}
    unspecified: list[ExaminationObservation] = []
    administered_subtypes: set[str] = set()
    unresolved_subtypes: set[str] = set()

    for observation in observations:
        subtype = categorize_exam_subtype(observation.exam_subtype, observation.title, observation.category)
        if subtype not in grouped:
            unspecified.append(observation)
            continue
        grouped[subtype].append(observation)
        if observation.administered:
            administered_subtypes.add(subtype)
        if observation.unresolved:
            unresolved_subtypes.add(subtype)

    # Preserve the gradebook's historical fallback: unresolved labels are placed
    # chronologically into ST1, ST2, then Term Exam when no explicit subtype exists.
    for observation in unspecified:
        title = _upper(observation.title)
        if "SUMMATIVE" in title:
            subtype = EXAM_SUBTYPE_SUMMATIVE_1 if not grouped[EXAM_SUBTYPE_SUMMATIVE_1] else EXAM_SUBTYPE_SUMMATIVE_2
        elif any(key in title for key in ("EXAM", "PERIODIC", "QUARTER", "TERM")):
            subtype = EXAM_SUBTYPE_TERM_EXAM
        elif not grouped[EXAM_SUBTYPE_SUMMATIVE_1]:
            subtype = EXAM_SUBTYPE_SUMMATIVE_1
        elif not grouped[EXAM_SUBTYPE_SUMMATIVE_2]:
            subtype = EXAM_SUBTYPE_SUMMATIVE_2
        else:
            subtype = EXAM_SUBTYPE_TERM_EXAM
        grouped[subtype].append(observation)
        if observation.administered:
            administered_subtypes.add(subtype)
        if observation.unresolved:
            unresolved_subtypes.add(subtype)

    subtype_percentages: dict[str, float | None] = {}
    subtype_has_evidence: dict[str, bool] = {}
    missing_subtypes: set[str] = set()
    score_over_hps_count = 0
    for subtype, items in grouped.items():
        percent, over_hps = _percent(items)
        subtype_percentages[subtype] = percent
        subtype_has_evidence[subtype] = percent is not None
        score_over_hps_count += over_hps
        if items and percent is None and subtype not in unresolved_subtypes:
            missing_subtypes.add(subtype)

    complete = all(subtype_has_evidence[subtype] for subtype in EXAM_SUBTYPES)
    warnings: list[dict[str, Any]] = []
    if any(subtype_has_evidence.values()) and not complete:
        warnings.append({
            "code": "QA_PARTIAL_COMPONENTS_AVAILABLE",
            "message": "Some Examination subparts have evidence, but the full ST1/ST2/Term Exam set is not complete.",
        })
    if unresolved_subtypes:
        warnings.append({
            "code": "QA_UNRESOLVED_COMPONENTS",
            "subtypes": sorted(unresolved_subtypes),
            "message": "Some Examination subparts have unresolved evidence.",
        })

    if require_complete_for_percent and not complete:
        return ExaminationComponentResult(
            examination_percent=None,
            subtype_percentages=subtype_percentages,
            subtype_has_evidence=subtype_has_evidence,
            missing_subtypes=missing_subtypes,
            unresolved_subtypes=unresolved_subtypes,
            administered_subtypes=administered_subtypes,
            complete=False,
            active_weight=0.0,
            warnings=warnings,
            score_over_hps_count=score_over_hps_count,
        )

    active_weight = 0.0
    weighted_sum = 0.0
    for subtype, weight in subsplit.by_subtype().items():
        percent = subtype_percentages[subtype]
        if percent is not None:
            active_weight += weight
            weighted_sum += percent * weight

    examination_percent = None
    if active_weight > 0:
        examination_percent = round(weighted_sum / active_weight, 2)

    return ExaminationComponentResult(
        examination_percent=examination_percent,
        subtype_percentages=subtype_percentages,
        subtype_has_evidence=subtype_has_evidence,
        missing_subtypes=missing_subtypes,
        unresolved_subtypes=unresolved_subtypes,
        administered_subtypes=administered_subtypes,
        complete=complete,
        active_weight=active_weight,
        warnings=warnings,
        score_over_hps_count=score_over_hps_count,
    )
