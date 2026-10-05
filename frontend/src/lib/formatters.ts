/**
 * Shared display and formatting helper functions for the frontend.
 */

/**
 * Converts a string (including snake_case and kebab-case) into Title Case.
 * Example: "WRITTEN_WORK" -> "Written Work", "quarterly_assessment" -> "Quarterly Assessment"
 */
export function toTitleCase(str?: string | null, fallback = ""): string {
  if (!str) return fallback;
  return str
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Formats a date string or Date object into human-readable words.
 * Default format: "Month DD, YYYY" (e.g. "October 5, 2026")
 */
export function formatDate(
  dateInput?: string | Date | null,
  options: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    year: "numeric",
  },
  fallback = ""
): string {
  if (!dateInput) return fallback;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", options);
}

/**
 * Formats a date string or Date object with both date and time.
 * Default format: "Month DD, YYYY, h:mm AM/PM" (e.g. "October 5, 2026, 2:30 PM")
 */
export function formatDateTime(
  dateInput?: string | Date | null,
  options: Intl.DateTimeFormatOptions = {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
  fallback = ""
): string {
  if (!dateInput) return fallback;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-US", options);
}

/**
 * Formats a date into time only (e.g. "2:30 PM").
 */
export function formatTime(
  dateInput?: string | Date | null,
  fallback = ""
): string {
  if (!dateInput) return fallback;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return fallback;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats a date into a human-friendly relative time string.
 * Example: "Just now", "5 minutes ago", "2 hours ago", "Yesterday", "3 days ago"
 */
export function formatRelativeTime(dateInput?: string | Date | null, fallback = ""): string {
  if (!dateInput) return fallback;
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return fallback;

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 0) return formatDate(date); // future date
  if (diffInSeconds < 60) return "Just now";

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays === 1) return "Yesterday";
  if (diffInDays < 7) return `${diffInDays}d ago`;

  return formatDate(date);
}

/**
 * Formats file size in bytes to human-readable strings (e.g. "500 B", "1.2 MB").
 */
export function formatFileSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "0 B";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Truncates text with an ellipsis if it exceeds the max length.
 */
export function truncateText(text?: string | null, maxLength = 50, ellipsis = "..."): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Formats a number with comma separators (e.g. 1,000,000).
 */
export function formatNumber(num?: number | null, fallback = "0"): string {
  if (num === null || num === undefined || isNaN(num)) return fallback;
  return num.toLocaleString("en-US");
}

/**
 * Formats a percentage value (e.g. 85.5 -> "86%" or "85.5%").
 */
export function formatPercentage(value?: number | null, decimals = 0, fallback = "0%"): string {
  if (value === null || value === undefined || isNaN(value)) return fallback;
  return `${Number(value).toFixed(decimals)}%`;
}
