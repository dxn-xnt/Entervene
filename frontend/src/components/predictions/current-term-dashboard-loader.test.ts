import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAdminCurrentTermScope: vi.fn(),
  fetchTeacherAcademicScope: vi.fn(),
  fetchCurrentTermPredictions: vi.fn(),
}));

vi.mock("@/lib/prediction-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/prediction-api")>();
  return { ...original, ...mocks };
});

import { loadAuthorizedCurrentTermPredictions } from "./current-term-dashboard-adapter";
import type {
  DashboardFilters,
  DevelopmentCurrentTermListItem,
} from "@/lib/prediction-api";

const emptyFilters: DashboardFilters = {
  grades: [],
  classes: [],
  subjects: [],
  terms: [],
};

function prediction(predictionId: number, classId: number, subjectId: number): DevelopmentCurrentTermListItem {
  return {
    prediction_id: predictionId,
    revision: 1,
    student_id: `student-${predictionId}`,
    student_name: `Student ${predictionId}`,
    class_id: classId,
    class_name: `Section ${classId}`,
    subject_id: subjectId,
    subject_name: `Subject ${subjectId}`,
    subject_codename: `SUB${subjectId}`,
    academic_period_id: 21,
    period_name: "Term 2",
    projected_final_term_grade: 88,
    intervention_level: "NEEDS_MONITORING",
    intervention_basis: "RULE_BASED",
    readiness_status: "READY",
    readiness_level: "STANDARD_READY",
    readiness_label: "Ready",
    academic_evidence: {
      written_works: { graded_count: 1, performance_percent: 88 },
      performance_tasks: { graded_count: 1, performance_percent: 88 },
      examination: {
        graded_count: 0,
        performance_percent: null,
        presentation: { status: "NOT_STARTED", completed_count: 0, components: {} },
      },
      overall: { graded_activity_count: 2, performance_percent: 88, observed_component_weight_percent: 70 },
    },
    participation_context: {
      attendance: { recorded_days: 0, attendance_rate: null, present: 0, absent: 0, late: 0, excused: 0 },
      submissions: { assigned_count: 2, submitted_count: 2, missing_count: 0, late_count: 0, upcoming_count: 0, completion_rate: 100 },
    },
    term_context: {
      start_date: "2026-09-01",
      end_date: "2026-11-30",
      evidence_cutoff_date: "2026-10-01",
      progress_percent: 33,
      days_remaining: 60,
      is_active: true,
      scheduled_end_passed_while_active: false,
    },
    official_final_grade_available: false,
    official_final_grade: null,
    model_version_id: 1,
    model_name: "current-term",
    lifecycle_status: "PRODUCTION",
    generated_at: "2026-10-01T00:00:00Z",
  };
}

afterEach(() => vi.clearAllMocks());

