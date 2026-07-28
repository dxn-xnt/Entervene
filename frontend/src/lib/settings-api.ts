/**
 * Settings API client.
 *
 * - `getPublicSettings()` uses raw `fetch()` (no auth) — works before login.
 * - `getAllSettings()` and `updateSetting()` use `apiFetch()` (requires JWT).
 */

import { apiFetch, API_URL } from "./api";

// ── Types ───────────────────────────────────────────────────────────

export type SettingItem = {
  key: string;
  value: string;
  type: "string" | "boolean" | "integer" | "json";
  group: string;
  is_public: boolean;
  description: string | null;
};

export type GroupedSettings = {
  groups: Record<string, SettingItem[]>;
};

// ── Public (no auth required) ───────────────────────────────────────

/**
 * Fetch public settings as a flat `{ key: value }` map.
 * Uses raw `fetch()` because this runs before authentication.
 */
export async function getPublicSettings(): Promise<Record<string, string>> {
  const res = await fetch(`${API_URL}/api/v1/settings/public`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load public settings");
  const data = await res.json();
  return data.settings;
}

// ── Admin (requires JWT) ────────────────────────────────────────────

/** Fetch all settings grouped by category (admin only). */
export async function getAllSettings(): Promise<GroupedSettings> {
  const res = await apiFetch("/api/v1/settings");
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

/** Update a single setting (admin only). */
export async function updateSetting(
  key: string,
  value: string,
): Promise<SettingItem> {
  const res = await apiFetch(
    `/api/v1/settings/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to update setting");
  }
  return res.json();
}
