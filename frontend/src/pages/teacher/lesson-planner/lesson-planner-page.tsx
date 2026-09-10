import { useParams, useNavigate } from "react-router-dom";
import { Dialog } from "@/components/retroui/Dialog";
import { LessonPlannerWizard } from "./lesson-planner-wizard";
import { routes } from "@/../routes";

interface LessonPlannerPageProps {
  open?: boolean;
  onClose?: () => void;
  planId?: number;
}

const LessonPlannerPage = ({
  open = true,
  onClose,
  planId: propPlanId,
}: LessonPlannerPageProps) => {
  const { planId: paramPlanId } = useParams<{ planId?: string }>();
  const navigate = useNavigate();

  const numericPlanId =
    propPlanId ?? (paramPlanId ? parseInt(paramPlanId, 10) : undefined);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate(routes.teacher.lessonPlanner);
    }
  };

  return (
    <Dialog
      open={open}
      disablePointerDismissal={true}
      onOpenChange={(isOpen) => {
        if (!isOpen) handleClose();
      }}
    >
      <Dialog.Content
        size="4xl"
        className="max-h-[90vh] w-[95vw] max-w-6xl flex flex-col bg-white border-2 border-black p-0 gap-0 rounded-lg overflow-hidden shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
      >
        <LessonPlannerWizard planId={numericPlanId} onClose={handleClose} />
      </Dialog.Content>
    </Dialog>
  );
};

export default LessonPlannerPage;
