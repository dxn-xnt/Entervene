import {
  fetchAdminCurrentTermScope,
  fetchTeacherAcademicScope,
  fetchCurrentTermPredictions,
  type DashboardAtRiskResponse,
  type DashboardFilters,
  type DashboardGradeGroupSummary,
  type DashboardPredictionItem,
  type DevelopmentCurrentTermListItem,
  type RiskSummary,
  CurrentTermPredictionLoadError,
} from "@/lib/prediction-api";
import { matchesTeacherRiskFilter } from "./teacher-risk-display";

export type AuthorizedCurrentTermRow = DevelopmentCurrentTermListItem & { grade_level: number | null };
export type CurrentTermViewerRole = "admin" | "teacher";

export function currentTermPredictionErrorMessage(error: unknown): string {
  return error instanceof CurrentTermPredictionLoadError
    ? error.message
    : "Current-term projections could not be loaded. Please try again.";
}

export async function loadAuthorizedCurrentTermPredictions(
  academicPeriodId: number,
  constraints: { gradeLevel?: number; classId?: number; subjectId?: number } = {},
  role: CurrentTermViewerRole = "teacher",
): Promise<{ filters: DashboardFilters; rows: AuthorizedCurrentTermRow[]; assignedScopes: AssignedSubjectSectionScope[] }> {
  if (role === "admin") {
    const { filters, scopes } = await fetchAdminCurrentTermScope(academicPeriodId);
    const assignedScopes = scopes.filter((scope) =>
      (constraints.gradeLevel === undefined || scope.grade_level === constraints.gradeLevel)
      && (constraints.classId === undefined || scope.class_id === constraints.classId)
      && (constraints.subjectId === undefined || scope.subject_id === constraints.subjectId));
    const responses = await Promise.all(assignedScopes.map(async (scope) => {
      const response = await fetchCurrentTermPredictions({
        class_id: scope.class_id,
        subject_id: scope.subject_id,
        academic_period_id: academicPeriodId,
      }, "admin");
      return response.items.map((row) => ({ ...row, grade_level: scope.grade_level }));
    }));
    const unique = new Map<number, AuthorizedCurrentTermRow>();
    responses.flat().forEach((row) => unique.set(row.prediction_id, row));
    return { filters, rows: [...unique.values()], assignedScopes };
  }

  const filters = await fetchTeacherAcademicScope();
  const classes = filters.classes.filter((item) =>
    (constraints.gradeLevel === undefined || item.grade_level === constraints.gradeLevel)
    && (constraints.classId === undefined || item.class_id === constraints.classId));

  const assignedScopes: AssignedSubjectSectionScope[] = [];

  const nested = await Promise.all(classes.map(async (classItem) => {
    const scoped = await fetchTeacherAcademicScope({ class_id: classItem.class_id, academic_period_id: academicPeriodId });
    const subjects = scoped.subjects.filter((item) => constraints.subjectId === undefined || item.subject_id === constraints.subjectId);
    subjects.forEach((subj) => {
      assignedScopes.push({
        subject_id: subj.subject_id,
        subject_name: subj.subject_name,
        subject_codename: subj.subject_codename,
        grade_level: classItem.grade_level ?? null,
        class_id: classItem.class_id,
        section_name: classItem.section_name,
      });
    });
    const responses = await Promise.all(subjects.map((subject) => fetchCurrentTermPredictions({
      class_id: classItem.class_id,
      subject_id: subject.subject_id,
      academic_period_id: academicPeriodId,
    }, "teacher")));
    return responses.flatMap((response) => response.items.map((row) => ({ ...row, grade_level: classItem.grade_level ?? null })));
  }));

  const unique = new Map<number, AuthorizedCurrentTermRow>();
  nested.flat().forEach((row) => unique.set(row.prediction_id, row));
  return { filters, rows: [...unique.values()], assignedScopes };
}

export function currentTermRiskSummary(rows: AuthorizedCurrentTermRow[]): RiskSummary {
  const actionable = rows.filter((row) => !row.official_final_grade_available && row.term_context.is_active);
  const summary: RiskSummary = { HIGH_RISK: 0, MODERATE_RISK: 0, NEEDS_MONITORING: 0, LOW_RISK: 0, INSUFFICIENT_DATA: 0, total: actionable.length };
  actionable.forEach((row) => { summary[row.intervention_level] += 1; });
  return summary;
}

