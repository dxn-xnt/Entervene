import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isChronologicallyEarlierYear,
  checkYearHasReusableSetup,
  invalidateReusableSetupCache,
  type AcademicYearDateItem,
} from "./academic-year-chronology";

const mocks = vi.hoisted(() => ({
  getClasses: vi.fn(),
  getOfficialSections: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getClasses: (...args: unknown[]) => mocks.getClasses(...args),
  getOfficialSections: (...args: unknown[]) => mocks.getOfficialSections(...args),
}));

describe("isChronologicallyEarlierYear", () => {
  const ay2024: AcademicYearDateItem = {
    academic_year_id: 10, // Higher database ID to prove ID is NOT used
    year_label: "AY 2024-2025",
    start_date: "2024-08-01",
    end_date: "2025-05-31",
    is_active: false,
  };

  const ay2025: AcademicYearDateItem = {
    academic_year_id: 2,
    year_label: "AY 2025-2026",
    start_date: "2025-08-01",
    end_date: "2026-05-31",
    is_active: true,
  };

  const ay2026: AcademicYearDateItem = {
    academic_year_id: 1, // Lower database ID to prove ID is NOT used
    year_label: "AY 2026-2027",
    start_date: "2026-08-01",
    end_date: "2027-05-31",
    is_active: false,
  };

  it("identifies AY 2025-2026 as chronologically earlier than AY 2026-2027", () => {
    expect(isChronologicallyEarlierYear(ay2025, ay2026)).toBe(true);
  });

  it("identifies AY 2024-2025 as chronologically earlier than AY 2025-2026 despite higher DB ID", () => {
    expect(isChronologicallyEarlierYear(ay2024, ay2025)).toBe(true);
  });

  it("never offers a future year as an earlier year", () => {
    expect(isChronologicallyEarlierYear(ay2026, ay2025)).toBe(false);
    expect(isChronologicallyEarlierYear(ay2025, ay2024)).toBe(false);
  });

  it("returns false for the same academic year", () => {
    expect(isChronologicallyEarlierYear(ay2025, ay2025)).toBe(false);
  });

  it("falls back to parsing year_label when dates are absent", () => {
    const noDate2024: AcademicYearDateItem = {
      academic_year_id: 99,
      year_label: "2024-2025",
    };
    const noDate2025: AcademicYearDateItem = {
      academic_year_id: 5,
      year_label: "2025-2026",
    };
    expect(isChronologicallyEarlierYear(noDate2024, noDate2025)).toBe(true);
    expect(isChronologicallyEarlierYear(noDate2025, noDate2024)).toBe(false);
  });
});

describe("checkYearHasReusableSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateReusableSetupCache();
  });

  it("returns true when classes exist in the source year", async () => {
    mocks.getClasses.mockResolvedValueOnce({
      summary: { total_classes: 5 },
      classes: [{ class_id: 1 }],
    });
    mocks.getOfficialSections.mockResolvedValueOnce([]);

    const result = await checkYearHasReusableSetup(2);
    expect(result).toBe(true);
  });

  it("returns true when official sections exist even with 0 classes", async () => {
    mocks.getClasses.mockResolvedValueOnce({
      summary: { total_classes: 0 },
      classes: [],
    });
    mocks.getOfficialSections.mockResolvedValueOnce([{ section_id: 1, section_name: "Diamond" }]);

    const result = await checkYearHasReusableSetup(2);
    expect(result).toBe(true);
  });

  it("returns false when neither classes nor official sections exist", async () => {
    mocks.getClasses.mockResolvedValueOnce({
      summary: { total_classes: 0 },
      classes: [],
    });
    mocks.getOfficialSections.mockResolvedValueOnce([]);

    const result = await checkYearHasReusableSetup(2);
    expect(result).toBe(false);
  });
});

