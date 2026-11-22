import {
  Frown as FaceSlightlyFrowning,
  Meh as FaceNeutral,
  Smile as FaceSlightlySmiling,
  ScanFace,
  type LucideIcon,
} from "lucide-react";
import type { StudentLesson } from "@/types/student-subject";

export const MASTERY_THRESHOLD_HIGH = 85;
export const MASTERY_THRESHOLD_MODERATE = 75;

export type MasteryLevelId = "not_yet_rated" | "low" | "moderate" | "high";

export interface MasteryClassworkInput {
  assignment_id?: number;
  classwork_assignment_id?: number;
  classwork_id?: number;
  title?: string;
  type?: string | null;
  classwork_type?: string | null;
  category?: string | null;
  classwork_category?: string | null;
  is_graded?: boolean | null;
  show_scores?: boolean | null;
  total_points?: number | string | null;
  grade?: number | string | null;
  status?: string | null;
  submission_status?: string | null;
  is_submitted?: boolean | null;
  submitted_at?: string | null;
}

export interface ComputedMasteryResult {
  id: MasteryLevelId;
  label: "Not yet rated" | "Low" | "Moderate" | "High";
  badgeLabel: "Not yet rated" | "Low" | "Moderate" | "High";
  badgeVariant: "outline" | "destructive" | "surface" | "success";
  badgeClass: string;
  colorClass: string;
  bgClass: string;
  fillColor: string;
  icon: LucideIcon;
  percentage: number | null;
  earnedPoints: number;
  possiblePoints: number;
  gradedCount: number;
  gradableCount: number;
  description: string;
}

export interface ComputedCompletionResult {
  totalCount: number;
  completedCount: number;
  pendingCount: number;
  percentage: number | null;
}

export interface PerLessonMasterySummary {
  lesson: StudentLesson;
  mastery: ComputedMasteryResult;
  completion: ComputedCompletionResult;
}

export interface SubjectLessonMasterySummary {
  aggregate: ComputedMasteryResult;
  perLesson: PerLessonMasterySummary[];
}

