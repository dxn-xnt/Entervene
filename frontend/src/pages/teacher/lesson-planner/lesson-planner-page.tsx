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
  const { classId, subjectId, planId: paramPlanId } = useParams<{
    classId?: string;
    subjectId?: string;
    planId?: string;
  }>();
  const navigate = useNavigate();

  const numericPlanId =
    propPlanId ?? (paramPlanId ? parseInt(paramPlanId, 10) : undefined);
  const numericClassId = classId ? parseInt(classId, 10) : undefined;
  const numericSubjectId = subjectId ? parseInt(subjectId, 10) : undefined;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (classId && subjectId) {
      navigate(`/teacher/classes/${classId}/subjects/${subjectId}/lesson-planner`);
    } else {
      navigate(routes.teacher.classes);
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
        className="flex max-h-[94dvh] w-[calc(100vw-1.5rem)] max-w-6xl flex-col gap-0 overflow-hidden rounded-none border-2 border-black bg-white p-0 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] sm:max-h-[90vh] sm:w-[95vw]"
      >
        <LessonPlannerWizard
          planId={numericPlanId}
          classId={numericClassId}
          subjectId={numericSubjectId}
          onClose={handleClose}
        />
      </Dialog.Content>
    </Dialog>
  );
};

export default LessonPlannerPage;
