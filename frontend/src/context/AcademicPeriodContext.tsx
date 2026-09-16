import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";

export const ACADEMIC_PERIOD_STORAGE_KEY = "entervene_selected_period_id";

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

interface AcademicPeriodContextType {
  periods: AcademicPeriodItem[];
  selectedPeriodId: number | null;
  setSelectedPeriodId: (id: number | null) => void;
  isLoading: boolean;
  refetch: () => Promise<void>;
  registerDirtyGuard: (guard: DirtyGuard) => () => void;
}

const AcademicPeriodContext = createContext<AcademicPeriodContextType | null>(null);

export const AcademicPeriodProvider = ({ children }: { children: ReactNode }) => {
  const [periods, setPeriods] = useState<AcademicPeriodItem[]>([]);
  const [selectedPeriodId, setSelectedPeriodIdState] = useState<number | null>(() => {
    // Optimistic read from localStorage before API returns
    try {
      const stored = localStorage.getItem(ACADEMIC_PERIOD_STORAGE_KEY);
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
  const [pendingPeriodId, setPendingPeriodId] = useState<number | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingGuardMessage, setPendingGuardMessage] = useState<string>("");

  const registerDirtyGuard = useCallback((guard: DirtyGuard) => {
    dirtyGuardsRef.current.set(guard.id, guard);
    return () => {
      dirtyGuardsRef.current.delete(guard.id);
    };
  }, []);

  const applyPeriodChange = useCallback((nextId: number | null) => {
    setSelectedPeriodIdState(nextId);
    try {
      if (nextId !== null) {
        localStorage.setItem(ACADEMIC_PERIOD_STORAGE_KEY, String(nextId));
      } else {
        localStorage.removeItem(ACADEMIC_PERIOD_STORAGE_KEY);
      }
    } catch (_) {}
  }, []);

  const requestPeriodChange = useCallback((nextId: number | null) => {
    setSelectedPeriodIdState((currentId) => {
      if (nextId === currentId) return currentId;

      // Check if any registered guard reports dirty
      const guards = Array.from(dirtyGuardsRef.current.values());
      const activeGuard = guards.find((g) => g.isDirty());

      if (activeGuard) {
        setPendingPeriodId(nextId);
        setPendingGuardMessage(
          activeGuard.message ||
            "You have unsaved changes that will be lost if you switch academic terms."
        );
        setShowConfirmDialog(true);
        // Do NOT change currentId!
        return currentId;
      }

      // Clean: apply immediately to state and localStorage
      try {
        if (nextId !== null) {
          localStorage.setItem(ACADEMIC_PERIOD_STORAGE_KEY, String(nextId));
        } else {
          localStorage.removeItem(ACADEMIC_PERIOD_STORAGE_KEY);
        }
      } catch (_) {}
      return nextId;
    });
  }, []);

  const handleConfirmSwitch = () => {
    const nextId = pendingPeriodId;
    // Notify all active guards to clear/discard their dirty state
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
    setPendingPeriodId(null);
    applyPeriodChange(nextId);
  };

  const handleCancelSwitch = () => {
    setShowConfirmDialog(false);
    setPendingPeriodId(null);

    // If change was attempted by an external tab mutating localStorage, revert localStorage back to current tab's active term
    try {
      if (selectedPeriodId !== null) {
        localStorage.setItem(ACADEMIC_PERIOD_STORAGE_KEY, String(selectedPeriodId));
      }
    } catch (_) {}
  };

  // Listen to cross-tab storage changes and run through the EXACT same dirty check
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== ACADEMIC_PERIOD_STORAGE_KEY) return;
      if (!e.newValue) return;
      const parsed = parseInt(e.newValue, 10);
      if (!isNaN(parsed) && parsed !== selectedPeriodId) {
        requestPeriodChange(parsed);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [selectedPeriodId, requestPeriodChange]);

  const fetchPeriods = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/v1/settings/academic-periods");
      if (res.ok) {
        const data = await res.json();
        const loadedPeriods: AcademicPeriodItem[] = data.periods || [];
        setPeriods(loadedPeriods);

        if (loadedPeriods.length > 0) {
          setSelectedPeriodIdState((currentId) => {
            // 1. Try to honor currentId / localStorage value if it exists in loadedPeriods
            if (currentId !== null && loadedPeriods.some((p) => p.id === currentId)) {
              return currentId;
            }

            // 2. Validate localStorage
            try {
              const stored = localStorage.getItem(ACADEMIC_PERIOD_STORAGE_KEY);
              if (stored) {
                const parsed = parseInt(stored, 10);
                if (!isNaN(parsed) && loadedPeriods.some((p) => p.id === parsed)) {
                  return parsed;
                }
              }
            } catch (_) {}

            // 3. Fallback to active period or first available period
            const active = loadedPeriods.find((p) => p.is_active) || loadedPeriods[0];
            const fallbackId = active ? active.id : null;
            if (fallbackId !== null) {
              try {
                localStorage.setItem(ACADEMIC_PERIOD_STORAGE_KEY, String(fallbackId));
              } catch (_) {}
            }
            return fallbackId;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load academic periods:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPeriods();
  }, [fetchPeriods]);

  return (
    <AcademicPeriodContext.Provider
      value={{
        periods,
        selectedPeriodId,
        setSelectedPeriodId: requestPeriodChange,
        isLoading,
        refetch: fetchPeriods,
        registerDirtyGuard,
      }}
    >
      {children}

      <ConfirmDialog
        open={showConfirmDialog}
        onOpenChange={(open) => !open && handleCancelSwitch()}
        title="Unsaved Changes in Academic Term"
        description={
          pendingGuardMessage ||
          "You have unsaved changes that will be lost if you switch academic terms. Are you sure you want to proceed?"
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

