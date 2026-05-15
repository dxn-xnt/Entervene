import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type StudentSubject = {
  subject_load_id: number;
  class_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename: string;
  teacher_name: string;
  period_id: number;
  period_name: string;
  is_current_quarter: boolean;
  section_name: string;
  year_label: string;
};

export type ActiveQuarter = {
  period_id: number | null;
  period_name: string;
  year_label: string;
};

type UseStudentSubjectsReturn = {
  subjects: StudentSubject[];
  activeQuarter: ActiveQuarter | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useStudentSubjects(): UseStudentSubjectsReturn {
  const { session } = useAuth();
  const [subjects, setSubjects] = useState<StudentSubject[]>([]);
  const [activeQuarter, setActiveQuarter] = useState<ActiveQuarter | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    // Only students may call these routes; missing/unknown role must not hit student APIs.
    if (session?.role !== 'student') {
      setSubjects([]);
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

    const fetchAll = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const headers = {
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        };

        const [subjectsRes, quarterRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/students/me/subjects`, { headers }),
          fetch(`${API_URL}/api/v1/students/me/active-quarter`, { headers }),
        ]);

        if (!subjectsRes.ok) {
          const err = await subjectsRes.json().catch(() => ({}));
          throw new Error(err.detail ?? `Failed to fetch subjects (${subjectsRes.status})`);
        }
        if (!quarterRes.ok) {
          const err = await quarterRes.json().catch(() => ({}));
          throw new Error(err.detail ?? `Failed to fetch quarter (${quarterRes.status})`);
        }

        const subjectsData: StudentSubject[] = await subjectsRes.json();
        const quarterData: ActiveQuarter = await quarterRes.json();

        if (!cancelled) {
          setSubjects(subjectsData);
          setActiveQuarter(quarterData);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? 'Unknown error');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchAll();

    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.role, trigger]);

  return { subjects, activeQuarter, isLoading, error, refresh };
}
