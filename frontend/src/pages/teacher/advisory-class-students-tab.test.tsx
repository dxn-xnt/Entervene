// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdvisoryClassDetail from "./advisory-class-view";
import type { TeacherAdvisoryClassDetailResponse } from "@/types/adminClasses";

const mockClassDetail: TeacherAdvisoryClassDetailResponse = {
  class_id: 1,
  section_name: "Diamond",
  academic_level: "Grade 8",
  academic_year: "2026-2027",
  academic_year_id: 1,
  class_status: "active",
  is_archived: false,
  created_at: "2026-06-01T00:00:00Z",
  active_since: "2026-06-01T00:00:00Z",
  student_count: 3,
  male_count: 2,
  female_count: 1,
  subject_count: 2,
  students: [
    {
      student_id: "stud-m1",
      full_name: "Juan Dela Cruz",
      student_lrn: "123456789001",
      gender: "Male",
      email: "juan@example.com",
      account_status: "ACTIVE",
      avatar_initial: "J",
    },
    {
      student_id: "stud-m2",
      full_name: "Ben Santos",
      student_lrn: "123456789002",
      gender: "Male",
      email: "ben@example.com",
      account_status: "ACTIVE",
      avatar_initial: "B",
    },
    {
      student_id: "stud-f1",
      full_name: "Ana Reyes",
      student_lrn: "123456789003",
      gender: "Female",
      email: "ana@example.com",
      account_status: "ACTIVE",
      avatar_initial: "A",
    },
  ],
  subject_loads: [
    {
      subject_load_id: 101,
      subject_id: 10,
      subject_name: "Mathematics 8",
      teacher_id: "teacher-1",
      teacher_name: "Pedro Penduko",
      schedule: null,
      status: "active",
    },
  ],
};

