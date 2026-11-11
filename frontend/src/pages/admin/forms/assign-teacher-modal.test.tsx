// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dialog } from "@/components/retroui/Dialog";
import AssignTeacherModal, { type StudioTeacher, type TeacherModalTarget } from "./assign-teacher-modal";

afterEach(cleanup);

describe("AssignTeacherModal sorting and prioritization", () => {
  const teachers: StudioTeacher[] = [
    { staff_id: "T_CONF_A", name: "Alice Conflicted" },
    { staff_id: "T_AVAIL_Z", name: "Zack Available" },
    { staff_id: "T_AVAIL_B", name: "Bob Available" },
    { staff_id: "T_CURR", name: "Charlie Assigned" },
  ];

  const target: TeacherModalTarget = {
    classId: 101,
    className: "Diamond",
    subjectId: 1,
    subjectName: "Science 9",
    currentStaffId: "T_CURR",
  };

  const getTeacherAvailabilityStatus = vi.fn((staffId: string) => {
    if (staffId === "T_CONF_A") return "Conflict (Overlap at 08:00)";
    return "Available";
  });

  it("prioritizes currently assigned teacher at top, then available teachers, then conflicted teachers", () => {
    render(
      <Dialog open>
        <AssignTeacherModal
          target={target}
          teachers={teachers}
          teacherWorkloads={[]}
          loads={[]}
          getTeacherAvailabilityStatus={getTeacherAvailabilityStatus}
          onAssign={vi.fn()}
          onClose={vi.fn()}
        />
      </Dialog>
    );

    const rows = screen.getAllByRole("row");
    // Row 0 is the table header
    const dataRows = rows.slice(1);
    expect(dataRows.length).toBe(4);

    // 1st row: Charlie Assigned (currentStaffId)
    expect(dataRows[0].textContent).toContain("Charlie Assigned");
    expect(dataRows[0].textContent).toContain("Assigned");

    // 2nd row: Bob Available (available, B < Z)
    expect(dataRows[1].textContent).toContain("Bob Available");
    expect(dataRows[1].textContent).toContain("Available");

    // 3rd row: Zack Available (available, Z > B)
    expect(dataRows[2].textContent).toContain("Zack Available");
    expect(dataRows[2].textContent).toContain("Available");

    // 4th row: Alice Conflicted (conflict)
    expect(dataRows[3].textContent).toContain("Alice Conflicted");
    expect(dataRows[3].textContent).toContain("Conflict (Overlap at 08:00)");
  });

  it("prioritizes available teachers before conflicted teachers when no teacher is currently assigned", () => {
    const unassignedTarget: TeacherModalTarget = {
      ...target,
      currentStaffId: null,
    };

    render(
      <Dialog open>
        <AssignTeacherModal
          target={unassignedTarget}
          teachers={teachers}
          teacherWorkloads={[]}
          loads={[]}
          getTeacherAvailabilityStatus={getTeacherAvailabilityStatus}
          onAssign={vi.fn()}
          onClose={vi.fn()}
        />
      </Dialog>
    );

    const rows = screen.getAllByRole("row");
    const dataRows = rows.slice(1);

    // Available teachers (Bob, Charlie, Zack) should all come before Alice (conflicted)
    expect(dataRows[0].textContent).toContain("Bob Available");
    expect(dataRows[1].textContent).toContain("Charlie Assigned");
    expect(dataRows[2].textContent).toContain("Zack Available");
    expect(dataRows[3].textContent).toContain("Alice Conflicted");
  });

  it("disables a conflicted assignment and never calls onAssign", () => {
    const onAssign = vi.fn();
    render(
      <Dialog open>
        <AssignTeacherModal
          target={{ ...target, currentStaffId: null }}
          teachers={teachers}
          teacherWorkloads={[]}
          loads={[]}
          getTeacherAvailabilityStatus={getTeacherAvailabilityStatus}
          onAssign={onAssign}
          onClose={vi.fn()}
        />
      </Dialog>
    );

    const row = screen.getByText("Alice Conflicted").closest("tr") as HTMLElement;
    const assign = within(row).getByRole("button", { name: "Assign" }) as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    fireEvent.click(assign);
    expect(onAssign).not.toHaveBeenCalled();
  });

  it("assigns an available teacher", () => {
    const onAssign = vi.fn();
    render(
      <Dialog open>
        <AssignTeacherModal
          target={{ ...target, currentStaffId: null }}
          teachers={teachers}
          teacherWorkloads={[]}
          loads={[]}
          getTeacherAvailabilityStatus={getTeacherAvailabilityStatus}
          onAssign={onAssign}
          onClose={vi.fn()}
        />
      </Dialog>
    );

    const row = screen.getByText("Bob Available").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Assign" }));
    expect(onAssign).toHaveBeenCalledWith(101, 1, "T_AVAIL_B");
  });

  it("keeps Unassign available for the current teacher", () => {
    const onAssign = vi.fn();
    render(
      <Dialog open>
        <AssignTeacherModal
          target={target}
          teachers={teachers}
          teacherWorkloads={[]}
          loads={[]}
          getTeacherAvailabilityStatus={getTeacherAvailabilityStatus}
          onAssign={onAssign}
          onClose={vi.fn()}
        />
      </Dialog>
    );

    fireEvent.click(screen.getByRole("button", { name: "Unassign" }));
    expect(onAssign).toHaveBeenCalledWith(101, 1, "none");
  });
});