export function toDashboardPrediction(row: AuthorizedCurrentTermRow): DashboardPredictionItem {
  return {
    prediction_id: row.prediction_id,
    student_id: row.student_id,
    student_name: row.student_name || row.student_id,
    student_lrn: "",
    class_name: row.class_name,
    grade_level: row.grade_level,
    subject_name: row.subject_name,
    subject_codename: row.subject_codename,
    term_label: row.period_name,
    term_number: 0,
    predicted_period_grade: row.projected_final_term_grade,
    risk_level: row.intervention_level,
    risk_score: null,
    data_status: row.readiness_status || "READY",
    generated_at: row.generated_at,
    official_final_grade: row.official_final_grade,
    historical_projection: row.official_final_grade_available || !row.term_context.is_active,
    is_provisional: row.is_provisional,
    validation_status: row.validation_status,
  };
}

export function buildCurrentTermDashboard(
  rows: AuthorizedCurrentTermRow[],
  options: { search?: string; interventionLevel?: string; offset?: number; limit?: number } = {},
): DashboardAtRiskResponse {
  const search = options.search?.trim().toLowerCase() || "";
  const filtered = rows.filter((row) =>
    (!options.interventionLevel || (!row.official_final_grade_available && row.term_context.is_active
      && matchesTeacherRiskFilter(row.intervention_level, options.interventionLevel)))
    && (!search || (row.student_name || row.student_id).toLowerCase().includes(search)));
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 10;
  return {
    items: filtered.slice(offset, offset + limit).map(toDashboardPrediction),
    risk_summary: currentTermRiskSummary(rows),
    total: filtered.length,
    limit,
    offset,
  };
}

export function buildCurrentTermGradeSummaries(rows: AuthorizedCurrentTermRow[]): DashboardGradeGroupSummary[] {
  const grades = new Map<number, DashboardGradeGroupSummary>();
  rows.forEach((row) => {
    if (row.grade_level === null) return;
    let grade = grades.get(row.grade_level);
    if (!grade) {
      grade = { grade_level: row.grade_level, level_name: `Grade ${row.grade_level}`, total_students: 0, at_risk_count: 0, sections: [] };
      grades.set(row.grade_level, grade);
    }
    let section = grade.sections.find((item) => item.class_id === row.class_id);
    if (!section) {
      section = { class_id: row.class_id, section_name: row.class_name, grade_level: row.grade_level, total_students: 0, at_risk_count: 0, high_risk_count: 0, moderate_risk_count: 0 };
      grade.sections.push(section);
    }
    grade.total_students += 1;
    section.total_students += 1;
    if (!row.official_final_grade_available && row.term_context.is_active && row.intervention_level !== "LOW_RISK") {
      grade.at_risk_count += 1;
      section.at_risk_count += 1;
    }
    if (!row.official_final_grade_available && row.term_context.is_active && row.intervention_level === "HIGH_RISK") section.high_risk_count += 1;
    if (!row.official_final_grade_available && row.term_context.is_active && (row.intervention_level === "MODERATE_RISK" || row.intervention_level === "NEEDS_MONITORING")) section.moderate_risk_count += 1;
  });
  return [...grades.values()].sort((a, b) => a.grade_level - b.grade_level);
}

export interface DashboardSubjectSectionSummaryItem {
  class_id: number;
  section_name: string;
  grade_level: number | null;
  subject_id: number;
  total_students: number;
  total_predictions: number;
  at_risk_count: number;
  high_risk_count: number;
  moderate_risk_count: number;
  needs_monitoring_count: number;
  low_risk_count: number;
}

export interface DashboardSubjectGroupSummary {
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
  grade_level: number | null;
  display_name: string;
  total_students: number;
  total_predictions: number;
  at_risk_count: number;
  high_risk_count: number;
  moderate_risk_count: number;
  needs_monitoring_count: number;
  low_risk_count: number;
  sections: DashboardSubjectSectionSummaryItem[];
}

export interface AssignedSubjectSectionScope {
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  grade_level?: number | null;
  class_id: number;
  section_name: string;
}

export type AdminStudentRiskLevel = "HIGH_RISK" | "MODERATE_RISK" | "ON_TRACK";

