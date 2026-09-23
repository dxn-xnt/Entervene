import {
  fetchDashboardFilters,
  fetchDevelopmentCurrentTermPredictions,
  type DashboardAtRiskResponse,
  type DashboardFilters,
  type DashboardGradeGroupSummary,
  type DashboardPredictionItem,
  type DevelopmentCurrentTermListItem,
  type RiskSummary,
} from "@/lib/prediction-api";

export type AuthorizedCurrentTermRow = DevelopmentCurrentTermListItem & { grade_level: number | null };

export async function loadAuthorizedCurrentTermPredictions(
  academicPeriodId: number,
  constraints: { gradeLevel?: number; classId?: number; subjectId?: number } = {},
): Promise<{ filters: DashboardFilters; rows: AuthorizedCurrentTermRow[] }> {
  const filters = await fetchDashboardFilters();
  const classes = filters.classes.filter((item) =>
    (constraints.gradeLevel === undefined || item.grade_level === constraints.gradeLevel)
    && (constraints.classId === undefined || item.class_id === constraints.classId));

  const nested = await Promise.all(classes.map(async (classItem) => {
    const scoped = await fetchDashboardFilters({ class_id: classItem.class_id, academic_period_id: academicPeriodId });
    const subjects = scoped.subjects.filter((item) => constraints.subjectId === undefined || item.subject_id === constraints.subjectId);
    const responses = await Promise.all(subjects.map((subject) => fetchDevelopmentCurrentTermPredictions({
      class_id: classItem.class_id,
      subject_id: subject.subject_id,
      academic_period_id: academicPeriodId,
    }, "teacher")));
    return responses.flatMap((response) => response.items.map((row) => ({ ...row, grade_level: classItem.grade_level ?? null })));
  }));

  const unique = new Map<number, AuthorizedCurrentTermRow>();
  nested.flat().forEach((row) => unique.set(row.prediction_id, row));
  return { filters, rows: [...unique.values()] };
}

export function currentTermRiskSummary(rows: AuthorizedCurrentTermRow[]): RiskSummary {
  const summary: RiskSummary = { HIGH_RISK: 0, MODERATE_RISK: 0, NEEDS_MONITORING: 0, LOW_RISK: 0, INSUFFICIENT_DATA: 0, total: rows.length };
  rows.forEach((row) => { summary[row.intervention_level] += 1; });
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
  };
}

export function buildCurrentTermDashboard(
  rows: AuthorizedCurrentTermRow[],
  options: { search?: string; interventionLevel?: string; offset?: number; limit?: number } = {},
): DashboardAtRiskResponse {
  const search = options.search?.trim().toLowerCase() || "";
  const filtered = rows.filter((row) =>
    (!options.interventionLevel || row.intervention_level === options.interventionLevel)
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
    if (row.intervention_level !== "LOW_RISK") {
      grade.at_risk_count += 1;
      section.at_risk_count += 1;
    }
    if (row.intervention_level === "HIGH_RISK") section.high_risk_count += 1;
    if (row.intervention_level === "MODERATE_RISK" || row.intervention_level === "NEEDS_MONITORING") section.moderate_risk_count += 1;
  });
  return [...grades.values()].sort((a, b) => a.grade_level - b.grade_level);
}
