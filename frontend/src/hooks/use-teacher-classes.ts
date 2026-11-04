import { useState, useEffect, useCallback, useRef } from "react";
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
  /** Optional override for year ID. */
  yearId?: number | null;
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
  selectedYearId: number | null;
  refetch: () => Promise<void>;
}

/**
 * Shared hook to fetch teacher subject loads and advisory classes scoped to the active/selected academic period and year.
 * Automatically gates requests until AcademicPeriodContext finishes loading, and prevents stale response race conditions.
 */
export function useTeacherClasses(
  options: UseTeacherClassesOptions = {}
): UseTeacherClassesReturn {
  const {
    periodId: overridePeriodId,
    yearId: overrideYearId,
    includeAdvisory = true,
    enabled = true,
  } = options;
  const {
    selectedPeriodId: contextPeriodId,
    selectedYearId: contextYearId,
    periods,
    isLoading: isContextLoading,
  } = useAcademicPeriod();

  // Explicit override wins; otherwise falls back to context's values
  const effectivePeriodId = overridePeriodId !== undefined ? overridePeriodId : contextPeriodId;
  const effectiveYearId = overrideYearId !== undefined ? overrideYearId : contextYearId;

  const [classes, setClasses] = useState<TeacherClassItem[]>([]);
  const [advisoryClasses, setAdvisoryClasses] = useState<TeacherAdvisoryClassListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    // Gate 1: do not fire while context is still loading initial period/year
    if (isContextLoading && overridePeriodId === undefined && overrideYearId === undefined) {
      return;
    }

    // Gate 2: if context has a selected year, and that year has periods, but period is not yet resolved
    if (
      overridePeriodId === undefined &&
      overrideYearId === undefined &&
      contextYearId != null &&
      periods.length > 0 &&
      contextPeriodId == null
    ) {
      return;
    }

    // Gate 3: if selected year has no periods at all
    if (
      overridePeriodId === undefined &&
      overrideYearId === undefined &&
      contextYearId != null &&
      periods.length === 0 &&
      !isContextLoading
    ) {
      setClasses([]);
      setAdvisoryClasses([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const [teaching, advisory] = await Promise.all([
        getTeacherClasses(effectivePeriodId, effectiveYearId),
        includeAdvisory
          ? getTeacherAdvisoryClasses(effectivePeriodId, effectiveYearId)
          : Promise.resolve([]),
      ]);
      if (currentRequestId === requestIdRef.current) {
        setClasses(teaching);
        setAdvisoryClasses(advisory);
      }
    } catch (err) {
      if (currentRequestId === requestIdRef.current) {
        setError(err instanceof Error ? err : new Error("Failed to load teacher classes"));
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    effectivePeriodId,
    effectiveYearId,
    includeAdvisory,
    isContextLoading,
    overridePeriodId,
    overrideYearId,
    contextYearId,
    contextPeriodId,
    periods.length,
  ]);

  useEffect(() => {
    if (enabled) {
      void fetchData();
    }
  }, [fetchData, enabled]);

  return {
    classes,
    advisoryClasses,
    isLoading: isLoading || (isContextLoading && overridePeriodId === undefined && overrideYearId === undefined),
    error,
    selectedPeriodId: effectivePeriodId,
    selectedYearId: effectiveYearId,
    refetch: fetchData,
  };
}
