// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminAcademicPeriods from "./academic-periods";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("./forms/view-previous-periods", () => ({ default: () => null }));
vi.mock("@/lib/api", () => ({ API_URL: "http://localhost:8000" }));

const periods = [
  { id: 1, period: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 10, academicyear: "2026-2027", startDate: "2026-06-01", endDate: "2026-08-31", is_active: true, status: "Active" },
  { id: 2, period: "Term 2", period_type: "TERM", period_sequence: 2, academic_year_id: 10, academicyear: "2026-2027", startDate: "2026-09-01", endDate: "2026-11-30", is_active: false, status: "Upcoming" },
];

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); navigate.mockClear(); });

describe("admin academic period warning", () => {
  it("shows a non-blocking overdue warning and links to the existing activation screen", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ periods }) }));
    render(<AdminAcademicPeriods />);
    await waitFor(() => expect(screen.getByText(/scheduled end date has passed/i)).toBeTruthy());
    expect(screen.getByText(/consider activating Term 2/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage Active Term" }));
    expect(navigate).toHaveBeenCalledWith("/admin/settings");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not invent a next term when none is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ periods: [periods[0]] }) }));
    render(<AdminAcademicPeriods />);
    await waitFor(() => expect(screen.getByText(/no next period is configured/i)).toBeTruthy());
    expect(screen.queryByText(/activating Term 2/i)).toBeNull();
  });
});
