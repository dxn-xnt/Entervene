import { Dialog } from "@/components/retroui/Dialog";
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
        <Dialog.Header position="fixed">
          <h3 className="truncate pr-6 text-xl font-bold">Repost Content</h3>
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
