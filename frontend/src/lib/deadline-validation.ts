export const DEADLINE_FUTURE_ERROR =
  "The deadline must be later than the current date and time.";

/**
 * Format a Date as a local "YYYY-MM-DDTHH:mm" string suitable for DatePicker inputs.
 */
export function formatLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Return the minimum selectable local date-time string ("YYYY-MM-DDTHH:mm")
 * representing the next minute strictly after `now`.
 */
export function getMinFutureDeadlineInput(now: Date = new Date()): string {
  const nextMinute = new Date(now.getTime());
  nextMinute.setSeconds(0, 0);
  nextMinute.setMinutes(nextMinute.getMinutes() + 1);
  return formatLocalDateTimeInput(nextMinute);
}

/**
 * Parse a deadline input value ("YYYY-MM-DDTHH:mm" or ISO string) into a Date,
 * returning null when blank or invalid.
 */
export function parseDeadlineInput(value?: string | null): Date | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Validate that a newly configured deadline is strictly later than `now`.
 * Empty values are allowed so callers preserve their own required/optional rules.
 */
export function validateFutureDeadline(
  value?: string | null,
  now: Date = new Date(),
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const parsed = parseDeadlineInput(trimmed);
  if (!parsed) return DEADLINE_FUTURE_ERROR;
  if (parsed.getTime() <= now.getTime()) {
    return DEADLINE_FUTURE_ERROR;
  }
  return "";
}
