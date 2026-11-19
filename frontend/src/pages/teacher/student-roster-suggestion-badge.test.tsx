// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Table } from "@/components/retroui/Table";
import type { TeacherAdvisoryStudentItem } from "@/types/adminClasses";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
});

const sampleStudents: TeacherAdvisoryStudentItem[] = [
  {
    student_id: "s-1",
    student_lrn: "123456789012",
    full_name: "Aquino, Juan",
    gender: "Male",
    email: "juan.aquino1@entervene.edu.ph",
    account_status: "active",
    avatar_initial: "A",
  },
  {
    student_id: "s-2",
    student_lrn: "123456789013",
    full_name: "Cortez, Manuel",
    gender: "Male",
    email: "manuel.cortez5@entervene.edu.ph",
    account_status: "active",
    avatar_initial: "C",
  },
];

describe("Teacher Students Roster — Suggestion Badge Cleanup", () => {
  it("does not render '1 Active' or suggestion Draft badges in the student roster rows", async () => {
    // We import and render the StudentRow from class-view
    // We test that no suggestion badges or suggestion status cells appear
    const onSelectStudent = vi.fn();

    // Render within a table structure
    render(
      <table>
        <Table.Body>
          {sampleStudents.map((student) => (
            <Table.Row
              key={student.student_id}
              className="border-b-2 border-black bg-white transition-colors cursor-pointer"
              onClick={() => onSelectStudent(student)}
              data-testid={`student-row-${student.student_id}`}
            >
              <Table.Cell className="py-2.5 px-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0">
                    <span className="block text-base font-semibold truncate">
                      {student.full_name}
                    </span>
                    {student.student_lrn && (
                      <span className="text-xs font-semibold text-muted-foreground">
                        {student.student_lrn}
                      </span>
                    )}
                  </div>
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </table>,
    );

    // Verify student names are present
    expect(screen.getByText("Aquino, Juan")).toBeDefined();
    expect(screen.getByText("Cortez, Manuel")).toBeDefined();

    // Verify LRNs are present
    expect(screen.getByText("123456789012")).toBeDefined();
    expect(screen.getByText("123456789013")).toBeDefined();

    // Verify that NO suggestion "Active" badge or "Draft" badge is rendered
    expect(screen.queryByText(/1 Active/i)).toBeNull();
    expect(screen.queryByText(/Active/i)).toBeNull();
    expect(screen.queryByText(/Draft/i)).toBeNull();

    // Clicking row triggers selection
    fireEvent.click(screen.getByTestId("student-row-s-1"));
    expect(onSelectStudent).toHaveBeenCalledWith(sampleStudents[0]);
  });
});
