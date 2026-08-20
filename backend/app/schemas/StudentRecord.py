from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class StudentRecordScope(BaseModel):
    class_id: int
    subject_id: int
    academic_year_id: int
    academic_period_id: int
    section_name: str
    subject_name: str
    period_name: str
    year_label: str


class StudentRecordRosterRow(BaseModel):
    student_id: str
    lrn: str
    full_name: str
    email: Optional[str] = None
    official_period_grade: Optional[float] = None
    running_classwork_percentage: Optional[float] = None
    completion_rate: Optional[float] = None
    submitted_count: int
    missing_count: int
    late_count: int
    ungraded_count: int


class StudentRecordRosterResponse(BaseModel):
    scope: StudentRecordScope
    students: list[StudentRecordRosterRow]


class StudentRecordProfile(BaseModel):
    student_id: str
    lrn: str
    full_name: str
    email: Optional[str] = None
    academic_level: Optional[str] = None
    section_name: str


class StudentRecordSummary(BaseModel):
    official_period_grade: Optional[float] = None
    running_classwork_percentage: Optional[float] = None
    completion_rate: Optional[float] = None
    assigned_count: int
    submitted_count: int
    missing_count: int
    late_count: int
    graded_count: int
    ungraded_count: int


class StudentClassworkResult(BaseModel):
    classwork_id: int
    assignment_id: int
    title: str
    type: str
    category: Optional[str] = None
    due_date: Optional[datetime] = None
    status: str
    score: Optional[float] = None
    total_points: Optional[float] = None
    percentage: Optional[float] = None
    submitted_at: Optional[datetime] = None
    graded_at: Optional[datetime] = None


class StudentRecordDetailResponse(BaseModel):
    student: StudentRecordProfile
    scope: StudentRecordScope
    summary: StudentRecordSummary
    classwork_results: list[StudentClassworkResult]


class StudentRecordPeriodOption(BaseModel):
    academic_year_id: int
    academic_period_id: int
    year_label: str
    period_name: str
    is_active: bool
    start_date: date
    end_date: date


class StudentRecordPeriodOptionsResponse(BaseModel):
    default_academic_period_id: Optional[int] = None
    periods: list[StudentRecordPeriodOption]


class StudentPeriodGradeFinalizeRequest(BaseModel):
    final_period_grade: Optional[float] = None
    # passing_grade is intentionally removed — resolved server-side from
    # SubjectGroup.passing_threshold via the subject FK on StudentPeriodGrade.


class StudentPeriodGradeFinalizeResponse(BaseModel):
    period_grade_id: int
    student_id: UUID
    class_id: int
    subject_id: int
    academic_period_id: int
    final_period_grade: float
    is_finalized: bool
    finalized_at: Optional[datetime] = None
    finalized_by_staff_id: Optional[str] = None
    prediction_outcomes_evaluated_count: int
    prediction_outcomes_skipped_count: int
    prediction_outcomes_message: Optional[str] = None


class ClassworkCategoryHeader(BaseModel):
    id: int
    title: str
    maxScore: float


class GradebookCategoryHeaderGroup(BaseModel):
    writtenWork: list[ClassworkCategoryHeader]
    performanceTask: list[ClassworkCategoryHeader]
    quarterlyAssessment: list[ClassworkCategoryHeader]


class StudentGradebookRow(BaseModel):
    student_id: str
    name: str
    gender: Optional[str] = None
    writtenWork: list[Optional[float]]
    performanceTask: list[Optional[float]]
    quarterlyAssessment: list[Optional[float]]
    # Per-category Percentage Scores (PS = sum_scores / max_possible * 100)
    ps_written: Optional[float] = None
    ps_performance: Optional[float] = None
    ps_quarterly: Optional[float] = None
    # DepEd computed grades
    initial_grade: Optional[float] = None
    transmuted_grade: Optional[float] = None
    total: Optional[str] = None


class StudentGradebookResponse(BaseModel):
    scope: StudentRecordScope
    classwork: list[GradebookCategoryHeaderGroup]
    studentGrades: list[StudentGradebookRow]


class TermGradeSummaryRow(BaseModel):
    student_id: str
    name: str
    gender: Optional[str] = None
    term_grades: dict[int, Optional[float]]  # {academic_period_id: grade}
    final_grade: Optional[float] = None
    remark: Optional[str] = None  # "PASSED" | "FAILED" | "INCOMPLETE"


class TermGradeSummaryScope(BaseModel):
    class_id: int
    subject_id: int
    academic_year_id: int
    section_name: str
    subject_name: str
    year_label: str


class TermPeriodInfo(BaseModel):
    academic_period_id: int
    period_name: str
    period_sequence: int


class TermGradeSummaryResponse(BaseModel):
    scope: TermGradeSummaryScope
    periods: list[TermPeriodInfo]
    students: list[TermGradeSummaryRow]
    passing_threshold: float