const api = vi.hoisted(() => ({
  getClassDetail: vi.fn(),
  exportBatchSF9: vi.fn(),
  getTeacherSuggestions: vi.fn(),
  getStudentSF9Data: vi.fn(),
  getClassSF9BatchData: vi.fn(),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

vi.mock("@/lib/api", () => ({
  getTeacherAdvisoryClassDetail: api.getClassDetail,
  exportTeacherAdvisoryBatchSF9: api.exportBatchSF9,
  getTeacherAdvisoryStudentSF9Data: api.getStudentSF9Data,
  getTeacherAdvisoryClassSF9BatchData: api.getClassSF9BatchData,
  getClassSchedule: vi.fn().mockResolvedValue({ entries: [] }),
  getTeacherAdvisoryClassGrades: vi.fn().mockResolvedValue({ grades: [], students: [] }),
}));

vi.mock("@/lib/suggestion-api", () => ({
  getTeacherSuggestions: api.getTeacherSuggestions,
  createBulkManualSuggestion: vi.fn(),
  createManualSuggestion: vi.fn(),
  generateRecommendationDrafts: vi.fn(),
  dismissSuggestion: vi.fn(),
  approveSuggestion: vi.fn(),
  archiveSuggestion: vi.fn(),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({ selectedPeriodId: 1, periods: [] }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("AdvisoryClassDetail - StudentsTab Integration", () => {
  beforeEach(() => {
    api.getClassDetail.mockResolvedValue(mockClassDetail);
    api.getTeacherSuggestions.mockResolvedValue({ suggestions: [] });
    api.getStudentSF9Data.mockResolvedValue({
      school_info: {
        school_name: "Entervene Demonstration School",
        school_id: "303012",
        region: "Region IV-A",
        division: "Schools Division Office",
        district: "District I",
        municipality: "Medellin",
        principal_name: "School Principal",
      },
      student: {
        student_id: "stud-m1",
        student_lrn: "123456789001",
        full_name: "Juan Dela Cruz",
        gender: "Male",
        dob: "2010-01-01",
        age: 14,
        track: "",
      },
      class_info: {
        class_id: 1,
        grade_level: "Grade 8",
        section_name: "Diamond",
        academic_year: "2026-2027",
        adviser_name: "Adviser Teacher",
      },
      periods: [
        { academic_period_id: 1, period_name: "Term 1", period_sequence: 1 },
      ],
      learning_areas: {
        core: [],
        electives: [],
      },
      general_average: {
        final_rating: 88.5,
        descriptor: "Very Satisfactory",
        remarks: "Passed",
      },
      descriptors: [
        { scale: "90-100", description: "Advancing", remarks: "Passed" },
      ],
      attendance: {
        months: [],
        total: {
          class_days: 200,
          present: 195,
          absent: 5,
        },
      },
    });
    api.getClassSF9BatchData.mockImplementation(() => new Promise(() => {}));
    api.exportBatchSF9.mockResolvedValue({
      blob: new Blob(["test"], { type: "application/zip" }),
      filename: "SF9_Advisory_Class_1.zip",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderView() {
    return render(
      <MemoryRouter initialEntries={["/teacher/advisory/1"]}>
        <Routes>
          <Route path="/teacher/advisory/:classId" element={<AdvisoryClassDetail />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("renders Students tab with header actions and NO redundant per-row SF9 buttons", async () => {
    renderView();

    // Switch to Students tab
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    // Verify all 3 primary header actions exist
    expect(await screen.findByRole("button", { name: /SF9 \(PDF\)/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /SF9 \(Excel\)/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Suggest Material/i })).toBeTruthy();

    // Verify student roster is displayed
    expect(screen.getByText("Juan Dela Cruz")).toBeTruthy();
    expect(screen.getByText("Ben Santos")).toBeTruthy();
    expect(screen.getByText("Ana Reyes")).toBeTruthy();

    // History buttons exist on rows
    const historyButtons = screen.getAllByRole("button", { name: /History/i });
    expect(historyButtons.length).toBe(3);

    // CRITICAL: Ensure NO per-row SF9 buttons exist
    const rowSF9Buttons = screen.queryAllByRole("button", { name: /^SF9$/i });
    expect(rowSF9Buttons.length).toBe(0);
  });

  it("allows selecting students across gender groups, with Select All and Clear Selection", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    await screen.findByText("Juan Dela Cruz");

    // Suggest Material button is initially disabled
    const suggestBtn = screen.getByRole("button", { name: /Suggest Material/i });
    expect(suggestBtn.hasAttribute("disabled")).toBe(true);

    // Select a male student and a female student
    const juanCheckbox = screen.getByRole("checkbox", { name: "Select Juan Dela Cruz" });
    const anaCheckbox = screen.getByRole("checkbox", { name: "Select Ana Reyes" });

    fireEvent.click(juanCheckbox);
    fireEvent.click(anaCheckbox);

    // Suggest button is now enabled and shows count 2
    expect(suggestBtn.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("2 of 3 selected")).toBeTruthy();

    // Clear Selection
    fireEvent.click(screen.getByRole("button", { name: /Clear Selection/i }));
    expect(screen.queryByText(/of 3 selected/)).toBeNull();
    expect(suggestBtn.hasAttribute("disabled")).toBe(true);

    // Select All
    fireEvent.click(screen.getByRole("button", { name: /Select All/i }));
    expect(screen.getByText("3 of 3 selected")).toBeTruthy();
    expect(suggestBtn.hasAttribute("disabled")).toBe(false);
  });

  it("opens Suggest Material dialog and displays confirmed recipient badges", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    await screen.findByText("Juan Dela Cruz");

    // Select Juan Dela Cruz
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Juan Dela Cruz" }));

    // Click Suggest Material
    const suggestBtn = screen.getByRole("button", { name: /Suggest Material/i });
    fireEvent.click(suggestBtn);

    // Verify dialog opens with confirmed recipient
    expect(await screen.findByText("Suggest Study Material")).toBeTruthy();
    expect(screen.getByText("Target Recipients (1)")).toBeTruthy();
    expect(screen.getAllByText("Juan Dela Cruz").length).toBeGreaterThanOrEqual(2);
  });

  it("opens History modal when History button is clicked and resets on close", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    await screen.findByText("Juan Dela Cruz");

    // Click History for Juan Dela Cruz
    const juanRow = screen.getByText("Juan Dela Cruz").closest("div[class*='border-b']") as HTMLElement;
    const historyBtn = within(juanRow).getByRole("button", { name: /History/i });
    fireEvent.click(historyBtn);

    // Modal opens
    expect(await screen.findByText("Suggestion History")).toBeTruthy();
    expect(screen.getByText(/Juan Dela Cruz • LRN 123456789001/)).toBeTruthy();
    expect(api.getTeacherSuggestions).toHaveBeenCalledWith({
      classId: 1,
      studentId: "stud-m1",
    });
  });

  it("handles SF9 (PDF) dropdown actions: Preview Individual, Download Selected, and Download All", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    await screen.findByText("Juan Dela Cruz");

    // Initially with 0 students selected:
    // Preview Individual should be disabled
    const previewItem = screen.getByRole("button", { name: /Preview Individual/i });
    expect(previewItem.hasAttribute("disabled")).toBe(true);

    // Download Selected should be disabled
    const downloadSelectedItem = screen.getByRole("button", { name: /Download Selected/i });
    expect(downloadSelectedItem.hasAttribute("disabled")).toBe(true);

    // Download All should be enabled
    const downloadAllItem = screen.getByRole("button", { name: /Download All/i });
    expect(downloadAllItem.hasAttribute("disabled")).toBe(false);

    // Trigger Download All -> opens batch PDF modal with "Export All Students"
    fireEvent.click(downloadAllItem);
    expect(await screen.findByText(/Export All Students — Printable PDF/i)).toBeTruthy();

    // Close the batch modal
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    // Select exactly 1 student: Juan Dela Cruz
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Juan Dela Cruz" }));

    // Both Preview Individual and Download Selected should now be enabled
    expect(previewItem.hasAttribute("disabled")).toBe(false);
    expect(downloadSelectedItem.hasAttribute("disabled")).toBe(false);

    // Click Preview Individual -> opens preview modal
    fireEvent.click(previewItem);
    expect(await screen.findByText(/Learner's Performance Report \(SF9 \/ Form 138\)/i)).toBeTruthy();
    expect(api.getStudentSF9Data).toHaveBeenCalledWith(1, "stud-m1");

    // Close preview modal
    const closeButtons = screen.getAllByRole("button", { name: /Close/i });
    fireEvent.click(closeButtons[0]);

    // Select a second student: Ben Santos (total 2 selected)
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ben Santos" }));

    // Preview Individual should now be disabled (requires exactly 1)
    expect(previewItem.hasAttribute("disabled")).toBe(true);

    // Download Selected should still be enabled (2 selected)
    expect(downloadSelectedItem.hasAttribute("disabled")).toBe(false);

    // Click Download Selected -> opens batch PDF modal with "Export Selected Students"
    fireEvent.click(downloadSelectedItem);
    expect(await screen.findByText(/Export Selected Students — Printable PDF/i)).toBeTruthy();
  });

  it("invokes export SF9 Excel for all students when Export All is selected", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    await screen.findByText("Juan Dela Cruz");

    // Open Export SF9 Excel dropdown
    const exportExcelBtn = screen.getByRole("button", { name: /SF9 \(Excel\)/i });
    fireEvent.click(exportExcelBtn);

    // Click Export All Students
    const exportAllItem = await screen.findByText("Export All Students");
    fireEvent.click(exportAllItem);

    await waitFor(() => {
      expect(api.exportBatchSF9).toHaveBeenCalledWith(1, undefined, "zip");
    });
  });

  it("invokes export SF9 Excel for selected students when Export Selected is chosen", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("tab", { name: /Students/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: /Students/i }));

    await screen.findByText("Ana Reyes");

    // Select Ana Reyes
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Reyes" }));

    // Open Export SF9 Excel dropdown
    const exportExcelBtn = screen.getByRole("button", { name: /SF9 \(Excel\)/i });
    fireEvent.click(exportExcelBtn);

    // Click Export Selected Students
    const exportSelectedItem = await screen.findByText("Export Selected Students");
    fireEvent.click(exportSelectedItem);

    await waitFor(() => {
      expect(api.exportBatchSF9).toHaveBeenCalledWith(1, ["stud-f1"], "zip");
    });
  });
});
