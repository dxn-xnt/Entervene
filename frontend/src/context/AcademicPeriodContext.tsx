import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useOptionalAuth } from "@/context/AuthContext";

export const ACADEMIC_PERIOD_STORAGE_KEY = "entervene_selected_period_id";
export const ACADEMIC_YEAR_STORAGE_KEY = "entervene_selected_year_id";

export interface AcademicYearItem {
  academic_year_id: number;
  year_label: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
}

export interface AcademicPeriodItem {
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
}

export interface DirtyGuardOptions {
  message?: string;
  onDiscard?: () => void;
}

export type DirtyGuard = {
  id: string;
  isDirty: () => boolean;
  message?: string;
  onDiscard?: () => void;
};

export interface AcademicPeriodContextType {
  periods: AcademicPeriodItem[];
  selectedPeriodId: number | null;
  setSelectedPeriodId: (id: number | null) => void;
  isLoading: boolean;
  refetch: () => Promise<void>;
  registerDirtyGuard: (guard: DirtyGuard) => () => void;
  academicYears: AcademicYearItem[];
  years: AcademicYearItem[];
  selectedYearId: number | null;
  setSelectedYearId: (id: number | null) => void;
  selectedPeriod: AcademicPeriodItem | null;
  selectedYear: AcademicYearItem | null;
}

export function getAcademicYearStorageKey(userId?: string | null): string {
  return userId ? `${ACADEMIC_YEAR_STORAGE_KEY}:${userId}` : ACADEMIC_YEAR_STORAGE_KEY;
}

export function getAcademicPeriodStorageKey(
  userId?: string | null,
  yearId?: number | null
): string {
  if (userId && yearId != null) {
    return `${ACADEMIC_PERIOD_STORAGE_KEY}:${userId}:${yearId}`;
  }
  if (userId) {
    return `${ACADEMIC_PERIOD_STORAGE_KEY}:${userId}`;
  }
  return ACADEMIC_PERIOD_STORAGE_KEY;
}

function saveYearToStorage(yearId: number | null, userId?: string | null) {
  try {
    const key = getAcademicYearStorageKey(userId);
    if (yearId !== null) {
      localStorage.setItem(key, String(yearId));
      if (!userId) {
        localStorage.setItem(ACADEMIC_YEAR_STORAGE_KEY, String(yearId));
      }
    } else {
      localStorage.removeItem(key);
    }
  } catch (_) {}
}

/**
 * Enforces role-based visibility rules as defense-in-depth:
 * - Admin: historical, active, future
 * - Teacher/Student/Unauthenticated: active + historical only. Never future years.
 */
export function filterAuthorizedYears(
  years: AcademicYearItem[],
  role?: string | null
): AcademicYearItem[] {
  if (role === "admin") {
    return years;
  }
  // Teachers, Students, and Unauthenticated callers must never see future years
  const activeYear = years.find((y) => y.is_active);
  if (!activeYear) {
    return years;
  }

  const parseStartYear = (y: AcademicYearItem): number | null => {
    if (y.start_date) {
      const d = new Date(y.start_date);
      if (!isNaN(d.getFullYear())) return d.getFullYear();
    }
    const match = y.year_label?.match(/^(\d{4})/);
    if (match) return parseInt(match[1], 10);
    return null;
  };

  const activeStartYear = parseStartYear(activeYear);

  return years.filter((year) => {
    if (year.is_active || year.academic_year_id === activeYear.academic_year_id) {
      return true;
    }
    const startYear = parseStartYear(year);
    if (activeStartYear !== null && startYear !== null) {
      return startYear <= activeStartYear;
    }
    if (year.start_date && activeYear.end_date) {
      return new Date(year.start_date).getTime() < new Date(activeYear.end_date).getTime();
    }
    return year.academic_year_id <= activeYear.academic_year_id;
  });
}

function savePeriodToStorage(
  periodId: number | null,
  userId?: string | null,
  yearId?: number | null
) {
  try {
    if (periodId !== null) {
      if (userId) {
        localStorage.setItem(getAcademicPeriodStorageKey(userId), String(periodId));
        if (yearId != null) {
          localStorage.setItem(getAcademicPeriodStorageKey(userId, yearId), String(periodId));
        }
      } else {
        localStorage.setItem(ACADEMIC_PERIOD_STORAGE_KEY, String(periodId));
      }
    } else {
      if (userId) {
        localStorage.removeItem(getAcademicPeriodStorageKey(userId));
        if (yearId != null) {
          localStorage.removeItem(getAcademicPeriodStorageKey(userId, yearId));
        }
      } else {
        localStorage.removeItem(ACADEMIC_PERIOD_STORAGE_KEY);
      }
    }
  } catch (_) {}
}

