export type AllowedSubmissionClassworkType = "assignment" | "activity" | "intervention";

export interface SubmissionSubject {
  id: string | number;
  name: string;
}

export interface SubmissionClasswork {
  id: string | number;
  title: string;
  type: AllowedSubmissionClassworkType | string;
  dueDate?: string;
}

export interface SubmissionNotificationItem {
  notification_id: string;
  type: "submission";
  notification_type: "submission";
  subject: SubmissionSubject;
  classwork: SubmissionClasswork;
  submittedCount: number;
  gradedCount: number;
  totalStudents: number;
  lateCount: number;
  latestSubmissionAt: string;
  title: string;
  body: string | null;
  action_url: string | null;
  is_read: boolean;
  created_at: string | null;
  read_at: string | null;
}

export const ALLOWED_SUBMISSION_TYPES = new Set<string>([
  "assignment",
  "activity",
  "intervention",
]);

/**
 * Scope constraint:
 * Only include classwork of types: assignment, activity, intervention.
 * Exclude all other types (quizzes, exams, announcements, materials, etc.).
 */
export function isAllowedSubmissionClassworkType(type: string | undefined): boolean {
  if (!type) return false;
  return ALLOWED_SUBMISSION_TYPES.has(type.trim().toLowerCase());
}

/**
 * Format date to "MMM D, YYYY" (e.g. "Nov 23, 2026")
 */
