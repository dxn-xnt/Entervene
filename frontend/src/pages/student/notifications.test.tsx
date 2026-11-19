// @vitest-environment jsdom

import type { ReactElement, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("Study Support")).toBeTruthy();
    expect(screen.queryByText(/^Intervention$/i)).toBeNull();

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
        action_url: "/student/classworks/73?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D9",
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
    expect(screen.getByText("Study Support")).toBeTruthy();
    expect(screen.queryByText(/Intervention/i)).toBeNull();
    fireEvent.click(title);

    await waitFor(() => {
      expect(apiMocks.markNotificationAsRead).toHaveBeenCalledWith("notice-2");
      expect(screen.getByTestId("location").textContent).toBe(
        "/student/classworks/73?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D9",
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
    expect(screen.getByText("Study Support")).toBeTruthy();
    expect(screen.queryByText(/Intervention/i)).toBeNull();
    fireEvent.click(title);

    await waitFor(() => {
      expect(apiMocks.markNotificationAsRead).toHaveBeenCalledWith("notice-3");
      expect(screen.getByTestId("location").textContent).toBe(
        "/student/classworks/73?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D9",
      );
    });
  });
});