export interface AdminPredictionStudentSummary {
  student_id: string;
  student_name: string;
  risk_level: AdminStudentRiskLevel | null;
  predictions: AuthorizedCurrentTermRow[];
}

export interface AdminPredictionSectionSummary {
  class_id: number;
  section_name: string;
  grade_level: number;
  unique_student_count: number;
  prediction_count: number;
  subject_count: number;
  high_risk_count: number;
  moderate_risk_count: number;
  on_track_count: number;
  students: AdminPredictionStudentSummary[];
  subjects: AdminPredictionSubjectSummary[];
}

export interface AdminPredictionSubjectSummary {
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
  prediction_count: number;
  high_risk_count: number;
  moderate_risk_count: number;
  needs_monitoring_count: number;
  low_risk_count: number;
  predictions: AuthorizedCurrentTermRow[];
}

export interface AdminPredictionGradeSummary {
  grade_level: number;
  sections: AdminPredictionSectionSummary[];
}

export interface AdminUniqueStudentRiskSummary {
  HIGH_RISK: number;
  MODERATE_RISK: number;
  ON_TRACK: number;
  total: number;
}

function isActionableCurrentTermRow(row: AuthorizedCurrentTermRow): boolean {
  return !row.official_final_grade_available && row.term_context.is_active;
}

export function adminStudentRiskLevel(
  predictions: AuthorizedCurrentTermRow[],
): AdminStudentRiskLevel | null {
  const actionable = predictions.filter(isActionableCurrentTermRow);
  if (actionable.some((row) => row.intervention_level === "HIGH_RISK")) return "HIGH_RISK";
  if (actionable.some((row) => row.intervention_level === "MODERATE_RISK")) return "MODERATE_RISK";
  if (actionable.some((row) =>
    row.intervention_level === "NEEDS_MONITORING" || row.intervention_level === "LOW_RISK")) {
    return "ON_TRACK";
  }
  return null;
}

export function adminUniqueStudentRiskSummary(
  rows: AuthorizedCurrentTermRow[],
): AdminUniqueStudentRiskSummary {
  const byStudent = new Map<string, AuthorizedCurrentTermRow[]>();
  rows.forEach((row) => {
    const current = byStudent.get(row.student_id) ?? [];
    current.push(row);
    byStudent.set(row.student_id, current);
  });

  const summary: AdminUniqueStudentRiskSummary = {
    HIGH_RISK: 0,
    MODERATE_RISK: 0,
    ON_TRACK: 0,
    total: 0,
  };
  byStudent.forEach((predictions) => {
    const level = adminStudentRiskLevel(predictions);
    if (!level) return;
    summary[level] += 1;
    summary.total += 1;
  });
  return summary;
}

