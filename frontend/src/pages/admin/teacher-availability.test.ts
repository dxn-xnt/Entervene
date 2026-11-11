import { describe, expect, it } from "vitest";
import type { SubjectLoadItem } from "@/lib/api";
import { teacherAssignmentConflict } from "./teacher-availability";

const slot = (overrides: Partial<SubjectLoadItem>): SubjectLoadItem => ({
  class_id: 1,
  subject_id: 1,
  staff_id: null,
  academic_period_id: 1,
  start_time: "08:00",
  end_time: "08:45",
  days_of_week: ["MON"],
  ...overrides,
});

describe("teacherAssignmentConflict", () => {
  it("checks every target slot and detects a conflict in the second slot", () => {
    const loads = [
      slot({ start_time: "08:00", end_time: "08:45" }),
      slot({ start_time: "10:00", end_time: "10:45" }),
      slot({ class_id: 2, subject_id: 2, staff_id: "T1", start_time: "10:15", end_time: "11:00" }),
    ];

    expect(teacherAssignmentConflict(loads, "T1", 1, 1)).toContain("Conflict:");
  });

  it("allows adjacent periods", () => {
    const loads = [
      slot({ end_time: "08:45" }),
      slot({ class_id: 2, subject_id: 2, staff_id: "T1", start_time: "08:45", end_time: "09:30" }),
    ];

    expect(teacherAssignmentConflict(loads, "T1", 1, 1)).toBeNull();
  });

  it("allows the same time on disjoint days", () => {
    const loads = [
      slot({ days_of_week: ["MON"] }),
      slot({ class_id: 2, subject_id: 2, staff_id: "T1", days_of_week: ["TUE"] }),
    ];

    expect(teacherAssignmentConflict(loads, "T1", 1, 1)).toBeNull();
  });

  it("excludes all existing rows for the target subject", () => {
    const loads = [
      slot({ staff_id: "T1" }),
      slot({ staff_id: "T1", start_time: "08:15", end_time: "09:00" }),
    ];

    expect(teacherAssignmentConflict(loads, "T1", 1, 1)).toBeNull();
  });
});
