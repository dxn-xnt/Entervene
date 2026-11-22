import type { NotificationItem } from "@/lib/notifications-api";

export type StudentNotificationTab = "all" | "classwork" | "study_support";
export type TeacherNotificationTab = "all" | "repost" | "interventions";
export type AdminNotificationTab = "all" | "academic" | "alerts";

const STUDENT_STUDY_SUPPORT_TYPES = new Set<NotificationItem["notification_type"]>([
  "risk_alert",
  "intervention_reviewer_available",
  "study_support_available",
  "study_support_reminder",
  "study_support_final_reminder",
]);

const STUDENT_DEADLINE_TYPES = new Set<NotificationItem["notification_type"]>([
  "classwork_due_soon",
  "classwork_due_today",
  "classwork_overdue",
]);

const STUDENT_CLASSWORK_TYPES = new Set<NotificationItem["notification_type"]>([
  "assignment_due",
  "classwork_updated",
  "deadline_changed",
  "submission_graded",
  "grade_released",
  "quiz_results_available",
]);

export function isExcludedNotification(item: Pick<NotificationItem, "notification_type">): boolean {
  return item.notification_type === "announcement";
}

export function isStudentStudySupportType(
  notificationType: NotificationItem["notification_type"],
): boolean {
  return STUDENT_STUDY_SUPPORT_TYPES.has(notificationType);
}

export function isStudentDeadlineNotification(
  notificationType: NotificationItem["notification_type"],
): boolean {
  return STUDENT_DEADLINE_TYPES.has(notificationType);
}

export function getStudentNotificationCategory(
  notificationType: NotificationItem["notification_type"],
): Exclude<StudentNotificationTab, "all"> {
  if (STUDENT_STUDY_SUPPORT_TYPES.has(notificationType)) {
    return "study_support";
  }
  if (STUDENT_CLASSWORK_TYPES.has(notificationType)) {
    return "classwork";
  }
  return "classwork";
}

export function matchesStudentNotificationTab(
  notificationType: NotificationItem["notification_type"],
  tab: StudentNotificationTab,
): boolean {
  if (tab === "all") return true;
  return getStudentNotificationCategory(notificationType) === tab;
}

export function getStudentNotificationBadgeLabel(
  notificationType: NotificationItem["notification_type"],
): string {
  const category = getStudentNotificationCategory(notificationType);
  if (category === "study_support") return "Study Support";
  if (notificationType === "quiz_results_available") return "Quiz Results Available";
  if (notificationType === "assignment_due") return "New Classwork";
  if (notificationType === "classwork_updated") return "Classwork Updated";
  if (notificationType === "deadline_changed") return "Deadline Changed";
  if (notificationType === "classwork_due_soon" || notificationType === "classwork_due_today") return "Deadline Reminder";
  if (notificationType === "classwork_overdue") return "Overdue";
  return "Classwork";
}

export function matchesTeacherNotificationTab(
  notificationType: NotificationItem["notification_type"],
  tab: TeacherNotificationTab,
): boolean {
  if (tab === "all") return true;
  if (tab === "repost") return notificationType.startsWith("repost_");
  if (tab === "interventions") {
    return notificationType === "risk_alert" || notificationType.startsWith("intervention_");
  }
  return true;
}

export function matchesAdminNotificationTab(
  notificationType: NotificationItem["notification_type"],
  tab: AdminNotificationTab,
): boolean {
  if (tab === "all") return true;
  if (tab === "academic") {
    return (
      notificationType.startsWith("grade_submission_") ||
      notificationType === "grade_released" ||
      notificationType === "submission_graded" ||
      notificationType.startsWith("classwork_") ||
      notificationType === "assignment_due" ||
      notificationType.startsWith("repost_")
    );
  }
  if (tab === "alerts") {
    return (
      notificationType === "risk_alert" ||
      notificationType.startsWith("intervention_") ||
      notificationType.startsWith("study_support_")
    );
  }
  return true;
}

export function formatNotificationTitle(title: string): string {
  const cleaned = title.trim();
  if (!cleaned) return "";

  // Collapse duplicated prefix like "Subject: Subject: Title" or "Late Submission: Math 9 - Math 9: Quiz"
  const leadPrefixMatch = cleaned.match(/^(Late Submission:\s*)(.+)$/i);
  if (leadPrefixMatch) {
    return `${leadPrefixMatch[1]}${collapseDuplicatedPrefix(leadPrefixMatch[2])}`;
  }
  return collapseDuplicatedPrefix(cleaned);
}

function collapseDuplicatedPrefix(value: string): string {
  const match = value.match(/^([^:—–-]+?)\s*[:—–-]\s*(.+)$/);
  if (!match) return value;
  const [, prefix, rest] = match;
  const trimmedPrefix = prefix.trim();
  const trimmedRest = rest.trim();
  if (!trimmedPrefix || !trimmedRest) return value;

  if (trimmedRest.toLowerCase() === trimmedPrefix.toLowerCase()) {
    return trimmedPrefix;
  }
  if (trimmedRest.toLowerCase().startsWith(trimmedPrefix.toLowerCase())) {
    const afterRepeat = trimmedRest.slice(trimmedPrefix.length).trimStart();
    if (afterRepeat && [":", "-", "–", "—"].includes(afterRepeat[0])) {
      return trimmedRest;
    }
  }
  return value;
}

export function formatNotificationBody(body: string | null | undefined): string {
  if (!body) return "";
  return body
    .replace(/\bAssigned classwork assigned by\b/gi, "Classwork assigned by")
    .replace(/\s+attached to\s+(?=•)/gi, " ")
    .replace(/\s+attached to\s*(?=\.$|$)/gi, "")
    .replace(/\s+\./g, ".")
    .trim();
}

export interface SystemSettingNotificationMeta {
  summary: string;
  changedBy?: string;
  academicYear?: string;
  changedOn?: string;
  reason?: string;
}

export function parseSystemSettingNotification(
  body: string | null | undefined,
  createdAt?: string | null,
): SystemSettingNotificationMeta {
  if (!body) {
    return {
      summary: "",
      changedOn: createdAt
        ? new Date(createdAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          })
        : undefined,
    };
  }

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  let summary = "";
  let changedBy: string | undefined;
  let academicYear: string | undefined;
  let changedOn: string | undefined;
  let reason: string | undefined;

  for (const line of lines) {
    const cleanLine = line.replace(/^[•\-*]\s*/, "");
    if (/^Changed by:\s*/i.test(cleanLine)) {
      changedBy = cleanLine.replace(/^Changed by:\s*/i, "").trim();
    } else if (/^Academic Year:\s*/i.test(cleanLine)) {
      academicYear = cleanLine.replace(/^Academic Year:\s*/i, "").trim();
    } else if (/^Changed on:\s*/i.test(cleanLine)) {
      changedOn = cleanLine.replace(/^Changed on:\s*/i, "").trim();
    } else if (/^Reason:\s*/i.test(cleanLine)) {
      reason = cleanLine.replace(/^Reason:\s*/i, "").trim();
    } else if (!summary) {
      summary = cleanLine;
    } else {
      summary += ` ${cleanLine}`;
    }
  }

  if (!changedOn && createdAt) {
    try {
      const d = new Date(createdAt);
      changedOn = d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      // ignore invalid date
    }
  }

  return { summary, changedBy, academicYear, changedOn, reason };
}
