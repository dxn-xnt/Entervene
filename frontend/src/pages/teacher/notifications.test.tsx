// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "./notifications";
import { SidebarConfigs } from "@/context/sidebar-config";

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

describe("Teacher notifications & Admin sidebar cleanup", () => {
  beforeEach(() => {
    apiMocks.getNotifications.mockResolvedValue({
      unread_count: 4,
      notifications: [
        {
          notification_id: "rep-1",
          notification_type: "repost_request_received",
          title: "New Repost Request",
          body: "A colleague requested to clone your lesson.",
          action_url: "/teacher/requests",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "sub-1",
          notification_type: "assignment_due",
          title: "Late Submission: Math 9 - Math 9: Quiz 1",
          body: "Juan turned in their work late after the due date.",
          action_url: "/teacher/classworks/10",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "int-cand",
          notification_type: "intervention_candidate",
          title: "New Intervention Candidate",
          body: "Student is ready for review.",
          action_url: "/teacher/interventions?candidate=5",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "int-sub",
          notification_type: "intervention_assessment_submitted",
          title: "Intervention Assessment Submitted",
          body: "Student submitted the intervention assessment.",
          action_url: "/teacher/classworks/20?submission=8",
          is_read: false,
          created_at: "2026-11-19T00:00:00Z",
          read_at: null,
        },
        {
          notification_id: "ann-1",
          notification_type: "announcement",
          title: "Old School Announcement",
          body: "Should be excluded from teacher feed",
          action_url: null,
          is_read: false,
          created_at: "2026-11-18T00:00:00Z",
          read_at: null,
        },
      ],
    });
    apiMocks.markNotificationAsRead.mockResolvedValue({});
    apiMocks.markAllNotificationsAsRead.mockResolvedValue({ marked_read: 4 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("removes Announcements tab, excludes announcements, cleans titles, and preserves Interventions notifications", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/notifications"]}>
        <Routes>
          <Route path="/teacher/notifications" element={<Notifications />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("New Repost Request");

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.replace(/\d+$/, "").trim())).toEqual([
      "All",
      "Repost Requests",
      "Submissions",
      "Interventions",
    ]);
    expect(screen.queryByRole("tab", { name: /Announcements/i })).toBeNull();
    expect(screen.queryByText("Old School Announcement")).toBeNull();

    // Duplicated subject name cleaned in late submission title
    expect(screen.getByText("Late Submission: Math 9: Quiz 1")).toBeTruthy();

    // Interventions tab preserves both candidate/resolution and intervention assessment alerts
    fireEvent.click(tabs[3]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("New Intervention Candidate")).toBeTruthy();
    expect(within(panel).getByText("Intervention Assessment Submitted")).toBeTruthy();
    expect(within(panel).queryByText("New Repost Request")).toBeNull();
  });

  it("shows tailored empty states for each teacher notification tab", async () => {
    apiMocks.getNotifications.mockResolvedValue({ unread_count: 0, notifications: [] });

    render(
      <MemoryRouter initialEntries={["/teacher/notifications"]}>
        <Routes>
          <Route path="/teacher/notifications" element={<Notifications />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText("No notifications");

    fireEvent.click(screen.getByRole("tab", { name: "Repost Requests" }));
    expect(screen.getByText("No repost request notifications")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Submissions" }));
    expect(screen.getByText("No submission notifications")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Interventions" }));
    expect(screen.getByText("No intervention notifications")).toBeTruthy();
  });

  it("removes Notifications from the Admin sidebar while keeping Teacher and Student Notifications", () => {
    expect(SidebarConfigs.admin.some((item) => item.title === "Notifications")).toBe(false);
    expect(SidebarConfigs.teacher.some((item) => item.title === "Notifications")).toBe(true);
    expect(SidebarConfigs.student.some((item) => item.title === "Notifications")).toBe(true);
  });
});
