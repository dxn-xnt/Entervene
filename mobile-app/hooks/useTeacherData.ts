// hooks/useTeacherData.ts
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from './api';

// ── Types ──

export type TeacherLesson = {
  lesson_id: number;
  title: string;
  description: string | null;
  content: string | null;
  order_index: number;
  is_published: boolean;
  subject_id: number;
  subject_name: string | null;
  created_by_staff_id: string;
  teacher_name: string | null;
  attachments: any[];
  created_at: string;
  updated_at: string;
};

export type TeacherClasswork = {
  classwork_id: number;
  title: string;
  description: string | null;
  instructions: string | null;
  classwork_type: string;
  classwork_category: string | null;
  total_points: number | null;
  is_published: boolean;
  subject_id: number;
  subject_name: string | null;
  created_by_staff_id: string;
  teacher_name: string | null;
  attachments: any[];
  created_at: string;
  updated_at: string;
};

export type TeacherClassSubject = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename: string;
  class_id: number;
  section_name: string;
};

// ── Hooks ──

export function useTeacherLessons() {
  const { session, isLoading: authLoading } = useAuth();
  const [lessons, setLessons] = useState<TeacherLesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.token) { setIsLoading(false); return; }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true); setError(null);
      try {
        const data = await apiFetch<TeacherLesson[]>('/api/v1/lessons/my-lessons', { token: session.token });
        if (!cancelled) setLessons(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, trigger, authLoading]);

  return { lessons, isLoading, error, refresh };
}

export function useTeacherClassworks() {
  const { session, isLoading: authLoading } = useAuth();
  const [classworks, setClassworks] = useState<TeacherClasswork[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);
  const refresh = useCallback(() => setTrigger((t) => t + 1), []);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.token) { setIsLoading(false); return; }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true); setError(null);
      try {
        const data = await apiFetch<TeacherClasswork[]>('/api/v1/classwork-assignments/my-classworks', { token: session.token });
        if (!cancelled) setClassworks(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, trigger, authLoading]);

  return { classworks, isLoading, error, refresh };
}

export function useTeacherClasses() {
  const { session, isLoading: authLoading } = useAuth();
  const [classes, setClasses] = useState<TeacherClassSubject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.token) { setIsLoading(false); return; }
    let cancelled = false;
    const go = async () => {
      setIsLoading(true); setError(null);
      try {
        const data = await apiFetch<TeacherClassSubject[]>('/api/v1/classwork-assignments/teacher/classes', { token: session.token });
        if (!cancelled) setClasses(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    go();
    return () => { cancelled = true; };
  }, [session?.token, authLoading]);

  return { classes, isLoading, error };
}
