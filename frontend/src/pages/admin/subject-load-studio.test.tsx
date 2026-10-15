// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminSubjectLoadStudio from "./subject-load-studio";

const getStudio = vi.hoisted(() => vi.fn());
const validate = vi.hoisted(() => vi.fn());
const unlock = vi.hoisted(() => vi.fn());

vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ getSetting: (_: string, fallback: string) => fallback }) }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => ({ selectedPeriodId: 1 }) }));
vi.mock("@/components/retroui/use-toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
  getSubjectLoadStudioData: getStudio,
  validateSubjectLoads: validate,
  unlockSection: unlock,
  batchSaveSubjectLoads: vi.fn(),
  autoScheduleSubjectLoads: vi.fn(),
  discardDraft: vi.fn(),
}));

const baseline = {
  active_period_id: 1,
  academic_years: [{ academic_year_id: 1, year_label: "2026-2027", is_active: true }],
  academic_periods: [{ academic_period_id: 1, period_name: "Term 1", is_active: true }],
  academic_levels: [{ academic_level_id: 9, level_name: "Grade 9", grade_level: 9 }],
  classes: [{ class_id: 8, section_name: "Archimedes", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" }],
  subjects: [{ subject_id: 3, subject_name: "Filipino 9", subject_codename: "F9", academic_level_id: 9, subject_group: "Core" }],
  teachers: [{ staff_id: "T1", name: "Maria Cruz", department: "Filipino", specialization: "Filipino" }],
  existing_loads: [{ subject_load_id: 12, class_id: 8, subject_id: 3, staff_id: "T1", academic_period_id: 1,
    start_time: "08:00", end_time: "08:45", days_of_week: ["MON"], status: "published", is_locked: true, section_revision: 1 }],
  has_pending_draft_by_class: {},
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Subject Load Studio locked section", () => {
  it("shows the lock, keeps assignments visible, and disables list edits", async () => {
    getStudio.mockResolvedValue(baseline);
    validate.mockResolvedValue({ conflicts: [{ rule: "TEACHER_OVERLAP", severity: "error", message: "Teacher overlap in Archimedes", class_id: 8, subject_id: 3 }], teacher_workloads: [], is_valid: false });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Section Locked")).toBeTruthy());
    expect(screen.getByText(/Unlock it to modify subject schedules/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unlock Section/i })).toBeTruthy();
    fireEvent.click(screen.getByText("List"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Maria Cruz/i })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Maria Cruz/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "M" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/Teacher overlap in Archimedes/i).length).toBeGreaterThan(0);
  });

  it("restores list editing after an authorized unlock refresh", async () => {
    const unlocked = {
      ...baseline,
      existing_loads: [{ ...baseline.existing_loads[0], status: "draft", is_locked: false, subject_load_id: 13, base_revision: 1 }],
      has_pending_draft_by_class: { 8: true },
    };
    getStudio.mockResolvedValueOnce(baseline).mockResolvedValue(unlocked);
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    unlock.mockResolvedValue({ section_revision: 2 });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Section Locked")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Unlock Section/i }));
    await waitFor(() => expect(screen.queryByText("Section Locked")).toBeNull());
    expect(unlock).toHaveBeenCalledWith(1, 8);
    fireEvent.click(screen.getByText("List"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Maria Cruz/i })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Maria Cruz/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "M" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows canonical SHS pathways in both views and updates on section navigation", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
      classes: [
        { class_id: 12, section_name: "Zara", academic_level_id: 11, academic_year_id: 1, pathway_id: 1,
          pathway: "medical-courses", pathway_name: "Medical Courses and Sciences Related", pathway_is_enabled: true, requires_pathway: true },
        { class_id: 13, section_name: "Campos", academic_level_id: 11, academic_year_id: 1, pathway_id: 2,
          pathway: "engineering-math", pathway_name: "Engineering and Mathematics Related", pathway_is_enabled: true, requires_pathway: true },
      ],
      subjects: [], existing_loads: [], has_pending_draft_by_class: {},
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy());
    fireEvent.click(screen.getByText("List"));
    expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    await waitFor(() => expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Search class"), { target: { value: "Medical Courses" } });
    await waitFor(() => expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy());
    expect(screen.queryByText("Engineering and Mathematics Related")).toBeNull();
  });

  it("shows a Grade 12 assignment when its academic year enables pathways", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      academic_levels: [{ academic_level_id: 12, level_name: "Grade 12", grade_level: 12 }],
      classes: [{ class_id: 21, section_name: "Sample", academic_level_id: 12, academic_year_id: 1,
        pathway_id: 2, pathway: "engineering-math", pathway_name: "Engineering and Mathematics Related",
        pathway_is_enabled: true, requires_pathway: true }],
      subjects: [], existing_loads: [], has_pending_draft_by_class: {},
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy());
    fireEvent.click(screen.getByText("List"));
    expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy();
  });
});
