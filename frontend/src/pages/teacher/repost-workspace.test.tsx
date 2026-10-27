// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RepostWorkspace } from "@/components/teacher/repost-workspace";
import { SidebarConfigs } from "@/context/sidebar-config";
import * as CloningApi from "@/lib/content-cloning-api";
import * as SettingsApi from "@/lib/settings-api";

vi.mock("@/lib/content-cloning-api", () => ({
  getDestinationScopes: vi.fn(),
  getSelfCloneMaterials: vi.fn(),
  cloneSelfMaterials: vi.fn(),
  getSourceTeachers: vi.fn(),
  createContentRequest: vi.fn(),
  getContentRequests: vi.fn(),
  declineContentRequest: vi.fn(),
  getEligibleMaterials: vi.fn(),
  createPackage: vi.fn(),
  getPackagePreview: vi.fn(),
  decidePackage: vi.fn(),
}));

vi.mock("@/lib/settings-api", () => ({
  getAcademicYearsSettings: vi.fn(),
  getAcademicPeriodsSettings: vi.fn(),
}));

describe("Unified Repost Workspace & Navigation Gate", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(SettingsApi.getAcademicYearsSettings).mockResolvedValue([
      {
        academic_year_id: 1,
        year_label: "2025-2026 PRIOR",
        start_date: "2025-06-01",
        end_date: "2026-05-31",
        is_active: false,
      },
      {
        academic_year_id: 2,
        year_label: "2026-2027 REPOST",
        start_date: "2026-06-01",
        end_date: "2027-05-31",
        is_active: true,
      },
    ]);

    vi.mocked(SettingsApi.getAcademicPeriodsSettings).mockResolvedValue([
      {
        id: 1,
        period: "Term 1 Prior",
        period_sequence: 1,
        total_periods: 3,
        academicyear: "2025-2026 PRIOR",
        academic_year_id: 1,
        startDate: "2025-06-01",
        endDate: "2025-09-30",
        is_active: false,
        status: "Passed",
      },
      {
        id: 2,
        period: "Term 2 Prior",
        period_sequence: 2,
        total_periods: 3,
        academicyear: "2025-2026 PRIOR",
        academic_year_id: 1,
        startDate: "2025-10-01",
        endDate: "2026-01-31",
        is_active: false,
        status: "Passed",
      },
      {
        id: 3,
        period: "Term 1 Repost",
        period_sequence: 1,
        total_periods: 3,
        academicyear: "2026-2027 REPOST",
        academic_year_id: 2,
        startDate: "2026-06-01",
        endDate: "2026-09-30",
        is_active: true,
        status: "Active",
      },
      {
        id: 4,
        period: "Term 2 Repost",
        period_sequence: 2,
        total_periods: 3,
        academicyear: "2026-2027 REPOST",
        academic_year_id: 2,
        startDate: "2026-10-01",
        endDate: "2027-01-31",
        is_active: false,
        status: "Upcoming",
      },
    ]);

    vi.mocked(CloningApi.getSelfCloneMaterials).mockResolvedValue({
      items: [
        {
          item_type: "LESSON",
          source_entity_id: 101,
          safe_title: "Prior Year Trigonometry Foundations",
          academic_period_id: 1,
          academic_period_name: "Term 1 Prior",
          source_revision_token: "token-rev-101",
        },
      ],
      total: 1,
    });

    vi.mocked(CloningApi.getSourceTeachers).mockResolvedValue([
      { staff_id: "SMOKE-T-B", display_name: "Bob Owner" },
    ]);

    vi.mocked(CloningApi.getContentRequests).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      page_size: 50,
      badges: { pending: 0, package_sent: 0, expired: 0 },
    });
  });

  it("ensures Received Requests is removed from the primary teacher sidebar", () => {
    const teacherSidebarItems = SidebarConfigs.teacher || [];
    const titles = teacherSidebarItems.map((item) => item.title);
    expect(titles).not.toContain("Received Requests");
  });

  it("renders all 4 unified tabs: Reuse, Request, Received, and Sent", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/requests"]}>
        <RepostWorkspace
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Reuse My Previous Materials")).toBeDefined();
    expect(screen.getByText("Request from Another Teacher")).toBeDefined();
    expect(screen.getByText("Received Requests")).toBeDefined();
    expect(screen.getByText("Sent Requests")).toBeDefined();

    // Default tab is Reuse
    expect(await screen.findByText("Prior Year Trigonometry Foundations")).toBeDefined();
  });

  it("dynamically shows Academic Year selector for ALL_TERMS and filters only historical years", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/requests?tab=request"]}>
        <RepostWorkspace
          initialTab="request"
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    // Switch to Any Term in Year
    fireEvent.click(screen.getByRole("button", { name: /Any Term in Year/i }));

    // Year selector should appear
    expect(await screen.findByText("Select Prior Academic Year")).toBeDefined();

    // Only 2025-2026 PRIOR should be an eligible historical year (since 2026-2027 has no completed terms before Term 1)
    expect(screen.getByText(/2025-2026 PRIOR/)).toBeDefined();
    expect(screen.queryByText(/2026-2027 REPOST/)).toBeNull();

    // Verify getSourceTeachers was called with mode ALL_TERMS and year 1
    await waitFor(() => {
      expect(CloningApi.getSourceTeachers).toHaveBeenCalledWith(
        expect.objectContaining({
          source_scope_mode: "ALL_TERMS",
          source_academic_year_id: 1,
        }),
      );
    });
  });

  it("dynamically shows Year and Term selectors for PERIOD mode", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/requests?tab=request"]}>
        <RepostWorkspace
          initialTab="request"
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Specific Term/i }));

    expect(await screen.findByText("1. Select Prior Academic Year")).toBeDefined();
    expect(await screen.findByText("2. Select Specific Historical Term")).toBeDefined();

    // Verify getSourceTeachers called with mode PERIOD, year 1, and period 1
    await waitFor(() => {
      expect(CloningApi.getSourceTeachers).toHaveBeenCalledWith(
        expect.objectContaining({
          source_scope_mode: "PERIOD",
          source_academic_year_id: 1,
          source_academic_period_id: 1,
        }),
      );
    });
  });

  it("starts packaging modal with 0 selected items and requires explicit selection", async () => {
    vi.mocked(CloningApi.getContentRequests).mockResolvedValue({
      items: [
        {
          request_id: "req-pending-1",
          requester_name: "Alice Requester",
          source_owner_name: "Bob Owner",
          subject_id: 20,
          subject_name: "Mathematics 10",
          source_scope_mode: "ANY",
          destination_class_id: 10,
          destination_section_name: "Section Diamond",
          destination_subject_id: 20,
          destination_academic_period_id: 3,
          destination_period_name: "Term 1 Repost",
          status: "PENDING_OWNER",
          expires_at: "2026-11-01T00:00:00Z",
          version: 1,
          created_at: "2026-10-27T00:00:00Z",
          updated_at: "2026-10-27T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
      badges: { pending: 1, package_sent: 0, expired: 0 },
    });

    vi.mocked(CloningApi.getEligibleMaterials).mockResolvedValue({
      request_id: "req-pending-1",
      items: [
        {
          item_type: "LESSON",
          source_entity_id: 201,
          safe_title: "Circles: Chords, Secants, and Tangents",
          academic_period_id: 1,
          academic_period_name: "Term 1 Prior",
          source_revision_token: "token-circle-201",
        },
      ],
      total: 1,
    });

    render(
      <MemoryRouter initialEntries={["/teacher/requests?box=incoming"]}>
        <RepostWorkspace
          initialTab="received"
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    const prepareBtn = await screen.findByRole("button", { name: /Prepare Package/i });
    fireEvent.click(prepareBtn);

    // Modal opens and loads materials
    expect(await screen.findByText("Circles: Chords, Secants, and Tangents")).toBeDefined();

    // Starts with 0 selected: button shows "Send Package (0)" and is disabled
    const sendBtn = screen.getByRole("button", { name: /Send Package \(0\)/i });
    expect(sendBtn.hasAttribute("disabled")).toBe(true);

    // Click item to toggle selection
    fireEvent.click(await screen.findByText("Circles: Chords, Secants, and Tangents"));

    // Now 1 selected and button enabled
    const enabledSendBtn = await screen.findByRole("button", { name: /Send Package \(1\)/i });
    expect(enabledSendBtn.hasAttribute("disabled")).toBe(false);
  });

  it("navigates to Sent Requests and opens package preview directly from deep-link", async () => {
    vi.mocked(CloningApi.getContentRequests).mockResolvedValue({
      items: [
        {
          request_id: "req-sent-ready",
          requester_name: "Alice Requester",
          source_owner_name: "Bob Owner",
          subject_id: 20,
          subject_name: "Mathematics 10",
          source_scope_mode: "ANY",
          destination_class_id: 10,
          destination_section_name: "Section Diamond",
          destination_subject_id: 20,
          destination_academic_period_id: 3,
          destination_period_name: "Term 1 Repost",
          status: "PACKAGE_SENT",
          expires_at: "2026-11-01T00:00:00Z",
          version: 2,
          created_at: "2026-10-27T00:00:00Z",
          updated_at: "2026-10-27T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
      badges: { pending: 0, package_sent: 1, expired: 0 },
    });

    vi.mocked(CloningApi.getPackagePreview).mockResolvedValue({
      package_id: "pkg-1",
      request_id: "req-sent-ready",
      status: "READY",
      sent_at: "2026-10-27T00:00:00Z",
      expires_at: "2026-11-03T00:00:00Z",
      summary: {
        competency_count: 0,
        lesson_count: 1,
        classwork_count: 0,
        attachment_count: 0,
      },
      items: [
        {
          item_type: "LESSON",
          safe_title: "Prior Year Trigonometry Foundations",
          display_order: 1,
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/teacher/requests?box=outgoing&request_id=req-sent-ready"]}>
        <RepostWorkspace
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    // Auto-opened preview modal from deep-link
    expect(await screen.findByText("Review Packaged Materials")).toBeDefined();
    expect(await screen.findByText("Accept & Clone")).toBeDefined();
  });

  it("executes self-cloning workflow without requiring peer request", async () => {
    vi.mocked(CloningApi.cloneSelfMaterials).mockResolvedValue({
      operation_id: "op-self-123",
      mode: "SELF",
      status: "SUCCEEDED",
      destination_class_id: 10,
      destination_subject_id: 20,
      destination_academic_period_id: 3,
      summary: {
        competency_count: 0,
        lesson_count: 1,
        classwork_count: 0,
        attachment_count: 0,
      },
      created_at: "2026-10-27T00:00:00Z",
    });

    render(
      <MemoryRouter initialEntries={["/teacher/requests?tab=reuse"]}>
        <RepostWorkspace
          initialTab="reuse"
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    // Initial state: 0 selected, button disabled
    const cloneBtn = await screen.findByRole("button", { name: /Reuse Selected Materials \(0\)/i });
    expect(cloneBtn.hasAttribute("disabled")).toBe(true);

    // Click material item to toggle selection
    fireEvent.click(await screen.findByText("Prior Year Trigonometry Foundations"));

    // Button updates to (1) and becomes enabled
    const enabledCloneBtn = await screen.findByRole("button", { name: /Reuse Selected Materials \(1\)/i });
    expect(enabledCloneBtn.hasAttribute("disabled")).toBe(false);

    // Execute self-clone
    fireEvent.click(enabledCloneBtn);

    // Verify API called with exact payload
    await waitFor(() => {
      expect(CloningApi.cloneSelfMaterials).toHaveBeenCalledWith({
        destination_class_id: 10,
        destination_subject_id: 20,
        destination_academic_period_id: 3,
        items: [
          {
            item_type: "LESSON",
            source_entity_id: 101,
            source_revision_token: "token-rev-101",
          },
        ],
      });
    });

    // Verify success confirmation view
    expect(await screen.findByText("Materials Successfully Reused!")).toBeDefined();
  });

  it("displays requests across different subjects in Received Requests inbox", async () => {
    vi.mocked(CloningApi.getContentRequests).mockResolvedValue({
      items: [
        {
          request_id: "req-math",
          requester_name: "Alice Requester",
          source_owner_name: "Bob Owner",
          subject_id: 20,
          subject_name: "Mathematics 10",
          source_scope_mode: "ANY",
          destination_class_id: 10,
          destination_section_name: "Section Diamond",
          destination_subject_id: 20,
          destination_academic_period_id: 3,
          destination_period_name: "Term 1 Repost",
          status: "PENDING_OWNER",
          expires_at: "2026-11-01T00:00:00Z",
          version: 1,
          created_at: "2026-10-27T00:00:00Z",
          updated_at: "2026-10-27T00:00:00Z",
        },
        {
          request_id: "req-sci",
          requester_name: "Charlie Colleague",
          source_owner_name: "Bob Owner",
          subject_id: 30,
          subject_name: "Science & Biology 10",
          source_scope_mode: "ANY",
          destination_class_id: 12,
          destination_section_name: "Section Emerald",
          destination_subject_id: 30,
          destination_academic_period_id: 3,
          destination_period_name: "Term 1 Repost",
          status: "PENDING_OWNER",
          expires_at: "2026-11-01T00:00:00Z",
          version: 1,
          created_at: "2026-10-27T00:00:00Z",
          updated_at: "2026-10-27T00:00:00Z",
        },
      ],
      total: 2,
      page: 1,
      page_size: 50,
      badges: { pending: 2, package_sent: 0, expired: 0 },
    });

    render(
      <MemoryRouter initialEntries={["/teacher/requests?box=incoming"]}>
        <RepostWorkspace
          initialTab="received"
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    // Both subjects appear, proving inbox is global across teacher's handled subjects
    expect(await screen.findByText("Mathematics 10")).toBeDefined();
    expect(await screen.findByText("Science & Biology 10")).toBeDefined();
  });

  it("renders exactly one accessible close control in dialog header", async () => {
    const { RepostModal } = await import("@/components/teacher/repost-modal");
    render(
      <MemoryRouter>
        <RepostModal
          open={true}
          onOpenChange={vi.fn()}
          destinationClassId={10}
          destinationSubjectId={20}
          destinationAcademicPeriodId={3}
          sectionName="Section Diamond"
          subjectName="Mathematics 10"
          academicPeriodName="Term 1 Repost"
        />
      </MemoryRouter>,
    );

    // Check Dialog.Header close button: exactly 1 close button with title "Close pop-up"
    const closeButtons = screen.getAllByTitle("Close pop-up");
    expect(closeButtons).toHaveLength(1);
  });
});
