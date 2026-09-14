import type { ReactNode } from "react";
import { BookOpen, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Tabs } from "@/components/retroui/Tabs";
import SubjectSuggestionsTab from "@/pages/student/subjects-view/tabs/subject-suggestions-tab";
import { routes } from "@/../routes";
import type { StudentLesson } from "@/types/student-subject";
import { SidebarTrigger } from "@/components/ui/sidebar";

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
    {
      id: "classwork",
      label: "Classwork",
      icon: ClipboardList,
    },
    {
      id: "suggestions",
      label: "Recommended Materials",
      icon: BookOpen,
    },
  ];

  return (
    <div className="min-w-0 space-y-3 sm:space-y-4">
      <header className="-mx-3 -mt-3 flex min-w-0 items-center gap-2 border-b-2 border-black bg-background px-3 py-3 sm:-mx-4 sm:-mt-4 sm:gap-3 sm:px-4 sm:py-4 md:-mx-6 md:h-[78px] md:px-6 md:py-0">
        <SidebarTrigger className="shrink-0 md:hidden" />
        <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
          <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 text-lg font-extrabold tracking-tight text-black sm:gap-2 sm:text-2xl md:text-3xl [&_a]:!font-inherit [&_a]:!text-inherit [&_a]:!text-muted-foreground [&_button]:!font-inherit [&_button]:!text-inherit [&_button]:!text-muted-foreground [&_[aria-current=page]]:!font-extrabold [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!text-black">
            <Breadcrumb.Item className="shrink-0">
              <Breadcrumb.Link
                onClick={() => navigate(routes.student.subjects)}
                className="cursor-pointer whitespace-nowrap text-lg text-black/50 hover:text-black sm:text-2xl md:text-4xl"
              >
                Subjects
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item className="min-w-0 shrink-0">
              <Breadcrumb.Link
                onClick={closeLessonDetail}
                className="block max-w-24 cursor-pointer truncate text-lg text-black/50 hover:text-black sm:max-w-48 sm:text-xl md:max-w-none md:text-3xl"
              >
                {displaySubjectName}
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item className="min-w-0 flex-1">
              <Breadcrumb.Page className="block truncate text-lg sm:text-xl md:text-3xl" title={lesson.title}>
                {lesson.title}
              </Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </header>

      <Card className="block w-full border-black bg-primary shadow-md hover:shadow-none">
        <Card.Title className="break-words text-xl font-bold sm:text-2xl">{lesson.title}</Card.Title>
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

      <Tabs
        tabs={tabs}
        activeTab={lessonDetailTab}
        onTabChange={(tab) =>
          setLessonDetailTab(
            tab === "suggestions" ? "suggestions" : "classwork",
          )
        }
      />

      {lessonDetailTab === "classwork" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">Classwork</h3>
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
