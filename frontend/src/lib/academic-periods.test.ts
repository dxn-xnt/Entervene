import { describe, expect, it } from "vitest";
import { overdueActivePeriodNotice, type OperationalPeriod } from "./academic-periods";

const periods: OperationalPeriod[] = [
  { id: 1, period: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 10, endDate: "2026-08-31", is_active: true },
  { id: 2, period: "Term 2", period_type: "TERM", period_sequence: 2, academic_year_id: 10, endDate: "2026-11-30", is_active: false },
  { id: 3, period: "Term 3", period_type: "TERM", period_sequence: 3, academic_year_id: 10, endDate: "2027-03-31", is_active: false },
];

describe("admin overdue active-term notice", () => {
  it("shows no warning before or on the scheduled end date", () => {
    expect(overdueActivePeriodNotice(periods, new Date(2026, 7, 30))).toBeNull();
    expect(overdueActivePeriodNotice(periods, new Date(2026, 7, 31))).toBeNull();
  });

  it("uses the next configured period in sequence after the scheduled end", () => {
    expect(overdueActivePeriodNotice(periods, new Date(2026, 8, 1))?.next?.period).toBe("Term 2");
    const term3Active = periods.map((p) => ({ ...p, is_active: p.id === 3 }));
    expect(overdueActivePeriodNotice(term3Active, new Date(2027, 3, 1))?.next).toBeNull();
  });

  it("never suggests a period from another academic year or type", () => {
    const onlyActive = [periods[0], { ...periods[1], academic_year_id: 11 }];
    expect(overdueActivePeriodNotice(onlyActive, new Date(2026, 8, 1))?.next).toBeNull();
  });
});
