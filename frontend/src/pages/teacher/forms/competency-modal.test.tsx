// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import CompetencyModal from "./competency-modal";

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CompetencyModal", () => {
  it("creates a competency without showing or sending a competency code", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        competency_id: 12,
        competency_code: null,
        statement: "Models linear relationships.",
        subject_id: 5,
      }),
    } as Response);

    render(
      <CompetencyModal
        open
        onOpenChange={vi.fn()}
        subjectId={5}
        academicPeriodId={1}
      />,
    );

    expect(screen.queryByLabelText("Competency Code")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Competency Statement/), {
      target: { value: "Models linear relationships." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Competency" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(apiFetch).mock.calls[0];
    const body = JSON.parse(String(options?.body));
    expect(body).not.toHaveProperty("competency_code");
    expect(body.statement).toBe("Models linear relationships.");
  });

  it("retains code editing for an existing competency", () => {
    render(
      <CompetencyModal
        open
        onOpenChange={vi.fn()}
        subjectId={5}
        academicPeriodId={1}
        editingCompetency={{
          competency_id: 12,
          competency_code: "M8AL-Ia-1",
          statement: "Models linear relationships.",
          description: null,
          order_index: 1,
          target_hours: 4,
          subject_id: 5,
          is_archived: false,
        }}
      />,
    );

    expect((screen.getByLabelText("Competency Code") as HTMLInputElement).value).toBe("M8AL-Ia-1");
  });
});
