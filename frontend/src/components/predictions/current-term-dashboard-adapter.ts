import {
  fetchTeacherAcademicScope,
  fetchDevelopmentCurrentTermPredictions,
  type DashboardAtRiskResponse,
  type DashboardFilters,
  type DashboardGradeGroupSummary,
  type DashboardPredictionItem,
  type DevelopmentCurrentTermListItem,
  type RiskSummary,
  CurrentTermPredictionLoadError,
} from "@/lib/prediction-api";

export type AuthorizedCurrentTermRow = DevelopmentCurrentTermListItem & { grade_level: number | null };

export function currentTermPredictionErrorMessage(error: unknown): string {
  return error instanceof CurrentTermPredictionLoadError
    ? error.message
    : "Current-term projections could not be loaded. Please try again.";
}

export async function loadAuthorizedCurrentTermPredictions(
  academicPeriodId: number,
  constraints: { gradeLevel?: number; classId?: number; subjectId?: number } = {},
): Promise<{ filters: DashboardFilters; rows: AuthorizedCurrentTermRow[]; assignedScopes: AssignedSubjectSectionScope[] }> {
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
    const responses = await Promise.all(subjects.map((subject) => fetchDevelopmentCurrentTermPredictions({
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
  };
}

export function buildCurrentTermDashboard(
  rows: AuthorizedCurrentTermRow[],
  options: { search?: string; interventionLevel?: string; offset?: number; limit?: number } = {},
): DashboardAtRiskResponse {
  const search = options.search?.trim().toLowerCase() || "";
  const filtered = rows.filter((row) =>
    (!options.interventionLevel || (!row.official_final_grade_available && row.term_context.is_active && row.intervention_level === options.interventionLevel))
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

