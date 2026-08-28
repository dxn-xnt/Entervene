import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, ChevronDown, ChevronUp, Lightbulb, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import {
  approveSuggestion,
  archiveSuggestion,
  dismissSuggestion,
  getTeacherSuggestions,
} from "@/lib/suggestion-api";
import type {
  TeacherAdvisoryStudentItem,
  TeacherAdvisorySubjectLoadItem,
} from "@/types/adminClasses";
import type { SuggestionResponse } from "@/types/suggestion";
import { SuggestionPanel } from "./suggestion-panel-modal";

type Props = {
  classId: number;
  student: TeacherAdvisoryStudentItem;
  subjectLoads: TeacherAdvisorySubjectLoadItem[];
};

export function ManualSuggestionPanel({
  classId,
  student,
  subjectLoads,
}: Props) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SuggestionResponse[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await getTeacherSuggestions({
        classId,
        studentId: student.student_id,
      });
      setHistory(data.suggestions);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Unable to load suggestions.",
      );
    } finally {
      setIsHistoryLoading(false);
    }
  }, [classId, student.student_id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function updateSuggestion(
    id: number,
    action: "approve" | "dismiss" | "archive",
  ) {
    setHistoryError("");
    try {
      if (action === "approve") await approveSuggestion(id);
      else if (action === "dismiss") await dismissSuggestion(id);
      else await archiveSuggestion(id);
      await loadHistory();
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Unable to update suggestion.",
      );
    }
  }

  const activeCount = history.filter((item) => item.status === "ACTIVE").length;
  const draftCount = history.filter((item) => item.status === "DRAFT").length;

  return (
    <Card className="p-3 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-md font-semibold">
            Study Suggestions
          </p>
          <p className="text-xs text-muted-foreground">
            {activeCount} active, {draftCount} draft
          </p>
        </div>
        <div className="flex items-center gap-2">
          {history.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowHistory((prev) => !prev)}
              className="gap-1 border-black text-xs font-bold"
            >
              {showHistory ? (
                <>
                  <ChevronUp size={14} />
                  Hide History ({history.length})
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  View History ({history.length})
                </>
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => setIsDialogOpen(true)}
            className="gap-2"
          >
            <Lightbulb size={14} />
            Suggest Material
          </Button>
        </div>
      </div>

      {showHistory && (
        <Card className="mt-3 block w-full border-black bg-white p-3 shadow-none transition-none hover:shadow-none">
          <h4 className="mb-2 text-sm font-black">Suggestion History</h4>
          {historyError && (
            <Alert status="error" className="mb-2 text-xs">
              {historyError}
            </Alert>
          )}
          {isHistoryLoading ? (
            <p className="text-xs font-semibold text-black/60">
              Loading suggestions...
            </p>
          ) : history.length ? (
            <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
              {history.map((item) => (
                <Card
                  key={item.student_suggestion_id}
                  className="block w-full border-black bg-[#fffdf5] p-2.5 text-xs shadow-none transition-none hover:shadow-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-black">{item.title}</p>
                      <p className="font-semibold text-black/60">
                        {item.resource.title}
                      </p>
                    </div>
                    <span className="border border-black bg-white px-2 py-0.5 font-black text-[10px]">
                      {item.status}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1 text-black/70">{item.description}</p>
                  )}
                  {item.source_metrics ? (
                    <div className="mt-2 border border-black bg-white px-2 py-1 text-[11px] font-semibold text-black/70">
                      <p>
                        Reason:{" "}
                        {String(
                          item.source_metrics.source_title ?? "Low result",
                        )}
                      </p>
                      <p>
                        Score:{" "}
                        {String(item.source_metrics.score_percent ?? "?")}%
                        {item.source_metrics.threshold_percent
                          ? ` below ${String(item.source_metrics.threshold_percent)}% threshold`
                          : ""}
                      </p>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.status === "DRAFT" && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() =>
                          updateSuggestion(
                            item.student_suggestion_id,
                            "approve",
                          )
                        }
                        className="gap-1 border-black bg-[#79bd80] px-2 py-1 font-bold shadow-none hover:bg-[#79bd80]"
                      >
                        <CheckCircle2 size={12} />
                        Approve
                      </Button>
                    )}
                    {item.status === "ACTIVE" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          updateSuggestion(
                            item.student_suggestion_id,
                            "dismiss",
                          )
                        }
                        className="gap-1 border-black px-2 py-1 font-bold shadow-none"
                      >
                        <X size={12} />
                        Dismiss
                      </Button>
                    )}
                    {(item.status === "COMPLETED" ||
                      item.status === "DISMISSED") && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateSuggestion(
                              item.student_suggestion_id,
                              "archive",
                            )
                          }
                          className="gap-1 border-black px-2 py-1 font-bold shadow-none"
                        >
                          <Archive size={12} />
                          Archive
                        </Button>
                      )}
                    {item.status === "COMPLETED" && (
                      <span className="inline-flex items-center gap-1 font-bold text-green-700">
                        <CheckCircle2 size={12} />
                        Completed by student
                      </span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-xs font-semibold text-black/60">
              No suggestions yet.
            </p>
          )}
        </Card>
      )}

      <SuggestionPanel
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        classId={classId}
        student={student}
        subjectLoads={subjectLoads}
        onSuccess={loadHistory}
      />
    </Card>
  );
}

export default ManualSuggestionPanel;
