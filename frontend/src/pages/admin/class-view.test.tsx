// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminClassDetail from "./class-view";

const mockGetClassDetail = vi.hoisted(() => vi.fn());
const mockGetClassStudents = vi.hoisted(() => vi.fn());
const mockGetClassTransferOptions = vi.hoisted(() => vi.fn());
const mockGetUnassignedClassStudents = vi.hoisted(() => vi.fn());
const mockGetClassSchedule = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  getClassDetail: mockGetClassDetail,
  getClassStudents: mockGetClassStudents,
  getClassTransferOptions: mockGetClassTransferOptions,
  getUnassignedClassStudents: mockGetUnassignedClassStudents,
  getClassSchedule: mockGetClassSchedule,
  updateClassStudentList: vi.fn(),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger">Toggle</button>,
}));

vi.mock("@/pages/admin/forms/classes/edit-student-list", () => ({
  default: ({ currentSectionName, onClose }: { currentSectionName: string; onClose: () => void }) => (
    <div data-testid="edit-student-list-modal">
      <span>Editing {currentSectionName}</span>
      <button onClick={onClose}>Close Modal</button>
    </div>
  ),
}));

vi.mock("@/pages/admin/forms/classes/edit-class", () => ({
  default: () => <div data-testid="edit-class-modal" />,
}));

beforeEach(() => {
  mockGetClassSchedule.mockResolvedValue({ schedule: [] });
  mockGetClassStudents.mockResolvedValue({
    pagination: { total_items: 0, total_pages: 1, current_page: 1, page_size: 200 },
    summary: { total_students: 0, male_students: 0, female_students: 0, unspecified_gender: 0 },
    students: [],
  });
  mockGetClassTransferOptions.mockResolvedValue({
    available_sections: [{ class_id: 20, section_name: "Reyes", student_count: 0 }],
  });
  mockGetUnassignedClassStudents.mockResolvedValue({
    students: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("loads Students tab when deep-linked with ?tab=students", async () => {
  mockGetClassDetail.mockResolvedValue({
    class_id: 19,
    section_name: "Del Mundo",
    class_status: "active",
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_level: { academic_level_id: 6, level_name: "Grade 12", grade_level: 12 },
    adviser: { first_name: "Roy", last_name: "Rondina" },
    created_at: "2025-06-01T00:00:00Z",
  });

  render(
    <MemoryRouter initialEntries={["/admin/classes/19?tab=students"]}>
      <Routes>
        <Route path="/admin/classes/:classId" element={<AdminClassDetail />} />
      </Routes>
    </MemoryRouter>
  );

  await waitFor(() => expect(screen.getAllByText("Del Mundo").length).toBeGreaterThan(0));
  // Students tab header should be present
  expect(screen.getByRole("button", { name: "Add / Manage Students" })).toBeTruthy();
  // Edit modal should NOT be open yet
  expect(screen.queryByTestId("edit-student-list-modal")).toBeNull();
});

it("automatically opens Manage Students modal when deep-linked with action=manage-students", async () => {
  mockGetClassDetail.mockResolvedValue({
    class_id: 19,
    section_name: "Del Mundo",
    class_status: "active",
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_level: { academic_level_id: 6, level_name: "Grade 12", grade_level: 12 },
    adviser: { first_name: "Roy", last_name: "Rondina" },
    created_at: "2025-06-01T00:00:00Z",
  });

  render(
    <MemoryRouter initialEntries={["/admin/classes/19?tab=students&action=manage-students"]}>
      <Routes>
        <Route path="/admin/classes/:classId" element={<AdminClassDetail />} />
      </Routes>
    </MemoryRouter>
  );

  // Modal should automatically open once data is loaded
  await waitFor(() => expect(screen.getByTestId("edit-student-list-modal")).toBeTruthy());
  expect(screen.getByText("Editing Del Mundo")).toBeTruthy();
});

it("does NOT open Manage Students modal if the class is archived", async () => {
  mockGetClassDetail.mockResolvedValue({
    class_id: 30,
    section_name: "OldSection",
    class_status: "archived",
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_level: { academic_level_id: 6, level_name: "Grade 12", grade_level: 12 },
    adviser: null,
    created_at: "2024-06-01T00:00:00Z",
  });

  render(
    <MemoryRouter initialEntries={["/admin/classes/30?tab=students&action=manage-students"]}>
      <Routes>
        <Route path="/admin/classes/:classId" element={<AdminClassDetail />} />
      </Routes>
    </MemoryRouter>
  );

  await waitFor(() => expect(screen.getAllByText("OldSection").length).toBeGreaterThan(0));
  // Archived banner should be displayed
  expect(screen.getByText(/This class is archived and read-only/i)).toBeTruthy();
  // Manage Students modal must NOT open
  expect(screen.queryByTestId("edit-student-list-modal")).toBeNull();
});

it("displays compact student count and gender summary in header and removes oversized Total Students card", async () => {
  mockGetClassDetail.mockResolvedValue({
    class_id: 25,
    section_name: "Campos",
    class_status: "active",
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_level: { academic_level_id: 5, level_name: "Grade 11", grade_level: 11 },
    adviser: { first_name: "Maria", last_name: "Santos" },
    created_at: "2025-06-01T00:00:00Z",
  });

  mockGetClassStudents.mockResolvedValue({
    pagination: { total_items: 2, total_pages: 1, current_page: 1, page_size: 200 },
    summary: {
      total_students: 2,
      gender_counts: { male: 1, female: 1, other: 0, unspecified: 0 },
    },
    students: [
      { student_id: "s-1", full_name: "Cruz, Juan", gender: "Male", avatar_initial: "J", account_status: "enrolled" },
      { student_id: "s-2", full_name: "Reyes, Maria", gender: "Female", avatar_initial: "M", account_status: "enrolled" },
    ],
  });

  render(
    <MemoryRouter initialEntries={["/admin/classes/25?tab=students"]}>
      <Routes>
        <Route path="/admin/classes/:classId" element={<AdminClassDetail />} />
      </Routes>
    </MemoryRouter>
  );

  await waitFor(() => expect(screen.getAllByText("Campos").length).toBeGreaterThan(0));

  // Compact student count summary in the header
  expect(screen.getByText(/— 2 enrolled/)).toBeTruthy();
  expect(screen.getByText(/1 male · 1 female/)).toBeTruthy();

  // The oversized OverviewCard for Total Students should NOT be rendered
  expect(screen.queryByText("Total Students")).toBeNull();

  // Student roster rows are displayed directly
  expect(screen.getByText("Cruz, Juan")).toBeTruthy();
  expect(screen.getByText("Reyes, Maria")).toBeTruthy();

  // Add / Manage Students action is present
  expect(screen.getByRole("button", { name: /Add \/ Manage Students/i })).toBeTruthy();
});
