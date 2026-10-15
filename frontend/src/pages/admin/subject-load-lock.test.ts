import { describe, expect, it } from "vitest";
import type { SubjectLoadStudioData } from "@/lib/api";
import { getLockedSectionIds } from "./subject-load-lock";

const data = (drafts: Record<number, boolean> = {}) => ({
  existing_loads: [
    { class_id: 8, status: "published" },
    { class_id: 14, status: "draft" },
    { class_id: 20, status: "published" },
  ],
  has_pending_draft_by_class: drafts,
}) as SubjectLoadStudioData;

describe("subject load section lock state", () => {
  it("uses the server snapshot for each section", () => {
    expect([...getLockedSectionIds(data())].sort((a, b) => a - b)).toEqual([8, 20]);
    expect(getLockedSectionIds(data()).has(14)).toBe(false);
  });

  it("enables only a section with an unlocked draft", () => {
    expect([...getLockedSectionIds(data({ 8: true }))]).toEqual([20]);
    expect([...getLockedSectionIds(data())].sort((a, b) => a - b)).toEqual([8, 20]);
  });

  it("does not carry a previous section lock across reloads", () => {
    expect(getLockedSectionIds(null).size).toBe(0);
    expect([...getLockedSectionIds(data({ 20: true }))]).toEqual([8]);
  });
});
