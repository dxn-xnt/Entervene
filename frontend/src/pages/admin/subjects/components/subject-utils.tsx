import { Badge } from "@/components/retroui/Badge";
import type {
  SubjectAcademicLevel,
  GradingTemplateListItem,
  SubjectListItem,
  SubjectOfferingListItem,
  SubjectOfferingPathway,
  SubjectStatus,
} from "@/lib/api";
import type { CurriculumGradeValue, CurriculumPathwayValue, CurriculumStatusValue } from "./CurriculumFilters";
import type { SubjectModuleTabId } from "./SubjectModuleTabs";

// ─── Constants ───────────────────────────────────────────────────────────────

export const TARGET_GRADES = new Set([7, 8, 9, 10, 11, 12]);
export const ALL_VALUE = "all";
export const SHS_PATHWAYS: SubjectOfferingPathway[] = ["both", "stem_medical", "stem_engineering"];
export const JHS_PATHWAYS: SubjectOfferingPathway[] = ["general"];
export const FALLBACK_PERIODS: SubjectOfferingListItem["academic_period"][] = [
  {
    academic_period_id: -1,
    period_name: "Term 1",
    period_type: "TERM",
    period_sequence: 1,
    academic_year_id: -1,
  },
  {
    academic_period_id: -2,
    period_name: "Term 2",
    period_type: "TERM",
    period_sequence: 2,
    academic_year_id: -1,
  },
  {
    academic_period_id: -3,
    period_name: "Term 3",
    period_type: "TERM",
    period_sequence: 3,
    academic_year_id: -1,
  },
];

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdminSubjectSection = SubjectModuleTabId;

export type GradeGroup = {
  academicLevelId: number;
  grade: string;
  gradeLevel: number;
  subjects: SubjectListItem[];
};

export type OfferingFilters = {
  academic_year_id: string;
  grade: CurriculumGradeValue;
  pathway: CurriculumPathwayValue;
  status: CurriculumStatusValue;
  search: string;
};

export type { CurriculumStatusValue };

export type PendingAction =
  | { kind: "subject"; action: "archive" | "restore"; id: number; label: string }
  | { kind: "offering"; action: "archive" | "restore"; id: number; label: string }
  | { kind: "grading"; action: "archive" | "restore"; id: number; label: string };

export type OfferingFormState = {
  subject_id: string;
  subject_ids: string[];
  academic_year_id: string;
  academic_level_id: string;
  academic_period_id: string;
  academic_period_ids: string[];
  pathway: SubjectOfferingPathway;
  status: SubjectStatus;
};

// ─── Utility Functions ──────────────────────────────────────────────────────

export function friendlyErrorMessage(message: string) {
  if (message.trim().toLowerCase() === "not found") {
    return "The subject API endpoint was not found. Restart the backend and make sure the latest migrations/routes are loaded.";
  }
  return message;
}

export function subjectCode(subject: SubjectListItem | SubjectOfferingListItem["subject"]) {
  return subject.subject_codename || "No code";
}

export function pathwayLabel(pathway: SubjectOfferingPathway) {
  if (pathway === "general") return "General";
  if (pathway === "stem_medical") return "STEM Medical";
  if (pathway === "stem_engineering") return "STEM Engineering";
  return "Shared / Both";
}

export function statusBadge(status: SubjectStatus) {
  return (
    <Badge size="sm" variant={status === "active" ? "surface" : "outline"} className="capitalize">
      {status}
    </Badge>
  );
}

export function targetLevels(levels: SubjectAcademicLevel[]) {
  const filtered = levels.filter((level) => TARGET_GRADES.has(level.grade_level));
  return filtered.length ? filtered : levels;
}

export function gradeValueForLevel(level: SubjectAcademicLevel | null | undefined): CurriculumGradeValue {
  if (!level || !TARGET_GRADES.has(level.grade_level)) return ALL_VALUE;
  return String(level.grade_level) as CurriculumGradeValue;
}

export function defaultPathwayForGrade(grade: CurriculumGradeValue): CurriculumPathwayValue {
  if (grade === "7" || grade === "8" || grade === "9" || grade === "10") return "general";
  if (grade === "11" || grade === "12") return "both";
  return ALL_VALUE;
}

export function gradeLabel(grade: CurriculumGradeValue) {
  return grade === ALL_VALUE ? "All Grades" : `Grade ${grade}`;
}

export function pathwaysForGrade(gradeLevel: number | null | undefined, allowed: SubjectOfferingPathway[] = []) {
  const source = allowed.length ? allowed : [...JHS_PATHWAYS, ...SHS_PATHWAYS];
  if (gradeLevel != null && gradeLevel >= 7 && gradeLevel <= 10) {
    return source.filter((pathway) => JHS_PATHWAYS.includes(pathway));
  }
  if (gradeLevel != null && gradeLevel >= 11 && gradeLevel <= 12) {
    return source.filter((pathway) => SHS_PATHWAYS.includes(pathway));
  }
  return source;
}

export function isJuniorHighGrade(gradeLevel: number | null | undefined) {
  return gradeLevel != null && gradeLevel >= 7 && gradeLevel <= 10;
}

export function isSeniorHighGrade(gradeLevel: number | null | undefined) {
  return gradeLevel != null && gradeLevel >= 11 && gradeLevel <= 12;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function subjectRouteGrade(level: SubjectAcademicLevel) {
  return level.level_name || `Grade ${level.grade_level}`;
}

export function scopeLabel(template: GradingTemplateListItem) {
  const level = template.academic_level?.level_name ?? "Any level";
  const subject = template.subject?.subject_name ?? "Any subject";
  return `${level} - ${subject}`;
}
