// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LessonItemLine from "@/components/item-line/lesson";
import LessonDeliveryCorrectionModal from "@/pages/teacher/forms/lesson-delivery-correction-modal";
import SubjectDetails from "@/pages/teacher/subject-view";
import TeacherClassDetail from "@/pages/teacher/class-view";
import * as lessonDeliveryApi from "@/lib/lesson-delivery-api";
import * as apiModule from "@/lib/api";

// ── Mock Sonner Toast ──
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Mock AppLayout & Sidebar ──
vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">SidebarTrigger</button>,
}));

vi.mock("@/components/retroui/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipContent: () => null,
}));

// ── Mock Context ──
const periodContextValue = {
  selectedPeriodId: 1,
  periods: [
    {
      id: 1,
      period: "Quarter 1",
      period_sequence: 1,
      total_periods: 4,
      academicyear: "2025-2026",
      academic_year_id: 10,
      startDate: null,
      endDate: null,
      is_active: true,
      status: "active",
    },
    {
      id: 2,
      period: "Quarter 2",
      period_sequence: 2,
      total_periods: 4,
      academicyear: "2025-2026",
      academic_year_id: 10,
      startDate: null,
      endDate: null,
      is_active: false,
      status: "inactive",
    },
  ],
  setSelectedPeriodId: vi.fn(),
  isLoading: false,
  refetch: vi.fn(),
  registerDirtyGuard: () => () => {},
};

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => periodContextValue,
}));

