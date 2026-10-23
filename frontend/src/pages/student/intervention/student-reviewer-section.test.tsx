// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentReviewerSection from "./student-reviewer-section";

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/student-intervention-reviewers-api", () => ({ listMyReviewers: api.list, getMyReviewer: api.detail }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <aside>{children}</aside> : null,
  SheetContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  SheetHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const reviewer = { material_id: 8, subject_name: "Mathematics", title: "Fractions review", sent_at: "2026-09-26T01:00:00Z" };
beforeEach(() => { api.list.mockResolvedValue({ items: [reviewer], total: 1 }); api.detail.mockResolvedValue({ ...reviewer, introduction: "Let's practice.", body: "Read the examples.\nTry one yourself." }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const mount = (path = "/student/interventions") => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/student/interventions" element={<StudentReviewerSection />} /></Routes></MemoryRouter>);

it("lists teacher reviewers and opens the private content", async () => {
  mount();
  expect(await screen.findByText("Fractions review")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Read Reviewer" }));
  const sheet = await screen.findByRole("complementary");
  expect(await within(sheet).findByText("Let's practice.")).toBeTruthy();
  expect(within(sheet).getByText(/Try one yourself/)).toBeTruthy();
  expect(api.detail).toHaveBeenCalledWith(8);
});

it("opens notification deep links and handles unavailable reviewer", async () => {
  api.detail.mockRejectedValue(new Error("Reviewer not found."));
  mount("/student/interventions?reviewer=999");
  expect(await screen.findByText("Reviewer not found.")).toBeTruthy();
  expect(api.detail).toHaveBeenCalledWith(999);
});

it("shows an empty state when nothing was sent", async () => {
  api.list.mockResolvedValue({ items: [], total: 0 });
  mount();
  expect(await screen.findByText("No teacher reviewers have been shared with you yet.")).toBeTruthy();
});
