// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AdminSystemSettings from "./system-settings";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ refetch: vi.fn() }) }));
const templates = [
  [1, "Core", 87, 20, 50, 30, 28, true],
  [10, "Applied", 85, 20, 60, 20, 1, false],
  [8, "Specialized", 85, 20, 50, 30, 11, false],
].map(([id, name, threshold, ww, pt, exams, count, locked]) => ({
  grading_template_id: id, template_name: name, passing_threshold: threshold,
  assigned_subject_count: count, is_locked: locked,
  lock_reason: locked ? "Recorded classwork grades" : null, status: "active",
  components: [
    { component_name: "Written Work", weight: ww },
    { component_name: "Performance Tasks", weight: pt },
    { component_name: "Exams", weight: exams },
  ], updated_at: "2026-10-18T00:00:00Z",
}));
vi.mock("@/lib/api", () => ({
  getGradingTemplates: vi.fn().mockImplementation(() => Promise.resolve({ grading_templates: templates })),
  fetchPathways: vi.fn().mockResolvedValue({ pathways: [] }),
  fetchPathwayScopes: vi.fn().mockResolvedValue({ scopes: [] }),
  updatePathway: vi.fn(), updatePathwayScopes: vi.fn(),
}));
vi.mock("@/lib/settings-api", () => ({
  getAllSettings: vi.fn().mockResolvedValue({ groups: {} }),
  getAcademicYearsSettings: vi.fn().mockResolvedValue([]),
  getAcademicLevelsSettings: vi.fn().mockResolvedValue([]),
  getAcademicPeriodsSettings: vi.fn().mockResolvedValue([]),
  setActiveAcademicYear: vi.fn(), setActivePeriod: vi.fn(), updateSetting: vi.fn(),
}));

afterEach(() => { cleanup(); navigate.mockClear(); });
describe("grading template settings overview", () => {
  it("renders read-only cards with no edit or save actions", async () => {
    render(<AdminSystemSettings />);
    await screen.findByText("Grading Templates");
    expect(screen.queryByRole("button", { name: "Edit Template" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Save Changes/ })).toBeNull();
    expect(screen.getByText("87%")).toBeTruthy();
    expect(screen.getAllByText("Exams")).toHaveLength(3);
    expect(screen.queryByText("Subject Grading Standards")).toBeNull();
    expect(screen.queryByText("Add Subject Group")).toBeNull();
  });

  it("links directly to the Subjects grading tab", async () => {
    render(<AdminSystemSettings />);
    await screen.findByText("Grading Templates");
    fireEvent.click(screen.getByRole("button", { name: /Manage in Subjects/ }));
    expect(navigate).toHaveBeenCalledWith("/admin/subjects?tab=grading");
  });
});
