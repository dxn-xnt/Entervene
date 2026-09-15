from __future__ import annotations

import re
from enum import Enum


class CanonicalGradingComponent(str, Enum):
    WRITTEN_WORK = "WRITTEN_WORK"
    PERFORMANCE_TASK = "PERFORMANCE_TASK"
    ASSESSMENT = "ASSESSMENT"


ASSESSMENT_CATEGORY_TOKENS = {
    "EXAM",
    "EXAMS",
    "EXAMINATION",
    "EXAMINATIONS",
    "PERIODICAL_EXAM",
    "PERIODICAL_ASSESSMENT",
    "PERIODIC_EXAM",
    "PERIODIC_ASSESSMENT",
    "QUARTERLY_ASSESSMENT",
    "QUARTERLY_EXAM",
    "QUARTER_EXAM",
    "SUMMATIVE",
    "SUMMATIVE_1",
    "SUMMATIVE_2",
    "TERM_EXAM",
}

WRITTEN_WORK_CATEGORY_TOKENS = {
    "WRITTEN_WORK",
    "WRITTEN_WORKS",
    "SEATWORK",
    "SEATWORKS",
    "QUIZ",
    "QUIZZES",
    "ASSIGNMENT",
    "ASSIGNMENTS",
}

PERFORMANCE_TASK_CATEGORY_TOKENS = {
    "PERFORMANCE_TASK",
    "PERFORMANCE_TASKS",
    "PERFORMANCE",
    "PROJECT",
    "PROJECTS",
    "ACTIVITY",
    "ACTIVITIES",
}

EXAM_SUBTYPES = {"SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"}


def normalize_component_token(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]+", "_", (value or "").upper()).strip("_")


def classify_classwork_component(
    classwork_type: str | None,
    classwork_category: str | None,
    exam_subtype: str | None = None,
) -> CanonicalGradingComponent:
    subtype = normalize_component_token(exam_subtype)
    if subtype in EXAM_SUBTYPES:
        return CanonicalGradingComponent.ASSESSMENT

    category = normalize_component_token(classwork_category)
    if category in ASSESSMENT_CATEGORY_TOKENS:
        return CanonicalGradingComponent.ASSESSMENT
    if category in WRITTEN_WORK_CATEGORY_TOKENS:
        return CanonicalGradingComponent.WRITTEN_WORK
    if category in PERFORMANCE_TASK_CATEGORY_TOKENS:
        return CanonicalGradingComponent.PERFORMANCE_TASK

    type_token = normalize_component_token(classwork_type)
    if type_token in {"EXAM", "PERIODICAL_EXAM", "QUARTERLY_EXAM", "SUMMATIVE"}:
        return CanonicalGradingComponent.ASSESSMENT
    if type_token in {"ACTIVITY", "PROJECT"}:
        return CanonicalGradingComponent.PERFORMANCE_TASK
    return CanonicalGradingComponent.WRITTEN_WORK


def to_legacy_prediction_component(component: CanonicalGradingComponent) -> str:
    if component == CanonicalGradingComponent.ASSESSMENT:
        return "QUARTERLY_ASSESSMENT"
    return component.value


def classify_template_component_name(name: str | None) -> str | None:
    raw = (name or "").strip()
    if not raw:
        return None
    normalized = raw.upper().replace("-", " ").replace("_", " ")
    words = set(re.findall(r"\b[A-Z0-9]+\b", normalized))

    has_exam_signal = (
        bool(words.intersection({"EXAM", "EXAMS", "EXAMINATION", "EXAMINATIONS", "PERIODIC", "PERIODICAL", "QA", "MIDTERM", "SUMMATIVE"}))
        or "QUARTERLY" in normalized
    )
    has_term_assessment = (
        "TERM ASSESSMENT" in normalized
        or "TERM EXAM" in normalized
        or "QUARTERLY ASSESSMENT" in normalized
    )
    has_quiz = bool(words.intersection({"QUIZ", "QUIZZES"}))
    if has_quiz and not bool(words.intersection({"EXAM", "EXAMS", "EXAMINATION", "EXAMINATIONS", "MIDTERM"})):
        return "WW"
    if has_exam_signal or has_term_assessment:
        return "QA"
    if "TERM" in words:
        if bool(words.intersection({"PROJECT", "PROJECTS", "PERFORMANCE", "TASK", "TASKS", "PORTFOLIO", "PORTFOLIOS", "PRODUCT", "PRACTICUM"})):
            return "PT"
        return "QA"
    if bool(words.intersection({"PERFORMANCE", "PERFORMANCES", "PROJECT", "PROJECTS", "ACTIVITY", "ACTIVITIES", "PT", "PRODUCT", "PRODUCTS", "TASK", "TASKS", "PORTFOLIO", "PORTFOLIOS", "DEMONSTRATION", "DEMONSTRATIONS", "PRACTICUM"})):
        return "PT"
    if bool(words.intersection({"WRITTEN", "SEATWORK", "SEATWORKS", "QUIZ", "QUIZZES", "WW", "WORK", "WORKS", "ASSIGNMENT", "ASSIGNMENTS", "EXERCISE", "EXERCISES", "MODULE", "MODULES"})):
        return "WW"
    return None

