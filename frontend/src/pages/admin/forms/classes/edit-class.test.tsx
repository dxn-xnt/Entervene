// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AcademicPathwayRead, ClassDetailResponse } from "@/types/adminClasses";
import EditClass from "./edit-class";

const fetchPathways = vi.hoisted(() => vi.fn());
const updateClass = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  fetchPathways,
  getClassDetail: vi.fn(),
  getClassFormOptions: vi.fn().mockResolvedValue({ eligible_advisers: [] }),
  updateClass,
}));
vi.mock("@/components/retroui/Dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: Object.assign(Container, { Content: Container, Header: Container, Footer: Container }) };
});
vi.mock("@/components/retroui/Select", () => {
  const Select = ({ children, value, onValueChange, onChange }: {
    children: ReactNode; value: string; onValueChange?: (value: string) => void;
    onChange?: (event: { target: { value: string } }) => void;
  }) => <select value={value} onChange={(event) => {
    onValueChange?.(event.target.value);
    onChange?.({ target: { value: event.target.value } });
  }}>{children}</select>;
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return { Select: Object.assign(Select, {
    Trigger: Container, Value: () => null, Content: Container, Group: Container,
    Item: ({ children, value, disabled }: { children: ReactNode; value: string; disabled?: boolean }) =>
      <option value={value} disabled={disabled}>{children}</option>,
  }) };
});

const medical: AcademicPathwayRead = { id: 1, code: "medical-courses", name: "Medical Courses and Sciences Related", is_enabled: true, sort_order: 1 };
const engineering: AcademicPathwayRead = { id: 2, code: "engineering-math", name: "Engineering and Mathematics Related", is_enabled: true, sort_order: 2 };
const schoolClass = (grade: number, pathwayId: number | null): ClassDetailResponse => ({
  class_id: 12, section_name: "Zara", class_status: "active", created_at: null,
  academic_year: { academic_year_id: 1, year_label: "2025-2026" },
  academic_level: { academic_level_id: grade, level_name: `Grade ${grade}`, grade_level: grade, requires_pathway: grade === 11 },
  pathway_id: pathwayId, pathway: pathwayId === 1 ? medical : pathwayId === 2 ? engineering : null,
  adviser: null, statistics: { student_count: 0, subject_count: 0, schedule_count: 0 },
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Edit Class pathway selection", () => {
  it("shows enabled configured choices and preserves the current assignment when editing the name", async () => {
    fetchPathways.mockResolvedValue({ pathways: [medical, engineering, { ...medical, id: 3, name: "Inactive", is_enabled: false }] });
    const detail = schoolClass(11, 1);
    updateClass.mockResolvedValue({ ...detail, section_name: "Zara A" });
    render(<EditClass classId={12} initialClass={detail} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy());
    expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy();
    expect(screen.queryByText("Inactive (inactive)")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Section name"), { target: { value: "Zara A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(updateClass).toHaveBeenCalledWith(12, { section_name: "Zara A" }));
  });

  it("keeps an inactive historical assignment visible while allowing a valid replacement", async () => {
    const inactive = { ...medical, is_enabled: false };
    fetchPathways.mockResolvedValue({ pathways: [inactive, engineering] });
    const detail = schoolClass(11, 1);
    render(<EditClass classId={12} initialClass={detail} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByText("Medical Courses and Sciences Related (inactive)")).toBeTruthy());
    const currentOption = screen.getByText("Medical Courses and Sciences Related (inactive)") as HTMLOptionElement;
    expect(currentOption.disabled).toBe(true);
    expect((screen.getByText("Engineering and Mathematics Related") as HTMLOptionElement).disabled).toBe(false);
    expect((screen.getByText("No pathway assigned") as HTMLOptionElement).disabled).toBe(true);
  });

  it("does not offer SHS pathways when the grade's scope is disabled", async () => {
    fetchPathways.mockResolvedValue({ pathways: [medical, engineering] });
    render(<EditClass classId={12} initialClass={schoolClass(12, null)} onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() => expect(screen.getByText("This grade does not require a pathway in this academic year.")).toBeTruthy());
    expect(screen.queryByText("Medical Courses and Sciences Related")).toBeNull();
    expect(screen.queryByText("Engineering and Mathematics Related")).toBeNull();
  });
});
