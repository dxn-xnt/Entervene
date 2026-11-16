import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CheckCircle2,
  History,
  Loader2,
  X,
} from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/teacher/button";
import { useToast } from "@/components/retroui/Toast";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import {
  approveSuggestion,
  archiveSuggestion,
  dismissSuggestion,
  getTeacherSuggestions,
} from "@/lib/suggestion-api";
import type { TeacherAdvisoryStudentItem } from "@/types/adminClasses";
import type { SuggestionResponse } from "@/types/suggestion";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  classId: number;
  student: TeacherAdvisoryStudentItem;
};

export function StudentSuggestionHistoryModal({
  isOpen,
  onClose,
  classId,
  student,
}: Props) {
  const toast = useToast();
  const [history, setHistory] = useState<SuggestionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgressId, setActionInProgressId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const data = await getTeacherSuggestions({
        classId,
        studentId: student.student_id,
      });
      setHistory(data.suggestions);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load suggestion history.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [classId, student.student_id]);

  useEffect(() => {
    if (isOpen) {
      setHistory([]);
      setError("");
      void loadHistory();
    }
  }, [isOpen, student.student_id, loadHistory]);

  async function updateSuggestion(
    id: number,
    action: "approve" | "dismiss" | "archive",
  ) {
    setActionInProgressId(id);
    setError("");
    try {
      if (action === "approve") await approveSuggestion(id);
      else if (action === "dismiss") await dismissSuggestion(id);
      else await archiveSuggestion(id);
      toast.success({
        title: `Suggestion ${action === "approve" ? "approved" : action === "dismiss" ? "dismissed" : "archived"}`,
      });
      await loadHistory();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update suggestion.",
      );
    } finally {
      setActionInProgressId(null);
    }
  }

  const currentHistory = history.filter(
    (item) => !item.is_historical && item.origin_academic_period_id != null,
  );
  const previousHistory = history.filter((item) => item.is_historical);
  const unknownHistory = history.filter(
    (item) => item.origin_academic_period_id == null,
  );

  const groups = [
    { label: "Current Period", items: currentHistory },
    { label: "Previous Periods (Historical)", items: previousHistory },
    { label: "Unknown Period", items: unknownHistory },
  ].filter((group) => group.items.length > 0);

  return (
    <Dialog
      open={isOpen}
      disablePointerDismissal={true}
      onOpenChange={(val) => !val && onClose()}
    >
      <Dialog.Content
        size="lg"
        className="w-[95vw] max-w-2xl p-0"
      >
        <Dialog.Header>
          <div className="flex items-center gap-2.5">
            <History className="size-5" />
            <div>
              <h2 className="text-lg font-black">Suggestion History</h2>
              <p className="text-xs text-muted-foreground font-semibold">
                {student.full_name} {student.student_lrn ? `• LRN ${student.student_lrn}` : ""}
              </p>
            </div>
          </div>
        </Dialog.Header>

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {error && (
            <Alert status="error" className="text-xs">
              {error}
            </Alert>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm font-semibold">Loading suggestion history...</span>
            </div>
          ) : history.length === 0 ? (
            <TeacherEmptyState
              compact
              illustration={<History className="size-10 text-muted-foreground" />}
              title="No Suggestions Yet"
              description={`No study materials have been suggested to ${student.full_name}.`}
            />
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.label} className="space-y-2">
                  <h4 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                    {group.label} ({group.items.length})
                  </h4>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <Card
                        key={item.student_suggestion_id}
                        className="block w-full border-border bg-card p-3 shadow-sm transition-none hover:shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0 flex-1">
                            <p className="font-bold text-sm text-foreground">
                              {item.title}
                            </p>
                            <p className="text-xs font-medium text-muted-foreground">
                              Resource: {item.resource.title}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Origin: {item.origin_period_label ?? "Unknown period"}
                            </p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground italic mt-1">
                                &ldquo;{item.description}&rdquo;
                              </p>
                            )}

                            {/* Resource Links */}
                            <div className="pt-1 text-xs">
                              {item.resource.resource_type === "LINK" && item.resource.external_url && (
                                <a
                                  className="font-bold text-primary underline break-all"
                                  href={item.resource.external_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open external resource
                                </a>
                              )}
                              {item.resource.resource_type === "LESSON" &&
                              item.resource.is_available &&
                              item.resource.lesson_id &&
                              item.resource.class_id ? (
                                <a
                                  className="font-bold text-primary underline"
                                  href={`/teacher/classes/${item.resource.class_id}/subjects/${item.subject_id}?lessonId=${item.resource.lesson_id}`}
                                >
                                  Open lesson
                                </a>
                              ) : item.resource.resource_type === "LESSON" ? (
                                <p className="text-muted-foreground">
                                  {item.resource.unavailable_reason ?? "Lesson is unavailable to open."}
                                </p>
                              ) : null}
                              {item.resource.is_available &&
                                item.resource.resource_type === "CLASSWORK" &&
                                item.resource.classwork_id && (
                                  <a
                                    className="font-bold text-primary underline"
                                    href={`/teacher/classworks/${item.resource.classwork_id}`}
                                  >
                                    Open classwork
                                  </a>
                                )}
                            </div>
                          </div>

                          {/* Status and Action Buttons */}
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant={
                                  item.status === "ACTIVE"
                                    ? "solid"
                                    : item.status === "COMPLETED"
                                      ? "outline"
                                      : "surface"
                                }
                                size="sm"
                                className="font-bold text-[10px]"
                              >
                                {item.status}
                              </Badge>
                              {!item.can_manage && (
                                <Badge variant="outline" size="sm" className="font-bold text-[10px] bg-amber-50 text-amber-900 border-amber-300">
                                  Read-only
                                </Badge>
                              )}
                            </div>

                            {item.can_manage && (
                              <div className="flex items-center gap-1 pt-1">
                                {item.status === "DRAFT" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={actionInProgressId === item.student_suggestion_id}
                                    onClick={() => updateSuggestion(item.student_suggestion_id, "approve")}
                                    className="h-7 px-2 text-xs gap-1"
                                    title="Approve suggestion"
                                  >
                                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                                    <span>Approve</span>
                                  </Button>
                                )}
                                {item.status === "ACTIVE" && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={actionInProgressId === item.student_suggestion_id}
                                    onClick={() => updateSuggestion(item.student_suggestion_id, "dismiss")}
                                    className="h-7 px-2 text-xs gap-1"
                                    title="Dismiss suggestion"
                                  >
                                    <X className="size-3.5 text-rose-600" />
                                    <span>Dismiss</span>
                                  </Button>
                                )}
                                {(item.status === "ACTIVE" || item.status === "COMPLETED" || item.status === "DISMISSED") && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={actionInProgressId === item.student_suggestion_id}
                                    onClick={() => updateSuggestion(item.student_suggestion_id, "archive")}
                                    className="h-7 px-2 text-xs gap-1"
                                    title="Archive suggestion"
                                  >
                                    <Archive className="size-3.5 text-muted-foreground" />
                                    <span>Archive</span>
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <Dialog.Footer className="flex justify-end p-4 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
