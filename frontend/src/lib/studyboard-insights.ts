import type {
  StudentStudyboardMetrics,
  StudentSubjectItem,
  TodoItem,
} from "@/lib/api";
import {
  deduplicateClassworkInputs,
  isEligibleGradedAssessment,
} from "@/lib/student-lesson-mastery";

export interface AcademicOverviewSummary {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  overdueCount: number;
  overdueActionableCount: number;
  overdueClosedCount: number;
  upcomingCount: number;
  nextDeadlineItem: TodoItem | null;
  completionRate: number | null;
}

export type PriorityBucket = "overdue" | "due_soon" | "pending";

export interface PrioritizedTaskItem {
  item: TodoItem;
  bucket: PriorityBucket;
  isActionable: boolean;
  isLocked: boolean;
}

export interface SubjectMasteryItem {
  subjectLoadId: number;
  classId: number;
  subjectId: number;
  subjectName: string;
  teacherName: string;
  percentage: number | null;
  gradedCount: number;
  earnedPoints: number;
  possiblePoints: number;
}

export interface OnTimeSummary {
  onTimeCount: number;
  lateCount: number;
  eligibleCount: number;
  withoutDeadlineCount: number;
  rate: number | null;
  hasData: boolean;
}

const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isCompleted(item: TodoItem): boolean {
  return Boolean(item.is_submitted || item.status === "completed");
}

