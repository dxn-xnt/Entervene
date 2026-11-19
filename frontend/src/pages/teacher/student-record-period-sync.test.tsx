// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeacherStudentView } from "./student-view";
import type { StudentRecordDetailResponse } from "@/lib/student-record-api";
import type { TeacherAdvisoryStudentItem, TeacherAdvisorySubjectLoadItem } from "@/types/adminClasses";

const mockApi = vi.hoisted(() => ({
  getDetail: vi.fn(),
  getSuggestions: vi.fn(),
}));

vi.mock("@/lib/student-record-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/student-record-api")>();
  return {
    ...actual,
    getTeacherStudentRecordDetail: mockApi.getDetail,
  };
});

vi.mock("@/lib/suggestion-api", () => ({
  getTeacherSuggestions: mockApi.getSuggestions,
  approveSuggestion: vi.fn(),
  dismissSuggestion: vi.fn(),
  archiveSuggestion: vi.fn(),
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">SidebarTrigger</button>,
}));

let currentPeriodId: number | null = 101;
let currentYearId: number | null = 1;

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedPeriodId: currentPeriodId,
    selectedYearId: currentYearId,
    selectedPeriod: {
      id: currentPeriodId,
      period: currentPeriodId === 101 ? "Term 1" : "Term 2",
      period_sequence: currentPeriodId === 101 ? 1 : 2,
      total_periods: 3,
      academicyear: "2026-2027",
      academic_year_id: 1,
      startDate: null,
      endDate: null,
      is_active: true,
      status: "active",
    },
    selectedYear: {
      academic_year_id: 1,
      year_label: "2026-2027",
      start_date: null,
      end_date: null,
      is_active: true,
    },
    periods: [
      { id: 101, period: "Term 1", period_sequence: 1, total_periods: 3, academicyear: "2026-2027", academic_year_id: 1, is_active: true, status: "active", startDate: null, endDate: null },
      { id: 102, period: "Term 2", period_sequence: 2, total_periods: 3, academicyear: "2026-2027", academic_year_id: 1, is_active: false, status: "inactive", startDate: null, endDate: null },
    ],
    academicYears: [],
    years: [],
    isLoading: false,
    setSelectedPeriodId: vi.fn(),
    setSelectedYearId: vi.fn(),
    refetch: vi.fn(),
    registerDirtyGuard: () => () => {},
  }),
  useOptionalAcademicPeriod: () => ({
    selectedPeriodId: currentPeriodId,
    selectedYearId: currentYearId,
  }),
}));

function mockRecordDetail(periodId: number, grade: number, runningAvg: number): StudentRecordDetailResponse {
  return {
    student: {
      student_id: "student-1",
      lrn: "123456789012",
      full_name: "Juan Dela Cruz",
      section_name: "Grade 9 - Diamond",
      status: "enrolled",
    },
    scope: {
      class_id: 1,
      subject_id: 10,
      academic_year_id: 1,
      academic_period_id: periodId,
      section_name: "Diamond",
      subject_name: "English 9",
      period_name: periodId === 101 ? "Term 1" : "Term 2",
      year_label: "2026-2027",
    },
    summary: {
      official_period_grade: grade,
      running_classwork_percentage: runningAvg,
      completion_rate: 90,
      assigned_count: 5,
      submitted_count: 4,
      missing_count: 1,
      late_count: 0,
      graded_count: 4,
      ungraded_count: 0,
    },
    classwork_results: [
      {
        classwork_id: 1,
        assignment_id: 11,
        title: periodId === 101 ? "Term 1 Essay" : "Term 2 Research",
        type: "ASSIGNMENT",
        status: "graded",
        score: grade,
        total_points: 100,
        percentage: grade,
        lesson_links: [{ lesson_id: 1, title: "Literature Intro" }],
      },
    ],
  };
}

describe("StudentRecord Period Synchronization & Header Cleanup", () => {
  beforeEach(() => {
    currentPeriodId = 101;
    currentYearId = 1;
    mockApi.getDetail.mockReset();
    mockApi.getSuggestions.mockReset().mockResolvedValue({ suggestions: [] });
  });

  afterEach(cleanup);

  it("removes duplicate period selector dropdown from TeacherStudentView header while preserving View History and Suggest Material", () => {
    const detail = mockRecordDetail(101, 88, 91.5);
    render(
      <TeacherStudentView
        student={{
          student_id: "student-1",
          student_lrn: "123456789012",
          full_name: "Juan Dela Cruz",
          gender: "Male",
          email: "juan@example.test",
          account_status: "enrolled",
          avatar_initial: "J",
        } as unknown as TeacherAdvisoryStudentItem}
        studentDetail={detail}
        classId={1}
        subjectLoads={[{ subject_load_id: 1, subject_id: 10, subject_name: "English 9" } as unknown as TeacherAdvisorySubjectLoadItem]}
        sectionName="Diamond"
        subjectName="English 9"
      />
    );

    // 1. Verify NO period select dropdown exists in the header
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Select period/i)).toBeNull();

    // 2. Verify Suggest Material and View History buttons are absent from Student Record
    expect(screen.queryByRole("button", { name: /Suggest Material/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /View History/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Hide History/i })).toBeNull();
    expect(screen.getAllByText("Juan Dela Cruz").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Official Grade")).toBeTruthy();
    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getByText("Running Average")).toBeTruthy();
    expect(screen.getByText("91.5%")).toBeTruthy();
    expect(screen.getAllByText("Term 1 Essay").length).toBeGreaterThanOrEqual(1);
  });

  it("updates student record automatically when sidebar term changes without leaking stale data", async () => {
    mockApi.getDetail.mockResolvedValue(mockRecordDetail(101, 88, 91.5));

    const testStudent = {
      student_id: "student-1",
      student_lrn: "123456789012",
      full_name: "Juan Dela Cruz",
      gender: "Male",
      email: "juan@example.test",
      account_status: "enrolled",
      avatar_initial: "J",
    } as unknown as TeacherAdvisoryStudentItem;
    const testLoads = [{ subject_load_id: 1, subject_id: 10, subject_name: "English 9" } as unknown as TeacherAdvisorySubjectLoadItem];

    // Render TeacherStudentView in loading state when switching
    const { rerender } = render(
      <TeacherStudentView
        student={testStudent}
        studentDetail={mockRecordDetail(101, 88, 91.5)}
        classId={1}
        subjectLoads={testLoads}
      />
    );

    expect(screen.getByText("88")).toBeTruthy();
    expect(screen.getAllByText("Term 1 Essay").length).toBeGreaterThanOrEqual(1);

    // Simulate switching term: old detail cleared, loading shown
    rerender(
      <TeacherStudentView
        student={testStudent}
        studentDetail={null}
        isDetailLoading={true}
        classId={1}
        subjectLoads={testLoads}
      />
    );

    // Verify stale data is NOT displayed during loading
    expect(screen.queryByText("88")).toBeNull();
    expect(screen.queryByText("Term 1 Essay")).toBeNull();
    expect(screen.getByText(/Loading student analytics/i)).toBeTruthy();

    // New term data loaded
    rerender(
      <TeacherStudentView
        student={testStudent}
        studentDetail={mockRecordDetail(102, 94, 96.0)}
        isDetailLoading={false}
        classId={1}
        subjectLoads={testLoads}
      />
    );

    expect(screen.getByText("94")).toBeTruthy();
    expect(screen.getByText("96%")).toBeTruthy();
    expect(screen.getAllByText("Term 2 Research").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Term 1 Essay")).toBeNull();
  });
});