const AcademicPeriodContext = createContext<AcademicPeriodContextType | null>(null);

type PendingSwitch =
  | { type: "period"; id: number | null }
  | { type: "year"; id: number | null };

export const AcademicPeriodProvider = ({ children }: { children: ReactNode }) => {
  const auth = useOptionalAuth();
  const userId = auth?.user?.userId ?? null;
  const role = auth?.role ?? auth?.user?.role ?? null;

  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;

  const roleRef = useRef<string | null>(role);
  roleRef.current = role;

  const [academicYears, setAcademicYears] = useState<AcademicYearItem[]>([]);
  const academicYearsRef = useRef<AcademicYearItem[]>([]);
  academicYearsRef.current = academicYears;

  const [selectedYearId, setSelectedYearIdState] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(getAcademicYearStorageKey(userId));
      if (stored) {
        const parsed = parseInt(stored, 10);
        return isNaN(parsed) ? null : parsed;
      }
    } catch (_) {}
    return null;
  });
  const selectedYearIdRef = useRef<number | null>(selectedYearId);
  selectedYearIdRef.current = selectedYearId;

  const [periods, setPeriods] = useState<AcademicPeriodItem[]>([]);
  const periodsRef = useRef<AcademicPeriodItem[]>([]);
  periodsRef.current = periods;

  const [selectedPeriodId, setSelectedPeriodIdState] = useState<number | null>(() => {
    try {
      const stored = localStorage.getItem(getAcademicPeriodStorageKey(userId));
      if (stored) {
        const parsed = parseInt(stored, 10);
        return isNaN(parsed) ? null : parsed;
      }
    } catch (_) {}
    return null;
  });

  const [isLoading, setIsLoading] = useState(true);

  // Dirty guard registry
  const dirtyGuardsRef = useRef<Map<string, DirtyGuard>>(new Map());
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingGuardMessage, setPendingGuardMessage] = useState<string>("");

  const periodRequestIdRef = useRef(0);
  const yearsRequestIdRef = useRef(0);

  const registerDirtyGuard = useCallback((guard: DirtyGuard) => {
    dirtyGuardsRef.current.set(guard.id, guard);
    return () => {
      dirtyGuardsRef.current.delete(guard.id);
    };
  }, []);

  const fetchPeriodsForYear = useCallback(
    async (yearId: number | null, uid?: string | null): Promise<AcademicPeriodItem[]> => {
      const currentRequestId = ++periodRequestIdRef.current;
      setIsLoading(true);
      try {
        const url =
          yearId != null
            ? `/api/v1/settings/academic-periods?academic_year_id=${yearId}`
            : "/api/v1/settings/academic-periods";
        const res = await apiFetch(url);

        if (currentRequestId !== periodRequestIdRef.current) {
          // Stale response! Another newer fetch was started. Discard.
          return [];
        }

        if (res.ok) {
          const data = await res.json();
          const loadedPeriods: AcademicPeriodItem[] = data.periods || [];
          setPeriods(loadedPeriods);
          periodsRef.current = loadedPeriods;

          setSelectedPeriodIdState((currentPeriodId) => {
            let chosenId: number | null = null;

            // 1. Try year-specific user storage first
            try {
              const yearStored = localStorage.getItem(
                getAcademicPeriodStorageKey(uid ?? userIdRef.current, yearId)
              );
              if (yearStored) {
                const parsed = parseInt(yearStored, 10);
                if (!isNaN(parsed) && loadedPeriods.some((p) => p.id === parsed)) {
                  chosenId = parsed;
                }
              }
            } catch (_) {}

            // 2. If current in-memory period belongs to loadedPeriods, retain it
            if (
              chosenId === null &&
              currentPeriodId !== null &&
              loadedPeriods.some((p) => p.id === currentPeriodId)
            ) {
              chosenId = currentPeriodId;
            }

            // 3. Try general user storage
            if (chosenId === null) {
              try {
                const generalStored = localStorage.getItem(
                  getAcademicPeriodStorageKey(uid ?? userIdRef.current)
                );
                if (generalStored) {
                  const parsed = parseInt(generalStored, 10);
                  if (!isNaN(parsed) && loadedPeriods.some((p) => p.id === parsed)) {
                    chosenId = parsed;
                  }
                }
              } catch (_) {}
            }

            // 4. Fallback to active period in this year or first period
            if (chosenId === null && loadedPeriods.length > 0) {
              const active = loadedPeriods.find((p) => p.is_active);
              chosenId = active ? active.id : loadedPeriods[0].id;
            }

            savePeriodToStorage(chosenId, uid ?? userIdRef.current, yearId);
            return chosenId;
          });

          return loadedPeriods;
        } else if (res.status === 403) {
          // Explicit unauthorized academic year requested!
          console.warn(`Access forbidden for academic year ${yearId}. Resetting selection.`);
          setPeriods([]);
          periodsRef.current = [];
          setSelectedPeriodIdState(null);

          // Fall back to active authorized year if available
          const activeYear = academicYearsRef.current.find((y) => y.is_active);
          const fallbackYearId = activeYear
            ? activeYear.academic_year_id
            : (academicYearsRef.current[0]?.academic_year_id ?? null);
          if (fallbackYearId !== null && fallbackYearId !== yearId) {
            setSelectedYearIdState(fallbackYearId);
            selectedYearIdRef.current = fallbackYearId;
            saveYearToStorage(fallbackYearId, uid ?? userIdRef.current);
            void fetchPeriodsForYear(fallbackYearId, uid ?? userIdRef.current);
          }
          return [];
        } else {
          setPeriods([]);
          periodsRef.current = [];
          setSelectedPeriodIdState(null);
          return [];
        }
      } catch (err) {
        if (currentRequestId === periodRequestIdRef.current) {
          console.error("Failed to load academic periods:", err);
          setPeriods([]);
          periodsRef.current = [];
          setSelectedPeriodIdState(null);
        }
        return [];
      } finally {
        if (currentRequestId === periodRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  const fetchYearsAndPeriods = useCallback(
    async (options?: { isAuthChange?: boolean; wasInitialAuth?: boolean }) => {
      const currentYearsRequestId = ++yearsRequestIdRef.current;
      const currentUid = userIdRef.current;
      const currentRole = roleRef.current;
      setIsLoading(true);

      try {
        const res = await apiFetch("/api/v1/settings/academic-years");
        if (currentYearsRequestId !== yearsRequestIdRef.current) {
          return;
        }

        let loadedYears: AcademicYearItem[] = [];
        if (res.ok) {
          const data = await res.json();
          loadedYears = data.years || [];
        } else {
          loadedYears = [];
        }

        // Defense-in-depth: Never show future years to Teacher, Student, or Unauthenticated callers
        loadedYears = filterAuthorizedYears(loadedYears, currentRole);

        setAcademicYears(loadedYears);
        academicYearsRef.current = loadedYears;

        const isAuthChange = options?.isAuthChange ?? false;
        const wasInitialAuth = options?.wasInitialAuth ?? false;

        let targetYearId: number | null = null;

        // If not an auth change and current selection is still valid in loadedYears, retain it
        if (
          !isAuthChange &&
          selectedYearIdRef.current !== null &&
          loadedYears.some((y) => y.academic_year_id === selectedYearIdRef.current)
        ) {
          targetYearId = selectedYearIdRef.current;
        }

        // 1. Try user-scoped storage for the current user
        if (targetYearId === null) {
          try {
            const stored = localStorage.getItem(getAcademicYearStorageKey(currentUid));
            if (stored) {
              const parsed = parseInt(stored, 10);
              if (!isNaN(parsed) && loadedYears.some((y) => y.academic_year_id === parsed)) {
                targetYearId = parsed;
              }
            }
          } catch (_) {}
        }

        // 2. Initial auth resolution: retain current selection or unscoped storage if valid
        if (targetYearId === null && wasInitialAuth) {
          if (
            selectedYearIdRef.current !== null &&
            loadedYears.some((y) => y.academic_year_id === selectedYearIdRef.current)
          ) {
            targetYearId = selectedYearIdRef.current;
          } else {
            try {
              const unscoped = localStorage.getItem(ACADEMIC_YEAR_STORAGE_KEY);
              if (unscoped) {
                const parsed = parseInt(unscoped, 10);
                if (!isNaN(parsed) && loadedYears.some((y) => y.academic_year_id === parsed)) {
                  targetYearId = parsed;
                }
              }
            } catch (_) {}
          }
        }

        // 3. Fallback to active year or first available authorized year
        if (targetYearId === null) {
          if (loadedYears.length > 0) {
            const activeYear = loadedYears.find((y) => y.is_active);
            targetYearId = activeYear ? activeYear.academic_year_id : loadedYears[0].academic_year_id;
          } else {
            targetYearId = null;
          }
        }

        // Reject/reset stored selection if no longer authorized or update storage with chosen year
        saveYearToStorage(targetYearId, currentUid);
        setSelectedYearIdState(targetYearId);
        selectedYearIdRef.current = targetYearId;

        if (currentYearsRequestId === yearsRequestIdRef.current) {
          await fetchPeriodsForYear(targetYearId, currentUid);
        }
      } catch (err) {
        if (currentYearsRequestId === yearsRequestIdRef.current) {
          console.error("Failed to load academic context:", err);
          await fetchPeriodsForYear(null, currentUid);
        }
      }
    },
    [fetchPeriodsForYear]
  );

  useEffect(() => {
    void fetchYearsAndPeriods();
  }, [fetchYearsAndPeriods]);

  // Handle user account switch / login / logout to re-fetch authorized years and re-scope stored selections
  const currentAuthKey = `${userId ?? ""}:${role ?? ""}`;
  const prevAuthKeyRef = useRef<string>(currentAuthKey);
  const prevUserIdRef = useRef<string | null>(userId);

  useEffect(() => {
    if (prevAuthKeyRef.current !== currentAuthKey) {
      const wasInitialAuth = prevUserIdRef.current === null && userId !== null;
      prevAuthKeyRef.current = currentAuthKey;
      prevUserIdRef.current = userId;

      void fetchYearsAndPeriods({ isAuthChange: true, wasInitialAuth });
    }
  }, [currentAuthKey, userId, fetchYearsAndPeriods]);

  const applyPeriodChange = useCallback(
    (nextId: number | null) => {
      setSelectedPeriodIdState(nextId);
      savePeriodToStorage(nextId, userIdRef.current, selectedYearId);
    },
    [selectedYearId]
  );

  const requestPeriodChange = useCallback(
    (nextId: number | null) => {
      if (nextId === selectedPeriodId) return;

      if (nextId !== null && periodsRef.current.length > 0) {
        if (!periodsRef.current.some((p) => p.id === nextId)) {
          console.warn(`Attempted to select unauthorized academic period: ${nextId}`);
          return;
        }
      }

      const guards = Array.from(dirtyGuardsRef.current.values());
      const activeGuard = guards.find((g) => g.isDirty());

      if (activeGuard) {
        setPendingSwitch({ type: "period", id: nextId });
        setPendingGuardMessage(
          activeGuard.message ||
            "You have unsaved changes that will be lost if you switch academic terms."
        );
        setShowConfirmDialog(true);
        return;
      }

      applyPeriodChange(nextId);
    },
    [applyPeriodChange, selectedPeriodId]
  );

  const applyYearChange = useCallback(
    (nextYearId: number | null) => {
      setSelectedYearIdState(nextYearId);
      selectedYearIdRef.current = nextYearId;
      saveYearToStorage(nextYearId, userIdRef.current);
      void fetchPeriodsForYear(nextYearId, userIdRef.current);
    },
    [fetchPeriodsForYear]
  );

  const requestYearChange = useCallback(
    (nextYearId: number | null) => {
      if (nextYearId === selectedYearId) return;

      // Reject selecting an unauthorized academic year
      if (nextYearId !== null && academicYearsRef.current.length > 0) {
        if (!academicYearsRef.current.some((y) => y.academic_year_id === nextYearId)) {
          console.warn(`Attempted to select unauthorized academic year: ${nextYearId}`);
          return;
        }
      }

      const guards = Array.from(dirtyGuardsRef.current.values());
      const activeGuard = guards.find((g) => g.isDirty());

      if (activeGuard) {
        setPendingSwitch({ type: "year", id: nextYearId });
        setPendingGuardMessage(
          activeGuard.message ||
            "You have unsaved changes that will be lost if you switch academic years."
        );
        setShowConfirmDialog(true);
        return;
      }

      applyYearChange(nextYearId);
    },
    [applyYearChange, selectedYearId]
  );

  const handleConfirmSwitch = () => {
    const target = pendingSwitch;
    Array.from(dirtyGuardsRef.current.values()).forEach((g) => {
      if (g.isDirty()) {
        try {
          g.onDiscard?.();
        } catch (e) {
          console.error("Error executing onDiscard handler:", e);
        }
      }
    });

    setShowConfirmDialog(false);
    setPendingSwitch(null);

    if (!target) return;
    if (target.type === "period") {
      applyPeriodChange(target.id);
    } else if (target.type === "year") {
      applyYearChange(target.id);
    }
  };

  const handleCancelSwitch = () => {
    setShowConfirmDialog(false);
    setPendingSwitch(null);

    try {
      if (selectedPeriodId !== null) {
        savePeriodToStorage(selectedPeriodId, userIdRef.current, selectedYearId);
      }
      if (selectedYearId !== null) {
        saveYearToStorage(selectedYearId, userIdRef.current);
      }
    } catch (_) {}
  };

  // Listen to cross-tab storage changes and run through the dirty check
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      const periodKey = getAcademicPeriodStorageKey(userIdRef.current);
      const yearKey = getAcademicYearStorageKey(userIdRef.current);

      if (e.key === periodKey || (e.key === ACADEMIC_PERIOD_STORAGE_KEY && !userIdRef.current)) {
        if (!e.newValue) return;
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed !== selectedPeriodId) {
          requestPeriodChange(parsed);
        }
      } else if (e.key === yearKey || (e.key === ACADEMIC_YEAR_STORAGE_KEY && !userIdRef.current)) {
        if (!e.newValue) return;
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed !== selectedYearId) {
          requestYearChange(parsed);
        }
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [selectedPeriodId, selectedYearId, requestPeriodChange, requestYearChange]);

  const selectedYear = useMemo(
    () => academicYears.find((y) => y.academic_year_id === selectedYearId) || null,
    [academicYears, selectedYearId]
  );

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) || null,
    [periods, selectedPeriodId]
  );

  return (
    <AcademicPeriodContext.Provider
      value={{
        periods,
        selectedPeriodId,
        setSelectedPeriodId: requestPeriodChange,
        isLoading,
        refetch: fetchYearsAndPeriods,
        registerDirtyGuard,
        academicYears,
        years: academicYears,
        selectedYearId,
        setSelectedYearId: requestYearChange,
        selectedPeriod,
        selectedYear,
      }}
    >
      {children}

      <ConfirmDialog
        open={showConfirmDialog}
        onOpenChange={(open) => !open && handleCancelSwitch()}
        title={
          pendingSwitch?.type === "year"
            ? "Unsaved Changes in Academic Context"
            : "Unsaved Changes in Academic Term"
        }
        confirmationTitle={
          pendingSwitch?.type === "year"
            ? "Switch academic year and discard changes?"
            : "Switch academic term and discard changes?"
        }
        description={
          pendingGuardMessage ||
          (pendingSwitch?.type === "year"
            ? "You have unsaved changes that will be lost if you switch academic years. Are you sure you want to proceed?"
            : "You have unsaved changes that will be lost if you switch academic terms. Are you sure you want to proceed?")
        }
        confirmLabel="Discard & Switch"
        cancelLabel="Stay Here"
        confirmVariant="destructive"
        onConfirm={handleConfirmSwitch}
        onCancel={handleCancelSwitch}
      />
    </AcademicPeriodContext.Provider>
  );
};

// Hook for consumers to access academic period state
// eslint-disable-next-line react-refresh/only-export-components
export const useAcademicPeriod = () => {
  const ctx = useContext(AcademicPeriodContext);
  if (!ctx) {
    throw new Error("useAcademicPeriod must be used within an AcademicPeriodProvider");
  }
  return ctx;
};

/**
 * Hook for pages/components to register a dirty-state guard against academic period switches.
 * When isDirty is true, any term switch (via sidebar or cross-tab sync) is blocked with a confirmation prompt.
 * Automatically deregisters on component unmount.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRegisterDirtyGuard(
  isDirty: boolean,
  options?: DirtyGuardOptions
) {
  const { registerDirtyGuard } = useAcademicPeriod();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  useEffect(() => {
    const id = Math.random().toString(36).substring(2, 9);
    const unregister = registerDirtyGuard({
      id,
      isDirty: () => isDirtyRef.current,
      get message() {
        return optionsRef.current?.message;
      },
      onDiscard: () => {
        optionsRef.current?.onDiscard?.();
      },
    });

    return unregister;
  }, [registerDirtyGuard]);
}
