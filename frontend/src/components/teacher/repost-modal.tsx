import { Dialog } from "@/components/retroui/Dialog";
import { Repeat } from "lucide-react";
import { RepostWorkspace } from "./repost-workspace";

export interface RepostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinationClassId?: number;
  destinationSubjectId?: number;
  destinationAcademicPeriodId?: number;
  sectionName?: string;
  subjectName?: string;
  academicPeriodName?: string;
  onClonedSuccess?: () => void;
}

export function RepostModal({
  open,
  onOpenChange,
  destinationClassId,
  destinationSubjectId,
  destinationAcademicPeriodId,
  sectionName = "Class",
  subjectName = "Subject",
  academicPeriodName,
  onClonedSuccess,
}: RepostModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="xl" className="max-h-[90vh] flex flex-col p-0">
        {/* Header - BaseDialog.Close automatically provides exactly one top-right X button */}
        <Dialog.Header position="fixed" className="bg-primary border-b-2 border-black px-6 py-4">
          <div className="flex items-center gap-2 min-w-0 pr-6">
            <Repeat className="size-5 shrink-0" />
            <div>
              <h3 className="text-xl font-bold font-head truncate">Repost & Clone Content</h3>
              <p className="text-xs text-black/70 font-semibold truncate">
                Target: <span className="font-bold underline">{subjectName}</span> &middot; {sectionName}
                {academicPeriodName ? ` (${academicPeriodName})` : ""}
              </p>
            </div>
          </div>
        </Dialog.Header>

        {/* Unified 4-tab Repost Workspace */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <RepostWorkspace
            isDialogContext
            onCloseDialog={() => onOpenChange(false)}
            destinationClassId={destinationClassId}
            destinationSubjectId={destinationSubjectId}
            destinationAcademicPeriodId={destinationAcademicPeriodId}
            sectionName={sectionName}
            subjectName={subjectName}
            academicPeriodName={academicPeriodName}
            onClonedSuccess={onClonedSuccess}
          />
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

export default RepostModal;
