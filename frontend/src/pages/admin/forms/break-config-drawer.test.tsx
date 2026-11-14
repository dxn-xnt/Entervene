// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import BreakConfigDrawer, { type PeriodTemplateSlotItem } from "./break-config-drawer";

const previewOverride = vi.hoisted(() => vi.fn());
const applyOverride = vi.hoisted(() => vi.fn());
const apiFetch = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch,
  previewPeriodTemplateOverride: previewOverride,
  applyPeriodTemplateOverride: applyOverride,
}));
vi.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({ getSetting: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn() }),
}));

const slots: PeriodTemplateSlotItem[] = [
  {
    slot_id: 41,
    template_group: "SHS_CAMPOS_ZARA",
    slot_name: "Period 1",
    slot_type: "CLASS",
    start_time: "08:00",
    end_time: "09:00",
    is_locked_break: false,
    display_order: 1,
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("published period-template replacement", () => {
  it("reviews impact and requires the exact destructive confirmation", async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => slots });
    previewOverride.mockResolvedValue({
      preview_token: "preview-token",
      expires_at: "2026-11-12T10:15:00Z",
      effective_date: "2026-11-12",
      template_group: "SHS_CAMPOS_ZARA",
      changed_slots: [{
        slot_id: 41,
        slot_name: "First Period",
        old_start_time: "08:00",
        old_end_time: "09:00",
        new_start_time: "08:00",
        new_end_time: "09:00",
      }],
      affected_sections: [{ class_id: 11, section_name: "Campos" }],
      affected_section_count: 1,
      affected_published_load_count: 1,
      conflicts: [],
      can_apply: true,
    });
    applyOverride.mockResolvedValue({
      message: "Published replacement Revision 2 is now active.",
      revision_id: 2,
      revision_number: 2,
      effective_date: "2026-11-12",
      status: "active",
      affected_section_count: 1,
      created_load_count: 1,
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <BreakConfigDrawer
        open
        onClose={onClose}
        onSaved={onSaved}
        initialSlots={slots}
        initialGroup="SHS_CAMPOS_ZARA"
        studioData={{
          active_period_id: 7,
          academic_years: [],
          academic_periods: [],
          academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
          classes: [{ class_id: 11, section_name: "Campos", academic_level_id: 11, academic_year_id: 3, period_template_group: "SHS_CAMPOS_ZARA" }],
          subjects: [],
          teachers: [],
          existing_loads: [{
            subject_load_id: 71,
            class_id: 11,
            subject_id: 5,
            academic_period_id: 7,
            staff_id: "T1",
            slot_id: 41,
            start_time: "08:00",
            end_time: "09:00",
            days_of_week: ["MON"],
            status: "published",
            is_locked: true,
          }],
          period_template_slots: slots,
        }}
      />,
    );

    const nameInput = await screen.findByDisplayValue("Period 1");
    fireEvent.change(nameInput, { target: { value: "First Period" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Break Timelines/i }));
    expect(await screen.findByText("Replace published schedules?")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Review Replacement/i }));
    await waitFor(() => expect(previewOverride).toHaveBeenCalled());

    const replaceButton = await screen.findByRole("button", { name: /Replace Published Schedules/i });
    expect(replaceButton.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type REPLACE PUBLISHED SCHEDULES/i), {
      target: { value: "REPLACE PUBLISHED SCHEDULES" },
    });
    expect(replaceButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(replaceButton);

    await waitFor(() => expect(applyOverride).toHaveBeenCalledWith("preview-token", "REPLACE PUBLISHED SCHEDULES"));
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
