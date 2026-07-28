import { useParams, Link } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { LessonPlannerWizard } from "./LessonPlannerWizard";
import { routes } from "@/../routes";

const LessonPlannerPage = () => {
  const { planId } = useParams<{ planId?: string }>();
  const numericPlanId = planId ? parseInt(planId, 10) : undefined;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />

                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                  {numericPlanId ? "Edit Lesson Plan" : "New Lesson Plan"}
                </h1>
              </div>

              <Link to={routes.teacher.lessonPlanner}>
                <Button variant="default" size="md" className="gap-2">
                  <ArrowLeft size={16} />
                  <span className="hidden sm:inline">Back to Lesson Plans</span>
                  <span className="sm:hidden">Back</span>
                </Button>
              </Link>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border" />

            <LessonPlannerWizard planId={numericPlanId} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default LessonPlannerPage;
