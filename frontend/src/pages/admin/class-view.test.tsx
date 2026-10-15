// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ClassDetailResponse } from "@/types/adminClasses";
import AdminClassDetail from "./class-view";

const getClassDetail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getClassDetail }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/retroui/use-toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const detail = (grade: number, pathwayId: number | null): ClassDetailResponse => ({
  class_id: 12, section_name: "Zara", class_status: "active", created_at: null,
  academic_year: { academic_year_id: 1, year_label: "2025-2026" },
  academic_level: { academic_level_id: grade, level_name: `Grade ${grade}`, grade_level: grade, requires_pathway: grade >= 11 },
  pathway_id: pathwayId,
  pathway: pathwayId == null ? null : { id: pathwayId, code: "medical-courses", name: "Medical Courses and Sciences Related", is_enabled: true, sort_order: 1 },
  adviser: null, statistics: { student_count: 0, subject_count: 0, schedule_count: 0 },
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Class detail pathway identity", () => {
  it("shows the canonical pathway on an SHS section", async () => {
    getClassDetail.mockResolvedValue(detail(11, 1));
    render(<MemoryRouter initialEntries={["/admin/classes/12"]}><Routes><Route path="/admin/classes/:classId" element={<AdminClassDetail />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Academic Pathway: Medical Courses and Sciences Related")).toBeTruthy());
  });

  it("shows an unassigned SHS state without adding a pathway label to JHS", async () => {
    getClassDetail.mockResolvedValueOnce(detail(12, null)).mockResolvedValue(detail(9, null));
    const page = render(<MemoryRouter initialEntries={["/admin/classes/12"]}><Routes><Route path="/admin/classes/:classId" element={<AdminClassDetail />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Academic Pathway: Unassigned pathway")).toBeTruthy());
    page.unmount();
    render(<MemoryRouter initialEntries={["/admin/classes/12"]}><Routes><Route path="/admin/classes/:classId" element={<AdminClassDetail />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Grade 9 - 2025-2026 | Active since N/A")).toBeTruthy());
    expect(screen.queryByText(/Academic Pathway:/)).toBeNull();
  });
});
