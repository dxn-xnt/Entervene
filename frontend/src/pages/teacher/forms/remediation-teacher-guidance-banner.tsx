import { useState } from "react";
import type {
  OriginalExamination,
  RemediationClassworkTarget,
  RemediationFocus,
  RemediationResource,
  TeacherInterventionDetail,
} from "@/lib/teacher-interventions-api";
import { focusGuidance } from "@/lib/remediation-authoring";

export interface RemediationTeacherGuidanceBannerProps {
  remediationTarget: TeacherInterventionDetail;
  remediationFocus?: RemediationFocus | null;
  remediationGradeTreatment?: "PRACTICE_ONLY" | "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | null;
  remediationOriginalExam?: OriginalExamination | null;
  selectedOriginalTarget?: RemediationClassworkTarget | null;
  remediationReferences?: RemediationResource[];
  className?: string;
}

export function RemediationTeacherGuidanceBanner({
  remediationTarget,
  remediationFocus = null,
  remediationGradeTreatment = null,
  remediationOriginalExam = null,
  selectedOriginalTarget = null,
  remediationReferences = [],
  className = "",
}: RemediationTeacherGuidanceBannerProps) {
  const [showDiagnosticFocus, setShowDiagnosticFocus] = useState(false);

  const isGradedWWPT =
    remediationGradeTreatment === "WRITTEN_WORK" ||
    remediationGradeTreatment === "PERFORMANCE_TASK";

  let linkedTitle = "None";
  let linkedDetail = "";
  let taskBold = "Remedial activity";
  let taskDetail = "completion recorded in intervention progress";

  if (remediationGradeTreatment === "EXAMINATION" && remediationOriginalExam) {
    linkedTitle = remediationOriginalExam.title;
    linkedDetail = `${remediationOriginalExam.score ?? 0}/${remediationOriginalExam.total_points} pts`;
    taskBold = "Matches original subtype";
    taskDetail = "higher score counts toward term grade";
  } else if (isGradedWWPT && selectedOriginalTarget) {
    linkedTitle = selectedOriginalTarget.title;
    linkedDetail = `${selectedOriginalTarget.original_score ?? 0}/${selectedOriginalTarget.max_points} pts`;
    taskBold = `Exactly ${selectedOriginalTarget.max_points} pts`;
    taskDetail = "adjusts grade within plan cap";
  } else if (remediationGradeTreatment === "PRACTICE_ONLY") {
    linkedTitle = selectedOriginalTarget ? selectedOriginalTarget.title : "Practice Assessment";
    linkedDetail = "non-graded";
    taskBold = "Practice only";
    taskDetail = "does not affect official grades";
  }

  const diagnosticText = remediationFocus ? focusGuidance(remediationFocus) : "";

  return (
    <div
      className={`border-2 border-black bg-[#FAF4D3] p-4 space-y-3 ${className}`}
      data-testid="remediation-teacher-guidance-banner"
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-bold text-black text-base">{remediationTarget.student_name}</span>
          <span className="text-neutral-500 text-sm font-normal">{remediationTarget.class_name}</span>
        </div>
        <div className="bg-black text-white text-xs font-semibold px-3 py-1 rounded-xs">
          Teacher only · Individual support
        </div>
      </div>

      {/* Two cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border-2 border-black bg-white p-3 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            LINKED ORIGINAL
          </div>
          <div className="text-sm font-sans">
            <span className="font-bold text-black">{linkedTitle}</span>
            {linkedDetail && <span className="text-neutral-500"> · {linkedDetail}</span>}
          </div>
        </div>

        <div className="border-2 border-black bg-white p-3 space-y-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            THIS TASK
          </div>
          <div className="text-sm font-sans">
            <span className="font-bold text-black">{taskBold}</span>
            <span className="text-neutral-500"> · {taskDetail}</span>
          </div>
        </div>
      </div>

      {/* Reading materials already linked to student */}
      {remediationReferences && remediationReferences.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            READING MATERIALS ALREADY LINKED TO STUDENT
          </div>
          <div className="flex flex-wrap gap-2">
            {remediationReferences.map((ref) => (
              <div
                key={`${ref.kind}-${ref.id}`}
                className="border-2 border-black bg-white px-3 py-1.5 text-xs text-black font-medium"
              >
                {ref.title}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible diagnostic focus */}
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
      )}
    </div>
  );
}
