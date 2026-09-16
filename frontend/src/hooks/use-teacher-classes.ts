import { useState, useEffect, useCallback } from "react";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  getTeacherClasses,
  getTeacherAdvisoryClasses,
  type TeacherClassItem,
} from "@/lib/api";
import type { TeacherAdvisoryClassListItem } from "@/types/adminClasses";

export interface UseTeacherClassesOptions {
  /** Optional override for period ID. Pass null to explicitly fetch all terms. */
  periodId?: number | null;
  /** Whether to fetch advisory classes in parallel. Default: true. */
  includeAdvisory?: boolean;
  /** Whether to automatically fetch on mount and on period change. Default: true. */
  enabled?: boolean;
}

export interface UseTeacherClassesReturn {
  classes: TeacherClassItem[];
  advisoryClasses: TeacherAdvisoryClassListItem[];
  isLoading: boolean;
  error: Error | null;
  selectedPeriodId: number | null;
  refetch: () => Promise<void>;
}

/**
 * Shared hook to fetch teacher subject loads and advisory classes scoped to the active/selected academic period.
 * Automatically gates requests until AcademicPeriodContext finishes loading.
 */
export function useTeacherClasses(
  options: UseTeacherClassesOptions = {}
): UseTeacherClassesReturn {
  const { periodId: overridePeriodId, includeAdvisory = true, enabled = true } = options;
  const { selectedPeriodId: contextPeriodId, isLoading: isContextLoading } = useAcademicPeriod();

  // Explicit override wins; otherwise falls back to context's selectedPeriodId
  const effectivePeriodId = overridePeriodId !== undefined ? overridePeriodId : contextPeriodId;

  const [classes, setClasses] = useState<TeacherClassItem[]>([]);
  const [advisoryClasses, setAdvisoryClasses] = useState<TeacherAdvisoryClassListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    // Gate: do not fire while context is still loading initial period
    if (isContextLoading && overridePeriodId === undefined) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const periodParam = effectivePeriodId ?? undefined;
      const [teaching, advisory] = await Promise.all([
        getTeacherClasses(periodParam),
        includeAdvisory ? getTeacherAdvisoryClasses(periodParam) : Promise.resolve([]),
      ]);
      setClasses(teaching);
      setAdvisoryClasses(advisory);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load teacher classes"));
    } finally {
      setIsLoading(false);
    }
  }, [effectivePeriodId, includeAdvisory, isContextLoading, overridePeriodId]);

  useEffect(() => {
    if (enabled) {
      void fetchData();
    }
  }, [fetchData, enabled]);

  return {
    classes,
    advisoryClasses,
    isLoading: isLoading || (isContextLoading && overridePeriodId === undefined),
    error,
    selectedPeriodId: effectivePeriodId,
    refetch: fetchData,
  };
}
