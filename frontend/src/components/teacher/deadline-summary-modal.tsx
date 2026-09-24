import { useState, useMemo } from "react";
import { Clock, CheckCircle2, ChevronRight, UserX, AlertTriangle } from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Avatar } from "@/components/retroui/Avatar";
import type { AssignmentTracking, TrackingStudent } from "@/types/classwork";

export type DeadlineSummaryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  tracking: AssignmentTracking | null;
  isLoading?: boolean;
  classworkTitle?: string;
  dueDate?: string | null;
  totalPoints?: number | null;
  onSelectStudent: (student: TrackingStudent) => void;
};

export default function DeadlineSummaryModal({
  isOpen,
  onClose,
  tracking,
  isLoading = false,
  classworkTitle = "Classwork",
  dueDate,
  totalPoints,
  onSelectStudent,
}: DeadlineSummaryModalProps) {
  const [activeTab, setActiveTab] = useState<"missing" | "late">("missing");

  const missingStudents = useMemo(() => {
    if (!tracking) return [];
    return tracking.missing ?? [];
  }, [tracking]);

  const lateStudents = useMemo(() => {
    if (!tracking) return [];
    return (tracking.submitted ?? []).filter((s) => s.status === "late");
  }, [tracking]);

  const totalFlagged = missingStudents.length + lateStudents.length;

  const formatTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size="lg" className="max-w-2xl overflow-hidden p-0">
        <Dialog.Header className="border-b-2 border-border bg-card px-5 py-4">
          <div className="flex flex-col gap-1 pr-4">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded border border-black bg-[#F6E9B2] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <AlertTriangle className="size-4" />
              </span>
              <Dialog.Title className="text-xl font-bold font-head">
                Deadline Summary
              </Dialog.Title>
            </div>
            <Dialog.Description className="text-sm font-semibold text-muted-foreground">
              {classworkTitle}
              {dueDate && (
                <span className="ml-2 font-normal text-xs text-foreground/70">
                  (Due {formatTimestamp(dueDate)})
                </span>
              )}
            </Dialog.Description>
          </div>
        </Dialog.Header>

        {/* Counter Summary Bar */}
        <div className="grid grid-cols-2 border-b-2 border-border bg-muted/40 text-center">
          <button
            type="button"
            onClick={() => setActiveTab("missing")}
            className={`flex items-center justify-center gap-2 p-3 font-semibold text-sm transition-all border-r-2 border-border ${
              activeTab === "missing"
                ? "bg-background border-b-2 border-b-primary shadow-[inset_0_-2px_0_0_black]"
                : "text-muted-foreground hover:bg-background/50"
            }`}
          >
            <UserX className="size-4 text-destructive" />
            <span>Missing Submissions</span>
            <Badge
              variant="outline"
              size="sm"
              className={`font-bold ${
                missingStudents.length > 0
                  ? "bg-red-100 text-red-700 border-red-500"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {missingStudents.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("late")}
            className={`flex items-center justify-center gap-2 p-3 font-semibold text-sm transition-all ${
              activeTab === "late"
                ? "bg-background border-b-2 border-b-primary shadow-[inset_0_-2px_0_0_black]"
                : "text-muted-foreground hover:bg-background/50"
            }`}
          >
            <Clock className="size-4 text-amber-600" />
            <span>Submitted Late</span>
            <Badge
              variant="outline"
              size="sm"
              className={`font-bold ${
                lateStudents.length > 0
                  ? "bg-amber-100 text-amber-700 border-amber-500"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {lateStudents.length}
            </Badge>
          </button>
        </div>

        {/* Content list */}
        <div className="max-h-[50vh] min-h-[220px] overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
              <span className="animate-pulse font-semibold">Loading student submissions...</span>
            </div>
          ) : activeTab === "missing" ? (
            missingStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2">
                <CheckCircle2 className="size-10 text-emerald-500" />
                <p className="font-semibold text-foreground">No missing submissions!</p>
                <p className="text-xs">All enrolled students have turned in their work for this classwork.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground px-1">
                  Showing {missingStudents.length} {missingStudents.length === 1 ? "student" : "students"} with no submission:
                </p>
                {missingStudents.map((student) => (
                  <div
                    key={student.student_id}
                    onClick={() => onSelectStudent(student)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectStudent(student);
                      }
                    }}
                    className="group flex items-center justify-between rounded border-2 border-black bg-card p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar variant="student" className="size-9 shrink-0">
                        <Avatar.Image
                          src="/avatars/student-avatars/1.svg"
                          alt={student.student_name}
                        />
                        <Avatar.Fallback>
                          {student.student_name.slice(0, 1).toUpperCase()}
                        </Avatar.Fallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate text-foreground group-hover:underline">
                          {student.student_name}
                        </p>
                        {student.student_lrn && (
                          <p className="text-xs text-muted-foreground font-mono">
                            LRN: {student.student_lrn}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        size="sm"
                        className="bg-red-50 text-red-700 border-red-400 font-semibold"
                      >
                        Missing
                      </Badge>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : lateStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground space-y-2">
              <CheckCircle2 className="size-10 text-emerald-500" />
              <p className="font-semibold text-foreground">No late submissions!</p>
              <p className="text-xs">All submitted work was turned in before the deadline.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground px-1">
                Showing {lateStudents.length} {lateStudents.length === 1 ? "student" : "students"} who turned in work after the deadline:
              </p>
              {lateStudents.map((student) => {
                const isGraded = student.grade !== null && student.grade !== undefined;
                return (
                  <div
                    key={student.student_id}
                    onClick={() => onSelectStudent(student)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectStudent(student);
                      }
                    }}
                    className="group flex items-center justify-between rounded border-2 border-black bg-card p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5 hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar variant="student" className="size-9 shrink-0">
                        <Avatar.Image
                          src="/avatars/student-avatars/1.svg"
                          alt={student.student_name}
                        />
                        <Avatar.Fallback>
                          {student.student_name.slice(0, 1).toUpperCase()}
                        </Avatar.Fallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate text-foreground group-hover:underline">
                          {student.student_name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {student.submitted_at && (
                            <span>Turned in {formatTimestamp(student.submitted_at)}</span>
                          )}
                          {student.student_lrn && !student.submitted_at && (
                            <span className="font-mono">LRN: {student.student_lrn}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isGraded ? (
                        <span className="text-xs font-semibold text-muted-foreground">
                          {student.grade} / {totalPoints ?? 100}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-amber-700">Ungraded</span>
                      )}
                      <Badge
                        variant="outline"
                        size="sm"
                        className="bg-amber-50 text-amber-700 border-amber-400 font-semibold"
                      >
                        Late
                      </Badge>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <Dialog.Footer className="flex items-center justify-between border-t-2 border-border bg-background px-5 py-3">
          <p className="text-xs text-muted-foreground font-medium">
            {totalFlagged > 0
              ? `Select a student to inspect or grade their submission.`
              : `All student submissions are in order.`}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="border-2 border-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            Dismiss / View Full Roster
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
