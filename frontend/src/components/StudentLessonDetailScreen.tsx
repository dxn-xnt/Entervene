import type { ReactNode } from "react";
import { BookOpen, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import Tabs from "@/components/Tabs";
import SubjectSuggestionsTab from "@/pages/student/Subjects/tabs/subject-suggestions-tab";
import { routes } from "@/../routes";
import type { StudentLesson } from "@/types/student-subject";

interface StudentLessonDetailScreenProps {
  lesson: StudentLesson;
  displaySubjectName: string;
  closeLessonDetail: () => void;
  lessonDetailTab: "classwork" | "suggestions";
  setLessonDetailTab: (tab: "classwork" | "suggestions") => void;
  renderLessonClassworkCards: (lesson: StudentLesson) => ReactNode;
  classId?: number;
  subjectId?: number;
  fmtDate: (date: string) => string;
}

export function StudentLessonDetailScreen({
  lesson,
  displaySubjectName,
  closeLessonDetail,
  lessonDetailTab,
  setLessonDetailTab,
  renderLessonClassworkCards,
  classId,
  subjectId,
  fmtDate,
}: StudentLessonDetailScreenProps) {
  const navigate = useNavigate();
  const tabs = [
    { id: "classwork", label: "Classwork", icon: <ClipboardList size={14} /> },
    {
      id: "suggestions",
      label: "Recommended Materials",
      icon: <BookOpen size={14} />,
    },
  ];

  return (
    <div className="space-y-4">
      <header className="-mx-4 border-b border-gray-200 px-4 pb-4 md:-mx-6 md:px-6">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item>
              <Breadcrumb.Link
                onClick={() => navigate(routes.student.subjects)}
                className="cursor-pointer text-2xl text-black/50 hover:text-black md:text-4xl"
              >
                Subjects
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Link
                onClick={closeLessonDetail}
                className="cursor-pointer text-xl text-black/50 hover:text-black md:text-3xl"
              >
                {displaySubjectName}
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Page className="text-xl md:text-3xl">
                {lesson.title}
              </Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </header>

      <Card className="block w-full border-black bg-[#F6E9B2]">
        <Card.Title className="text-2xl font-bold">{lesson.title}</Card.Title>
        <p className="mt-1 text-sm font-semibold text-gray-800">
          {lesson.description || "No lesson description provided."}
        </p>
        {lesson.content ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-800">
            {lesson.content}
          </p>
        ) : null}
        <p className="mt-2 text-xs font-semibold text-gray-600">
          {lesson.updated_at
            ? `Updated ${fmtDate(lesson.updated_at)}`
            : lesson.created_at
              ? `Created ${fmtDate(lesson.created_at)}`
              : ""}
        </p>
      </Card>

      <div className="-mx-4 md:-mx-6">
        <Tabs
          tabs={tabs}
          activeTab={lessonDetailTab}
          onChange={(tab) =>
            setLessonDetailTab(
              tab === "suggestions" ? "suggestions" : "classwork",
            )
          }
        />
      </div>

      {lessonDetailTab === "classwork" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">Classwork</h3>
              <span className="text-xs font-semibold text-gray-500">
                See all
              </span>
            </div>
            {renderLessonClassworkCards(lesson)}
          </section>
          <aside className="space-y-3">
            <Card className="block w-full border-black bg-white p-3">
              <h3 className="font-bold">Lesson Mastery</h3>
              <p className="mt-2 text-xs text-gray-700">
                Review the classwork and recommended materials for this lesson
                to strengthen mastery.
              </p>
            </Card>
            <Card className="block w-full border-black bg-white p-3 text-center text-sm font-semibold italic">
              Setting a goal is about achieving it and staying with that plan.
            </Card>
          </aside>
        </div>
      ) : classId && subjectId ? (
        <SubjectSuggestionsTab
          classId={classId}
          subjectId={subjectId}
          selectedLessonId={lesson.lesson_id}
          hideIntro
        />
      ) : null}
    </div>
  );
}
