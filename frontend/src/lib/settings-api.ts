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

export type AcademicYearSettingItem = {
  academic_year_id: number;
  year_label: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
};

export type AcademicLevelSettingItem = {
  academic_level_id: number;
  level_name: string;
  grade_level: number;
  stage: "Junior High" | "Senior High";
};

export type AcademicPeriodSettingItem = {
  id: number;
  period: string;
  period_sequence: number;
  total_periods: number;
  academicyear: string;
  academic_year_id: number;
  startDate: string | null;
  endDate: string | null;
  is_active: boolean;
  status: string;
};

/** Fetch all settings grouped by category (admin only). */
export async function getAllSettings(): Promise<GroupedSettings> {
  const res = await apiFetch("/api/v1/settings");
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

/** Fetch all academic years (admin only). */
export async function getAcademicYearsSettings(): Promise<AcademicYearSettingItem[]> {
  const res = await apiFetch("/api/v1/settings/academic-years");
  if (!res.ok) throw new Error("Failed to load academic years");
  const data = await res.json();
  return data.years || [];
}

/** Set active academic year (admin only). */
export async function setActiveAcademicYear(academicYearId: number): Promise<void> {
  const res = await apiFetch(`/api/v1/settings/active-academic-year/${academicYearId}`, {
    method: "PUT",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to set active academic year");
  }
}

/** Fetch all academic levels (admin only). */
export async function getAcademicLevelsSettings(): Promise<AcademicLevelSettingItem[]> {
  const res = await apiFetch("/api/v1/settings/academic-levels");
  if (!res.ok) throw new Error("Failed to load academic levels");
  const data = await res.json();
  return data.levels || [];
}

/** Fetch all academic periods (admin only). */
export async function getAcademicPeriodsSettings(academicYearId?: number): Promise<AcademicPeriodSettingItem[]> {
  const query = academicYearId ? `?academic_year_id=${academicYearId}` : "";
  const res = await apiFetch(`/api/v1/settings/academic-periods${query}`);
  if (!res.ok) throw new Error("Failed to load academic periods");
  const data = await res.json();
  return data.periods || [];
}

/** Set active academic period (admin only). */
export async function setActivePeriod(periodId: number): Promise<void> {
  const res = await apiFetch(`/api/v1/settings/active-period/${periodId}`, {
    method: "PUT",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to set active period");
  }
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
