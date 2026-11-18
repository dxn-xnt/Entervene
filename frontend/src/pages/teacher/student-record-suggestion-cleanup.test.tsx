// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TeacherStudentView } from "./student-view";
import type { StudentRecordDetailResponse } from "@/lib/student-record-api";
import type { TeacherAdvisoryStudentItem, TeacherAdvisorySubjectLoadItem } from "@/types/adminClasses";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const mockApi = vi.hoisted(() => ({
  getDetail: vi.fn(),
  getPredictions: vi.fn(),
}));

vi.mock("@/lib/student-record-api", () => ({
  getStudentRecordDetail: mockApi.getDetail,
  getStudentRecordPredictions: mockApi.getPredictions,
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useOptionalAcademicPeriod: () => ({
    selectedPeriodId: 101,
    selectedYearId: 1,
    terms: [
      { academic_period_id: 101, period_name: "Term 1", is_active: true },
      { academic_period_id: 102, period_name: "Term 2", is_active: false },
    ],
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const sampleDetail: StudentRecordDetailResponse = {
  student: {
    student_id: "s-1",
    lrn: "123456789012",
    full_name: "Juan Dela Cruz",
    status: "active",
    academic_level: "Grade 9",
    section_name: "Grade 9 - Diamond",
    gender: "Male",
    email: "juan@example.test",
  },
  scope: {
    class_id: 1,
    subject_id: 10,
    academic_year_id: 1,
    academic_period_id: 101,
    section_name: "Diamond",
    subject_name: "English 9",
    period_name: "Term 1",
    year_label: "2026-2027",
  },
  summary: {
    official_period_grade: 90,
    running_classwork_percentage: 91.5,
    completion_rate: 100,
    assigned_count: 3,
    submitted_count: 3,
    missing_count: 0,
    late_count: 0,
    graded_count: 3,
    ungraded_count: 0,
  },
  classwork_results: [
    {
      classwork_id: 1,
      assignment_id: 10,
      title: "Introduction Quiz",
      type: "QUIZ",
      lesson_links: [{ lesson_id: 1, title: "Lesson 1: Introduction" }],
      status: "graded",
      score: 18,
      total_points: 20,
      percentage: 90,
      due_date: null,
      submitted_at: "2026-11-01T10:00:00Z",
    },
  ],
};

const sampleStudent: TeacherAdvisoryStudentItem = {
  student_id: "s-1",
  student_lrn: "123456789012",
  full_name: "Juan Dela Cruz",
  gender: "Male",
  email: "juan@example.test",
  account_status: "active",
  avatar_initial: "J",
};

const sampleLoads: TeacherAdvisorySubjectLoadItem[] = [
  {
    subject_load_id: 1,
    subject_id: 10,
    subject_name: "English 9",
  } as unknown as TeacherAdvisorySubjectLoadItem,
];

describe("Teacher Student Record — Suggest Material UI Cleanup", () => {
  beforeEach(() => {
    mockApi.getDetail.mockResolvedValue(sampleDetail);
    mockApi.getPredictions.mockResolvedValue({ predictions: [] });
  });

  it("does not render Suggest Material or View/Hide History buttons in Student Record", async () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <TeacherStudentView
            classId="1"
            subjectId="10"
            student={sampleStudent}
            studentDetail={sampleDetail}
            subjectLoads={sampleLoads}
            sectionName="Diamond"
            subjectName="English 9"
          />
        </SidebarProvider>
      </MemoryRouter>,
    );

    // Suggest Material button is absent
    expect(screen.queryByRole("button", { name: /Suggest Material/i })).toBeNull();

    // View History / Hide History buttons are absent
    expect(screen.queryByRole("button", { name: /View History/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Hide History/i })).toBeNull();

    // Suggestion History container is absent
    expect(screen.queryByText("Suggestion History")).toBeNull();

    // Suggestion-specific active/draft counters are absent
    expect(screen.queryByText(/active,\s*\d+\s*draft/i)).toBeNull();
  });

  it("preserves the student Active enrollment status badge on the profile", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <TeacherStudentView
            classId="1"
            subjectId="10"
            student={sampleStudent}
            studentDetail={sampleDetail}
            subjectLoads={sampleLoads}
            sectionName="Diamond"
            subjectName="English 9"
          />
        </SidebarProvider>
      </MemoryRouter>,
    );

    // Student account/enrollment status badge (Active) is rendered
    expect(screen.getByText("Active")).toBeDefined();
    // Grade level badge
    expect(screen.getByText("Grade 9")).toBeDefined();
    // LRN
    expect(screen.getByText(/LRN: 123456789012/i)).toBeDefined();
  });

  it("preserves all academic performance information (Official Grade, Running Average, Lesson Performance)", () => {
    render(
      <MemoryRouter>
        <SidebarProvider>
          <TeacherStudentView
            classId="1"
            subjectId="10"
            student={sampleStudent}
            studentDetail={sampleDetail}
            subjectLoads={sampleLoads}
            sectionName="Diamond"
            subjectName="English 9"
          />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Lesson Performance")).toBeDefined();
    expect(screen.getByText("Official Grade")).toBeDefined();
    expect(screen.getByText("90")).toBeDefined();
    expect(screen.getByText("Running Average")).toBeDefined();
    expect(screen.getByText("91.5%")).toBeDefined();
    expect(screen.getByText("Lesson 1: Introduction")).toBeDefined();
  });
});
