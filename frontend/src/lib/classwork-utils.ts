import type { ActivityRubricLevel, CreateDraft, EditDraft, TeacherClasswork } from "@/types/classwork";

export const defaultActivityRubric: ActivityRubricLevel[] = [
  { level_name: "Excellent", points: 100, description: "Displays all required components clearly and accurately.", display_order: 0 },
  { level_name: "Good", points: 80, description: "Most components are present with minor errors.", display_order: 1 },
  { level_name: "Fair", points: 60, description: "Some required parts are missing or unclear.", display_order: 2 },
  { level_name: "Needs Improvement", points: 40, description: "Many required elements are missing.", display_order: 3 },
  { level_name: "Poor", points: 20, description: "Work is incomplete or not submitted.", display_order: 4 },
];

export function activityRubricMaximum(levels: ActivityRubricLevel[]) {
  return levels.length ? Math.max(...levels.map((level) => Number(level.points))) : 0;
}

export function validateActivityRubric(levels: ActivityRubricLevel[]) {
  if (!levels.length) return "Add at least one performance level.";
  const names = new Set<string>();
  const points = new Set<number>();
  for (const level of levels) {
    const name = level.level_name.trim().toLocaleLowerCase();
    if (!name) return "Every performance level needs a name.";
    if (!level.description.trim()) return `${level.level_name || "Each level"} needs a description.`;
    if (!Number.isFinite(Number(level.points)) || Number(level.points) < 0) return `${level.level_name} needs a non-negative point value.`;
    if (names.has(name)) return "Performance level names must be unique.";
    if (points.has(Number(level.points))) return "Performance level point values must be unique.";
    names.add(name);
    points.add(Number(level.points));
  }
  if (activityRubricMaximum(levels) <= 0) return "Maximum score must be greater than zero.";
  return "";
}

export const emptyClassworkDraft: CreateDraft = {
  subject_id: "",
  title: "",
  description: "",
  instructions: "",
  classwork_category: "WRITTEN_WORK",
  total_points: "100",
  due_date: "",
  lock_date: "",
  allow_late_submissions: false,
  max_attempts: "1",
  is_published: true,
  show_scores: true,
};

export const allowedClassworkMaterialExtensions = [".pdf", ".docx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png"];
export const maxClassworkMaterialSize = 10 * 1024 * 1024;

export function formatDate(value?: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

export function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 bytes";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function fileExtension(fileName: string) {
  const suffix = fileName.split(".").pop()?.toLowerCase();
  return suffix ? `.${suffix}` : "";
}

export function scoreBand(points: number | null | undefined, ratio: number) {
  if (!points) return "0 pts";
  return `${Math.max(1, Math.round(points * ratio))} pts`;
}

export function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

export function isQuizType(value?: string | null) {
  return value?.toUpperCase() === "QUIZ";
}

export function submissionStatusLabel(status?: string | null) {
  if (status === "graded") return "Graded";
  if (status === "late") return "Late submission";
  if (status === "submitted") return "On-time submission";
  if (status === "pending") return "Ungraded";
  if (status === "not_submitted") return "Missing";
  return "Ungraded";
}

export const classworkToEditDraft = (item: TeacherClasswork): EditDraft => ({
  // The global editor applies assignment settings to all assigned sections.
  ...(() => {
    const firstAssignment = item.assignments?.[0];
    return {
      due_date: toDateTimeLocal(firstAssignment?.due_date),
      lock_date: toDateTimeLocal(firstAssignment?.lock_date),
      allow_late_submissions: firstAssignment?.allow_late_submissions ?? false,
      max_attempts: firstAssignment?.max_attempts ? String(firstAssignment.max_attempts) : "1",
      is_published: firstAssignment?.is_published ?? item.is_published,
      show_scores: item.show_scores ?? true,
    };
  })(),
  title: item.title,
  description: item.description ?? "",
  instructions: item.instructions ?? "",
  classwork_type: item.classwork_type,
  classwork_category: item.classwork_category ?? "",
  exam_subtype: item.exam_subtype ?? "",
  total_points: item.total_points !== null && item.total_points !== undefined ? String(item.total_points) : "",
});
