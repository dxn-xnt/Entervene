import { useState } from "react";
import ClassworkItemLine from "@/components/item-line/classwork";
import { Select } from "@/components/retroui/Select";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  OriginalExamination,
  RemediationClassworkTarget,
  RemediationFocus,
  RemediationResource,
  TeacherInterventionDetail,
} from "@/lib/teacher-interventions-api";
import { Card } from "@/components/retroui/Card";
import { Avatar } from "@/components/retroui/Avatar";

export interface RemediationTeacherGuidanceBannerProps {
  remediationTarget: TeacherInterventionDetail;
  remediationFocus?: RemediationFocus | null;
  remediationGradeTreatment?: "PRACTICE_ONLY" | "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | null;
  remediationOriginalExam?: OriginalExamination | null;
  selectedOriginalTarget?: RemediationClassworkTarget | null;
  remediationOriginalTargets?: RemediationClassworkTarget[];
  selectedTargetId?: number | null;
  onSelectTargetId?: (targetId: number) => void;
  disabled?: boolean;
  remediationReferences?: RemediationResource[];
  className?: string;
}

export function RemediationTeacherGuidanceBanner({
  remediationTarget,
  remediationGradeTreatment = null,
  remediationOriginalExam = null,
  selectedOriginalTarget = null,
  remediationOriginalTargets = [],
  selectedTargetId = null,
  onSelectTargetId,
  disabled = false,
  remediationReferences = [],
  className = "",
}: RemediationTeacherGuidanceBannerProps) {
  const [showAllReferences, setShowAllReferences] = useState(false);

  const isGradedWWPT =
    remediationGradeTreatment === "WRITTEN_WORK" ||
    remediationGradeTreatment === "PERFORMANCE_TASK";

  let linkedTitle = "None";
  let linkedDetail = "";
  let taskBold = "Remedial activity";
  let taskDetail = "Completion recorded in intervention progress.";

  if (remediationGradeTreatment === "EXAMINATION" && remediationOriginalExam) {
    linkedTitle = remediationOriginalExam.title;
    linkedDetail = `${remediationOriginalExam.score ?? 0}/${remediationOriginalExam.total_points} pts`;
    taskBold = "Matches Original Exam Activity";
    taskDetail = "Higher score counts toward term grade.";
  } else if (isGradedWWPT && selectedOriginalTarget) {
    linkedTitle = selectedOriginalTarget.title;
    linkedDetail = `${selectedOriginalTarget.original_score ?? 0}/${selectedOriginalTarget.max_points} pts`;
    taskBold = `Graded Activity (${selectedOriginalTarget.component === "WRITTEN_WORK" ? "Written Work" : "Performance Task"})`;
    taskDetail = "Adjusts grade within plan cap.";
  } else if (remediationGradeTreatment === "PRACTICE_ONLY") {
    linkedTitle = selectedOriginalTarget ? selectedOriginalTarget.title : "Practice Assessment";
    linkedDetail = "non-graded";
    taskBold = "Practice Activty";
    taskDetail = "Does not affect official grades.";
  }

  return (
    <Card
      className={`border-2 border-black bg-primary p-4 space-y-3 ${className}`}
      data-testid="remediation-teacher-guidance-banner"
    >
      {/* Header row */}
      <Card className="flex flex-wrap items-center justify-between gap-2 border-2! p-2">
        <div className="flex items-center gap-2.5">
          <Avatar variant="student" className="size-8 shrink-0">
            <Avatar.Image
              src={(remediationTarget as any).avatar || "/avatars/student-avatars/1.svg"}
              alt={remediationTarget.student_name}
            />
            <Avatar.Fallback>
              {(remediationTarget.student_name || "?").slice(0, 1).toUpperCase()}
            </Avatar.Fallback>
          </Avatar>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-black text-base">{remediationTarget.student_name}</span>
            <span className="text-neutral-500 text-sm font-normal">{remediationTarget.class_name}</span>
          </div>
        </div>
        <Badge variant="solid" size="sm">
          Individual Support
        </Badge>
      </Card>

      {/* Two cards */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-bold">
            Targeted Original Classwork
          </div>
          <div className="">
            {isGradedWWPT ? (
              <div className="space-y-2">
                {remediationOriginalTargets && remediationOriginalTargets.length > 1 && onSelectTargetId ? (
                  <Select
                    value={selectedTargetId ? String(selectedTargetId) : ""}
                    onValueChange={(val) => onSelectTargetId(Number(val))}
                    disabled={disabled}
                  >
                    <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                      <Select.Value placeholder="Select target classwork assignment" />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black rounded bg-white">
                      <Select.Group>
                        {remediationOriginalTargets.map((target) => (
                          <Select.Item key={target.assignment_id} value={String(target.assignment_id)}>
                            {target.title} ({target.original_score ?? 0}/{target.max_points} pts)
                            {target.is_recommended ? " — Recommended" : ""}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                ) : null}

                {selectedOriginalTarget ? (
                  <div className="flex flex-col gap-2 text-sm">
                    <Card className="flex items-center gap-1.5 flex-wrap justify-between border-2! border-black bg-white p-3">
                      <div className="flex flex-row gap-2">
                        <span className="text-base font-bold text-black">{selectedOriginalTarget.title}</span>
                        <div className="flex items-center justify-between gap-1">
                          {isGradedWWPT && selectedOriginalTarget && (
                            <Badge variant="surface" size="sm">
                              {selectedOriginalTarget.component === "WRITTEN_WORK" ? "Written Work" : "Performance Task"}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {selectedOriginalTarget.is_recommended && (
                        <Badge variant="solid" size="sm">
                          Recommended
                        </Badge>
                      )}
                    </Card>

                    <div className=" flex items-center gap-2 justify-between px-1">
                      <span className="text-sm font-normal text-foreground">
                        Student's original score:
                      </span>
                      <Badge variant="outline" size="sm">
                        {selectedOriginalTarget.original_score ?? 0}/{selectedOriginalTarget.max_points} points
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-destructive font-medium" role="alert">
                    Please select a target original classwork assignment.
                  </p>
                )}
              </div>
            ) : (
              <div className="text-sm font-sans">
                <span className="font-bold text-black">{linkedTitle}</span>
                {linkedDetail && <span className="text-neutral-500"> · {linkedDetail}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-bold -mb-1">
            This Task
          </div>
          <Card className="border-2! border-black bg-white py-2 px-3 flex flex-row justify-between gap-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-bold text-black">{taskBold}</span>
              <span className="text-xs text-foreground">{taskDetail}</span>
            </div>
            <div className="flex flex-col">
              {selectedOriginalTarget && (
                <div className=" flex flex-col items-end gap-1.5 px-1 mt-1">
                  <Badge variant="surface" size="sm">
                    {selectedOriginalTarget.max_points} points
                  </Badge>
                  <span className="text-xs font-normal text-foreground">
                    Max points for this task
                  </span>

                </div>
              )}
            </div>

          </Card>

        </div>

      </div>

      {/* Reading materials already linked to student */}
      {remediationReferences && remediationReferences.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-sm font-bold text-foreground">
            Linked Reading Materials
          </div>
          <div className="flex flex-col gap-2">
            {(showAllReferences
              ? remediationReferences
              : remediationReferences.slice(0, 1)
            ).map((ref) => (
              <ClassworkItemLine
                key={`${ref.kind}-${ref.id}`}
                className="border-2! shadow-none!"
                size="sm"
                item={{
                  classwork_id: ref.id,
                  title: ref.title,
                  classwork_type: ref.classwork_type ?? ref.kind,
                }}
                showPublicationStatus={false}
                showCategory={false}
              />
            ))}
            {remediationReferences.length > 1 && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowAllReferences((prev) => !prev)}
                className="text-foreground bg-none shadow-none self-end p-0 px-2"
              >
                {showAllReferences ? (
                  <>
                    Hide
                    <ChevronUp className="size-3.5 ml-1" />
                  </>
                ) : (
                  <>
                    See more
                    <ChevronDown className="size-3.5 ml-1" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Collapsible diagnostic focus
      {diagnosticText && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowDiagnosticFocus((prev) => !prev)}
            className="font-bold text-black text-sm underline cursor-pointer hover:text-black/70 flex items-center gap-1"
          >
            {showDiagnosticFocus ? "Hide diagnostic focus ▴" : "Show diagnostic focus ▾"}
          </button>
          {showDiagnosticFocus && (
            <div className="border-2 border-black bg-white p-3 text-xs leading-relaxed text-black">
              {diagnosticText}
            </div>
          )}
        </div>
      )} */}
    </Card>
  );
}
