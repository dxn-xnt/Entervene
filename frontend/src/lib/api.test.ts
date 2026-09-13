import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-navigation-progress", () => ({ startProgress: vi.fn(), doneProgress: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("document", { cookie: "" });
});
afterEach(() => vi.unstubAllGlobals());

it("does not retry a usage-limit response", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const { apiFetch } = await import("./api");
  expect((await apiFetch("/api/v1/ai/generate-quiz", { method: "POST" })).status).toBe(429);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("shares a failed refresh across a burst of unauthorized requests", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
  vi.stubGlobal("fetch", fetch);
  const { apiFetch } = await import("./api");
  await apiFetch("/api/v1/users");
  await apiFetch("/api/v1/classes");
  const refreshes = fetch.mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
  expect(refreshes).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});