export function buildAdminPredictionHierarchy(
  rows: AuthorizedCurrentTermRow[],
  assignedScopes: AssignedSubjectSectionScope[],
  options: {
    gradeLevel?: number;
    search?: string;
    riskLevel?: string;
    includeEmptySections?: boolean;
  } = {},
): AdminPredictionGradeSummary[] {
  const gradeLevels = options.gradeLevel === undefined
    ? [7, 8, 9, 10, 11, 12]
    : [options.gradeLevel];
  const grades = new Map<number, Map<number, {
    class_id: number;
    section_name: string;
    grade_level: number;
    scope_subjects: Map<number, {
      subject_id: number;
      subject_name: string;
      subject_codename: string | null;
    }>;
    rows: AuthorizedCurrentTermRow[];
  }>>();
  gradeLevels.forEach((grade) => grades.set(grade, new Map()));

  const ensureSection = (
    gradeLevel: number | null | undefined,
    classId: number,
    sectionName: string,
  ) => {
    if (gradeLevel == null || !grades.has(gradeLevel)) return null;
    const sections = grades.get(gradeLevel)!;
    let section = sections.get(classId);
    if (!section) {
      section = {
        class_id: classId,
        section_name: sectionName,
        grade_level: gradeLevel,
        scope_subjects: new Map(),
        rows: [],
      };
      sections.set(classId, section);
    }
    return section;
  };

  assignedScopes.forEach((scope) => {
    const section = ensureSection(scope.grade_level, scope.class_id, scope.section_name);
    section?.scope_subjects.set(scope.subject_id, {
      subject_id: scope.subject_id,
      subject_name: scope.subject_name,
      subject_codename: scope.subject_codename ?? null,
    });
  });
  rows.forEach((row) => {
    const section = ensureSection(row.grade_level, row.class_id, row.class_name);
    if (!section) return;
    section.scope_subjects.set(row.subject_id, {
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      subject_codename: row.subject_codename ?? null,
    });
    section.rows.push(row);
  });

  const search = options.search?.trim().toLowerCase() ?? "";
  return gradeLevels.map((gradeLevel) => {
    const sections = [...(grades.get(gradeLevel)?.values() ?? [])]
      .map((section): AdminPredictionSectionSummary | null => {
        const byStudent = new Map<string, AuthorizedCurrentTermRow[]>();
        section.rows.forEach((row) => {
          const current = byStudent.get(row.student_id) ?? [];
          current.push(row);
          byStudent.set(row.student_id, current);
        });

        const students = [...byStudent.entries()]
          .map(([studentId, predictions]): AdminPredictionStudentSummary => ({
            student_id: studentId,
            student_name: predictions[0]?.student_name || studentId,
            risk_level: adminStudentRiskLevel(predictions),
            predictions: [...predictions].sort((a, b) =>
              a.subject_name.localeCompare(b.subject_name) || a.prediction_id - b.prediction_id),
          }))
          .filter((student) => !search || student.student_name.toLowerCase().includes(search))
          .filter((student) => !options.riskLevel || student.risk_level === options.riskLevel)
          .sort((a, b) => a.student_name.localeCompare(b.student_name));

        if (!options.includeEmptySections && students.length === 0) return null;
        const visiblePredictions = students.flatMap((student) => student.predictions);
        const subjects = [...section.scope_subjects.values()]
          .map((subject): AdminPredictionSubjectSummary => {
            const predictions = visiblePredictions
              .filter((prediction) => prediction.subject_id === subject.subject_id)
              .sort((a, b) =>
                (a.student_name || a.student_id).localeCompare(b.student_name || b.student_id)
                || a.prediction_id - b.prediction_id);
            const actionable = predictions.filter(isActionableCurrentTermRow);
            return {
              ...subject,
              prediction_count: predictions.length,
              high_risk_count: actionable.filter((row) => row.intervention_level === "HIGH_RISK").length,
              moderate_risk_count: actionable.filter((row) => row.intervention_level === "MODERATE_RISK").length,
              needs_monitoring_count: actionable.filter((row) => row.intervention_level === "NEEDS_MONITORING").length,
              low_risk_count: actionable.filter((row) => row.intervention_level === "LOW_RISK").length,
              predictions,
            };
          })
          .sort((a, b) => a.subject_name.localeCompare(b.subject_name) || a.subject_id - b.subject_id);
        return {
          class_id: section.class_id,
          section_name: section.section_name,
          grade_level: section.grade_level,
          unique_student_count: students.length,
          prediction_count: visiblePredictions.length,
          subject_count: subjects.length,
          high_risk_count: students.filter((student) => student.risk_level === "HIGH_RISK").length,
          moderate_risk_count: students.filter((student) => student.risk_level === "MODERATE_RISK").length,
          on_track_count: students.filter((student) => student.risk_level === "ON_TRACK").length,
          students,
          subjects,
        };
      })
      .filter((section): section is AdminPredictionSectionSummary => section !== null)
      .sort((a, b) => a.section_name.localeCompare(b.section_name));
    return { grade_level: gradeLevel, sections };
  });
}

export function formatSubjectDisplayName(subjectName: string, gradeLevel?: number | null): string {
  const trimmed = (subjectName || "").trim();
  if (!trimmed) {
    return gradeLevel !== null && gradeLevel !== undefined ? `Subject ${gradeLevel}` : "Subject";
  }
  if (gradeLevel === null || gradeLevel === undefined) {
    return trimmed;
  }
  const endsWithGrade = new RegExp(`(?:^|\\s|-)${gradeLevel}$`, "i").test(trimmed);
  const mentionsGrade = new RegExp(`\\bgrade\\s*${gradeLevel}\\b`, "i").test(trimmed);
  if (endsWithGrade || mentionsGrade) {
    return trimmed;
  }
  return `${trimmed} ${gradeLevel}`;
}

