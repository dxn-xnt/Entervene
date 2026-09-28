import { describe, expect, it } from "vitest";
import { SidebarConfigs } from "./sidebar-config";
import { routes } from "@/../routes";

describe("intervention navigation", () => {
  it("shows teacher intervention review and preserves admin AI Predictions", () => {
    expect(SidebarConfigs.teacher.some((item) => item.url === routes.teacher.interventions)).toBe(true);
    expect(SidebarConfigs.admin.some((item) => item.url === routes.admin.interventions)).toBe(false);
    expect(SidebarConfigs.admin.some((item) => item.url === routes.admin.predictions)).toBe(true);
  });
});
