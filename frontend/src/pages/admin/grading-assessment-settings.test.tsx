// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminSystemSettings from "./system-settings";

const navigate = vi.hoisted(() => vi.fn());
const getYearPolicy = vi.hoisted(() => vi.fn().mockResolvedValue({
  academic_year_id: 7, year_label: "2026-2027", is_active: true,
  configured: true, threshold: "80.00", version: 1,
}));
const saveYearPolicy = vi.hoisted(() => vi.fn().mockResolvedValue({
  academic_year_id: 7, year_label: "2026-2027", is_active: true,
  configured: true, threshold: "83.00", version: 2,
}));
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
  getOfficialSections: vi.fn().mockResolvedValue([]),
  fetchPathways: vi.fn().mockResolvedValue({ pathways: [] }),
  fetchPathwayScopes: vi.fn().mockResolvedValue({ scopes: [] }),
  updatePathway: vi.fn(), updatePathwayScopes: vi.fn(),
}));
vi.mock("@/lib/settings-api", () => ({
  getAllSettings: vi.fn().mockResolvedValue({ groups: {} }),
  getAcademicYearsSettings: vi.fn().mockResolvedValue([{ academic_year_id: 7, year_label: "2026-2027", is_active: true }]),
  getYearGeneralAveragePolicy: getYearPolicy, saveYearGeneralAveragePolicy: saveYearPolicy,
  getAcademicLevelsSettings: vi.fn().mockResolvedValue([]),
  getAcademicPeriodsSettings: vi.fn().mockResolvedValue([]),
  setActiveAcademicYear: vi.fn(), setActivePeriod: vi.fn(), updateSetting: vi.fn(),
}));

afterEach(() => { cleanup(); navigate.mockClear(); getYearPolicy.mockClear(); saveYearPolicy.mockClear(); });
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

  it("saves a confirmed year-specific general-average edit with an audit reason", async () => {
    render(<AdminSystemSettings />);
    const field = await screen.findByLabelText("General Average Passing Grade");
    fireEvent.change(field, { target: { value: "83" } });
    fireEvent.change(screen.getByLabelText("Audit reason"), { target: { value: "Approved annual policy" } });
    fireEvent.click(screen.getByLabelText("I confirm this year-specific policy action."));
    fireEvent.click(screen.getByRole("button", { name: "Save Threshold" }));
    await waitFor(() => expect(saveYearPolicy).toHaveBeenCalledWith(7, {
      threshold: "83", expected_version: 1, reason: "Approved annual policy",
      action: "edit", confirmed: true,
    }));
  });

  it("requires explicit confirmation of the legacy proposal", async () => {
    getYearPolicy.mockResolvedValueOnce({ academic_year_id: 7, year_label: "2026-2027",
      is_active: true, configured: false, threshold: null, version: 0,
      legacy_proposal: "80", previous_academic_year_id: null });
    render(<AdminSystemSettings />);
    const button = await screen.findByRole("button", { name: "Confirm legacy proposal (80%)" });
    fireEvent.click(button);
    expect(saveYearPolicy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Audit reason"), { target: { value: "Confirmed by administrator" } });
    fireEvent.click(screen.getByLabelText("I confirm this year-specific policy action."));
    fireEvent.click(button);
    await waitFor(() => expect(saveYearPolicy).toHaveBeenCalledWith(7, {
      threshold: "80", expected_version: 0, reason: "Confirmed by administrator",
      action: "confirm_legacy", confirmed: true,
    }));
    expect(screen.queryByRole("button", { name: "Set initial passing grade manually" })).toBeNull();
  });

  it.each(["missing", "invalid"] as const)("offers explicit manual initialization for %s legacy policy", async (legacyState) => {
    getYearPolicy.mockResolvedValueOnce({ academic_year_id: 7, year_label: "2026-2027",
      is_active: true, configured: false, threshold: null, version: 0,
      legacy_proposal: null, previous_academic_year_id: null,
      ...(legacyState === "invalid" ? { legacy_error: "The legacy value is invalid." } : {}),
    });
    render(<AdminSystemSettings />);
    const button = await screen.findByRole("button", { name: "Set initial passing grade manually" });
    expect(screen.getByText("Unconfigured for this academic year")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm legacy proposal/ })).toBeNull();
    fireEvent.click(button);
    expect(saveYearPolicy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("General Average Passing Grade"), { target: { value: "82.25" } });
    fireEvent.change(screen.getByLabelText("Audit reason"), { target: { value: "Approved initial policy" } });
    fireEvent.click(screen.getByLabelText("I confirm this year-specific policy action."));
    fireEvent.click(button);
    await waitFor(() => expect(saveYearPolicy).toHaveBeenCalledWith(7, {
      threshold: "82.25", expected_version: 0, reason: "Approved initial policy",
      action: "initialize_manual", confirmed: true,
    }));
  });

  it("copies from the previous academic year only on explicit action", async () => {
    getYearPolicy.mockImplementation((yearId: number) => Promise.resolve(yearId === 7
      ? { academic_year_id: 7, year_label: "2026-2027", is_active: true,
          configured: false, threshold: null, version: 0, previous_academic_year_id: 6 }
      : { academic_year_id: 6, year_label: "2025-2026", is_active: false,
          configured: true, threshold: "80.00", version: 1 }));
    render(<AdminSystemSettings />);
    const button = await screen.findByRole("button", { name: "Copy from Previous Academic Year" });
    fireEvent.change(screen.getByLabelText("Audit reason"), { target: { value: "Approved carry-forward" } });
    fireEvent.click(screen.getByLabelText("I confirm this year-specific policy action."));
    fireEvent.click(button);
    await waitFor(() => expect(saveYearPolicy).toHaveBeenCalledWith(7, {
      threshold: "80.00", expected_version: 0, reason: "Approved carry-forward",
      action: "copy_previous", confirmed: true, source_year_id: 6,
    }));
    expect(getYearPolicy).toHaveBeenCalledWith(6);
  });
});
