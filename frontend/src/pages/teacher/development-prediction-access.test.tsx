// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PredictionsDashboard from "./predictions";
import PredictionTable from "@/components/predictions/prediction-table";

const auth = vi.hoisted(() => ({ role: "teacher" as "teacher" | "admin" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ role: auth.role }) }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => ({ selectedPeriodId: 3 }) }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/predictions/prediction-detail-sheet", () => ({ default: () => null }));
vi.mock("@/components/predictions/development-current-term-panel", () => ({ default: () => <div>Development panel mounted</div> }));
vi.mock("@/components/retroui/Tabs", () => ({ Tabs: ({ tabs, onTabChange }: { tabs: Array<{ id: string; label: string }>; onTabChange: (id: string) => void }) => <div>{tabs.map((tab) => <button key={tab.id} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}</div> }));
vi.mock("@/lib/prediction-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/prediction-api")>();
  return {
    ...original,
    fetchDashboardFilters: vi.fn().mockResolvedValue({ grades: [], classes: [], subjects: [], terms: [] }),
    fetchDashboardGradeSummaries: vi.fn().mockResolvedValue([]),
    fetchDashboardAtRisk: vi.fn().mockResolvedValue({ items: [], total: 0, risk_summary: { total: 0 } }),
  };
});

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe("shared prediction page access", () => {
  it("keeps the teacher on the legacy view even with the development flag", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    auth.role = "teacher";
    render(<PredictionsDashboard />);
    expect(screen.queryByText("Current-Term Development")).toBeNull();
    expect(screen.queryByText("Development panel mounted")).toBeNull();
    expect(screen.getByText("AI Predictions")).toBeTruthy();
  });

  it("hides the development tab in production, including for admins", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    auth.role = "admin";
    render(<PredictionsDashboard />);
    expect(screen.queryByText("Current-Term Development")).toBeNull();
  });

  it("mounts the development surface only for an enabled admin", () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_DEVELOPMENT_PREDICTIONS", "true");
    auth.role = "admin";
    render(<PredictionsDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "Current-Term Development" }));
    expect(screen.getByText("Development panel mounted")).toBeTruthy();
  });

  it("leaves the legacy table's risk-score rendering intact", () => {
    render(<PredictionTable items={[{
      prediction_id: 1,
      student_id: "s1",
      student_name: "Alex Rivera",
      student_lrn: "123456789012",
      class_name: "Archimedes",
      subject_name: "Science",
      term_label: "Term 1",
      term_number: 1,
      predicted_period_grade: 84,
      risk_level: "MODERATE_RISK",
      risk_score: 70,
      data_status: "GENERATED",
      generated_at: null,
    }]} total={1} limit={5} offset={0} onSort={() => {}} onPageChange={() => {}} onRowClick={() => {}} />);
    expect(screen.getByText("Predicted Grade")).toBeTruthy();
    expect(screen.getByText("Risk Level")).toBeTruthy();
    expect(screen.getByText("Risk Score")).toBeTruthy();
  });
});
