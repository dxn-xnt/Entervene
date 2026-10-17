// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ClassDetailResponse } from "@/types/adminClasses";
import AdminClassDetail from "./class-view";

const getClassDetail = vi.hoisted(() => vi.fn());
const getClassStudents = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getClassDetail, getClassStudents }));
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

it("shows an empty roster and the later assignment action", async () => {
  getClassDetail.mockResolvedValue(detail(12, null));
  getClassStudents.mockResolvedValue({
    class_id: 12, section_name: "Zara", academic_level: { academic_level_id: 12, level_name: "Grade 12" },
    summary: { total_students: 0, gender_counts: { female: 0, male: 0, other: 0, unspecified: 0 } },
    students: [], pagination: { page: 1, page_size: 200, total_items: 0, total_pages: 1 },
  });
  render(<MemoryRouter initialEntries={["/admin/classes/12"]}><Routes><Route path="/admin/classes/:classId" element={<AdminClassDetail />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Students" })).toBeTruthy());
  fireEvent.click(screen.getByRole("tab", { name: "Students" }));
  await waitFor(() => expect(screen.getByText("No students assigned yet. Use Add / Manage Students to build the roster.")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Add / Manage Students" })).toBeTruthy();
  expect(screen.queryByText("88%")).toBeNull();
});

it("loads every roster page when a class exceeds the API page size", async () => {
  getClassDetail.mockResolvedValue(detail(12, null));
  const base = {
    class_id: 12, section_name: "Zara", academic_level: { academic_level_id: 12, level_name: "Grade 12" },
    summary: { total_students: 201, gender_counts: { female: 0, male: 201, other: 0, unspecified: 0 } },
  };
  getClassStudents.mockImplementation(async (_classId: number, options: { page?: number }) => ({
    ...base,
    students: options.page === 2 ? [{ student_id: "last", student_lrn: "123456789012", first_name: "Last", last_name: "Student", full_name: "Last Student", gender: "Male", avatar_initial: "L" }] : [],
    pagination: { page: options.page ?? 1, page_size: 200, total_items: 201, total_pages: 2 },
  }));
  render(<MemoryRouter initialEntries={["/admin/classes/12"]}><Routes><Route path="/admin/classes/:classId" element={<AdminClassDetail />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("tab", { name: "Students" })).toBeTruthy());
  fireEvent.click(screen.getByRole("tab", { name: "Students" }));
  await waitFor(() => expect(screen.getByText("Last Student")).toBeTruthy());
  expect(getClassStudents).toHaveBeenCalledWith("12", { page: 2, pageSize: 200 });
});
