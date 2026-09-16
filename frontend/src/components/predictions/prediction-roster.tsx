import { useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import type {
  CurrentPeriodGenerateResponse,
  PredictionRefreshResponse,
  PredictionRosterResponse,
  PredictionRosterStudentItem,
} from "@/lib/prediction-api";
import { generatePrediction, refreshPrediction } from "@/lib/prediction-api";
import { generationStatusLabel } from "./prediction-status-copy";
import { PredictionStudentCard } from "./prediction-student-card";

export interface PredictionRosterProps {
  roster: PredictionRosterResponse | null;
  students: PredictionRosterStudentItem[];
  loading: boolean;
  error: string | null;
  onRefetch: () => Promise<void> | void;
  onOpenDetail: (predictionId: number) => void;
}

type ActionResult = {
  studentId: string;
  status: string;
  message: string;
};

export function PredictionRoster({
  roster,
  students,
  loading,
  error,
  onRefetch,
  onOpenDetail,
}: PredictionRosterProps) {
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [actionResult, setActionResult] = useState<ActionResult | null>(null);
  const generationRequestIds = useRef<Record<string, string>>({});
  const refreshRequestIds = useRef<Record<number, string>>({});

  const setPending = (key: string, pending: boolean) => {
    setPendingKeys((prev) => {
      const next = new Set(prev);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const finishAction = async (
    studentId: string,
    response: CurrentPeriodGenerateResponse | PredictionRefreshResponse
  ) => {
    const status = response.generation_status ?? "UNKNOWN";
    setActionResult({
      studentId,
      status,
      message: response.message || generationStatusLabel(status),
    });
    await onRefetch();
  };

  const handleGenerate = async (item: PredictionRosterStudentItem) => {
    const studentId = item.student.student_id;
    const classContext = roster?.class_context;
    if (!classContext) return;

    const pendingKey = `generate:${studentId}`;
    if (!generationRequestIds.current[studentId]) {
      generationRequestIds.current[studentId] = crypto.randomUUID();
    }

    setPending(pendingKey, true);
    setActionResult(null);
    try {
      const response = await generatePrediction({
        student_id: studentId,
        class_id: classContext.class_id,
        subject_id: classContext.subject_id,
        academic_period_id: classContext.academic_period_id,
        generation_request_id: generationRequestIds.current[studentId],
      });
      await finishAction(studentId, response);
      delete generationRequestIds.current[studentId];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to generate projection.";
      setActionResult({ studentId, status: "ERROR", message });
    } finally {
      setPending(pendingKey, false);
    }
  };

  const handleRefresh = async (item: PredictionRosterStudentItem) => {
    const predictionId = item.current_projection.latest_prediction_id;
    if (!predictionId) return;

    const pendingKey = `refresh:${predictionId}`;
    if (!refreshRequestIds.current[predictionId]) {
      refreshRequestIds.current[predictionId] = crypto.randomUUID();
    }

    setPending(pendingKey, true);
    setActionResult(null);
    try {
      const response = await refreshPrediction(predictionId, {
        generation_request_id: refreshRequestIds.current[predictionId],
      });
      await finishAction(item.student.student_id, response);
      delete refreshRequestIds.current[predictionId];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to refresh projection.";
      setActionResult({ studentId: item.student.student_id, status: "ERROR", message });
    } finally {
      setPending(pendingKey, false);
    }
  };

  if (loading && !roster) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded border-2 border-black bg-white p-8 text-sm font-bold text-gray-500">
        <RefreshCw className="mr-2 size-4 animate-spin" />
        Loading prediction roster...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded border-2 border-black bg-red-50 p-8 text-center">
        <AlertTriangle className="size-8 text-red-600" />
        <p className="text-sm font-bold text-red-900">{error}</p>
        <Button type="button" size="sm" onClick={() => void onRefetch()} className="border-2 border-black">
          Retry
        </Button>
      </div>
    );
  }

  if (!roster) {
    return (
      <div className="rounded border-2 border-black bg-white p-8 text-center text-sm font-semibold text-gray-600">
        Select a class, subject, and grading period to load prediction readiness.
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="rounded border-2 border-black bg-white p-8 text-center">
        <p className="text-lg font-black text-black">No students match this roster filter.</p>
        <p className="mt-1 text-sm font-semibold text-gray-600">
          Absence from the list is not a risk assessment. Try clearing search or risk filters.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {roster?.class_context && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border-2 border-black bg-white px-4 py-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-wrap items-center gap-3 text-sm font-extrabold text-black">
            <span>{roster.class_context.class_name}</span>
            <span className="text-gray-400">·</span>
            <span>{roster.class_context.subject_name}</span>
            <span className="text-gray-400">·</span>
            <span className="font-semibold text-gray-700">{roster.class_context.period_label}</span>
          </div>
          {roster.class_context.teacher && (
            <div className="text-xs font-semibold text-gray-600">
              Teacher: <span className="font-bold text-black">{roster.class_context.teacher.teacher_name || roster.class_context.teacher.full_name || "Assigned"}</span>
            </div>
          )}
        </div>
      )}

      {actionResult && (
        <div className="rounded border-2 border-black bg-yellow-50 p-3 text-sm font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          {actionResult.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {students.map((item) => {
          const predictionId = item.current_projection.latest_prediction_id;
          const pending =
            pendingKeys.has(`generate:${item.student.student_id}`) ||
            (predictionId != null && pendingKeys.has(`refresh:${predictionId}`));

          return (
            <PredictionStudentCard
              key={`${item.student.student_id}:${item.current_projection.latest_prediction_id ?? "none"}`}
              item={item}
              actionPending={pending}
              onGenerate={handleGenerate}
              onRefresh={handleRefresh}
              onOpenDetail={onOpenDetail}
            />
          );
        })}
      </div>
    </div>
  );
}

export const DualPurposeRoster = PredictionRoster;
export type { PredictionRosterProps as DualPurposeRosterProps };

