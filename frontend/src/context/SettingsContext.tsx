/**
 * SettingsContext — global provider for public application settings.
 *
 * Fetches public settings on app mount (before auth), making values
 * like `app_name`, `primary_color`, etc. available to every component.
 *
 * Pattern matches AuthContext.tsx exactly:
 *   - createContext + Provider + useSettings hook
 *   - isLoading state for initial fetch
 *   - refetch() for admin settings page to trigger after a PUT
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { getPublicSettings } from "../lib/settings-api";

interface SettingsContextType {
  /** Flat map of public settings: { app_name: "ENTERVENE", ... } */
  settings: Record<string, string>;
  /** True while the initial fetch is in progress */
  isLoading: boolean;
  /** Type-safe getter with fallback default */
  getSetting: (key: string, defaultValue?: string) => string;
  /** Re-fetch public settings (call after admin updates a setting) */
  refetch: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await getPublicSettings();
      setSettings(data);
    } catch (err) {
      console.error("Failed to load public settings:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const getSetting = useCallback(
    (key: string, defaultValue = ""): string => {
      return settings[key] ?? defaultValue;
    },
    [settings],
  );

  const refetch = useCallback(async () => {
    await fetchSettings();
  }, [fetchSettings]);

  return (
    <SettingsContext.Provider value={{ settings, isLoading, getSetting, refetch }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
};
