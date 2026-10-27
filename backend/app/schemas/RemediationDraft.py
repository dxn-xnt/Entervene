"""Strict validation schemas for AI-generated remediation drafts.

Defines complete, reusable contracts for Quiz/Summative and Classwork/PT
remediation activities grounded strictly in verified student weaknesses
and teacher-verified taught lessons.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.Classwork import ActivityRubricLevelInput, ClassworkCreate
from app.schemas.Quiz import QuizOptionIn, QuizQuestionIn, QuizSettingIn


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ── Option & Teacher Answer Key for Quizzes ──

class RemediationQuizOptionDraft(StrictModel):
    """Student-facing option item for multiple choice or true/false questions."""

    option_text: str = Field(min_length=1, max_length=500)
    option_order: int = Field(ge=1, le=20)


class RemediationTeacherAnswerKey(StrictModel):
    """Teacher-only answer key, explanation, and grading rationale."""

    correct_answer: str = Field(min_length=1, max_length=1000)
    explanation: str = Field(min_length=5, max_length=2000)
    scoring_guide: str | None = Field(default=None, max_length=2000)


class RemediationQuizQuestionDraft(StrictModel):
    """A targeted question in an AI remediation quiz or summative."""

    question_text: str = Field(min_length=3, max_length=2000)
    question_type: Literal["MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "SHORT_ANSWER"]
    points: float = Field(gt=0, le=100)
    display_order: int = Field(ge=1, le=100)
    difficulty_level: Literal["EASY", "MEDIUM", "HARD"] | None = None
    targeted_competency_id: int = Field(gt=0)
    targeted_lesson_id: int = Field(gt=0)
    targeted_quiz_question_id: int | None = Field(default=None, gt=0)

    # Student-facing options (for MULTIPLE_CHOICE and TRUE_FALSE)
    options: list[RemediationQuizOptionDraft] = Field(default_factory=list)

    # Teacher-only answer key and explanation (never leaked to student instructions)
    teacher_answer_key: RemediationTeacherAnswerKey

    @model_validator(mode="after")
    def validate_question_mechanics(self) -> "RemediationQuizQuestionDraft":
        q_type = self.question_type
        opts = self.options
        correct = self.teacher_answer_key.correct_answer.strip()

        if q_type == "MULTIPLE_CHOICE":
            if len(opts) < 2:
                raise ValueError("MULTIPLE_CHOICE question requires at least 2 options")
            if len(opts) > 10:
                raise ValueError("MULTIPLE_CHOICE question cannot exceed 10 options")
            orders = [o.option_order for o in opts]
            if len(orders) != len(set(orders)):
                raise ValueError("Option order numbers must be unique")
            texts = [o.option_text.casefold() for o in opts]
            if len(texts) != len(set(texts)):
                raise ValueError("Option texts must be unique")
            matched = any(o.option_text.strip().casefold() == correct.casefold() for o in opts)
            if not matched:
                raise ValueError(
                    f"Correct answer '{correct}' does not match any provided option: {[o.option_text for o in opts]}"
                )

        elif q_type == "TRUE_FALSE":
            if len(opts) != 2:
                raise ValueError("TRUE_FALSE question must provide exactly 2 options (True and False)")
            opt_texts = {o.option_text.strip().casefold() for o in opts}
            if opt_texts != {"true", "false"}:
                raise ValueError("TRUE_FALSE options must be 'True' and 'False'")
            if correct.casefold() not in {"true", "false"}:
                raise ValueError("Correct answer for TRUE_FALSE question must be 'True' or 'False'")

        elif q_type in ("IDENTIFICATION", "SHORT_ANSWER"):
            if opts:
                raise ValueError(f"{q_type} questions must not have multiple choice options")
            if not correct:
                raise ValueError(f"{q_type} question requires a non-empty correct answer")

        return self

    def to_quiz_question_in(self) -> QuizQuestionIn:
        """Convert into standard Entervene QuizQuestionIn for teacher authoring."""
        correct_text = self.teacher_answer_key.correct_answer.strip().casefold()
        options_in = [
            QuizOptionIn(
                option_text=opt.option_text,
                is_correct=(opt.option_text.strip().casefold() == correct_text),
                option_order=opt.option_order,
            )
            for opt in self.options
        ]
        # Entervene stores TRUE_FALSE using the canonical multiple-choice model.
        # Identification answer keys are stored as hidden correct options. Student
        # attempt serialization suppresses those options until an answer is given.
        question_type = "MULTIPLE_CHOICE" if self.question_type == "TRUE_FALSE" else self.question_type
        if self.question_type == "IDENTIFICATION":
            options_in = [
                QuizOptionIn(
                    option_text=self.teacher_answer_key.correct_answer.strip(),
                    is_correct=True,
                    option_order=1,
                )
            ]
        explanation_parts = [
            f"Correct answer: {self.teacher_answer_key.correct_answer.strip()}",
            f"Explanation: {self.teacher_answer_key.explanation.strip()}",
        ]
        if self.teacher_answer_key.scoring_guide:
            explanation_parts.append(f"Scoring guide: {self.teacher_answer_key.scoring_guide.strip()}")
        return QuizQuestionIn(
            question_text=self.question_text,
            question_type=question_type,
            points=self.points,
            display_order=self.display_order,
            difficulty_level=self.difficulty_level,
            explanation="\n".join(explanation_parts),
            lesson_id=self.targeted_lesson_id,
            is_ai_generated=True,
            options=options_in,
        )


# ── Tasks, Deliverables, Rubric & Teacher Guide for Classworks / PTs ──

class RemediationTaskDraft(StrictModel):
    """A distinct student task step in an AI remediation classwork/PT."""

    task_number: int = Field(ge=1, le=20)
    title: str = Field(min_length=3, max_length=200)
    instructions: str = Field(min_length=10, max_length=2000)
    targeted_competency_id: int = Field(gt=0)
    targeted_lesson_id: int = Field(gt=0)


class RemediationDeliverableDraft(StrictModel):
    """Expected student artifact / deliverable."""

    deliverable_name: str = Field(min_length=2, max_length=200)
    deliverable_type: Literal[
        "DOCUMENT", "SPREADSHEET", "PRESENTATION", "IMAGE", "PDF", "AUDIO", "VIDEO", "CODE", "WRITTEN_REPORT"
    ]
    description: str = Field(min_length=5, max_length=1000)


class RemediationRubricLevelDraft(StrictModel):
    """Performance rubric level for grading classwork/PT."""

    level_name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=5, max_length=1000)
    points: float = Field(ge=0, le=1000)
    display_order: int = Field(ge=0, le=20)


class RemediationTeacherClassworkGuide(StrictModel):
    """Teacher-only evaluation criteria and exemplar responses."""

    exemplar_or_expected_response: str = Field(min_length=10, max_length=4000)
    evaluation_notes: str = Field(min_length=5, max_length=2000)
    common_misconceptions: list[str] = Field(default_factory=list, max_length=10)


# ── Complete Draft Schemas ──

class RemediationQuizDraft(StrictModel):
    """Complete AI remediation draft for a Quiz or Summative."""

    draft_format: Literal["QUIZ"] = "QUIZ"
    target_component: Literal["WRITTEN_WORK", "EXAMINATION"]
    grade_treatment: Literal["WRITTEN_WORK", "EXAMINATION", "PRACTICE_ONLY"]
    exam_subtype: Literal["SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"] | None = None
    title: str = Field(min_length=3, max_length=255)
    instructions: str = Field(min_length=5, max_length=2000)
    total_points: float = Field(gt=0, le=1000)
    duration_minutes: int | None = Field(default=None, gt=0, le=300)
    settings: QuizSettingIn = Field(default_factory=QuizSettingIn)
    questions: list[RemediationQuizQuestionDraft] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_quiz_draft(self) -> "RemediationQuizDraft":
        calc_total = sum(q.points for q in self.questions)
        if abs(calc_total - self.total_points) > 0.001:
            raise ValueError(
                f"Sum of question points ({calc_total}) does not equal draft total_points ({self.total_points})"
            )
        orders = [q.display_order for q in self.questions]
        if len(orders) != len(set(orders)):
            raise ValueError("Question display_order numbers must be unique")
        if self.target_component == "EXAMINATION":
            if self.grade_treatment == "EXAMINATION" and not self.exam_subtype:
                raise ValueError("Graded EXAMINATION remediation requires an exam_subtype (e.g. SUMMATIVE_1)")
        elif self.exam_subtype is not None:
            raise ValueError("exam_subtype is only valid when target_component is EXAMINATION")
        return self

    def to_quiz_questions_in(self) -> list[QuizQuestionIn]:
        return [q.to_quiz_question_in() for q in self.questions]

    def to_student_view(self) -> dict[str, Any]:
        """Strip all teacher-only answer keys, explanations, and guides."""
        return {
            "draft_format": self.draft_format,
            "target_component": self.target_component,
            "grade_treatment": self.grade_treatment,
            "exam_subtype": self.exam_subtype,
            "title": self.title,
            "instructions": self.instructions,
            "total_points": self.total_points,
            "duration_minutes": self.duration_minutes,
            "questions": [
                {
                    "question_text": q.question_text,
                    "question_type": q.question_type,
                    "points": q.points,
                    "display_order": q.display_order,
                    "difficulty_level": q.difficulty_level,
                    "options": [o.model_dump() for o in q.options],
                }
                for q in self.questions
            ],
        }


SUPPORTED_UPLOAD_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
    ".txt", ".png", ".jpg", ".jpeg", ".zip", ".csv", ".mp3", ".mp4",
}


class RemediationClassworkDraft(StrictModel):
    """Complete AI remediation draft for a Classwork or Performance Task."""

    draft_format: Literal["CLASSWORK"] = "CLASSWORK"
    target_component: Literal["WRITTEN_WORK", "PERFORMANCE_TASK"]
    grade_treatment: Literal["WRITTEN_WORK", "PERFORMANCE_TASK", "PRACTICE_ONLY"]
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=5, max_length=2000)
    student_instructions: str = Field(min_length=10, max_length=4000)
    total_points: float = Field(gt=0, le=1000)
    activity_mode: Literal["ONLINE", "MANUAL"] = "ONLINE"
    tasks: list[RemediationTaskDraft] = Field(min_length=1, max_length=20)
    deliverables: list[RemediationDeliverableDraft] = Field(min_length=1, max_length=10)
    supported_upload_formats: list[str] = Field(min_length=1, max_length=15)
    rubric_levels: list[RemediationRubricLevelDraft] = Field(min_length=2, max_length=10)
    teacher_guide: RemediationTeacherClassworkGuide

    @field_validator("supported_upload_formats")
    @classmethod
    def validate_formats(cls, formats: list[str]) -> list[str]:
        cleaned = []
        for f in formats:
            norm = f.strip().lower()
            if not norm.startswith("."):
                norm = f".{norm}"
            if norm not in SUPPORTED_UPLOAD_EXTENSIONS:
                raise ValueError(
                    f"Unsupported upload format: '{f}'. Allowed: {sorted(SUPPORTED_UPLOAD_EXTENSIONS)}"
                )
            cleaned.append(norm)
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("Upload formats must be unique")
        return cleaned

    @model_validator(mode="after")
    def validate_classwork_draft(self) -> "RemediationClassworkDraft":
        task_nums = [t.task_number for t in self.tasks]
        if len(task_nums) != len(set(task_nums)):
            raise ValueError("Task numbers must be unique")

        names = [r.level_name.strip().casefold() for r in self.rubric_levels]
        if len(names) != len(set(names)):
            raise ValueError("Rubric level names must be unique")
        points = [r.points for r in self.rubric_levels]
        if len(points) != len(set(points)):
            raise ValueError("Rubric level points must be unique")
        max_rubric = max(points)
        if abs(max_rubric - self.total_points) > 0.001:
            raise ValueError(
                f"Maximum rubric points ({max_rubric}) must equal classwork total_points ({self.total_points})"
            )
        sorted_points = sorted(points, reverse=True)
        if points != sorted_points:
            raise ValueError("Rubric levels must be ordered in descending order by points")

        return self

    def to_classwork_create(self, subject_id: int) -> ClassworkCreate:
        """Convert into standard Entervene ClassworkCreate for teacher authoring."""
        rubric_inputs = [
            ActivityRubricLevelInput(
                level_name=r.level_name,
                description=r.description,
                points=r.points,
                display_order=r.display_order,
            )
            for r in self.rubric_levels
        ]
        lesson_ids = sorted({t.targeted_lesson_id for t in self.tasks})
        return ClassworkCreate(
            title=self.title,
            description=self.description,
            instructions=self.student_instructions,
            classwork_type="ACTIVITY" if self.target_component == "PERFORMANCE_TASK" else "ASSIGNMENT",
            classwork_category=self.target_component,
            activity_mode=self.activity_mode,
            is_graded=(self.grade_treatment != "PRACTICE_ONLY"),
            total_points=self.total_points,
            subject_id=subject_id,
            is_published=False,
            lesson_ids=lesson_ids,
            rubric_levels=rubric_inputs,
        )

    def to_student_view(self) -> dict[str, Any]:
        """Strip teacher guide and exemplar responses."""
        return {
            "draft_format": self.draft_format,
            "target_component": self.target_component,
            "grade_treatment": self.grade_treatment,
            "title": self.title,
            "description": self.description,
            "student_instructions": self.student_instructions,
            "total_points": self.total_points,
            "activity_mode": self.activity_mode,
            "tasks": [t.model_dump() for t in self.tasks],
            "deliverables": [d.model_dump() for d in self.deliverables],
            "supported_upload_formats": self.supported_upload_formats,
            "rubric_levels": [r.model_dump() for r in self.rubric_levels],
        }


RemediationDraft = Annotated[
    Union[RemediationQuizDraft, RemediationClassworkDraft],
    Field(discriminator="draft_format"),
]


class RemediationDraftGenerationRequest(StrictModel):
    """Teacher request parameters to generate an AI remediation draft."""

    draft_format: Literal["QUIZ", "CLASSWORK"]
    target_component: Literal["WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION"]
    grade_treatment: Literal["WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION", "PRACTICE_ONLY"]
    exam_subtype: Literal["SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"] | None = None
    item_count: int = Field(default=5, ge=1, le=20)
    total_points: float = Field(default=20.0, gt=0, le=1000)
    activity_mode: Literal["ONLINE", "MANUAL"] = "ONLINE"
    selected_lesson_ids: list[int] | None = None
    selected_competency_ids: list[int] | None = None
    selected_quiz_question_ids: list[int] | None = None
    selected_reading_ids: list[int] | None = None
    custom_teacher_instructions: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_request_compatibility(self) -> "RemediationDraftGenerationRequest":
        if self.target_component == "PERFORMANCE_TASK" and self.draft_format != "CLASSWORK":
            raise ValueError("PERFORMANCE_TASK remediation must use CLASSWORK format")
        if self.target_component == "EXAMINATION" and self.draft_format != "QUIZ":
            raise ValueError("EXAMINATION remediation must use QUIZ format")
        if self.grade_treatment != "PRACTICE_ONLY" and self.grade_treatment != self.target_component:
            raise ValueError(
                f"grade_treatment '{self.grade_treatment}' must match target_component '{self.target_component}'"
            )
        if self.target_component == "EXAMINATION":
            if self.grade_treatment == "EXAMINATION" and not self.exam_subtype:
                raise ValueError("Graded EXAMINATION remediation requires an exam_subtype (e.g. SUMMATIVE_1)")
        elif self.exam_subtype is not None:
            raise ValueError("exam_subtype is only allowed when target_component is EXAMINATION")
        return self


def parse_remediation_draft(data: dict[str, Any]) -> RemediationDraft:
    """Parse raw dictionary into typed RemediationQuizDraft or RemediationClassworkDraft."""
    if not isinstance(data, dict):
        raise ValueError("Remediation draft data must be a dictionary")
    draft_format = data.get("draft_format")
    if draft_format == "QUIZ":
        return RemediationQuizDraft.model_validate(data)
    elif draft_format == "CLASSWORK":
        return RemediationClassworkDraft.model_validate(data)
    else:
        raise ValueError(
            f"Unknown or missing draft_format '{draft_format}': must be 'QUIZ' or 'CLASSWORK'"
        )


class RemediationPublicationPreflightResult(BaseModel):
    """Result of publication preflight validation and conversion."""

    model_config = ConfigDict(extra="forbid")

    is_valid: bool = True
    draft_format: Literal["QUIZ", "CLASSWORK"]
    target_component: Literal["WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION"]
    grade_treatment: Literal["WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION", "PRACTICE_ONLY"]
    exam_subtype: Literal["SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"] | None = None
    title: str
    total_points: float
    authoritative_cap: float
    target_assignment_ids: list[int] = Field(default_factory=list)
    reading_prerequisites: list[dict[str, Any]] = Field(default_factory=list)
    authoring_payload: dict[str, Any]
    student_view: dict[str, Any]
    teacher_guide_view: dict[str, Any]
    intervention_id: int
    student_id: str
    class_id: int
    subject_id: int
    academic_period_id: int


class RemediationDraftPreflightRequest(BaseModel):
    """Preflight request containing the teacher-edited remediation draft."""

    model_config = ConfigDict(extra="allow")

    draft: dict[str, Any] | None = None
    validation_stage: Literal["SAVE_DRAFT", "PUBLICATION"] = "PUBLICATION"


class RemediationAssessmentCreateRequest(StrictModel):
    """Idempotent request to persist one teacher-reviewed remediation draft."""

    remediation_request_id: UUID
    draft: dict[str, Any]


class RemediationAssessmentCreateResult(BaseModel):
    """Non-student-facing identifiers for the newly staged assessment."""

    model_config = ConfigDict(extra="forbid")

    remediation_request_id: UUID
    intervention_id: int
    classwork_id: int
    classwork_assignment_id: int
    quiz_id: int | None = None
    draft_format: Literal["QUIZ", "CLASSWORK"]
    grade_treatment: Literal["WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION", "PRACTICE_ONLY"]
    is_published: bool = False


