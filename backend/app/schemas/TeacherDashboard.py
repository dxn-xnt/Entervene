"""Additive, nullable metrics for the teacher dashboard only."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class DashboardWarning(BaseModel):
    code: str
    message: str
    subject_id: int | None = None
    class_id: int | None = None
    assignment_id: int | None = None


class DashboardEngagementSummary(BaseModel):
    expected_count: int = Field(default=0, ge=0)
    completed_count: int | None = Field(default=0, ge=0)
    pending_grading_count: int | None = Field(default=0, ge=0)
    # Resolved rows are useful even when ambiguous attempts make totals unknown.
    resolved_completed_count: int = Field(default=0, ge=0)
    resolved_pending_grading_count: int = Field(default=0, ge=0)
    completion_rate_percent: float | None = None
    avg_score_percent: float | None = None
    scored_count: int = Field(default=0, ge=0)
    graded_task_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardTrendPoint(BaseModel):
    date_key: date
    assignment_ids: list[int]
    task_count: int = Field(ge=1)
    classwork_id: int | None = None
    title: str
    category: str = "Grouped tasks"
    due_date: str | None = None
    label: str
    short_label: str
    avg_score_percent: float | None = None
    completion_rate_percent: float | None = None
    submitted_count: int | None = Field(default=0, ge=0)
    total_enrolled: int = Field(default=0, ge=0)
    eligible_count: int = Field(default=0, ge=0)
    scored_count: int = Field(default=0, ge=0)
    graded_task_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class ThresholdResolution(BaseModel):
    subject_id: int
    grading_template_id: int | None = None
    passing_threshold: float | None = None
    warning: DashboardWarning | None = None


class DashboardGrade(BaseModel):
    student_id: str
    class_id: int
    subject_id: int
    academic_period_id: int
    current_grade: float | None = None
    warning: DashboardWarning | None = None


class GradeSummary(BaseModel):
    current_grade: float | None = None
    passing_rate_percent: float | None = None
    available_grade_count: int = 0
    total_grade_count: int = 0
    passing_count: int | None = None
    # Aggregates containing several subjects have no invented average threshold.
    passing_threshold: float | None = None
    current_grade_meets_threshold: bool | None = None
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardScopeLabel(BaseModel):
    section_name: str | None = None
    subject_name: str | None = None


class DashboardPerformerItem(BaseModel):
    student_id: str
    class_id: int
    subject_id: int
    academic_period_id: int
    name: str
    section_name: str | None = None
    subject_name: str | None = None
    current_grade: float


class DashboardPerformerSummary(BaseModel):
    items: list[DashboardPerformerItem] = Field(default_factory=list)
    limit: int = Field(default=3, ge=1)
    cutoff_tie_omitted_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardGradeBand(BaseModel):
    band: str
    count: int = Field(default=0, ge=0)
    percent: float = Field(default=0.0, ge=0.0)


class DashboardGradeDistribution(BaseModel):
    bands: list[DashboardGradeBand] = Field(default_factory=list)
    total_grade_count: int = Field(default=0, ge=0)
    available_grade_count: int = Field(default=0, ge=0)
    unavailable_grade_count: int = Field(default=0, ge=0)


class DashboardGradeDetails(BaseModel):
    total_grade_count: int = Field(ge=0)
    available_grade_count: int = Field(ge=0)
    unavailable_grade_count: int = Field(ge=0)
    grade_coverage_percent: float | None = None
    top_performer_limit: int = Field(default=3, ge=1)
    cutoff_tie_omitted_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardWindow(BaseModel):
    start_date: date
    end_date: date
    today: date
    label: str = "This month"

    @property
    def is_empty(self) -> bool:
        return self.start_date > self.end_date


class AttendanceSummary(BaseModel):
    rate: float | None = None
    record_count: int = 0
    present_count: int = 0
    late_count: int = 0
    excused_count: int = 0
    absent_count: int = 0


class LateSubmissionSummary(BaseModel):
    late_rate_percent: float | None = None
    late_count: int = 0
    eligible_count: int = 0
    excused_excluded_count: int = 0
    completed_count: int = 0
    warnings: list[DashboardWarning] = Field(default_factory=list)


class WeekdayCount(BaseModel):
    label: str
    day_index: int
    count: int = 0


class WeekdaySummary(BaseModel):
    days: list[WeekdayCount] = Field(default_factory=list)
    sunday_count: int = 0
    total_count: int = 0
    warnings: list[DashboardWarning] = Field(default_factory=list)


class TermProgress(BaseModel):
    progress_percent: float | None = None
    elapsed_days: int = 0
    total_days: int = 0
    week_number: int = 0
    total_weeks: int = 0
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardLessonPolicy(BaseModel):
    model_config = {"frozen": True}
    min_learners: int = Field(default=3, ge=1)
    min_questions: int = Field(default=3, ge=1)
    limit_per_subject: int = Field(default=5, ge=1)


class DashboardLessonPerformanceItem(BaseModel):
    lesson_id: int
    title: str
    performance_percent: float
    awarded_points: float
    possible_points: float
    scored_response_count: int
    learner_count: int
    question_count: int


class DashboardLessonCoverage(BaseModel):
    scored_mapped_response_count: int = 0
    unmapped_response_count: int = 0
    ungraded_response_count: int = 0
    invalid_response_count: int = 0
    insufficient_lesson_count: int = 0
    omitted_lesson_count: int = 0
    excluded_manual_assignment_count: int = 0


class DashboardLessonSubjectSummary(BaseModel):
    subject_id: int
    subject_name: str
    class_ids: list[int] = Field(default_factory=list)
    items: list[DashboardLessonPerformanceItem] = Field(default_factory=list)
    coverage: DashboardLessonCoverage = Field(default_factory=DashboardLessonCoverage)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardLessonPerformanceSummary(BaseModel):
    policy: DashboardLessonPolicy = Field(default_factory=DashboardLessonPolicy)
    subjects: list[DashboardLessonSubjectSummary] = Field(default_factory=list)


class DashboardSupportPolicy(BaseModel):
    model_config = {"frozen": True}
    min_overdue_tasks: int = Field(default=1, ge=1)
    min_late_submissions: int = Field(default=2, ge=1)
    min_recorded_attendance_days: int = Field(default=5, ge=1)
    min_unexcused_absence_days: int = Field(default=2, ge=1)
    limit: int = Field(default=3, ge=1)


class DashboardSupportReason(BaseModel):
    code: Literal["below_passing", "overdue_work", "unexcused_absences", "late_submissions"]
    message: str
    count: int | None = Field(default=None, ge=0)
    passing_threshold: float | None = None
    recorded_day_count: int | None = Field(default=None, ge=0)


class DashboardSupportItem(BaseModel):
    student_id: str
    class_id: int
    subject_id: int
    academic_period_id: int
    name: str
    section_name: str | None = None
    subject_name: str | None = None
    current_grade: float | None = None
    reasons: list[DashboardSupportReason]


class DashboardSupportSummary(BaseModel):
    policy: DashboardSupportPolicy = Field(default_factory=DashboardSupportPolicy)
    items: list[DashboardSupportItem] = Field(default_factory=list)
    total_entry_count: int = Field(default=0, ge=0)
    qualifying_entry_count: int = Field(default=0, ge=0)
    omitted_entry_count: int = Field(default=0, ge=0)
    unavailable_grade_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardSubmissionRateSummary(BaseModel):
    submission_rate_percent: float | None = None
    submitted_count: int | None = Field(default=0, ge=0)
    expected_count: int = Field(default=0, ge=0)
    resolved_submitted_count: int = Field(default=0, ge=0)
    late_rate_percent: float | None = None
    late_count: int = Field(default=0, ge=0)
    late_eligible_count: int = Field(default=0, ge=0)
    excused_excluded_count: int = Field(default=0, ge=0)
    eligible_assignment_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardGradingCompletionSummary(BaseModel):
    grading_completion_rate_percent: float | None = None
    finalized_count: int | None = Field(default=0, ge=0)
    auto_graded_count: int | None = Field(default=0, ge=0)
    teacher_graded_count: int | None = Field(default=0, ge=0)
    awaiting_grading_count: int | None = Field(default=0, ge=0)
    submitted_gradable_count: int | None = Field(default=0, ge=0)
    resolved_finalized_count: int = Field(default=0, ge=0)
    resolved_awaiting_grading_count: int = Field(default=0, ge=0)
    eligible_assignment_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardGradedPerformanceSummary(BaseModel):
    avg_graded_score_percent: float | None = None
    scored_submission_count: int = Field(default=0, ge=0)
    graded_assignment_count: int = Field(default=0, ge=0)
    eligible_assignment_count: int = Field(default=0, ge=0)
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardThresholdSummary(BaseModel):
    meeting_threshold_count: int | None = Field(default=None, ge=0)
    below_threshold_count: int | None = Field(default=None, ge=0)
    meeting_threshold_percent: float | None = None
    below_threshold_percent: float | None = None
    available_grade_count: int = Field(default=0, ge=0)
    total_grade_count: int = Field(default=0, ge=0)
    grade_coverage_percent: float | None = None
    uniform_passing_threshold: float | None = None
    has_mixed_thresholds: bool = False
    warnings: list[DashboardWarning] = Field(default_factory=list)


class DashboardSubjectComparisonItem(BaseModel):
    subject_id: int
    subject_name: str
    section_count: int = Field(default=0, ge=0)
    student_count: int = Field(default=0, ge=0)
    submission_rate_percent: float | None = None
    grading_completion_rate_percent: float | None = None
    avg_graded_score_percent: float | None = None
    passing_rate_percent: float | None = None
    mean_current_grade: float | None = None
    available_grade_count: int = Field(default=0, ge=0)
    total_grade_count: int = Field(default=0, ge=0)
    grade_coverage_percent: float | None = None
    passing_threshold: float | None = None


class DashboardCategoryPerformanceItem(BaseModel):
    category: str
    label: str
    assignment_count: int = Field(default=0, ge=0)
    scored_submission_count: int = Field(default=0, ge=0)
    avg_graded_score_percent: float | None = None
    grading_completion_rate_percent: float | None = None
    awaiting_grading_count: int | None = Field(default=0, ge=0)


class DashboardPracticeAssessmentSummary(BaseModel):
    published_count: int = Field(default=0, ge=0)
    attempted_count: int = Field(default=0, ge=0)
    passed_count: int = Field(default=0, ge=0)
    attempt_participation_rate_percent: float | None = None
    attempted_pass_rate_percent: float | None = None
    is_ungraded: bool = True
    excluded_from_official_grades: bool = True


class DashboardInterventionAnalytics(BaseModel):
    candidate_count: int = Field(default=0, ge=0)
    active_count: int = Field(default=0, ge=0)
    resolved_improved_count: int = Field(default=0, ge=0)
    resolved_other_count: int = Field(default=0, ge=0)
    resolved_total_count: int = Field(default=0, ge=0)
    total_count: int = Field(default=0, ge=0)
    activated_count: int = Field(default=0, ge=0)
    activation_rate_percent: float | None = None
    improved_prediction_resolution_rate_percent: float | None = None
    other_resolution_rate_percent: float | None = None
    practice_assessments: DashboardPracticeAssessmentSummary = Field(
        default_factory=DashboardPracticeAssessmentSummary
    )


class DashboardAnalyticsPayload(BaseModel):
    submission_rate: DashboardSubmissionRateSummary = Field(default_factory=DashboardSubmissionRateSummary)
    grading_completion: DashboardGradingCompletionSummary = Field(default_factory=DashboardGradingCompletionSummary)
    graded_performance: DashboardGradedPerformanceSummary = Field(default_factory=DashboardGradedPerformanceSummary)
    term_grades: GradeSummary = Field(default_factory=GradeSummary)
    threshold_summary: DashboardThresholdSummary = Field(default_factory=DashboardThresholdSummary)
    period_attendance: AttendanceSummary = Field(default_factory=AttendanceSummary)
    interventions: DashboardInterventionAnalytics = Field(default_factory=DashboardInterventionAnalytics)
    subject_comparisons: list[DashboardSubjectComparisonItem] = Field(default_factory=list)
    category_performance: list[DashboardCategoryPerformanceItem] = Field(default_factory=list)
    grade_distribution: DashboardGradeDistribution = Field(default_factory=DashboardGradeDistribution)
