// hooks/useSubmissions.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from './api';

export type Submission = {
  submission_id: number;
  student_id: string;
  student_name: string | null;
  classwork_assignment_id: number;
  classwork_title: string | null;
  submitted_at: string | null;
  status: string;
  grade: number | null;
  feedback: string | null;
  attempt_count: number;
  graded_at: string | null;
  attachments: { submission_attachment_id: number; file_name: string; file_type: string | null; file_size: number }[];
  total_points?: number | null;
  created_at: string | null;
};

export type SubmissionTrackingStudent = {
  student_id: string;
  student_name: string;
  student_lrn: string | null;
  email: string | null;
  status: string;
  submitted_at: string | null;
  submission_id: number | null;
  attempt_count: number;
  grade: number | null;
  attachment_count: number;
};

export type AssignmentSubmissionTracking = {
  classwork_assignment_id: number;
  classwork_id: number;
  classwork_title: string | null;
  class_id: number;
  due_date: string | null;
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: SubmissionTrackingStudent[];
  missing: SubmissionTrackingStudent[];
};

// Shape returned by /submissions/classwork/{id}/tracking
export type ClassworkSubmissionTracking = {
  classwork_id: number;
  classwork_title: string | null;
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: SubmissionTrackingStudent[];
  missing: SubmissionTrackingStudent[];
};

export function useStudentSubmissions() {
  const { session } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!session?.token) { setIsLoading(false); return; }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true); setError(null);
      try {
        const data = await apiFetch<Submission[]>('/api/v1/submissions/my-submissions', { token: session.token });
        if (!cancelled) setSubmissions(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, trigger]);

  return { submissions, isLoading, error, refresh };
}

export function useAssignmentSubmissions(assignmentId: number) {
  const { session } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);
 
  useEffect(() => {
    if (!session?.token || !assignmentId) { setIsLoading(false); return; }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true); setError(null);
      try {
        const data = await apiFetch<Submission[]>(`/api/v1/submissions/assignment/${assignmentId}/all`, { token: session.token });
        if (!cancelled) setSubmissions(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, assignmentId, trigger]);
 
  return { submissions, isLoading, error, refresh };
}

export function useAssignmentSubmissionTracking(assignmentId: number) {
  const { session } = useAuth();
  const [tracking, setTracking] = useState<AssignmentSubmissionTracking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!session?.token || !assignmentId) { 
      setIsLoading(false); 
      setTracking(null);
      return; 
    }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true); 
      setError(null);
      try {
        // Try classwork endpoint first (for viewing by classwork)
        const data = await apiFetch<AssignmentSubmissionTracking>(
          `/api/v1/submissions/classwork/${assignmentId}/tracking`,
          { token: session.token },
        );
        if (!cancelled) setTracking(data);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          setTracking(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, assignmentId, trigger]);

  return { tracking, isLoading, error, refresh };
}

export function useClassworkSubmissionTracking(classworkId: number) {
  const { session } = useAuth();
  const [tracking, setTracking] = useState<ClassworkSubmissionTracking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (!session?.token || !classworkId) {
      setIsLoading(false);
      setTracking(null);
      return;
    }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await apiFetch<ClassworkSubmissionTracking>(
          `/api/v1/submissions/classwork/${classworkId}/tracking`,
          { token: session.token },
        );
        if (!cancelled) setTracking(data);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          setTracking(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, classworkId, trigger]);

  return { tracking, isLoading, error, refresh };
}
