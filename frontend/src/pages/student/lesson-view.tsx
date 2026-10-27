import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { routes } from "@/../routes";
import type { StudentLesson } from "@/types/student-subject";
import { SidebarTrigger } from "@/components/ui/sidebar";

export interface LessonViewProps {
  lesson: StudentLesson;
  displaySubjectName: string;
  closeLessonDetail: () => void;
  renderLessonClassworkCards: (lesson: StudentLesson) => ReactNode;
  classId?: number;
  subjectId?: number;
  fmtDate: (date: string) => string;
}

export type StudentLessonDetailScreenProps = LessonViewProps;

export function LessonView({
  lesson,
  displaySubjectName,
  closeLessonDetail,
  renderLessonClassworkCards,
  fmtDate,
}: LessonViewProps) {
  const navigate = useNavigate();
  return (
    <>
      <div data-page-tabs-sticky-region>
        <header className="flex min-w-0 items-center gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
          <SidebarTrigger className="shrink-0 md:hidden" />
          <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
            <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 text-lg font-extrabold tracking-tight text-black sm:gap-2 sm:text-2xl md:text-3xl [&_a]:!font-inherit [&_a]:!text-inherit [&_a]:!text-muted-foreground [&_button]:!font-inherit [&_button]:!text-inherit [&_button]:!text-muted-foreground [&_[aria-current=page]]:!font-extrabold [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!text-black">
              <Breadcrumb.Item className="shrink-0">
                <Breadcrumb.Link
                  onClick={() => navigate(routes.student.subjects)}
                  className="cursor-pointer whitespace-nowrap text-lg text-black/50 sm:text-2xl md:text-4xl hover:text-foreground!"
                >
                  Subjects
                </Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item className="min-w-0 shrink-0">
                <Breadcrumb.Link
                  onClick={closeLessonDetail}
                  className="block max-w-24 cursor-pointer truncate text-lg text-black/50 sm:max-w-48 sm:text-xl md:max-w-none md:text-3xl hover:text-foreground!"
                >
                  {displaySubjectName}
                </Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator />
              <Breadcrumb.Item className="min-w-0 flex-1">
                <Breadcrumb.Page
                  className="block truncate text-lg sm:text-xl md:text-3xl"
                  title={lesson.title}
                >
                  {lesson.title}
                </Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb>
        </header>
        <div className="border-b-2 border-black" aria-hidden="true" />

      </div>

      <div className="flex min-w-0 flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        <Card className="block w-full border-2 border-black bg-primary p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] sm:p-5">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="break-words text-xl font-extrabold leading-tight text-black sm:text-2xl md:text-3xl">
                  {lesson.title}
                </h1>
                <Badge variant="outline" size="sm">Lesson</Badge>
              </div>
              {lesson.is_published && <Badge variant="solid" size="sm">Published</Badge>}
            </div>
            <div className={lesson.content ? "grid gap-5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8" : "flex flex-col gap-3"}>
              <div className="flex flex-col gap-3">
                {(lesson.competency_code || lesson.competency_statement) && (
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wide text-foreground/70">Competency</p>
                    <p className="mt-1 break-words text-sm font-semibold text-foreground sm:text-base">
                      {lesson.competency_code || lesson.competency_statement}
                    </p>
                  </div>
                )}
                {lesson.description && <p className="text-sm text-foreground/80">{lesson.description}</p>}
                {(lesson.updated_at || lesson.created_at) && (
                  <p className="text-sm text-foreground/80">
                    {lesson.updated_at && (!lesson.created_at || lesson.updated_at !== lesson.created_at)
                      ? `Updated ${fmtDate(lesson.updated_at)}`
                      : `Created ${fmtDate(lesson.created_at!)}`}
                  </p>
                )}
              </div>
              {lesson.content && (
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/70">Lesson Content</h2>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground sm:text-base">
                    {lesson.content}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        <section className="mt-2 flex flex-col gap-3 px-1">
          {renderLessonClassworkCards(lesson)}
        </section>
      </div>
    </>
  );
}

export const StudentLessonDetailScreen = LessonView;
export default LessonView;
