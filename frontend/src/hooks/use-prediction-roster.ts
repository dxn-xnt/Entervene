import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPredictionRosterStatus,
  type PredictionRosterResponse,
  type PredictionRosterStudentItem,
} from "@/lib/prediction-api";

export interface PredictionRosterParams {
  classId?: number;
  subjectId?: number;
  academicPeriodId?: number;
  search?: string;
  baselineRiskLevel?: string;
}

export function usePredictionRoster({
  classId,
  subjectId,
  academicPeriodId,
  search = "",
  baselineRiskLevel,
}: PredictionRosterParams) {
  const [data, setData] = useState<PredictionRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLoad = classId !== undefined && subjectId !== undefined && academicPeriodId !== undefined;

  const refetch = useCallback(async () => {
    if (!canLoad) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetchPredictionRosterStatus({
        class_id: classId,
        subject_id: subjectId,
        academic_period_id: academicPeriodId,
      });
      setData(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to load prediction roster.";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [academicPeriodId, canLoad, classId, subjectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const filteredStudents = useMemo<PredictionRosterStudentItem[]>(() => {
    const rows = data?.students ?? [];
    const term = search.trim().toLowerCase();

    return rows.filter((item) => {
      const matchesSearch =
        !term ||
        item.student.student_name.toLowerCase().includes(term) ||
        item.student.student_lrn.toLowerCase().includes(term);

      const matchesRisk =
        !baselineRiskLevel ||
        (item.baseline_forecast?.risk_assessment_status === "EVALUATED" &&
          item.baseline_forecast?.risk_level === baselineRiskLevel);

      return matchesSearch && matchesRisk;
    });
  }, [baselineRiskLevel, data?.students, search]);

  return {
    data,
    students: filteredStudents,
    total: data?.total ?? 0,
    loading,
    error,
    refetch,
    canLoad,
  };
}

export const useDualPurposePredictionRoster = usePredictionRoster;
export type UseDualPurposePredictionRosterParams = PredictionRosterParams;