vi.mock("@/lib/student-record-api", () => ({
  getTeacherRecordPeriods: vi.fn().mockResolvedValue({
    default_academic_period_id: 1,
    periods: [{ academic_period_id: 1, period_name: "Quarter 1" }],
  }),
  getTeacherStudentRoster: vi.fn().mockResolvedValue({
    students: [],
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PR 2B.2: Teacher Lesson Delivery UI — Component Level", () => {
  it("renders Published and Taught as completely distinct statuses", () => {
    const publishedUntaughtLesson = {
      lesson_id: 1,
      title: "Cell Structure and Organelles",
      is_published: true,
      is_draft: false,
      is_archived: false,
      is_taught: false,
    };

    render(
      <MemoryRouter>
        <LessonItemLine
          lesson={publishedUntaughtLesson}
          isDelivered={false}
          onConfirmDelivery={vi.fn()}
        />
      </MemoryRouter>,
    );

    const pubBadge = screen.getByTestId("badge-published-1");
    const taughtBadge = screen.getByTestId("badge-taught-1");

    expect(pubBadge.textContent).toBe("Published");
    expect(taughtBadge.textContent).toBe("Not Taught");
    // Does not treat published lesson as taught
    expect(taughtBadge.textContent).not.toBe("Taught");
  });

  it("renders Draft and Taught as distinct statuses when delivered", () => {
    const draftTaughtLesson = {
      lesson_id: 2,
      title: "Photosynthesis Reactions",
      is_published: false,
      is_draft: true,
      is_archived: false,
      is_taught: true,
      delivery: {
        delivery_id: 50,
        lesson_id: 2,
        class_id: 10,
        subject_id: 20,
        academic_period_id: 1,
        delivered_at: "2026-10-28T08:00:00Z",
        is_active: true,
      },
    };

    render(
      <MemoryRouter>
        <LessonItemLine
          lesson={draftTaughtLesson}
          isDelivered={true}
          delivery={draftTaughtLesson.delivery}
        />
      </MemoryRouter>,
    );

    const pubBadge = screen.getByTestId("badge-published-2");
    const taughtBadge = screen.getByTestId("badge-taught-2");

    expect(pubBadge.textContent).toBe("Draft");
    expect(taughtBadge.textContent).toBe("Taught");
  });

  it("shows 'Mark as Taught' action for untaught lessons and fires confirmation callback", async () => {
    const lesson = {
      lesson_id: 3,
      title: "Newton's Laws of Motion",
      is_published: true,
      is_draft: false,
      is_archived: false,
    };
    const onConfirmMock = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <LessonItemLine
          lesson={lesson}
          isExpanded={true}
          isDelivered={false}
          onConfirmDelivery={onConfirmMock}
        />
      </MemoryRouter>,
    );

    const markBtn = screen.getByTestId("mark-taught-btn-3");
    expect(markBtn).toBeTruthy();
    expect(markBtn.textContent).toContain("Mark as Taught");

    fireEvent.click(markBtn);
    expect(onConfirmMock).toHaveBeenCalledTimes(1);
    expect(onConfirmMock).toHaveBeenCalledWith(lesson);
  });

  it("shows 'Correct Confirmation' action when taught and opens correction dialog", () => {
    const lesson = {
      lesson_id: 4,
      title: "Chemical Equilibrium",
      is_published: true,
      is_draft: false,
      is_archived: false,
      delivery: {
        delivery_id: 88,
        lesson_id: 4,
        class_id: 10,
        subject_id: 20,
        academic_period_id: 1,
        delivered_at: "2026-10-27T10:30:00Z",
        is_active: true,
      },
    };
    const onOpenCorrectionMock = vi.fn();

    render(
      <MemoryRouter>
        <LessonItemLine
          lesson={lesson}
          isExpanded={true}
          isDelivered={true}
          delivery={lesson.delivery}
          onOpenCorrectionDialog={onOpenCorrectionMock}
        />
      </MemoryRouter>,
    );

    const correctBtn = screen.getByTestId("correct-delivery-btn-4");
    expect(correctBtn).toBeTruthy();
    expect(correctBtn.textContent).toContain("Correct Confirmation");

    fireEvent.click(correctBtn);
    expect(onOpenCorrectionMock).toHaveBeenCalledTimes(1);
    expect(onOpenCorrectionMock).toHaveBeenCalledWith(lesson);
  });
});

describe("PR 2B.2: Correction Dialog Workflow & Auditing", () => {
  it("enforces minimum 3-character reason and submits correction with auditable reason", async () => {
    const onConfirmCorrectionMock = vi.fn().mockResolvedValue(undefined);
    const onOpenChangeMock = vi.fn();

    render(
      <LessonDeliveryCorrectionModal
        open={true}
        onOpenChange={onOpenChangeMock}
        deliveryId={99}
        lessonTitle="Genetic Inheritance"
        deliveredAt="2026-10-26T14:00:00Z"
        onConfirmCorrection={onConfirmCorrectionMock}
      />,
    );

    expect(screen.getByText("Correct Lesson Delivery Confirmation")).toBeTruthy();
    expect(screen.getByText("Genetic Inheritance")).toBeTruthy();

    const textarea = screen.getByPlaceholderText(/Explain why this delivery record is being corrected/i);
    const submitBtn = screen.getByRole("button", { name: /Revoke Delivery/i });

    // Initially empty -> button disabled (needs >= 3 chars)
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    // Type 2 chars -> still disabled
    fireEvent.change(textarea, { target: { value: "No" } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(true);

    // Type valid reason >= 3 chars
    fireEvent.change(textarea, { target: { value: "Mistakenly marked; rescheduled for Term 2." } });
    expect((submitBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onConfirmCorrectionMock).toHaveBeenCalledTimes(1);
      expect(onConfirmCorrectionMock).toHaveBeenCalledWith(
        99,
        "Mistakenly marked; rescheduled for Term 2.",
      );
    });
  });

  it("shows an inline Alert when revocation fails with frozen evidence conflict (409) without double-toasting", async () => {
    const conflictError = new Error(
      "Cannot revoke delivery confirmation: This delivery is referenced by an existing active intervention evidence scope and must remain preserved for student remediation auditability.",
    );
    const onConfirmCorrectionMock = vi.fn().mockRejectedValue(conflictError);

    render(
      <LessonDeliveryCorrectionModal
        open={true}
        onOpenChange={vi.fn()}
        deliveryId={102}
        lessonTitle="Thermodynamics"
        deliveredAt="2026-10-25T09:00:00Z"
        onConfirmCorrection={onConfirmCorrectionMock}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Explain why this delivery record is being corrected/i);
    fireEvent.change(textarea, { target: { value: "Attempt to revert frozen lesson" } });

    const submitBtn = screen.getByRole("button", { name: /Revoke Delivery/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Cannot revoke delivery confirmation: This delivery is referenced by an existing active intervention/i),
      ).toBeTruthy();
    });
  });
});

describe("PR 2B.2: Integration in Classes → Subject → Lessons Interface", () => {
  beforeEach(() => {
    vi.spyOn(apiModule, "getTeacherDashboardHealth").mockResolvedValue({ section_matrix: [] } as any);
    vi.spyOn(apiModule, "apiFetch").mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.includes("/api/v1/classwork-assignments/teacher/classes")) {
        return new Response(
          JSON.stringify([
            {
              class_id: 10,
              section_name: "Grade 9 - Ruby",
              grade_level: 9,
              subject_id: 20,
              subject_name: "Science 9",
              academic_period_id: 1,
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/lessons/my-class/10/subject/20")) {
        return new Response(
          JSON.stringify([
            {
              lesson_id: 101,
              title: "Cell Membrane Dynamics",
              order_index: 1,
              is_published: true,
              is_draft: false,
              is_archived: false,
              attachments: [],
            },
            {
              lesson_id: 102,
              title: "Cellular Respiration",
              order_index: 2,
              is_published: true,
              is_draft: false,
              is_archived: false,
              attachments: [],
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/competencies/subject/20")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/classwork-assignments/teacher/class/10/subject/20/assignments")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lessons/my-class/10/lesson/101/linked-classwork")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lessons/my-class/10/lesson/102/linked-classwork")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lesson-deliveries/class/10/subject/20")) {
        // Initially lesson 102 is already taught, 101 is not
        return new Response(
          JSON.stringify([
            {
              delivery_id: 501,
              lesson_id: 102,
              lesson_title: "Cellular Respiration",
              class_id: 10,
              subject_id: 20,
              academic_period_id: 1,
              delivered_at: "2026-10-27T10:00:00Z",
              is_active: true,
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/lesson-deliveries/confirm")) {
        return new Response(
          JSON.stringify({
            delivery_id: 502,
            lesson_id: 101,
            lesson_title: "Cell Membrane Dynamics",
            class_id: 10,
            subject_id: 20,
            academic_period_id: 1,
            delivered_at: "2026-10-28T09:00:00Z",
            is_active: true,
          }),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/lesson-deliveries/501/correct")) {
        return new Response(
          JSON.stringify({
            delivery_id: 501,
            lesson_id: 102,
            class_id: 10,
            subject_id: 20,
            academic_period_id: 1,
            is_active: false,
            revoked_at: "2026-10-28T09:15:00Z",
            correction_reason: "Taught in Section Diamond instead",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
  });

  it("loads existing delivery records on mount and shows distinct statuses", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/subjects/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subjects/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>,
    );

    // Lesson 101: Published, Not Taught
    await waitFor(() => {
      expect(screen.getByTestId("badge-published-101").textContent).toBe("Published");
      expect(screen.getByTestId("badge-taught-101").textContent).toBe("Not Taught");
    });

    // Lesson 102: Published, Taught (persisted from backend GET)
    expect(screen.getByTestId("badge-published-102").textContent).toBe("Published");
    expect(screen.getByTestId("badge-taught-102").textContent).toBe("Taught");
  });

  it("confirms lesson delivery via POST /api/v1/lesson-deliveries/confirm with exact payload and updates status to Taught", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/subjects/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subjects/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("badge-taught-101").textContent).toBe("Not Taught");
    });

    // Click quick Mark as Taught on lesson 101
    const markBtn = screen.getByTestId("quick-mark-taught-101");
    fireEvent.click(markBtn);

    await waitFor(() => {
      expect(screen.getByTestId("badge-taught-101").textContent).toBe("Taught");
    });

    // Verify apiFetch was called with exact POST payload
    const calls = vi.mocked(apiModule.apiFetch).mock.calls;
    const confirmCall = calls.find(([url]) => String(url).includes("/api/v1/lesson-deliveries/confirm"));
    expect(confirmCall).toBeDefined();
    expect(confirmCall![1]?.method).toBe("POST");
    expect(JSON.parse(String(confirmCall![1]?.body))).toEqual({
      lesson_id: 101,
      class_id: 10,
      subject_id: 20,
      academic_period_id: 1,
    });
  });

  it("corrects a delivery confirmation via correction dialog and updates status back to Not Taught", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/subjects/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subjects/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>,
    );

    // Lesson 102 is taught
    await waitFor(() => {
      expect(screen.getByTestId("badge-taught-102").textContent).toBe("Taught");
    });

    // Expand lesson 102 to see the Correct Confirmation button in accordion
    const chevronBtns = screen.getAllByRole("button", { name: /Expand classworks/i });
    fireEvent.click(chevronBtns[1]);

    const correctBtn = await screen.findByTestId("correct-delivery-btn-102");
    fireEvent.click(correctBtn);

    // Modal opens
    const textarea = await screen.findByPlaceholderText(/Explain why this delivery record is being corrected/i);
    fireEvent.change(textarea, { target: { value: "Taught in Section Diamond instead" } });

    const revokeBtn = screen.getByRole("button", { name: /Revoke Delivery/i });
    fireEvent.click(revokeBtn);

    // Status updates back to Not Taught
    await waitFor(() => {
      expect(screen.getByTestId("badge-taught-102").textContent).toBe("Not Taught");
    });

    // Verify PUT call to /correct endpoint with payload
    const calls = vi.mocked(apiModule.apiFetch).mock.calls;
    const correctCall = calls.find(([url]) => String(url).includes("/api/v1/lesson-deliveries/501/correct"));
    expect(correctCall).toBeDefined();
    expect(correctCall![1]?.method).toBe("PUT");
    expect(JSON.parse(String(correctCall![1]?.body))).toEqual({
      reason: "Taught in Section Diamond instead",
    });
  });

  it("handles authorization error (403) cleanly with inline error alert", async () => {
    vi.mocked(apiModule.apiFetch).mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.includes("/api/v1/classwork-assignments/teacher/classes")) {
        return new Response(
          JSON.stringify([
            {
              class_id: 10,
              section_name: "Grade 9 - Ruby",
              grade_level: 9,
              subject_id: 20,
              subject_name: "Science 9",
              academic_period_id: 1,
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/lessons/my-class/10/subject/20")) {
        return new Response(
          JSON.stringify([
            {
              lesson_id: 103,
              title: "Forbidden Lesson",
              order_index: 1,
              is_published: true,
              is_draft: false,
              is_archived: false,
              attachments: [],
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/lesson-deliveries/class/10/subject/20")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lesson-deliveries/confirm")) {
        return new Response(
          JSON.stringify({ detail: "You are not authorized to confirm delivery for this subject load." }),
          { status: 403 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/subjects/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/subjects/:subjectId" element={<SubjectDetails />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("badge-taught-103")).toBeTruthy();
    });

    const markBtn = screen.getByTestId("quick-mark-taught-103");
    fireEvent.click(markBtn);

    await waitFor(() => {
      expect(
        screen.getByText("You are not authorized to confirm delivery for this subject load."),
      ).toBeTruthy();
    });
  });
});

describe("PR 2B.2A: Teacher → Classes → Mathematics → Demo Archimedes (TeacherClassDetail)", () => {
  const mockClassDetail = {
    class_id: 10,
    section_name: "Demo Archimedes",
    academic_level: "Grade 9",
    academic_year: "2025-2026",
    class_status: "Active",
    is_archived: false,
    created_at: "2026-01-01T00:00:00Z",
    active_since: "2026-01-01T00:00:00Z",
    student_count: 30,
    male_count: 15,
    female_count: 15,
    subject_count: 1,
    students: [],
    subject_loads: [
      {
        subject_load_id: 1,
        subject_id: 20,
        subject_name: "Mathematics",
        teacher_id: "T-001",
        teacher_name: "John Doe",
        schedule: null,
        status: "Active",
      },
    ],
  };

  const mockTeacherClassLoads = [
    {
      class_id: 10,
      section_name: "Demo Archimedes",
      grade_level: 9,
      subject_id: 20,
      subject_name: "Mathematics",
      academic_period_id: 1,
    },
  ];

  beforeEach(() => {
    vi.spyOn(apiModule, "getTeacherAdvisoryClassDetail").mockResolvedValue(mockClassDetail as any);
    vi.spyOn(apiModule, "getTeacherClasses").mockResolvedValue(mockTeacherClassLoads as any);
    vi.spyOn(apiModule, "getTeacherAdvisoryClasses").mockResolvedValue([]);
    vi.spyOn(apiModule, "getTeacherDashboardHealth").mockResolvedValue({ section_matrix: [] } as any);
    vi.spyOn(apiModule, "apiFetch").mockImplementation(async (path: string, options?: any) => {
      const p = String(path);
      if (p.includes("/api/v1/lessons/my-class/10/subject/20")) {
        return new Response(
          JSON.stringify([
            {
              lesson_id: 101,
              title: "Quadratic Equations",
              order_index: 1,
              is_published: true,
              is_draft: false,
              is_archived: false,
              attachments: [],
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/competencies/subject/20")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lessons/my-class/10/lesson/101/linked-classwork")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lesson-goals/class/10/subject/20")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (p.includes("/api/v1/lesson-deliveries/class/10/subject/20")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (p.includes("/api/v1/lesson-deliveries/confirm")) {
        return new Response(
          JSON.stringify({
            delivery_id: 55,
            lesson_id: 101,
            class_id: 10,
            subject_id: 20,
            academic_period_id: 1,
            delivered_by_staff_id: "T-001",
            delivered_at: "2026-10-28T08:00:00Z",
            is_active: true,
            created_at: "2026-10-28T08:00:00Z",
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
  });

  it("renders Mark as Taught in expanded lesson card on TeacherClassDetail (/teacher/classes/10/20)", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/:subjectId" element={<TeacherClassDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    // Verify badges
    await waitFor(() => {
      expect(screen.getByTestId("badge-published-101")).toBeTruthy();
      expect(screen.getByTestId("badge-taught-101")).toBeTruthy();
      expect(screen.getByTestId("badge-taught-101").textContent).toContain("Not Taught");
    });

    // Quick button is visible
    expect(screen.getByTestId("quick-mark-taught-101")).toBeTruthy();

    // Expand the lesson card
    const expandBtn = screen.getByRole("button", { name: /Expand classworks/i });
    fireEvent.click(expandBtn);

    // Verify Mark as Taught action inside expanded card
    await waitFor(() => {
      expect(screen.getByTestId("mark-taught-btn-101")).toBeTruthy();
    });

    // Click Mark as Taught
    const markBtn = screen.getByTestId("mark-taught-btn-101");
    fireEvent.click(markBtn);

    // Verify status updates to Taught
    await waitFor(() => {
      expect(screen.getByTestId("badge-taught-101").textContent).toContain("Taught");
      expect(screen.queryByTestId("mark-taught-btn-101")).toBeNull();
      expect(screen.getByTestId("correct-delivery-btn-101")).toBeTruthy();
    });
  });

  it("displays API failure in an Alert on TeacherClassDetail when confirmation fails", async () => {
    vi.spyOn(apiModule, "apiFetch").mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.includes("/api/v1/lessons/my-class/10/subject/20")) {
        return new Response(
          JSON.stringify([
            {
              lesson_id: 101,
              title: "Quadratic Equations",
              order_index: 1,
              is_published: true,
              is_draft: false,
              is_archived: false,
              attachments: [],
            },
          ]),
          { status: 200 },
        );
      }
      if (p.includes("/api/v1/lesson-deliveries/confirm")) {
        return new Response(
          JSON.stringify({ detail: "Database table 'lesson_delivery' does not exist." }),
          { status: 500 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/:subjectId" element={<TeacherClassDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("quick-mark-taught-101")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("quick-mark-taught-101"));

    await waitFor(() => {
      expect(
        screen.getByText("Database table 'lesson_delivery' does not exist."),
      ).toBeTruthy();
      // Action remains available so user can retry once database is migrated
      expect(screen.getByTestId("quick-mark-taught-101")).toBeTruthy();
    });
  });

  it("displays Mark as Taught on full Lesson Details screen when opened from TeacherClassDetail", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/classes/10/20"]}>
        <Routes>
          <Route path="/teacher/classes/:classId/:subjectId" element={<TeacherClassDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Quadratic Equations")).toBeTruthy();
    });

    // Click on lesson title to open Lesson Details full view
    fireEvent.click(screen.getByText("Quadratic Equations"));

    // Verify Mark as Taught in full screen header
    await waitFor(() => {
      expect(screen.getByTestId("detail-mark-taught-101")).toBeTruthy();
    });
  });
});
