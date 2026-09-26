import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-navigation-progress", () => ({ startProgress: vi.fn(), doneProgress: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("document", { cookie: "" });
});
afterEach(() => vi.unstubAllGlobals());

it("does not retry a usage-limit response", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const { apiFetch } = await import("./api");
  expect((await apiFetch("/api/v1/ai/generate-quiz", { method: "POST" })).status).toBe(429);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("shares a failed refresh across a burst of unauthorized requests", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const { apiFetch } = await import("./api");
  await apiFetch("/api/v1/users");
  await apiFetch("/api/v1/classes");
  const refreshes = fetch.mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
  expect(refreshes).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("exports teacher advisory student SF9 report card correctly", async () => {
  const mockBlob = new Blob(["fake-sf9-content"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const fetch = vi.fn().mockResolvedValue(
    new Response(mockBlob, {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="SF9_Grade8_Reyes_Ana.xlsx"',
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { exportTeacherAdvisoryStudentSF9 } = await import("./api");
  const result = await exportTeacherAdvisoryStudentSF9(10, "student-uuid-123");

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining(
      "/api/v1/classes/teacher/advisory/10/students/student-uuid-123/export-sf9",
    ),
    expect.any(Object),
  );
  expect(result.filename).toBe("SF9_Grade8_Reyes_Ana.xlsx");
  expect(result.blob).toBeDefined();
});

it("exports teacher advisory batch SF9 cards correctly", async () => {
  const mockBlob = new Blob(["fake-sf9-batch-content"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const fetch = vi.fn().mockResolvedValue(
    new Response(mockBlob, {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="SF9_Advisory_Batch_Diamond.xlsx"',
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { exportTeacherAdvisoryBatchSF9 } = await import("./api");
  const result = await exportTeacherAdvisoryBatchSF9(10);

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/classes/teacher/advisory/10/export-sf9-batch"),
    expect.any(Object),
  );
  expect(result.filename).toBe("SF9_Advisory_Batch_Diamond.xlsx");
  expect(result.blob).toBeDefined();
});

it("fetches teacher advisory student SF9 data correctly", async () => {
  const mockData = {
    school_info: { school_name: "Test School" },
    student: { full_name: "Reyes, Ana", student_lrn: "123456789001" },
    class_info: { grade_level: "Grade 8", section_name: "Diamond" },
    periods: [],
    learning_areas: { core: [], electives: [] },
    general_average: { final_rating: 92.5 },
    descriptors: [],
    attendance: { months: [], total: { class_days: 200, present: 195, absent: 5 } },
  };
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(mockData), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { getTeacherAdvisoryStudentSF9Data } = await import("./api");
  const data = await getTeacherAdvisoryStudentSF9Data(10, "student-uuid-123");

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/classes/teacher/advisory/10/students/student-uuid-123/sf9-data"),
    expect.any(Object),
  );
  expect(data.student.full_name).toBe("Reyes, Ana");
});

it("exports teacher advisory student Word (.docx) SF9 report card correctly", async () => {
  const mockBlob = new Blob(["fake-docx-content"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const fetch = vi.fn().mockResolvedValue(
    new Response(mockBlob, {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="SF9_Grade8_Reyes_Ana.docx"',
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { exportTeacherAdvisoryStudentSF9Docx } = await import("./api");
  const result = await exportTeacherAdvisoryStudentSF9Docx(10, "student-uuid-123", {
    term1: "Excellent academic performance",
  });

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/classes/teacher/advisory/10/students/student-uuid-123/export-sf9-docx?term1_comment=Excellent+academic+performance"),
    expect.any(Object),
  );
  expect(result.filename).toBe("SF9_Grade8_Reyes_Ana.docx");
  expect(result.blob).toBeDefined();
});

it("exports teacher advisory batch Word (.docx) SF9 cards correctly", async () => {
  const mockBlob = new Blob(["fake-docx-batch-content"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const fetch = vi.fn().mockResolvedValue(
    new Response(mockBlob, {
      status: 200,
      headers: {
        "content-disposition": 'attachment; filename="SF9_Advisory_Batch_Diamond.docx"',
      },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { exportTeacherAdvisoryBatchSF9Docx } = await import("./api");
  const result = await exportTeacherAdvisoryBatchSF9Docx(10);

  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("/api/v1/classes/teacher/advisory/10/export-sf9-batch-docx"),
    expect.any(Object),
  );
  expect(result.filename).toBe("SF9_Advisory_Batch_Diamond.docx");
  expect(result.blob).toBeDefined();
});