export function buildCurrentTermSubjectSummaries(
  rows: AuthorizedCurrentTermRow[],
  assignedScopes?: AssignedSubjectSectionScope[],
): DashboardSubjectGroupSummary[] {
  const subjects = new Map<number, DashboardSubjectGroupSummary>();

  if (assignedScopes && assignedScopes.length > 0) {
    assignedScopes.forEach((scope) => {
      let subject = subjects.get(scope.subject_id);
      if (!subject) {
        subject = {
          subject_id: scope.subject_id,
          subject_name: scope.subject_name,
          subject_codename: scope.subject_codename ?? null,
          grade_level: scope.grade_level ?? null,
          display_name: formatSubjectDisplayName(scope.subject_name, scope.grade_level),
          total_students: 0,
          total_predictions: 0,
          at_risk_count: 0,
          high_risk_count: 0,
          moderate_risk_count: 0,
          needs_monitoring_count: 0,
          low_risk_count: 0,
          sections: [],
        };
        subjects.set(scope.subject_id, subject);
      }
      let section = subject.sections.find((item) => item.class_id === scope.class_id);
      if (!section) {
        section = {
          class_id: scope.class_id,
          section_name: scope.section_name,
          grade_level: scope.grade_level ?? null,
          subject_id: scope.subject_id,
          total_students: 0,
          total_predictions: 0,
          at_risk_count: 0,
          high_risk_count: 0,
          moderate_risk_count: 0,
          needs_monitoring_count: 0,
          low_risk_count: 0,
        };
        subject.sections.push(section);
      }
    });
  }

  rows.forEach((row) => {
    let subject = subjects.get(row.subject_id);
    if (!subject) {
      subject = {
        subject_id: row.subject_id,
        subject_name: row.subject_name,
        subject_codename: row.subject_codename ?? null,
        grade_level: row.grade_level ?? null,
        display_name: formatSubjectDisplayName(row.subject_name, row.grade_level),
        total_students: 0,
        total_predictions: 0,
        at_risk_count: 0,
        high_risk_count: 0,
        moderate_risk_count: 0,
        needs_monitoring_count: 0,
        low_risk_count: 0,
        sections: [],
      };
      subjects.set(row.subject_id, subject);
    }

    let section = subject.sections.find((item) => item.class_id === row.class_id);
    if (!section) {
      section = {
        class_id: row.class_id,
        section_name: row.class_name,
        grade_level: row.grade_level ?? null,
        subject_id: row.subject_id,
        total_students: 0,
        total_predictions: 0,
        at_risk_count: 0,
        high_risk_count: 0,
        moderate_risk_count: 0,
        needs_monitoring_count: 0,
        low_risk_count: 0,
      };
      subject.sections.push(section);
    }

    subject.total_students += 1;
    subject.total_predictions += 1;
    section.total_students += 1;
    section.total_predictions += 1;

    const isActionable = !row.official_final_grade_available && row.term_context.is_active;
    if (isActionable) {
      if (row.intervention_level !== "LOW_RISK") {
        subject.at_risk_count += 1;
        section.at_risk_count += 1;
      }
      if (row.intervention_level === "HIGH_RISK") {
        subject.high_risk_count += 1;
        section.high_risk_count += 1;
      } else if (row.intervention_level === "MODERATE_RISK") {
        subject.moderate_risk_count += 1;
        section.moderate_risk_count += 1;
      } else if (row.intervention_level === "NEEDS_MONITORING") {
        subject.needs_monitoring_count += 1;
        section.needs_monitoring_count += 1;
      } else if (row.intervention_level === "LOW_RISK") {
        subject.low_risk_count += 1;
        section.low_risk_count += 1;
      }
    }
  });

  const sortedSubjects = [...subjects.values()].map((subject) => {
    subject.sections.sort((a, b) => {
      const nameCompare = a.section_name.localeCompare(b.section_name);
      if (nameCompare !== 0) return nameCompare;
      return a.class_id - b.class_id;
    });
    return subject;
  });

  sortedSubjects.sort((a, b) => {
    const gradeA = a.grade_level ?? 999;
    const gradeB = b.grade_level ?? 999;
    if (gradeA !== gradeB) return gradeA - gradeB;
    const nameCompare = a.display_name.localeCompare(b.display_name);
    if (nameCompare !== 0) return nameCompare;
    return a.subject_id - b.subject_id;
  });

  return sortedSubjects;
}

