import { AttendanceApiError } from "@/lib/attendance-api";

export interface AttendancePeriodBounds {
  period?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AttendanceDateIssue {
  severity: "warning" | "error";
  message: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format a Date as a local calendar YYYY-MM-DD string (never UTC-shifted).
 */
export function getLocalIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getValidBounds(period?: AttendancePeriodBounds | null): {
  startDate: string | null;
  endDate: string | null;
  periodLabel: string;
  rangeText: string;
} {
  const startDate =
    period?.startDate && ISO_DATE_RE.test(period.startDate)
      ? period.startDate
      : null;
  const endDate =
    period?.endDate && ISO_DATE_RE.test(period.endDate) ? period.endDate : null;
  const periodLabel = period?.period?.trim() || "the selected academic period";

  let rangeText = "";
  if (startDate && endDate) {
    rangeText = `${startDate} to ${endDate}`;
  } else if (startDate) {
    rangeText = `on or after ${startDate}`;
  } else if (endDate) {
    rangeText = `on or before ${endDate}`;
  }

  return { startDate, endDate, periodLabel, rangeText };
}

/**
 * Returns true when dateValue is a valid YYYY-MM-DD date within the period's bounds.
 */
export function isDateWithinPeriod(
  dateValue: string,
  period?: AttendancePeriodBounds | null,
): boolean {
  if (!dateValue || !ISO_DATE_RE.test(dateValue)) {
    return false;
  }
  const { startDate, endDate } = getValidBounds(period);
  if (startDate && dateValue < startDate) return false;
  if (endDate && dateValue > endDate) return false;
  return true;
}

/**
 * Returns true when the period's calendar end date is strictly before referenceDate (defaults to local today).
 */
export function isPeriodEndedBeforeDate(
  period?: AttendancePeriodBounds | null,
  referenceDate: string = getLocalIsoDate(),
): boolean {
  const { endDate } = getValidBounds(period);
  return Boolean(endDate && referenceDate > endDate);
}

/**
 * Resolve the initial attendance date when an academic period loads or changes.
 * - Keeps the current date if it is already valid inside the selected period.
 * - Defaults to local today if today falls within the selected period.
 * - Returns "" when today is outside the period so we never silently preselect an old date.
 */
export function resolveInitialAttendanceDateForPeriod(
  currentDate: string,
  period?: AttendancePeriodBounds | null,
  referenceDate: string = getLocalIsoDate(),
): string {
  if (isDateWithinPeriod(currentDate, period)) {
    return currentDate;
  }
  if (isDateWithinPeriod(referenceDate, period)) {
    return referenceDate;
  }
  return "";
}

/**
 * Validate the selected attendance date against the selected academic period.
 * Distinguishes:
 * - "warning": no date selected yet (for example, today falls outside a past/ended period).
 * - "error": a selected date is malformed or outside the allowed period bounds.
 */
export function getAttendanceDateIssue(
  dateValue: string,
  period?: AttendancePeriodBounds | null,
  referenceDate: string = getLocalIsoDate(),
): AttendanceDateIssue | null {
  const { startDate, endDate, periodLabel, rangeText } = getValidBounds(period);

  if (!dateValue) {
    if ((startDate || endDate) && !isDateWithinPeriod(referenceDate, period)) {
      return {
        severity: "warning",
        message: `Today (${referenceDate}) is outside ${periodLabel} (${rangeText}). No date was preselected to prevent saving to the wrong day. Select a valid date within ${periodLabel} before saving attendance.`,
      };
    }
    return {
      severity: "warning",
      message: rangeText
        ? `Select an attendance date within ${periodLabel} (${rangeText}) before saving.`
        : "Select an attendance date before saving.",
    };
  }

  if (!ISO_DATE_RE.test(dateValue)) {
    return {
      severity: "error",
      message: "Please select a valid attendance date before saving.",
    };
  }

  if (!isDateWithinPeriod(dateValue, period)) {
    return {
      severity: "error",
      message: `Selected date (${dateValue}) is outside ${periodLabel}${rangeText ? ` (${rangeText})` : ""}. Choose a date within the selected academic period.`,
    };
  }

  return null;
}

export interface ClassifiedAttendanceSaveError {
  title: string;
  description: string;
}

/**
 * Classify attendance save errors into clear, actionable toast messages
 * distinguishing validation, authorization, conflict, not-found, and server/network failures.
 */
export function classifyAttendanceSaveError(
  err: unknown,
): ClassifiedAttendanceSaveError {
  if (err instanceof AttendanceApiError) {
    switch (err.kind) {
      case "validation":
        return {
          title: "Cannot save attendance",
          description:
            err.detail ||
            "Check the selected attendance date and student entries.",
        };
      case "authorization":
        return {
          title: "Not authorized to save attendance",
          description:
            err.detail ||
            "You do not have permission to save attendance for this class or period.",
        };
      case "conflict":
        return {
          title: "Attendance period conflict",
          description:
            err.detail ||
            "The selected attendance period could not be resolved unambiguously.",
        };
      case "not_found":
        return {
          title: "Attendance target not found",
          description:
            err.detail ||
            "The selected class or academic period was not found.",
        };
      case "server":
      default:
        return {
          title: "Server error while saving attendance",
          description: err.detail || "Please try again in a moment.",
        };
    }
  }

  const message =
    err instanceof Error && err.message.trim()
      ? err.message.trim()
      : "Unable to reach the server. Check your connection and try again.";

  return {
    title: "Unable to save attendance",
    description: message,
  };
}
