// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "./notifications";

const apiMocks = vi.hoisted(() => ({
  getNotifications: vi.fn(),
  markAllNotificationsAsRead: vi.fn(),
  markNotificationAsRead: vi.fn(),
}));

vi.mock("@/lib/notifications-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications-api")>();
  return { ...actual, ...apiMocks };
});

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Menu</button>,
}));

vi.mock("@/components/retroui/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, render }: { children?: ReactNode; render?: ReactElement }) =>
    render ?? <>{children}</>,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

describe("student Study Support notifications", () => {
  beforeEach(() => {
    apiMocks.getNotifications.mockResolvedValue({
      unread_count: 1,
      notifications: [{
        notification_id: "notice-1",
        notification_type: "intervention_reviewer_available",
        title: "New Study Support Available",
        body: "Your teacher prepared new Study Support for Mathematics.",
        action_url: "/student/interventions/view?reviewer=42",
        is_read: false,
        created_at: "2026-11-19T00:00:00Z",
        read_at: null,
      }],
    });
    apiMocks.markNotificationAsRead.mockResolvedValue({});
    apiMocks.markAllNotificationsAsRead.mockResolvedValue({ marked_read: 1 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses Study Support terminology and opens the reviewer detail destination", async () => {
    render(
      <MemoryRouter initialEntries={["/student/notifications"]}>
        <Routes>
          <Route path="/student/notifications" element={<><Notifications /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const title = await screen.findByText("New Study Support Available");
    expect(within(screen.getByRole("tabpanel")).getByText("Study Support")).toBeTruthy();
    expect(screen.queryByText(/Intervention/i)).toBeNull();

    fireEvent.click(title);

    await waitFor(() => {
      expect(apiMocks.markNotificationAsRead).toHaveBeenCalledWith("notice-1");
      expect(screen.getByTestId("location").textContent)
        .toBe("/student/interventions/view?reviewer=42");
    });
  });

  it("labels an assigned activity as Study Support and opens that activity", async () => {
    apiMocks.getNotifications.mockResolvedValue({
      unread_count: 1,
      notifications: [{
        notification_id: "notice-2",
        notification_type: "study_support_available",
        title: "New Study Support Available",
        body: "New Study Support for Mathematics is ready for you.",
        action_url: "/student/interventions/view?intervention=9&activity=73",
        is_read: false,
        created_at: "2026-11-19T00:00:00Z",
        read_at: null,
      }],
    });

    render(
      <MemoryRouter initialEntries={["/student/notifications"]}>
        <Routes>
          <Route path="/student/notifications" element={<><Notifications /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const title = await screen.findByText("New Study Support Available");
    expect(within(screen.getByRole("tabpanel")).getByText("Study Support")).toBeTruthy();
    expect(screen.queryByText(/Intervention/i)).toBeNull();
    fireEvent.click(title);

    await waitFor(() => {
      expect(apiMocks.markNotificationAsRead).toHaveBeenCalledWith("notice-2");
      expect(screen.getByTestId("location").textContent).toBe(
        "/student/interventions/view?intervention=9&activity=73",
      );
    });
  });

  it("keeps final reminder terminology student-safe and opens the assigned activity", async () => {
    apiMocks.getNotifications.mockResolvedValue({
      unread_count: 1,
      notifications: [{
        notification_id: "notice-3",
        notification_type: "study_support_final_reminder",
        title: "Final Study Support Reminder",
        body: "Your Study Support for Mathematics is still available.",
        action_url: "/student/classworks/73?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D9",
        is_read: false,
        created_at: "2026-11-24T00:00:00Z",
        read_at: null,
      }],
    });

    render(
      <MemoryRouter initialEntries={["/student/notifications"]}>
        <Routes>
          <Route path="/student/notifications" element={<><Notifications /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const title = await screen.findByText("Final Study Support Reminder");
    expect(within(screen.getByRole("tabpanel")).getByText("Study Support")).toBeTruthy();
    expect(screen.queryByText(/Intervention/i)).toBeNull();
    fireEvent.click(title);

    await waitFor(() => {
      expect(apiMocks.markNotificationAsRead).toHaveBeenCalledWith("notice-3");
      expect(screen.getByTestId("location").textContent).toBe(
        "/student/interventions/view?intervention=9",
      );
    });
  });

  it("redirects a legacy Study Support Subject link to Study Support", async () => {
    apiMocks.getNotifications.mockResolvedValue({
      unread_count: 1,
      notifications: [{
        notification_id: "notice-legacy",
        notification_type: "study_support_available",
        title: "New Study Support Available",
        body: "Study Support is ready.",
        action_url: "/student/subjects/4/8?tab=classwork",
        is_read: false,
        created_at: "2026-11-19T00:00:00Z",
        read_at: null,
      }],
    });

    render(
      <MemoryRouter initialEntries={["/student/notifications"]}>
        <Routes>
          <Route path="/student/notifications" element={<><Notifications /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText("New Study Support Available"));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/student/interventions");
    });
  });

  it("filters across All, Classwork, and Study Support, hides deadlines and announcements, and cleans phrasing", async () => {
    apiMocks.getNotifications.mockResolvedValue({
      unread_count: 3,
      notifications: [
        {
          notification_id: "cw-1",
          notification_type: "assignment_due",
          title: "Enhanced Mathematics 9: Enhanced Mathematics 9: Parallel Lines Quiz",
          body: "Assigned classwork assigned by Angel Alcantara attached to  • Due: Nov 25, 2026.",
          action_url: "/student/subjects/1/2?tab=classwork&classworkAssignmentId=10",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "grade-1",
          notification_type: "grade_released",
          title: "Science 9: Science 9: Lab Report",
          body: "Graded by Teacher • Score: 95 points.",
          action_url: "/student/subjects/1/3?tab=classwork&classworkAssignmentId=11",
          is_read: true,
          created_at: "2026-11-19T00:00:00Z",
          read_at: "2026-11-19T01:00:00Z",
        },
        {
          notification_id: "deadline-1",
          notification_type: "classwork_due_soon",
          title: "Reminder: Worksheet 1 due tomorrow",
          body: "Submit before the deadline.",
          action_url: "/student/subjects/1/2?tab=classwork&classworkAssignmentId=12",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "support-1",
          notification_type: "study_support_reminder",
          title: "Study Support Reminder",
          body: "Complete this quiz lesson practice.",
          action_url: "/student/classworks/73",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "legacy-announcement",
          notification_type: "announcement",
          title: "Legacy Announcement",
          body: "Should be excluded from visible feed",
          action_url: null,
          is_read: false,
          created_at: "2026-11-18T00:00:00Z",
          read_at: null,
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/student/notifications"]}>
        <Routes>
          <Route path="/student/notifications" element={<><Notifications /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("Enhanced Mathematics 9: Parallel Lines Quiz");

    // Student deadline notifications and their tab are removed.
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/, "").trim())).toEqual([
      "All",
      "Classwork",
      "Study Support",
    ]);

    // Historical announcements excluded; duplicated subject name & redundant phrasing cleaned
    expect(screen.queryByText("Legacy Announcement")).toBeNull();
    expect(screen.queryByText("Reminder: Worksheet 1 due tomorrow")).toBeNull();
    expect(screen.queryByText(/Intervention/i)).toBeNull();
    expect(screen.getByText("Classwork assigned by Angel Alcantara • Due: Nov 25, 2026.")).toBeTruthy();
    expect(screen.getByText("Science 9: Lab Report")).toBeTruthy();

    // Classwork tab includes assignment_due + grade_released only
    fireEvent.click(tabs[1]);
    let panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Enhanced Mathematics 9: Parallel Lines Quiz")).toBeTruthy();
    expect(within(panel).getByText("Science 9: Lab Report")).toBeTruthy();
    expect(within(panel).queryByText("Reminder: Worksheet 1 due tomorrow")).toBeNull();
    expect(within(panel).queryByText("Study Support Reminder")).toBeNull();

    // Study Support tab uses structured type even when body contains "quiz" and "lesson"
    fireEvent.click(tabs[2]);
    panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Study Support Reminder")).toBeTruthy();
    expect(within(panel).getByText("Study Support")).toBeTruthy();
    expect(within(panel).queryByText("Classwork")).toBeNull();

    // Mark All as Read works across notifications
    fireEvent.click(screen.getByRole("button", { name: /Mark All as Read/i }));
    await waitFor(() => {
      expect(apiMocks.markAllNotificationsAsRead).toHaveBeenCalledTimes(1);
    });
  });

  it("shows tailored empty states for each student notification tab", async () => {
    apiMocks.getNotifications.mockResolvedValue({ unread_count: 0, notifications: [] });

    render(
      <MemoryRouter initialEntries={["/student/notifications"]}>
        <Routes>
          <Route path="/student/notifications" element={<><Notifications /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("No notifications yet");

    fireEvent.click(screen.getByRole("tab", { name: "Classwork" }));
    expect(screen.getByText("No classwork notifications")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Study Support" }));
    expect(screen.getByText("No Study Support notifications")).toBeTruthy();
  });
});
