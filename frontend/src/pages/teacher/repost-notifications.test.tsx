// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "./notifications";

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), readAll: vi.fn() }));
vi.mock("@/lib/notifications-api", () => ({
  getNotifications: api.list,
  markNotificationAsRead: api.read,
  markAllNotificationsAsRead: api.readAll,
}));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/retroui/Tabs", () => ({
  Tabs: ({ tabs, onTabChange }: { tabs: Array<{ id: string; label: string }>; onTabChange: (id: string) => void }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.id} onClick={() => onTabChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@/components/notification-card", () => ({
  NotificationCard: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h4>{title}</h4>
      <p>{description}</p>
    </div>
  ),
}));

const makeNotification = (notification_type: string, action_url: string, title: string, id = "n1") => ({
  notification_id: id,
  notification_type,
  title,
  body: "Details of the repost request",
  action_url,
  is_read: false,
  created_at: "2026-10-26T00:00:00Z",
  read_at: null,
});

function Destination() {
  const location = useLocation();
  return <p>Destination: {location.pathname}{location.search}</p>;
}

function mount() {
  render(
    <MemoryRouter initialEntries={["/teacher/notifications"]}>
      <Routes>
        <Route path="/teacher/notifications" element={<Notifications />} />
        <Route path="/teacher/requests" element={<Destination />} />
        <Route path="/teacher/dashboard" element={<Destination />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.read.mockResolvedValue({});
  api.readAll.mockResolvedValue({ marked_read: 1 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Teacher Repost Notifications & Deep Linking", () => {
  it("filters repost notifications under Repost Requests tab and deep-links directly to the request", async () => {
    api.list.mockResolvedValue({
      unread_count: 1,
      notifications: [
        makeNotification(
          "repost_request_received",
          "/teacher/requests?box=incoming&request_id=req-12345",
          "Material Request from Jane Doe",
          "n1"
        ),
      ],
    });

    mount();
    await screen.findByText("Material Request from Jane Doe");

    // Click Repost Requests tab
    fireEvent.click(screen.getByRole("button", { name: "Repost Requests" }));
    expect(screen.getByText("Material Request from Jane Doe")).toBeTruthy();

    // Click the notification card
    fireEvent.click(screen.getByText("Material Request from Jane Doe"));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("n1"));

    // Deep link destination must be the exact incoming request, NEVER the dashboard
    expect(await screen.findByText("Destination: /teacher/requests?box=incoming&request_id=req-12345")).toBeTruthy();
  });

  it("navigates to outgoing package review when repost_package_ready notification is clicked", async () => {
    api.list.mockResolvedValue({
      unread_count: 1,
      notifications: [
        makeNotification(
          "repost_package_ready",
          "/teacher/requests?box=outgoing&request_id=req-67890",
          "Materials Ready for Repost",
          "n2"
        ),
      ],
    });

    mount();
    await screen.findByText("Materials Ready for Repost");

    fireEvent.click(screen.getByText("Materials Ready for Repost"));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("n2"));

    // Deep links to outbox with request_id
    expect(await screen.findByText("Destination: /teacher/requests?box=outgoing&request_id=req-67890")).toBeTruthy();
  });

  it("falls back to /teacher/requests instead of teacher dashboard if action_url is blank", async () => {
    api.list.mockResolvedValue({
      unread_count: 1,
      notifications: [
        makeNotification(
          "repost_accepted",
          "",
          "Your Repost Package Was Accepted",
          "n3"
        ),
      ],
    });

    mount();
    await screen.findByText("Your Repost Package Was Accepted");

    fireEvent.click(screen.getByText("Your Repost Package Was Accepted"));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("n3"));

    // Must navigate to /teacher/requests, not /teacher/dashboard
    expect(await screen.findByText("Destination: /teacher/requests")).toBeTruthy();
  });
});
