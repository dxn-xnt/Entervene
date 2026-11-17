import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { exportClassAttendanceCSV } from "./attendance-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

describe("attendance API CSV export", () => {
  beforeEach(() => apiFetchMock.mockReset());

  it("calls the class export CSV endpoint with correct query parameters", async () => {
    const csvContent = "Date,Student LRN,Student Name,Gender,Section,Subject,Attendance Status,Remarks,Recorded By\n";
    const headers = new Headers();
    headers.set("content-disposition", 'attachment; filename="attendance_Emerald_2025-2026.csv"');

    apiFetchMock.mockResolvedValue(
      new Response(csvContent, {
        status: 200,
        headers,
      }),
    );

    const result = await exportClassAttendanceCSV(10, {
      subjectId: 5,
      academicPeriodId: 2,
      academicYearId: 1,
      startDate: "2025-06-01",
      endDate: "2025-08-31",
    });

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/attendance/class/10/export-csv?subject_id=5&academic_period_id=2&academic_year_id=1&start_date=2025-06-01&end_date=2025-08-31",
    );
    expect(result.filename).toBe("attendance_Emerald_2025-2026.csv");
    expect(result.blob).toBeDefined();
  });

  it("falls back to default filename when Content-Disposition is missing", async () => {
    apiFetchMock.mockResolvedValue(
      new Response("test-csv-data", {
        status: 200,
      }),
    );

    const result = await exportClassAttendanceCSV(42);

    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/attendance/class/42/export-csv");
    expect(result.filename).toBe("attendance_class_42.csv");
  });

  it("throws error with detail message on non-200 response", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not authorized to access attendance records" }), {
        status: 403,
      }),
    );

    await expect(exportClassAttendanceCSV(99)).rejects.toThrow(
      "Not authorized to access attendance records",
    );
  });
});
