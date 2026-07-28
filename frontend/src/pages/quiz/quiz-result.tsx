import { useNavigate } from "react-router-dom";
import { ChevronLeft, FileEdit } from "lucide-react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";

// TEMP mock data — replace with real fetch
const resultInfo = {
  subjectName: "Computer Programming",
  quizTitle: "Summative Test",
  lessonMastery: 80,
  lessonsCovered: [
    "Data Types and Variables",
    "Control Structures and Decision Making",
    "Functions and Modular Programming",
  ],
  feedback:
    "Your quiz results reflect a high level of understanding — you have consistently applied lesson concepts with great accuracy.",
  itemSummary: [
    { question: 1, points: 1 },
    { question: 2, points: 1 },
    { question: 3, points: 0 },
    { question: 4, points: 1 },
    { question: 5, points: 1 },
    { question: 6, points: 1 },
    { question: 7, points: 1 },
  ],
};

const StudentQuizResult = () => {
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
                      {resultInfo.subjectName}
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Ellipsis />
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-xl md:text-3xl">
                      {resultInfo.quizTitle}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />

            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(-1)}
                className="text-black/70 hover:text-black"
                aria-label="Go back"
              >
                <ChevronLeft size={22} />
              </button>
              <FileEdit size={20} />
              <h1 className="text-xl font-bold">{resultInfo.quizTitle}</h1>
            </div>

            <div className="flex flex-col items-center gap-2">
              <span className="text-xl font-semibold">Quiz Summary</span>
              <p className="text-5xl font-bold">
                {resultInfo.lessonMastery}
                <span className="text-2xl">%</span>
              </p>
              <span className="text-md ">Lesson Mastery</span>
            </div>

            <div className="flex flex-col items-center gap-3">
              <span className="text-md ">Lessons Covered</span>
              <div className="flex flex-wrap justify-center gap-3">
                {resultInfo.lessonsCovered.map((lesson) => (
                  <span
                    key={lesson}
                    className="rounded-lg border-2 border-black bg-[#F6E9B2] px-4 py-2 text-sm font-medium shadow-md hover:shadow-none transition-all"
                  >
                    {lesson}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Feedback</span>
              <Card className="bg-white flex flex-col gap-1">
                <p className="text-sm">{resultInfo.feedback}</p>
                <span className="text-xs italic text-black/70">
                  AI Generated Comment
                </span>
              </Card>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Item Summary</span>
              <Card className="flex flex-col divide-y p-0">
                {resultInfo.itemSummary.map((item) => (
                  <div
                    key={item.question}
                    className="flex items-center justify-between px-4 py-3 text-sm"
                  >
                    <span>Question {item.question}</span>
                    <span className="font-semibold">
                      {item.points}{" "}
                      <span className="font-normal">points</span>
                    </span>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentQuizResult;