function parseDueMs(item: TodoItem): number | null {
  if (!item.due_date) return null;
  const ms = new Date(item.due_date).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isItemActionable(item: TodoItem): boolean {
  if (typeof item.is_actionable === "boolean") return item.is_actionable;
  if (isCompleted(item)) return false;
  if (item.is_locked) return false;
  if (item.status === "pastdue" && item.allow_late_submissions === false) {
    return false;
  }
  return true;
}

/**
 * Compute Student Study Board overview metrics with explicit, non-overlapping
 * definitions. Completion rate is strictly completed / total published activities.
 */
export function computeAcademicOverview(
  todos: TodoItem[],
  now: Date = new Date(),
): AcademicOverviewSummary {
  const nowMs = now.getTime();
  const upcomingCutoffMs = nowMs + UPCOMING_WINDOW_MS;

  let completedCount = 0;
  let overdueCount = 0;
  let overdueActionableCount = 0;
  let overdueClosedCount = 0;
  let pendingCount = 0;
  let upcomingCount = 0;
  let nextDeadlineItem: TodoItem | null = null;
  let nextDeadlineMs = Number.POSITIVE_INFINITY;

  for (const item of todos) {
    if (isCompleted(item)) {
      completedCount += 1;
      continue;
    }

    if (item.status === "pastdue") {
      overdueCount += 1;
      if (isItemActionable(item)) {
        overdueActionableCount += 1;
      } else {
        overdueClosedCount += 1;
      }
      continue;
    }

    pendingCount += 1;
    const dueMs = parseDueMs(item);
    if (dueMs !== null && dueMs > nowMs) {
      if (dueMs <= upcomingCutoffMs) {
        upcomingCount += 1;
      }
      if (dueMs < nextDeadlineMs) {
        nextDeadlineMs = dueMs;
        nextDeadlineItem = item;
      }
    }
  }

  const totalCount = todos.length;
  return {
    totalCount,
    completedCount,
    pendingCount,
    overdueCount,
    overdueActionableCount,
    overdueClosedCount,
    upcomingCount,
    nextDeadlineItem,
    completionRate:
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : null,
  };
}

/**
 * Prioritize unsubmitted work into:
 * 1. Actionable overdue activities (earliest deadline first)
 * 2. Upcoming deadlines within 7 days (soonest first)
 * 3. Other pending activities (by due date, then title)
 *
 * Non-actionable past-due items (locked or late submissions disallowed) are
 * excluded from the primary action queue.
 */
export function prioritizeStudyboardTasks(
  todos: TodoItem[],
  now: Date = new Date(),
  limit = 5,
): PrioritizedTaskItem[] {
  const nowMs = now.getTime();
  const upcomingCutoffMs = nowMs + UPCOMING_WINDOW_MS;

  const overdueActionable: PrioritizedTaskItem[] = [];
  const dueSoon: PrioritizedTaskItem[] = [];
  const otherPending: PrioritizedTaskItem[] = [];

  for (const item of todos) {
    if (isCompleted(item)) continue;
    const actionable = isItemActionable(item);
    const locked = Boolean(item.is_locked);

    if (item.status === "pastdue") {
      if (actionable) {
        overdueActionable.push({
          item,
          bucket: "overdue",
          isActionable: true,
          isLocked: locked,
        });
      }
      continue;
    }

    if (locked) continue;

    const dueMs = parseDueMs(item);
    if (dueMs !== null && dueMs > nowMs && dueMs <= upcomingCutoffMs) {
      dueSoon.push({
        item,
        bucket: "due_soon",
        isActionable: actionable,
        isLocked: locked,
      });
    } else {
      otherPending.push({
        item,
        bucket: "pending",
        isActionable: actionable,
        isLocked: locked,
      });
    }
  }

  const sortByDueAsc = (a: PrioritizedTaskItem, b: PrioritizedTaskItem) => {
    const dueA = parseDueMs(a.item) ?? Number.MAX_SAFE_INTEGER;
    const dueB = parseDueMs(b.item) ?? Number.MAX_SAFE_INTEGER;
    if (dueA !== dueB) return dueA - dueB;
    return a.item.title.localeCompare(b.item.title);
  };

  overdueActionable.sort(sortByDueAsc);
  dueSoon.sort(sortByDueAsc);
  otherPending.sort(sortByDueAsc);

  return [...overdueActionable, ...dueSoon, ...otherPending].slice(0, limit);
}

/**
 * Compute per-subject released performance for every enrolled subject using the
 * same authoritative eligibility rules as `computeLessonMastery` in
 * `student-lesson-mastery.ts`:
 * - Non-reading, graded assessments with positive `total_points`
 * - `show_scores !== false` (excludes unreleased / hidden results)
 * - `submission_status === "graded"` with a finite non-negative numeric `grade`
 * - Deduplicated by `assignment_id`
 * - Missing scores are never treated as zero (`percentage` is `null` when no
 *   released graded records exist).
 */
export function computeSubjectMastery(
  subjects: StudentSubjectItem[],
  todos: TodoItem[],
): SubjectMasteryItem[] {
  const uniqueTodos = deduplicateClassworkInputs(todos);

  return [...subjects]
    .sort((a, b) => a.subject_name.localeCompare(b.subject_name))
    .map((subject) => {
      const subjectItems = uniqueTodos.filter((item) => {
        const todo = item as TodoItem;
        if (todo.subject_id !== subject.subject_id) return false;
        if (todo.class_id && subject.class_id && todo.class_id !== subject.class_id) {
          return false;
        }
        return true;
      });

      const eligible = subjectItems.filter(isEligibleGradedAssessment);
      const earnedPoints = eligible.reduce(
        (sum, item) => sum + Number(item.grade),
        0,
      );
      const possiblePoints = eligible.reduce(
        (sum, item) => sum + Number(item.total_points),
        0,
      );
      const percentage =
        eligible.length > 0 && possiblePoints > 0
          ? Math.min(100, Math.max(0, Math.round((earnedPoints / possiblePoints) * 100)))
          : null;

      return {
        subjectLoadId: subject.subject_load_id,
        classId: subject.class_id,
        subjectId: subject.subject_id,
        subjectName: subject.subject_name,
        teacherName: subject.teacher_name,
        percentage,
        gradedCount: eligible.length,
        earnedPoints,
        possiblePoints,
      };
    });
}

/**
 * Compute On-Time Submissions summary without misleading 0% when 0 eligible
 * submissions with deadlines exist.
 */
export function computeOnTimeSummary(
  metrics: StudentStudyboardMetrics | null | undefined,
): OnTimeSummary {
  const onTimeCount = metrics?.on_time_count ?? 0;
  const lateCount = metrics?.late_submission_count ?? 0;
  const eligibleCount = onTimeCount + lateCount;
  const withoutDeadlineCount = metrics?.submitted_without_deadline_count ?? 0;
  return {
    onTimeCount,
    lateCount,
    eligibleCount,
    withoutDeadlineCount,
    rate: eligibleCount > 0 ? Math.round((onTimeCount / eligibleCount) * 100) : null,
    hasData: eligibleCount > 0,
  };
}
