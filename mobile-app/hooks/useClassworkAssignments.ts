// hooks/useClassworkAssignments.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from './api';

export type ClassworkAssignmentItem = {
  classwork_assignment_id: number;
  classwork_id: number;
  classwork_title: string;
  classwork_type: string;
  classwork_category?: string;
  total_points: number;
  subject_name: string;
  subject_id: number;
  teacher_name: string;
  publish_date: string;
  due_date: string;
  lock_date?: string;
  is_published: boolean;
  is_locked: boolean;
  max_attempts: number;
  submission_status?: 'pending' | 'submitted' | 'graded' | 'late' | 'missed';
  grade?: number;
  submitted_at?: string;
  attempt_count?: number;
};

export type ClassworkAssignmentResponse = {
  pending: ClassworkAssignmentItem[];
  submitted: ClassworkAssignmentItem[];
  graded: ClassworkAssignmentItem[];
};

export function useClassworkAssignments() {
  const { session } = useAuth();
  const [assignments, setAssignments] = useState<ClassworkAssignmentResponse>({
    pending: [],
    submitted: [],
    graded: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!session?.token) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const fetchAssignments = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<ClassworkAssignmentResponse>(
          '/api/v1/classwork-assignments/my-assignments',
          { token: session.token }
        );
        if (!cancelled) {
          setAssignments(data || { pending: [], submitted: [], graded: [] });
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Failed to fetch assignments');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchAssignments();

    return () => {
      cancelled = true;
    };
  }, [session?.token, trigger]);

  return { assignments, isLoading, error, refresh };
}
