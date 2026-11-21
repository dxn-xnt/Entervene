// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import PasswordRecovery from "./password-recovery";

const apiFetch = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: toastSuccess }),
}));

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  toastSuccess.mockReset();
});

describe("PasswordRecovery", () => {
  it("requests a reset link without revealing whether the account exists", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        message: "If this email has an active account, a reset link has been sent.",
      }),
    });

    render(
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Routes>
          <Route path="/forgot-password" element={<PasswordRecovery />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Link" }));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        "/api/v1/auth/forgot-password",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "person@example.com" }),
        }),
      );
    });
    expect(toastSuccess).toHaveBeenCalledWith({
      title: "Check your email",
      description: "If this email has an active account, a reset link has been sent.",
    });
  });

  it("shows a clear state for an invalid or used reset link", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    render(
      <MemoryRouter initialEntries={["/reset-password?token=invalid"]}>
        <Routes>
          <Route path="/reset-password" element={<PasswordRecovery />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Reset link unavailable")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeTruthy();
  });
});
