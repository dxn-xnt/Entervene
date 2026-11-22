import { describe, it, expect } from "vitest";
import type {
  StudentStudyboardMetrics,
  StudentSubjectItem,
  TodoItem,
} from "@/lib/api";
import {
  computeAcademicOverview,
  computeOnTimeSummary,
  computeSubjectMastery,
  prioritizeStudyboardTasks,
} from "./studyboard-insights";

function makeSubject(overrides: Partial<StudentSubjectItem>): StudentSubjectItem {
  return {
    subject_load_id: 1,
    class_id: 10,
    subject_id: 1,
    subject_name: "Enhanced Mathematics 9",
    subject_codename: "MATH9",
    teacher_name: "Ms. Cruz",
    teacher_avatar: null,
    period_id: 101,
    period_name: "First Quarter",
    is_current_period: true,
    is_current_quarter: true,
    section_name: "Section Newton",
    year_label: "2026-2027",
    ...overrides,
  };
}

function makeTodo(overrides: Partial<TodoItem>): TodoItem {
  return {
    assignment_id: 1,
    class_id: 10,
    classwork_id: 100,
    title: "Activity",
    subject: "Enhanced Mathematics 9",
    subject_id: 1,
    due_date: null,
    deadline: "No deadline",
    type: "ASSIGNMENT",
    category: "WRITTEN_WORK",
    is_graded: true,
    total_points: 20,
    status: "pending",
    is_submitted: false,
    submission_status: null,
    grade: null,
    show_scores: true,
    allow_late_submissions: false,
    is_locked: false,
    is_actionable: true,
    ...overrides,
  };
}

