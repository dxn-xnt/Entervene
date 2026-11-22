// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Notifications from "./notifications";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button" aria-label="Toggle sidebar" />,
}));

vi.mock("@/lib/notifications-api", () => ({
  getNotifications: vi.fn().mockResolvedValue({
    unread_count: 1,
    notifications: [
      {
        notification_id: "backend-notif-1",
        notification_type: "repost_request_received",
        title: "Repost Request: Math 7",
        body: "A repost request was submitted",
        action_url: "/teacher/requests",
        is_read: false,
        created_at: "2026-11-20T10:00:00Z",
        read_at: null,
      },
    ],
  }),
  markAllNotificationsAsRead: vi.fn().mockResolvedValue({ marked_read: 1 }),
  markNotificationAsRead: vi.fn().mockResolvedValue({}),
}));

describe("Teacher Notifications - Submissions Tab and Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders All, Repost Requests, Interventions, and Submissions tabs in order", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const tabList = screen.getByRole("tablist", { name: "Notification categories" });
    const tabButtons = tabList.querySelectorAll("button");
    const tabLabels = Array.from(tabButtons).map((btn) => btn.textContent?.replace(/\d+/g, "").trim());

    expect(tabLabels).toEqual(["All", "Repost Requests", "Interventions", "Submissions"]);
  });

  it("calculates unread badges correctly including Submissions", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
    // 3 unread mock submissions: cw-101 (3 new), cw-102 (1 new), cw-103 (2 new)
    expect(submissionsTab.textContent).toContain("3");
  });

  it("filters out excluded types (e.g. quiz cw-104) and enforces allowed types", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    // Click Submissions tab
    const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
    fireEvent.click(submissionsTab);

    // cw-104 is a Quiz - it MUST NOT be displayed
    expect(screen.queryByText(/Midterm Assessment Quiz/i)).toBeNull();

    // Allowed types must be displayed
    expect(screen.getByText(/Mathematics 7: Linear Equations Worksheet - 3 new submissions/i)).toBeDefined();
    expect(screen.getByText(/Science 7: Plant and Animal Cells Diagram - 1 new submission/i)).toBeDefined();
    expect(screen.getByText(/English 7: Reading Comprehension Support Exercise - 2 new submissions/i)).toBeDefined();
  });

  it("displays exact templates for title and description (singular and plural)", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
    fireEvent.click(submissionsTab);

    // Singular templates (cw-102)
    expect(screen.getByText("Science 7: Plant and Animal Cells Diagram - 1 new submission")).toBeDefined();
    expect(screen.getByText("1 new student classwork submission needs to be graded as of Nov 21, 2026")).toBeDefined();

    // Plural templates (cw-101)
    expect(screen.getByText("Mathematics 7: Linear Equations Worksheet - 3 new submissions")).toBeDefined();
    expect(screen.getByText("3 new student classwork submissions needs to be graded as of Nov 22, 2026")).toBeDefined();
  });

  it("renders clean default notification cards without progressbar or grading progress elements", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
    fireEvent.click(submissionsTab);

    // Default notification cards should NOT have progress bars or "Grading progress" text
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
    expect(screen.queryByText(/Grading progress:/i)).toBeNull();
  });

  it("updates existing notification instead of creating duplicates on new submission arrival", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
    fireEvent.click(submissionsTab);

    // Initially cw-102 has 1 new submission
    expect(screen.getByText("Science 7: Plant and Animal Cells Diagram - 1 new submission")).toBeDefined();

    // Click "Simulate Submission"
    const simulateBtn = screen.getByRole("button", { name: /Simulate Submission/i });
    fireEvent.click(simulateBtn);

    // Now cw-102 must have updated to "2 new submissions"
    expect(screen.getByText("Science 7: Plant and Animal Cells Diagram - 2 new submissions")).toBeDefined();

    // Ensure there are still exactly 3 submission cards (no duplicate card was added!)
    const cards = screen.getAllByText(/new submission/i);
    expect(cards.length).toBe(3);
  });

  it("marks all notifications as read and clears badges", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const markAllBtn = screen.getByRole("button", { name: /Mark All as Read/i });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      // Unread badges should disappear
      const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
      expect(submissionsTab.querySelector(".badge")).toBeNull();
      // All unread badges inside cards should disappear
      expect(screen.queryAllByText("Unread").length).toBe(0);
    });
  });

  it("navigates to classwork when clicking a submission notification card", async () => {
    render(
      <MemoryRouter>
        <Notifications />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading notifications...")).toBeNull();
    });

    const submissionsTab = screen.getByRole("tab", { name: /Submissions/i });
    fireEvent.click(submissionsTab);

    const cardTitle = screen.getByText("Science 7: Plant and Animal Cells Diagram - 1 new submission");
    fireEvent.click(cardTitle);

    expect(mockNavigate).toHaveBeenCalledWith("/teacher/classworks/cw-102");
  });
});
