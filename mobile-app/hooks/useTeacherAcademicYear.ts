import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type ActiveQuarter = {
  period_id: number | null;
  period_name: string;
  year_label: string;
};

type UseTeacherAcademicYearReturn = {
  activeQuarter: ActiveQuarter | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

/**
 * Fetch the current active academic quarter/year for the teacher.
 * Uses the same endpoint as students which falls back to global active period.
 */
export function useTeacherAcademicYear(): UseTeacherAcademicYearReturn {
  const { session } = useAuth();
  const [activeQuarter, setActiveQuarter] = useState<ActiveQuarter | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    // Only teachers may call this
    if (session?.role !== 'teacher') {
      setActiveQuarter(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    if (!session?.token) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetchQuarter = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const headers = {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        };

        // Use the same endpoint as students - it has a fallback to global active period
        const quarterRes = await fetch(`${API_URL}/api/v1/students/me/active-quarter`, { 
          headers 
        });

        if (!quarterRes.ok) {
          const err = await quarterRes.json().catch(() => ({}));
          throw new Error(err.detail ?? `Failed to fetch academic year (${quarterRes.status})`);
        }

        const quarterData: ActiveQuarter = await quarterRes.json();

        if (!cancelled) {
          setActiveQuarter(quarterData);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? 'Unknown error');
          // Still set a default so UI doesn't break
          setActiveQuarter({
            period_id: null,
            period_name: 'Current Quarter',
            year_label: '2025-2026'
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchQuarter();

    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.role, trigger]);

  return { activeQuarter, isLoading, error, refresh };
}
