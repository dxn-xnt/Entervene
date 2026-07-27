import { useNavigate } from "react-router-dom";
import { ChevronLeft, FileEdit } from "lucide-react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";

// TEMP mock data — replace with real fetch
const quizInfo = {
  subjectName: "Computer Programming",
  lessonName: "Introduction to Programming",
  quizTitle: "Summative Test",
  lessonsCovered: [
    "Data Types and Variables",
    "Control Structures and Decision Making",
    "Functions and Modular Programming",
  ],
  accessibleDate: "November 20, 2025 - 8:00 AM",
  items: 20,
  durationMinutes: 45,
};

const StudentQuizView = () => {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6 flex-1">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link
                      onClick={() => navigate(routes.student.subjects)}
                      className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                    >
                      {quizInfo.subjectName}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-xl md:text-3xl">
                      {quizInfo.lessonName}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(-1)}
                  className="text-black/70 hover:text-black"
                  aria-label="Go back"
                >
                  <ChevronLeft size={22} />
                </button>
                <FileEdit size={20} />
                <h1 className="text-xl font-bold">{quizInfo.quizTitle}</h1>
              </div>
              <Button
                onClick={() =>
                  navigate(
                    routes.student.quizTake
                      .replace(":subject", "computer-programming")
                      .replace(":quizTitle", "summative-test"),
                  )
                }
                className="hover:shadow-none transition-all"
              >
                Take Quiz
              </Button>
            </div>

            <div className="flex flex-1 flex-col gap-6 p-6">
              <div className="flex flex-col items-center gap-3">
                <span className="text-sm">Lessons Covered</span>
                <div className="flex flex-wrap justify-center gap-3">
                  {quizInfo.lessonsCovered.map((lesson) => (
                    <span
                      key={lesson}
                      className="rounded-lg border-2 border-black bg-[#F6E9B2] px-4 py-2 text-sm font-medium shadow-md hover:shadow-none transition-all"
                    >
                      {lesson}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-1 flex-col items-center justify-center gap-4">
                <p className="text-sm text-black/70">
                  This quiz will be accessible on{" "}
                  <span className="font-semibold text-black">
                    {quizInfo.accessibleDate}
                  </span>
                </p>
                <div className="flex gap-12">
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-bold">{quizInfo.items}</span>
                    <span className="text-xs text-black/60">Items</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-bold">
                      {quizInfo.durationMinutes} minutes
                    </span>
                    <span className="text-xs text-black/60">Duration</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentQuizView;
