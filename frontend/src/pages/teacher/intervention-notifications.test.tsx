// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Notifications from "./notifications";

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), readAll: vi.fn() }));
vi.mock("@/lib/notifications-api", () => ({
  getNotifications: api.list, markNotificationAsRead: api.read, markAllNotificationsAsRead: api.readAll,
}));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/components/retroui/Tabs", () => ({ Tabs: ({ tabs, onTabChange }: { tabs: Array<{ id: string; label: string }>; onTabChange: (id: string) => void }) => <div>{tabs.map((tab) => <button key={tab.id} onClick={() => onTabChange(tab.id)}>{tab.label}</button>)}</div> }));
vi.mock("@/components/notification-card", () => ({ NotificationCard: ({ title }: { title: string }) => <div>{title}</div> }));

const item = (notification_type: string, action_url: string) => ({
  notification_id: "n1", notification_type, title: "Review Alex Rivera", body: "Evidence is available",
  action_url, is_read: false, created_at: "2026-09-26T00:00:00Z", read_at: null,
});
function Destination() { const location = useLocation(); return <p>Destination: {location.pathname}{location.search}</p>; }
function mount() { render(<MemoryRouter initialEntries={["/teacher/notifications"]}><Routes><Route path="/teacher/notifications" element={<Notifications />} /><Route path="/teacher/interventions" element={<Destination />} /></Routes></MemoryRouter>); }
beforeEach(() => { api.read.mockResolvedValue({}); api.readAll.mockResolvedValue({ marked_read: 1 }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("teacher Intervention notifications", () => {
  it("shows a candidate in the existing Interventions tab and opens its exact deep link", async () => {
    api.list.mockResolvedValue({ unread_count: 1, notifications: [item("intervention_candidate", "/teacher/interventions?candidate=12")] });
    mount();
    await screen.findByText("Review Alex Rivera");
    fireEvent.click(screen.getByRole("button", { name: "Interventions" }));
    fireEvent.click(screen.getByText("Review Alex Rivera"));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("n1"));
    expect(await screen.findByText("Destination: /teacher/interventions?candidate=12")).toBeTruthy();
  });
  it("shows resolved notifications and keeps legacy risk alerts in the tab", async () => {
    api.list.mockResolvedValue({ unread_count: 0, notifications: [item("intervention_resolved", "/teacher/interventions"), { ...item("risk_alert", "/teacher/interventions"), notification_id: "n2", title: "Existing alert" }] });
    mount();
    await screen.findByText("Existing alert");
    fireEvent.click(screen.getByRole("button", { name: "Interventions" }));
    expect(screen.getByText("Review Alex Rivera")).toBeTruthy();
    expect(screen.getByText("Existing alert")).toBeTruthy();
  });
});
