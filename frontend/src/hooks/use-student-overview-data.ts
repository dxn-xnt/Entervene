import { useEffect, useState } from "react";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  getMySubjects,
  getStudentTodos,
  type StudentSubjectItem,
  type TodoItem,
} from "@/lib/api";

type OverviewData = { subjects: StudentSubjectItem[]; todos: TodoItem[]; urgentTodos: TodoItem[] };
const inFlightRequests = new Map<string, Promise<OverviewData>>();

function loadStudentOverview(periodId: number | null): Promise<OverviewData> {
  const key = periodId === null ? "current" : String(periodId);
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = Promise.all([
    getMySubjects(periodId ?? undefined),
    getStudentTodos(periodId ?? undefined),
  ]).then(([subjects, todoData]) => ({
    subjects,
    todos: todoData.all || [],
    urgentTodos: [...todoData.pastdue, ...todoData.pending].slice(0, 3),
  }))
    .finally(() => inFlightRequests.delete(key));
  inFlightRequests.set(key, request);
  return request;
}

export function useStudentOverviewData() {
  const { selectedPeriodId } = useAcademicPeriod();
  const [subjects, setSubjects] = useState<StudentSubjectItem[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [urgentTodos, setUrgentTodos] = useState<TodoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    // This reset belongs to the period-driven external request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setError(null);

    loadStudentOverview(selectedPeriodId)
      .then(({ subjects: subjectsData, todos: todosData, urgentTodos: urgentData }) => {
        if (!isMounted) return;
        setSubjects(subjectsData);
        setTodos(todosData);
        setUrgentTodos(urgentData);
      })
      .catch((cause: unknown) => {
        if (!isMounted) return;
        setSubjects([]);
        setTodos([]);
        setUrgentTodos([]);
        setError(cause instanceof Error ? cause.message : "Unable to load grade overview.");
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedPeriodId]);

  return { subjects, todos, urgentTodos, isLoading, error };
}
