import { useParams, Link } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BookOpenCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LessonPlannerWizard } from "./LessonPlannerWizard";
import { routes } from "@/../routes";

const LessonPlannerPage = () => {
  const { planId } = useParams<{ planId?: string }>();
  const numericPlanId = planId ? parseInt(planId, 10) : undefined;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col w-full">
        <div className="@container/main flex flex-1 flex-col w-full">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-8 pb-10 w-full max-w-7xl mx-auto">
            {/* Page Header */}
            <header className="flex items-center justify-between gap-4 flex-wrap w-full">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm shrink-0">
                    <BookOpenCheck className="size-5" />
                  </div>
                  <div>
                    <h1 className="text-2xl md:text-3xl font-semibold leading-tight">
                      {numericPlanId ? "Edit Lesson Plan" : "New Lesson Plan"}
                    </h1>
                    <p className="text-sm text-gray-500">
                      ILAW Format — Intentions · Learning Experience · Assessment · Ways Forward
                    </p>
                  </div>
                </div>
              </div>

              <Link to={routes.teacher.lessonPlanner}>
                <Button variant="outline" size="sm" className="gap-2 h-9 text-xs">
                  <ArrowLeft className="size-3.5" />
                  Back to Lesson Plans
                </Button>
              </Link>
            </header>

            <div className="-mx-4 md:-mx-8 border-b border-black/10" />

            {/* Wizard */}
            <LessonPlannerWizard planId={numericPlanId} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default LessonPlannerPage;
