import type { ActivityRubricLevel, CreateDraft, EditDraft, TeacherClasswork, TrackingStudent } from "@/types/classwork";
import { formatLocalDateTimeInput } from "@/lib/deadline-validation";

export type SubmissionStatusFilter = "all" | "on_time" | "late" | "missing";
export type GradingStatusFilter = "all" | "graded" | "not_graded";

type StructuredStudentName = {
  student_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
};

export function formatStudentRosterName(student: StructuredStudentName) {
  const firstName = student.first_name?.trim();
  const lastName = student.last_name?.trim();
  if (!firstName || !lastName) return student.student_name?.trim() || "Student";
  const middleInitial = student.middle_name?.trim().charAt(0).toUpperCase();
  return `${lastName}, ${firstName}${middleInitial ? ` ${middleInitial}.` : ""}`;
}

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
  auto_ai_feedback_enabled: false,
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
  return formatLocalDateTimeInput(date);
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

/** Resolve a stored upper score threshold into its contiguous inclusive range. */
export function rubricPointBounds(points: number, levelPoints: number[]) {
  const lowerLevels = levelPoints.filter((value) => value < points);
  if (lowerLevels.length === 0) {
    return { minimum: Math.min(0, points), maximum: points };
  }
  const previous = Math.max(...lowerLevels);
  const increment = levelPoints.every(Number.isInteger) ? 1 : 0.01;
  const minimum = Math.min(points, Number((previous + increment).toFixed(2)));
  return { minimum, maximum: points };
}

/** Display stored level scores as inclusive ranges without changing grading values. */
export function rubricPointRange(points: number, levelPoints: number[]) {
  const { minimum, maximum } = rubricPointBounds(points, levelPoints);
  return minimum === maximum ? `${maximum}` : `${maximum}–${minimum}`;
}

export function scaleRubricLevels(
  levels: ActivityRubricLevel[],
  targetMax: number,
): ActivityRubricLevel[] {
  if (!levels.length || !Number.isFinite(targetMax) || targetMax <= 0) return levels;
  const currentMax = activityRubricMaximum(levels);
  if (currentMax <= 0) return levels;
  if (currentMax === targetMax) return levels;

  return levels.map((level) => {
    if (Number(level.points) === currentMax) {
      return { ...level, points: targetMax };
    }
    const ratio = Number(level.points) / currentMax;
    const scaled = targetMax * ratio;
    const roundedInt = Math.round(scaled);
    const points = Math.abs(scaled - roundedInt) < 1e-6 ? roundedInt : Number(scaled.toFixed(2));
    return { ...level, points };
  });
}

export function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

export function isQuizType(value?: string | null) {
  return value?.toUpperCase() === "QUIZ";
}

export function canPublishFromClassworkDetail(
  classwork: Pick<TeacherClasswork, "classwork_type" | "is_published" | "is_archived">,
) {
  return (
    !classwork.is_published &&
    !classwork.is_archived &&
    ["ASSIGNMENT", "ACTIVITY", "QUIZ"].includes(classwork.classwork_type.toUpperCase())
  );
}

export function compareTrackingStudentsBySurname(
  left: TrackingStudent,
  right: TrackingStudent,
) {
  const compare = (a?: string | null, b?: string | null) =>
    (a ?? "").trim().localeCompare((b ?? "").trim(), undefined, {
      sensitivity: "base",
    });
  const bothHaveSurnames = Boolean(left.last_name?.trim() && right.last_name?.trim());
  if (bothHaveSurnames) {
    return (
      compare(left.last_name, right.last_name) ||
      compare(left.first_name, right.first_name) ||
      compare(left.student_name, right.student_name) ||
      left.student_id.localeCompare(right.student_id)
    );
  }
  return (
    compare(left.student_name, right.student_name) ||
    left.student_id.localeCompare(right.student_id)
  );
}

export function isTrackingStudentGraded(student: TrackingStudent) {
  return (
    student.status === "graded" ||
    (student.grade !== null && student.grade !== undefined)
  );
}

export function matchesTrackingFilters(
  student: TrackingStudent,
  submissionFilter: SubmissionStatusFilter,
  gradingFilter: GradingStatusFilter,
  submissionStatus: Exclude<SubmissionStatusFilter, "all">,
) {
  const matchesSubmission =
    submissionFilter === "all" || submissionStatus === submissionFilter;
  const graded = isTrackingStudentGraded(student);
  const matchesGrading =
    gradingFilter === "all" ||
    (gradingFilter === "graded" ? graded : !graded);
  return matchesSubmission && matchesGrading;
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
      auto_ai_feedback_enabled: item.auto_ai_feedback_enabled ?? false,
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

export function isAutoAiFeedbackSupported(
  classworkType?: string | null,
  activityMode?: string | null,
  isRemediationOrIntervention?: boolean,
): boolean {
  if (isRemediationOrIntervention) return false;
  const normalized = (classworkType || "").trim().toUpperCase();
  if (normalized === "QUIZ" || normalized === "ASSIGNMENT") return true;
  if (normalized === "ACTIVITY" && (activityMode || "ONLINE").toUpperCase() === "ONLINE") return true;
  return false;
}