export function getAssignmentId(item: MasteryClassworkInput): number | null {
  const id = item.assignment_id ?? item.classwork_assignment_id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

export function mergeClassworkRecords(
  primary: MasteryClassworkInput,
  secondary?: MasteryClassworkInput,
): MasteryClassworkInput {
  if (!secondary) return { ...primary };
  return {
    ...secondary,
    ...primary,
    assignment_id: primary.assignment_id ?? secondary.assignment_id ?? primary.classwork_assignment_id ?? secondary.classwork_assignment_id,
    classwork_assignment_id: primary.classwork_assignment_id ?? secondary.classwork_assignment_id ?? primary.assignment_id ?? secondary.assignment_id,
    classwork_id: primary.classwork_id ?? secondary.classwork_id,
    title: primary.title ?? secondary.title,
    type: primary.type ?? secondary.type ?? primary.classwork_type ?? secondary.classwork_type,
    classwork_type: primary.classwork_type ?? secondary.classwork_type ?? primary.type ?? secondary.type,
    category: primary.category ?? secondary.category ?? primary.classwork_category ?? secondary.classwork_category,
    classwork_category: primary.classwork_category ?? secondary.classwork_category ?? primary.category ?? secondary.category,
    is_graded: primary.is_graded !== undefined ? primary.is_graded : secondary.is_graded,
    show_scores: primary.show_scores !== undefined ? primary.show_scores : secondary.show_scores,
    total_points: primary.total_points !== undefined && primary.total_points !== null ? primary.total_points : secondary.total_points,
    grade: primary.grade !== undefined && primary.grade !== null ? primary.grade : secondary.grade,
    status: primary.status ?? secondary.status,
    submission_status: primary.submission_status ?? secondary.submission_status,
    is_submitted: primary.is_submitted !== undefined ? primary.is_submitted : secondary.is_submitted,
    submitted_at: primary.submitted_at ?? secondary.submitted_at,
  };
}

export function deduplicateClassworkInputs(items: MasteryClassworkInput[]): MasteryClassworkInput[] {
  const byId = new Map<number, MasteryClassworkInput>();
  const withoutId: MasteryClassworkInput[] = [];
  for (const item of items) {
    const id = getAssignmentId(item);
    if (id === null) {
      withoutId.push(item);
    } else {
      const existing = byId.get(id);
      byId.set(id, existing ? mergeClassworkRecords(item, existing) : { ...item });
    }
  }
  return [...byId.values(), ...withoutId];
}

export function isReadingAssessment(item: MasteryClassworkInput): boolean {
  const rawType = (item.classwork_type ?? item.type ?? "").trim().toUpperCase();
  return rawType === "READING";
}

export function isGradableAssessment(item: MasteryClassworkInput): boolean {
  if (isReadingAssessment(item)) return false;
  if (item.is_graded === false) return false;
  const totalPoints = Number(item.total_points);
  return Number.isFinite(totalPoints) && totalPoints > 0;
}

export function isEligibleGradedAssessment(item: MasteryClassworkInput): boolean {
  if (!isGradableAssessment(item)) return false;
  if (item.show_scores === false) return false;
  const subStatus = (item.submission_status ?? "").trim().toLowerCase();
  if (subStatus !== "graded") return false;
  if (item.grade === null || item.grade === undefined || item.grade === "") return false;
  const grade = Number(item.grade);
  return Number.isFinite(grade) && grade >= 0;
}

export function isCompletedClasswork(item: MasteryClassworkInput): boolean {
  if (item.is_submitted === true) return true;
  if (item.submitted_at) return true;
  const subStatus = (item.submission_status ?? item.status ?? "").trim().toLowerCase();
  return (
    subStatus === "submitted" ||
    subStatus === "graded" ||
    subStatus === "late" ||
    subStatus === "completed"
  );
}

export function classifyMasteryPercentage(
  percentage: number | null,
  gradableCount = 0,
): Omit<ComputedMasteryResult, "earnedPoints" | "possiblePoints" | "gradedCount" | "gradableCount"> {
  if (percentage === null || !Number.isFinite(percentage)) {
    return {
      id: "not_yet_rated",
      label: "Not yet rated",
      badgeLabel: "Not yet rated",
      badgeVariant: "outline",
      badgeClass: "bg-muted text-black border-2 border-black font-bold",
      colorClass: "text-muted-foreground",
      bgClass: "bg-retro bg-muted/40 border-border",
      fillColor: "none",
      icon: ScanFace,
      percentage: null,
      description:
        gradableCount === 0
          ? "Mastery appears after related classwork is graded."
          : "Mastery appears after related classwork is graded.",
    };
  }

  const clamped = Math.min(100, Math.max(0, Math.round(percentage)));
  if (clamped >= MASTERY_THRESHOLD_HIGH) {
    return {
      id: "high",
      label: "High",
      badgeLabel: "High",
      badgeVariant: "success",
      badgeClass: "bg-[#00e65f] text-black border-2 border-black font-bold",
      colorClass: "text-[#00e65f] dark:text-[#00e65f]",
      bgClass: "bg-retro bg-[#00e65f]/20 border-border",
      fillColor: "#00e65f",
      icon: FaceSlightlySmiling,
      percentage: clamped,
      description: "You've got this down. Keep shining!",
    };
  }

  if (clamped >= MASTERY_THRESHOLD_MODERATE) {
    return {
      id: "moderate",
      label: "Moderate",
      badgeLabel: "Moderate",
      badgeVariant: "surface",
      badgeClass: "bg-[#ff9233] text-black border-2 border-black font-bold",
      colorClass: "text-[#ff9233] dark:text-[#ff9233]",
      bgClass: "bg-retro bg-[#ff9233]/15 border-border",
      fillColor: "#ff9233",
      icon: FaceNeutral,
      percentage: clamped,
      description: "You're getting there. Keep going",
    };
  }

  return {
    id: "low",
    label: "Low",
    badgeLabel: "Low",
    badgeVariant: "destructive",
    badgeClass: "bg-[#ff3333] text-black border-2 border-black font-bold",
    colorClass: "text-[#ff3333] dark:text-[#ff3333]",
    bgClass: "bg-retro bg-[#ff3333]/15 border-border",
    fillColor: "#ff3333",
    icon: FaceSlightlyFrowning,
    percentage: clamped,
    description: "Every expert started here. Let's grow!",
  };
}

export function computeLessonMastery(items: MasteryClassworkInput[]): ComputedMasteryResult {
  const uniqueItems = deduplicateClassworkInputs(items);
  const gradableItems = uniqueItems.filter(isGradableAssessment);
  const gradedItems = uniqueItems.filter(isEligibleGradedAssessment);

  const earnedPoints = gradedItems.reduce((sum, item) => sum + Number(item.grade), 0);
  const possiblePoints = gradedItems.reduce((sum, item) => sum + Number(item.total_points), 0);

  const rawPercentage =
    gradedItems.length > 0 && possiblePoints > 0
      ? Math.round((earnedPoints / possiblePoints) * 100)
      : null;

  const classified = classifyMasteryPercentage(rawPercentage, gradableItems.length);
  return {
    ...classified,
    earnedPoints,
    possiblePoints,
    gradedCount: gradedItems.length,
    gradableCount: gradableItems.length,
  };
}

export function computeLessonCompletion(items: MasteryClassworkInput[]): ComputedCompletionResult {
  const uniqueItems = deduplicateClassworkInputs(items);
  const totalCount = uniqueItems.length;
  const completedCount = uniqueItems.filter(isCompletedClasswork).length;
  const pendingCount = Math.max(0, totalCount - completedCount);
  const percentage =
    totalCount > 0 ? Math.min(100, Math.max(0, Math.round((completedCount / totalCount) * 100))) : null;

  return {
    totalCount,
    completedCount,
    pendingCount,
    percentage,
  };
}

export function computeSubjectLessonMastery(
  lessons: StudentLesson[],
  assignmentIdsByLesson: Record<number, number[]>,
  classworks: MasteryClassworkInput[],
  lessonClassworksByLesson?: Record<number, MasteryClassworkInput[]>,
): SubjectLessonMasterySummary {
  const mergedByAssignmentId = new Map<number, MasteryClassworkInput>();

  for (const cw of classworks) {
    const id = getAssignmentId(cw);
    if (id !== null) {
      const existing = mergedByAssignmentId.get(id);
      mergedByAssignmentId.set(id, existing ? mergeClassworkRecords(cw, existing) : { ...cw });
    }
  }

  if (lessonClassworksByLesson) {
    for (const list of Object.values(lessonClassworksByLesson)) {
      for (const cw of list ?? []) {
        const id = getAssignmentId(cw);
        if (id !== null) {
          const existing = mergedByAssignmentId.get(id);
          mergedByAssignmentId.set(id, existing ? mergeClassworkRecords(existing, cw) : { ...cw });
        }
      }
    }
  }

  const uniqueSubjectAssignmentIds = new Set<number>();
  const perLesson: PerLessonMasterySummary[] = lessons.map((lesson) => {
    const rawIds = assignmentIdsByLesson[lesson.lesson_id] ?? [];
    const directItems = lessonClassworksByLesson?.[lesson.lesson_id] ?? [];
    const lessonIds = new Set<number>(rawIds);
    for (const item of directItems) {
      const id = getAssignmentId(item);
      if (id !== null) lessonIds.add(id);
    }

    const lessonItems: MasteryClassworkInput[] = [];
    for (const id of lessonIds) {
      uniqueSubjectAssignmentIds.add(id);
      const resolved = mergedByAssignmentId.get(id);
      if (resolved) {
        lessonItems.push(resolved);
      }
    }

    return {
      lesson,
      mastery: computeLessonMastery(lessonItems),
      completion: computeLessonCompletion(lessonItems),
    };
  });

  const aggregateItems: MasteryClassworkInput[] = [];
  for (const id of uniqueSubjectAssignmentIds) {
    const resolved = mergedByAssignmentId.get(id);
    if (resolved) {
      aggregateItems.push(resolved);
    }
  }

  return {
    aggregate: computeLessonMastery(aggregateItems),
    perLesson,
  };
}

export {
  FaceSlightlyFrowning,
  FaceNeutral,
  FaceSlightlySmiling,
  ScanFace,
};