export function formatSubmissionDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month} ${day}, ${year}`;
}

/**
 * Title template:
 * "{subject.name}: {classwork.title} - {count} new submissions"
 * Singular when count is 1 ("1 new submission").
 */
export function formatSubmissionTitle(
  subjectName: string,
  classworkTitle: string,
  count: number,
): string {
  const suffix = count === 1 ? "1 new submission" : `${count} new submissions`;
  return `${subjectName}: ${classworkTitle} - ${suffix}`;
}

/**
 * Description template:
 * "{count} new student classwork submissions needs to be graded as of {date}"
 * Singular when count is 1 ("1 new student classwork submission needs to be graded as of {date}").
 */
export function formatSubmissionDescription(count: number, dateStr: string): string {
  const formattedDate = formatSubmissionDate(dateStr);
  if (count === 1) {
    return `1 new student classwork submission needs to be graded as of ${formattedDate}`;
  }
  return `${count} new student classwork submissions needs to be graded as of ${formattedDate}`;
}

export interface IncomingSubmissionPayload {
  subject: SubmissionSubject;
  classwork: SubmissionClasswork;
  newSubmissionsCount?: number;
  submittedCount?: number;
  gradedCount?: number;
  totalStudents?: number;
  lateCount?: number;
  latestSubmissionAt: string;
}

/**
 * One notification per classwork constraint:
 * - There is exactly one submission notification per classwork. Never create duplicates.
 * - When a new student submission arrives, update the existing notification (count, date, latest submission time) instead of creating a new one.
 * - If the notification was already read and new submissions arrive, mark it unread again.
 * - When no submissions remain to be graded, it is marked resolved / excluded from the Submissions tab.
 */
export function upsertSubmissionNotification(
  currentNotifications: SubmissionNotificationItem[],
  incoming: IncomingSubmissionPayload,
): SubmissionNotificationItem[] {
  // Enforce type scope constraint: exclude non-allowed types
  if (!isAllowedSubmissionClassworkType(incoming.classwork.type)) {
    return currentNotifications;
  }

  const classworkId = String(incoming.classwork.id);
  const existingIndex = currentNotifications.findIndex(
    (n) => String(n.classwork.id) === classworkId,
  );

  if (existingIndex >= 0) {
    const existing = currentNotifications[existingIndex];
    const newSubmittedCount =
      incoming.submittedCount !== undefined
        ? incoming.submittedCount
        : existing.submittedCount + (incoming.newSubmissionsCount ?? 1);
    const newGradedCount =
      incoming.gradedCount !== undefined ? incoming.gradedCount : existing.gradedCount;
    const ungraded = Math.max(0, newSubmittedCount - newGradedCount);

    const updatedTitle = formatSubmissionTitle(
      incoming.subject.name,
      incoming.classwork.title,
      ungraded,
    );
    const updatedBody = formatSubmissionDescription(ungraded, incoming.latestSubmissionAt);

    const updatedItem: SubmissionNotificationItem = {
      ...existing,
      subject: incoming.subject,
      classwork: incoming.classwork,
      submittedCount: newSubmittedCount,
      gradedCount: newGradedCount,
      totalStudents: incoming.totalStudents ?? existing.totalStudents,
      lateCount: incoming.lateCount ?? existing.lateCount,
      latestSubmissionAt: incoming.latestSubmissionAt,
      title: updatedTitle,
      body: updatedBody,
      is_read: false, // If the notification was already read and new submissions arrive, mark it unread again
      created_at: incoming.latestSubmissionAt,
      read_at: null,
    };

    const nextList = [...currentNotifications];
    nextList[existingIndex] = updatedItem;
    return nextList;
  }

  // Create single notification for this classwork
  const submitted =
    incoming.submittedCount !== undefined
      ? incoming.submittedCount
      : incoming.newSubmissionsCount ?? 1;
  const graded = incoming.gradedCount ?? 0;
  const ungraded = Math.max(0, submitted - graded);

  const title = formatSubmissionTitle(
    incoming.subject.name,
    incoming.classwork.title,
    ungraded,
  );
  const body = formatSubmissionDescription(ungraded, incoming.latestSubmissionAt);

  const newItem: SubmissionNotificationItem = {
    notification_id: `submission-cw-${classworkId}`,
    type: "submission",
    notification_type: "submission",
    subject: incoming.subject,
    classwork: incoming.classwork,
    submittedCount: submitted,
    gradedCount: graded,
    totalStudents: incoming.totalStudents ?? 30,
    lateCount: incoming.lateCount ?? 0,
    latestSubmissionAt: incoming.latestSubmissionAt,
    title,
    body,
    action_url: `/teacher/classworks/${classworkId}`,
    is_read: false,
    created_at: incoming.latestSubmissionAt,
    read_at: null,
  };

  return [newItem, ...currentNotifications];
}

/**
 * Filter to determine whether a submission notification awaits grading:
 * - Must belong to allowed classwork types (assignment, activity, intervention)
 * - Must have ungraded submissions (submittedCount - gradedCount > 0)
 */
export function isSubmissionAwaitingGrading(item: SubmissionNotificationItem): boolean {
  if (!isAllowedSubmissionClassworkType(item.classwork.type)) return false;
  return item.submittedCount - item.gradedCount > 0;
}

/**
 * Raw mock events demonstrating:
 * 1. An assignment submission
 * 2. An activity submission with count = 1 (singular template)
 * 3. An intervention submission
 * 4. ONE EXCLUDED TYPE (quiz) to prove filtering works
 * 5. ONE CLASSWORK RECEIVING A SECOND SUBMISSION to prove the update-not-duplicate behavior
 * 6. ONE COMPLETED CLASSWORK (0 remaining to grade) to prove removal from tab
 */
export const MOCK_SUBMISSION_EVENTS: IncomingSubmissionPayload[] = [
  // 1. Initial assignment submission
  {
    subject: { id: "sub-1", name: "Mathematics 7" },
    classwork: {
      id: "cw-101",
      title: "Linear Equations Worksheet",
      type: "assignment",
      dueDate: "2026-11-22",
    },
    submittedCount: 1,
    gradedCount: 0,
    totalStudents: 30,
    lateCount: 0,
    latestSubmissionAt: "2026-11-20T10:00:00Z",
  },
  // 2. Activity submission with count = 1
  {
    subject: { id: "sub-2", name: "Science 7" },
    classwork: {
      id: "cw-102",
      title: "Plant and Animal Cells Diagram",
      type: "activity",
      dueDate: "2026-11-21",
    },
    submittedCount: 1,
    gradedCount: 0,
    totalStudents: 28,
    lateCount: 0,
    latestSubmissionAt: "2026-11-21T09:15:00Z",
  },
  // 3. Intervention classwork submission
  {
    subject: { id: "sub-3", name: "English 7" },
    classwork: {
      id: "cw-103",
      title: "Reading Comprehension Support Exercise",
      type: "intervention",
      dueDate: "2026-11-23",
    },
    submittedCount: 4,
    gradedCount: 2,
    totalStudents: 8,
    lateCount: 0,
    latestSubmissionAt: "2026-11-23T08:00:00Z",
  },
  // 4. EXCLUDED TYPE: Quiz submission (demonstrates scope filtering)
  {
    subject: { id: "sub-1", name: "Mathematics 7" },
    classwork: {
      id: "cw-104",
      title: "Midterm Assessment Quiz",
      type: "quiz",
      dueDate: "2026-11-22",
    },
    submittedCount: 5,
    gradedCount: 0,
    totalStudents: 30,
    lateCount: 0,
    latestSubmissionAt: "2026-11-22T11:00:00Z",
  },
  // 5. SECOND SUBMISSION for cw-101: updates existing notification instead of creating duplicate!
  {
    subject: { id: "sub-1", name: "Mathematics 7" },
    classwork: {
      id: "cw-101",
      title: "Linear Equations Worksheet",
      type: "assignment",
      dueDate: "2026-11-22",
    },
    submittedCount: 3,
    gradedCount: 0,
    totalStudents: 30,
    lateCount: 1,
    latestSubmissionAt: "2026-11-22T14:30:00Z",
  },
  // 6. Fully graded classwork (0 remaining to grade): excluded from tab
  {
    subject: { id: "sub-2", name: "Science 7" },
    classwork: {
      id: "cw-105",
      title: "Microscope Laboratory Report",
      type: "activity",
      dueDate: "2026-11-19",
    },
    submittedCount: 25,
    gradedCount: 25,
    totalStudents: 25,
    lateCount: 0,
    latestSubmissionAt: "2026-11-19T16:00:00Z",
  },
];

/**
 * Generate initial mock submissions using the upsert logic over MOCK_SUBMISSION_EVENTS
 */
export function generateInitialMockSubmissions(): SubmissionNotificationItem[] {
  let list: SubmissionNotificationItem[] = [];
  for (const event of MOCK_SUBMISSION_EVENTS) {
    list = upsertSubmissionNotification(list, event);
  }
  return list;
}