describe("loadAuthorizedCurrentTermPredictions", () => {
  it("loads every valid Admin school-wide scope for the selected term", async () => {
    const filters: DashboardFilters = {
      grades: [{ grade_level: 7, level_name: "Grade 7" }, { grade_level: 9, level_name: "Grade 9" }],
      classes: [
        { class_id: 10, section_name: "Rizal", grade_level: 7 },
        { class_id: 20, section_name: "Archimedes", grade_level: 9 },
      ],
      subjects: [
        { subject_id: 100, subject_name: "English 7" },
        { subject_id: 200, subject_name: "Science" },
      ],
      terms: [{ term_number: 2, term_label: "Term 2", academic_period_id: 21 }],
    };
    mocks.fetchAdminCurrentTermScope.mockResolvedValue({
      filters,
      scopes: [
        { class_id: 10, section_name: "Rizal", grade_level: 7, subject_id: 100, subject_name: "English 7", subject_codename: "ENG7" },
        { class_id: 20, section_name: "Archimedes", grade_level: 9, subject_id: 200, subject_name: "Science", subject_codename: "SCIENCE" },
      ],
    });
    mocks.fetchCurrentTermPredictions
      .mockResolvedValueOnce({ items: [prediction(1, 10, 100)], total: 1 })
      .mockResolvedValueOnce({ items: [prediction(2, 20, 200)], total: 1 });

    const result = await loadAuthorizedCurrentTermPredictions(21, {}, "admin");

    expect(mocks.fetchAdminCurrentTermScope).toHaveBeenCalledWith(21);
    expect(mocks.fetchCurrentTermPredictions).toHaveBeenNthCalledWith(1, {
      class_id: 10,
      subject_id: 100,
      academic_period_id: 21,
    }, "admin");
    expect(mocks.fetchCurrentTermPredictions).toHaveBeenNthCalledWith(2, {
      class_id: 20,
      subject_id: 200,
      academic_period_id: 21,
    }, "admin");
    expect(result.filters).toBe(filters);
    expect(result.rows.map((row) => [row.prediction_id, row.grade_level])).toEqual([[1, 7], [2, 9]]);
    expect(result.assignedScopes).toHaveLength(2);
    expect(mocks.fetchTeacherAcademicScope).not.toHaveBeenCalled();
  });

  it("applies Admin grade, class, and subject constraints before prediction reads", async () => {
    mocks.fetchAdminCurrentTermScope.mockResolvedValue({
      filters: emptyFilters,
      scopes: [
        { class_id: 10, section_name: "Rizal", grade_level: 7, subject_id: 100, subject_name: "English 7", subject_codename: "ENG7" },
        { class_id: 20, section_name: "Archimedes", grade_level: 9, subject_id: 200, subject_name: "Science", subject_codename: "SCIENCE" },
      ],
    });
    mocks.fetchCurrentTermPredictions.mockResolvedValue({ items: [prediction(2, 20, 200)], total: 1 });

    const result = await loadAuthorizedCurrentTermPredictions(
      21,
      { gradeLevel: 9, classId: 20, subjectId: 200 },
      "admin",
    );

    expect(mocks.fetchCurrentTermPredictions).toHaveBeenCalledTimes(1);
    expect(result.rows.map((row) => row.prediction_id)).toEqual([2]);
    expect(result.assignedScopes.map((scope) => scope.class_id)).toEqual([20]);
  });

  it("returns an empty Admin result without issuing prediction requests", async () => {
    mocks.fetchAdminCurrentTermScope.mockResolvedValue({ filters: emptyFilters, scopes: [] });

    const result = await loadAuthorizedCurrentTermPredictions(21, {}, "admin");

    expect(result).toEqual({ filters: emptyFilters, rows: [], assignedScopes: [] });
    expect(mocks.fetchCurrentTermPredictions).not.toHaveBeenCalled();
  });

  it("returns an empty Admin result when valid scopes have no prediction records", async () => {
    mocks.fetchAdminCurrentTermScope.mockResolvedValue({
      filters: emptyFilters,
      scopes: [
        { class_id: 10, section_name: "Rizal", grade_level: 7, subject_id: 100, subject_name: "English 7", subject_codename: "ENG7" },
      ],
    });
    mocks.fetchCurrentTermPredictions.mockResolvedValue({ items: [], total: 0 });

    const result = await loadAuthorizedCurrentTermPredictions(21, {}, "admin");

    expect(result.rows).toEqual([]);
    expect(result.assignedScopes).toHaveLength(1);
    expect(mocks.fetchCurrentTermPredictions).toHaveBeenCalledWith({
      class_id: 10,
      subject_id: 100,
      academic_period_id: 21,
    }, "admin");
  });

  it("preserves Teacher assignment discovery and Teacher-role prediction reads", async () => {
    const teacherFilters: DashboardFilters = {
      ...emptyFilters,
      classes: [{ class_id: 10, section_name: "Rizal", grade_level: 7 }],
    };
    mocks.fetchTeacherAcademicScope.mockImplementation((params?: { class_id?: number }) => {
      if (!params?.class_id) return Promise.resolve(teacherFilters);
      return Promise.resolve({
        ...teacherFilters,
        subjects: [{ subject_id: 100, subject_name: "English 7", subject_codename: "ENG7" }],
      });
    });
    mocks.fetchCurrentTermPredictions.mockResolvedValue({ items: [prediction(1, 10, 100)], total: 1 });

    const result = await loadAuthorizedCurrentTermPredictions(21);

    expect(mocks.fetchTeacherAcademicScope).toHaveBeenNthCalledWith(1);
    expect(mocks.fetchTeacherAcademicScope).toHaveBeenNthCalledWith(2, {
      class_id: 10,
      academic_period_id: 21,
    });
    expect(mocks.fetchCurrentTermPredictions).toHaveBeenCalledWith({
      class_id: 10,
      subject_id: 100,
      academic_period_id: 21,
    }, "teacher");
    expect(result.rows[0].grade_level).toBe(7);
    expect(mocks.fetchAdminCurrentTermScope).not.toHaveBeenCalled();
  });
});