describe("studyboard-insights", () => {
  const now = new Date("2026-11-23T08:00:00Z");

  it("computes per-subject released graded average accurately and excludes hidden/ungraded/missing items", () => {
    const subjects: StudentSubjectItem[] = [
      makeSubject({ subject_load_id: 1, subject_id: 1, subject_name: "Enhanced Mathematics 9" }),
      makeSubject({ subject_load_id: 2, subject_id: 2, subject_name: "Science 9" }),
      makeSubject({ subject_load_id: 3, subject_id: 3, subject_name: "English 9" }),
    ];

    const todos: TodoItem[] = [
      // Math: 14/20 + 15/20 + 15/20 = 44/60 = 73.33% -> 73% (3 released scores)
      makeTodo({ assignment_id: 1, subject_id: 1, status: "completed", is_submitted: true, submission_status: "graded", grade: 14, total_points: 20 }),
      makeTodo({ assignment_id: 2, subject_id: 1, status: "completed", is_submitted: true, submission_status: "graded", grade: 15, total_points: 20 }),
      makeTodo({ assignment_id: 3, subject_id: 1, status: "completed", is_submitted: true, submission_status: "graded", grade: 15, total_points: 20 }),
      // Missing / unsubmitted item in Math must NOT be treated as 0
      makeTodo({ assignment_id: 4, subject_id: 1, status: "pending", is_submitted: false, submission_status: null, grade: null, total_points: 20 }),
      // Hidden score in Math must be excluded
      makeTodo({ assignment_id: 5, subject_id: 1, status: "completed", is_submitted: true, submission_status: "graded", grade: 0, total_points: 20, show_scores: false }),
      // Reading item must be excluded
      makeTodo({ assignment_id: 6, subject_id: 1, type: "READING", is_graded: false, status: "completed", is_submitted: true, submission_status: "graded", grade: 20, total_points: 20 }),
      // Science: only has hidden score -> percentage must be null, gradedCount 0
      makeTodo({ assignment_id: 7, subject_id: 2, subject: "Science 9", status: "completed", is_submitted: true, submission_status: "graded", grade: 18, total_points: 20, show_scores: false }),
      // English: no todos at all -> percentage must be null, gradedCount 0
    ];

    const mastery = computeSubjectMastery(subjects, todos);
    expect(mastery.map((m) => m.subjectName)).toEqual([
      "English 9",
      "Enhanced Mathematics 9",
      "Science 9",
    ]);

    const math = mastery.find((m) => m.subjectId === 1)!;
    expect(math.percentage).toBe(73);
    expect(math.gradedCount).toBe(3);

    const science = mastery.find((m) => m.subjectId === 2)!;
    expect(science.percentage).toBeNull();
    expect(science.gradedCount).toBe(0);

    const english = mastery.find((m) => m.subjectId === 3)!;
    expect(english.percentage).toBeNull();
    expect(english.gradedCount).toBe(0);
  });

  it("does not report 0% on-time rate when 0 eligible submissions exist", () => {
    const emptyMetrics: StudentStudyboardMetrics = {
      week_start: "2026-11-23",
      attendance: [],
      attendance_rate: null,
      daily_reading_seconds: [0, 0, 0, 0, 0, 0, 0],
      subject_reading_seconds: [],
      grade_trend: [],
      on_time_count: 0,
      late_submission_count: 0,
      submitted_without_deadline_count: 2,
      quiz_correct: 0,
      quiz_wrong: 0,
    };
    const summary = computeOnTimeSummary(emptyMetrics);
    expect(summary.hasData).toBe(false);
    expect(summary.rate).toBeNull();
    expect(summary.eligibleCount).toBe(0);
    expect(summary.withoutDeadlineCount).toBe(2);
  });

  it("prioritizes actionable overdue, then due soon, then other pending and excludes closed overdue", () => {
    const todos: TodoItem[] = [
      makeTodo({ assignment_id: 1, title: "Far Pending", status: "pending", due_date: "2026-12-20T08:00:00Z" }),
      makeTodo({ assignment_id: 2, title: "Closed Overdue", status: "pastdue", due_date: "2026-11-20T08:00:00Z", allow_late_submissions: false, is_actionable: false }),
      makeTodo({ assignment_id: 3, title: "Due Tomorrow", status: "pending", due_date: "2026-11-24T08:00:00Z" }),
      makeTodo({ assignment_id: 4, title: "Actionable Overdue", status: "pastdue", due_date: "2026-11-22T08:00:00Z", allow_late_submissions: true, is_actionable: true }),
      makeTodo({ assignment_id: 5, title: "Locked Pending", status: "pending", due_date: "2026-11-24T09:00:00Z", is_locked: true, is_actionable: false }),
    ];

    const prioritized = prioritizeStudyboardTasks(todos, now);
    expect(prioritized.map((p) => `${p.bucket}:${p.item.title}`)).toEqual([
      "overdue:Actionable Overdue",
      "due_soon:Due Tomorrow",
      "pending:Far Pending",
    ]);

    const overview = computeAcademicOverview(todos, now);
    expect(overview.overdueCount).toBe(2);
    expect(overview.overdueActionableCount).toBe(1);
    expect(overview.overdueClosedCount).toBe(1);
    expect(overview.upcomingCount).toBe(2);
    expect(overview.completionRate).toBe(0);
  });

  it("caps prioritized tasks at 5 after sorting overdue actionable, due soon, and other pending", () => {
    const todos: TodoItem[] = [
      makeTodo({ assignment_id: 1, title: "Pending C", status: "pending", due_date: "2026-12-25T08:00:00Z" }),
      makeTodo({ assignment_id: 2, title: "Pending B", status: "pending", due_date: "2026-12-20T08:00:00Z" }),
      makeTodo({ assignment_id: 3, title: "Pending A", status: "pending", due_date: "2026-12-15T08:00:00Z" }),
      makeTodo({ assignment_id: 4, title: "Due Soon 2", status: "pending", due_date: "2026-11-26T08:00:00Z" }),
      makeTodo({ assignment_id: 5, title: "Due Soon 1", status: "pending", due_date: "2026-11-24T08:00:00Z" }),
      makeTodo({ assignment_id: 6, title: "Overdue 2", status: "pastdue", due_date: "2026-11-22T08:00:00Z", allow_late_submissions: true, is_actionable: true }),
      makeTodo({ assignment_id: 7, title: "Overdue 1", status: "pastdue", due_date: "2026-11-21T08:00:00Z", allow_late_submissions: true, is_actionable: true }),
    ];

    const prioritized = prioritizeStudyboardTasks(todos, now);
    expect(prioritized).toHaveLength(5);
    expect(prioritized.map((p) => `${p.bucket}:${p.item.title}`)).toEqual([
      "overdue:Overdue 1",
      "overdue:Overdue 2",
      "due_soon:Due Soon 1",
      "due_soon:Due Soon 2",
      "pending:Pending A",
    ]);

    const overview = computeAcademicOverview(todos, now);
    expect(overview.totalCount).toBe(7);
    expect(overview.overdueCount).toBe(2);
    expect(overview.pendingCount).toBe(5);
  });
});
