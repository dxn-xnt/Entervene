"""Additive, nullable metrics for the teacher dashboard only."""

from datetime import date

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
    subject_group_id: int | None = None
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


class DashboardGradeDistribution(BaseModel):
    bands: list[DashboardGradeBand] = Field(default_factory=list)
    total_grade_count: int = Field(default=0, ge=0)
    available_grade_count: int = Field(default=0, ge=0)
    unavailable_grade_count: int = Field(default=0, ge=0)


class DashboardGradeDetails(BaseModel):
    total_grade_count: int = Field(ge=0)
    available_grade_count: int = Field(ge=0)
    unavailable_grade_count: int = Field(ge=0)
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
