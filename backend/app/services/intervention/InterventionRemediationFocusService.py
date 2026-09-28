"""Deterministic remediation focus from an Intervention's frozen trigger evidence."""

from collections import defaultdict

from app.models.intervention.Intervention import Intervention


EXAM_SUBTYPES = {"SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"}
COMPONENTS = {"WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION"}


def build_remediation_focus(row: Intervention) -> dict:
    diagnosis = row.diagnosis_snapshot if isinstance(row.diagnosis_snapshot, dict) else {}
    weakest = [value for value in diagnosis.get("weakest_supported_components", []) if value in COMPONENTS]
    component = weakest[0] if len(weakest) == 1 else None
    scored = diagnosis.get("lowest_supported_competencies") or []
    missed = [score for item in scored for score in item.get("supporting_scores", [])
              if score.get("source_type") == "QUIZ_QUESTION"
              and isinstance(score.get("score"), (int, float))
              and isinstance(score.get("possible_score"), (int, float))
              and score["possible_score"] > 0 and score["score"] < score["possible_score"]]
    if missed:
        level, evidence = "QUESTION_SCORE", missed
    else:
        measured = [item for item in scored if isinstance(item.get("percent"), (int, float))
                    and item["percent"] < 100 and item.get("supporting_scores")]
        if measured:
            lowest = min(item["percent"] for item in measured)
            level, evidence = "SCORED_COMPETENCY", [item for item in measured if item["percent"] == lowest]
        else:
            coverage = [item for item in diagnosis.get("manual_assessment_coverage", [])
                        if item.get("component") == component and item.get("in_weakest_supported_component")
                        and isinstance(item.get("percent"), (int, float)) and item["percent"] < 100]
            level, evidence = ("ACTIVITY_COVERAGE", coverage) if coverage else ("COMPONENT_ONLY", [])

    lesson_ids: set[int] = set()
    lesson_titles: dict[int, str] = {}
    competency_ids: set[int] = set()
    competency_labels: dict[int, str] = {}
    question_evidence = []
    source_ids: set[int] = set()
    if level == "QUESTION_SCORE":
        for item in evidence:
            if isinstance(item.get("lesson_id"), int):
                lesson_ids.add(item["lesson_id"])
                lesson_titles[item["lesson_id"]] = item.get("lesson_title") or ""
            if isinstance(item.get("competency_id"), int):
                competency_ids.add(item["competency_id"])
                competency_labels[item["competency_id"]] = item.get("competency_statement") or ""
            if isinstance(item.get("classwork_id"), int):
                source_ids.add(item["classwork_id"])
            question_evidence.append({"quiz_question_id": item.get("quiz_question_id"),
                                      "score": item["score"], "possible_score": item["possible_score"]})
    elif level == "SCORED_COMPETENCY":
        for item in evidence:
            competency_ids.add(item["competency_id"])
            competency_labels[item["competency_id"]] = item.get("competency_statement") or ""
            for score in item["supporting_scores"]:
                if isinstance(score.get("lesson_id"), int):
                    lesson_ids.add(score["lesson_id"])
                    lesson_titles[score["lesson_id"]] = score.get("lesson_title") or ""
                if isinstance(score.get("classwork_id"), int):
                    source_ids.add(score["classwork_id"])
    elif level == "ACTIVITY_COVERAGE":
        for item in evidence:
            source_ids.add(item["classwork_id"])
            for lesson in item.get("covered_lessons", []):
                lesson_ids.add(lesson["lesson_id"])
                lesson_titles[lesson["lesson_id"]] = lesson.get("title") or ""
            for competency in item.get("covered_competencies", []):
                competency_ids.add(competency["competency_id"])
                competency_labels[competency["competency_id"]] = competency.get("competency_statement") or ""
    elif level == "COMPONENT_ONLY" and component:
        activities = [item for item in diagnosis.get("supporting_activities", [])
                      if item.get("component") == component and isinstance(item.get("percent"), (int, float))]
        if activities:
            minimum = min(item["percent"] for item in activities)
            source_ids.update(item["classwork_id"] for item in activities
                              if item["percent"] == minimum and minimum < 100 and isinstance(item.get("classwork_id"), int))

    # An explicit subtype on the uniquely lowest scored exam activity is traceable.
    # Titles and legacy gradebook fallback labels are deliberately ignored.
    exam_subtype = None
    if component == "EXAMINATION":
        by_subtype: dict[str, list[tuple[float, float]]] = defaultdict(list)
        for item in diagnosis.get("supporting_activities", []):
            subtype = item.get("exam_subtype")
            if item.get("component") == "EXAMINATION" and subtype in EXAM_SUBTYPES:
                score, possible = item.get("score"), item.get("possible_score")
                if isinstance(score, (int, float)) and isinstance(possible, (int, float)) and possible > 0:
                    by_subtype[subtype].append((score, possible))
        percentages = {key: sum(score for score, _ in values) / sum(possible for _, possible in values)
                       for key, values in by_subtype.items()}
        if percentages:
            minimum = min(percentages.values())
            lowest = [key for key, value in percentages.items() if abs(value - minimum) < 0.000001]
            if len(lowest) == 1 and minimum < 1:
                exam_subtype = lowest[0]

    return {
        "basis": "FROZEN_TRIGGER_DIAGNOSIS",
        "evidence_level": level,
        "component": component,
        "exam_subtype": exam_subtype,
        "exam_subtype_requires_confirmation": component == "EXAMINATION" and exam_subtype is None,
        "lesson_ids": sorted(lesson_ids),
        "lessons": [{"id": key, "title": lesson_titles[key]} for key in sorted(lesson_ids)],
        "competency_ids": sorted(competency_ids),
        "competencies": [{"id": key, "label": competency_labels[key]} for key in sorted(competency_ids)],
        "topics": [],  # No separate scored topic model exists in the frozen diagnosis.
        "source_classwork_ids": sorted(source_ids),
        "question_evidence": question_evidence,
        "coverage_is_context_only": level == "ACTIVITY_COVERAGE",
    }
