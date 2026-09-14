/* eslint-disable react-refresh/only-export-components -- provider, hook, and theme metadata form one small public API */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export const COLOR_THEME_STORAGE_KEY = "entervene-color-theme";
export const APPEARANCE_STORAGE_KEY = "entervene-appearance";

export const colorThemes = [
  { value: "default", label: "Default", swatch: "#ffdb33" },
  { value: "blue", label: "Blue", swatch: "#60a5fa" },
  { value: "green", label: "Green", swatch: "#4ade80" },
  { value: "purple", label: "Purple", swatch: "#c084fc" },
  { value: "orange", label: "Orange", swatch: "#fb923c" },
] as const;

export type ColorTheme = (typeof colorThemes)[number]["value"];
export type Appearance = "light" | "dark";

export function isColorTheme(value: unknown): value is ColorTheme {
  return colorThemes.some((theme) => theme.value === value);
}

function getInitialTheme(): ColorTheme {
  if (typeof document !== "undefined") {
    const activeTheme = document.documentElement.dataset.theme;
    if (isColorTheme(activeTheme)) return activeTheme;
  }

  return "default";
}

function getInitialAppearance(): Appearance {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return "dark";
  }

  return "light";
}

interface ColorThemeContextValue {
  theme: ColorTheme;
  setTheme: (theme: ColorTheme) => void;
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorTheme>(getInitialTheme);
  const [appearance, setAppearanceState] = useState<Appearance>(getInitialAppearance);

  const setTheme = useCallback((nextTheme: ColorTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    setThemeState(nextTheme);
  }, []);

  const setAppearance = useCallback((nextAppearance: Appearance) => {
    document.documentElement.classList.toggle("dark", nextAppearance === "dark");
    document.documentElement.style.colorScheme = nextAppearance;

    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextAppearance);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }

    setAppearanceState(nextAppearance);
  }, []);

  return (
    <ColorThemeContext.Provider value={{ theme, setTheme, appearance, setAppearance }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme() {
  const context = useContext(ColorThemeContext);
  if (!context) throw new Error("useColorTheme must be used within ColorThemeProvider");
  return context;
}
