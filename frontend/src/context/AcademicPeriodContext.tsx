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
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;

  const [academicYears, setAcademicYears] = useState<AcademicYearItem[]>([]);
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

  const [periods, setPeriods] = useState<AcademicPeriodItem[]>([]);
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

          setSelectedPeriodIdState((currentPeriodId) => {
            let chosenId: number | null = null;

            // 1. If currentPeriodId belongs to loadedPeriods, retain it
            if (currentPeriodId !== null && loadedPeriods.some((p) => p.id === currentPeriodId)) {
              chosenId = currentPeriodId;
            }

            // 2. Try year-specific user storage
            if (chosenId === null) {
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
        } else {
          setPeriods([]);
          setSelectedPeriodIdState(null);
          return [];
        }
      } catch (err) {
        if (currentRequestId === periodRequestIdRef.current) {
          console.error("Failed to load academic periods:", err);
          setPeriods([]);
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

  const fetchYearsAndPeriods = useCallback(async () => {
    const currentYearsRequestId = ++yearsRequestIdRef.current;
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
        setAcademicYears(loadedYears);
      }

      let targetYearId: number | null = null;
      setSelectedYearIdState((currentYearId) => {
        // 1. Retain current if valid
        if (currentYearId !== null && loadedYears.some((y) => y.academic_year_id === currentYearId)) {
          targetYearId = currentYearId;
          return currentYearId;
        }

        // 2. Try user-scoped storage
        try {
          const stored = localStorage.getItem(getAcademicYearStorageKey(userIdRef.current));
          if (stored) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed) && loadedYears.some((y) => y.academic_year_id === parsed)) {
              targetYearId = parsed;
              return parsed;
            }
          }
        } catch (_) {}

        // 3. Fallback to active year or first available year
        if (loadedYears.length > 0) {
          const activeYear = loadedYears.find((y) => y.is_active);
          targetYearId = activeYear ? activeYear.academic_year_id : loadedYears[0].academic_year_id;
        } else {
          targetYearId = null;
        }

        saveYearToStorage(targetYearId, userIdRef.current);
        return targetYearId;
      });

      await fetchPeriodsForYear(targetYearId, userIdRef.current);
    } catch (err) {
      if (currentYearsRequestId === yearsRequestIdRef.current) {
        console.error("Failed to load academic context:", err);
        await fetchPeriodsForYear(null, userIdRef.current);
      }
    }
  }, [fetchPeriodsForYear]);

  useEffect(() => {
    void fetchYearsAndPeriods();
  }, [fetchYearsAndPeriods]);

  // Handle user account switch / login / logout to re-scope stored selections
  const prevUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      const wasInitialAuth = prevUserIdRef.current === null;
      prevUserIdRef.current = userId;

      if (academicYears.length > 0) {
        let targetYearId: number | null = null;
        try {
          const stored = localStorage.getItem(getAcademicYearStorageKey(userId));
          if (stored) {
            const parsed = parseInt(stored, 10);
            if (!isNaN(parsed) && academicYears.some((y) => y.academic_year_id === parsed)) {
              targetYearId = parsed;
            }
          }
        } catch (_) {}

        // Fallback 1: Retain current selected year if valid (initial auth resolution only, avoid cross-user leak)
        if (
          wasInitialAuth &&
          targetYearId === null &&
          selectedYearId !== null &&
          academicYears.some((y) => y.academic_year_id === selectedYearId)
        ) {
          targetYearId = selectedYearId;
        }

        // Fallback 2: Check unscoped storage key (initial auth resolution only)
        if (wasInitialAuth && targetYearId === null) {
          try {
            const unscoped = localStorage.getItem(ACADEMIC_YEAR_STORAGE_KEY);
            if (unscoped) {
              const parsed = parseInt(unscoped, 10);
              if (!isNaN(parsed) && academicYears.some((y) => y.academic_year_id === parsed)) {
                targetYearId = parsed;
              }
            }
          } catch (_) {}
        }

        // Fallback 3: Active year or first available year
        if (targetYearId === null) {
          const activeYear = academicYears.find((y) => y.is_active);
          targetYearId = activeYear ? activeYear.academic_year_id : (academicYears[0]?.academic_year_id ?? null);
        }

        setSelectedYearIdState(targetYearId);
        saveYearToStorage(targetYearId, userId);
        void fetchPeriodsForYear(targetYearId, userId);
      }
    }
  }, [userId, academicYears, fetchPeriodsForYear, selectedYearId]);

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
      saveYearToStorage(nextYearId, userIdRef.current);
      void fetchPeriodsForYear(nextYearId, userIdRef.current);
    },
    [fetchPeriodsForYear]
  );

  const requestYearChange = useCallback(
    (nextYearId: number | null) => {
      if (nextYearId === selectedYearId) return;

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
