import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  Frown as FaceSlightlyFrowning,
  Meh as FaceNeutral,
  Smile as FaceSlightlySmiling,
  ScanFace,
} from "lucide-react";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/student/button";
import { Progress } from "@/components/retroui/Progress";
import { routes } from "@/../routes";
import type { StudentLesson } from "@/types/student-subject";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

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

const MASTERY_LEVELS = [
  {
    id: "low",
    label: "Low",
    shortLabel: "Low",
    badgeLabel: "Low",
    badgeVariant: "destructive" as const,
    colorClass: "text-destructive",
    bgClass: "bg-retro bg-destructive/10 border-border",
    icon: FaceSlightlyFrowning,
    percentage: 35,
    completedCount: 1,
    pendingCount: 3,
    description: "Related classwork suggests more practice may help.",
  },
  {
    id: "moderate",
    label: "Moderate",
    shortLabel: "Moderate",
    badgeLabel: "Moderate",
    badgeVariant: "surface" as const,
    colorClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-retro bg-amber-500/10 border-border",
    icon: FaceNeutral,
    percentage: 75,
    completedCount: 3,
    pendingCount: 1,
    description: "Making steady progress in related classwork.",
  },
  {
    id: "outstanding",
    label: "Outstanding",
    shortLabel: "Outstanding",
    badgeLabel: "Outstanding",
    badgeVariant: "success" as const,
    colorClass: "text-success dark:text-success",
    bgClass: "bg-retro bg-success/20 border-border",
    icon: FaceSlightlySmiling,
    percentage: 95,
    completedCount: 4,
    pendingCount: 0,
    description: "Strong performance across all lesson activities.",
  },
  {
    id: "no_recorded_classwork",
    label: "No recorded classwork",
    shortLabel: "No records",
    badgeLabel: "Not rated",
    badgeVariant: "outline" as const,
    colorClass: "text-muted-foreground",
    bgClass: "bg-retro bg-muted/40 border-border",
    icon: ScanFace,
    percentage: 0,
    completedCount: 0,
    pendingCount: 4,
    description: "Mastery appears after related classwork is graded.",
  },
] as const;

export {
  FaceSlightlyFrowning,
  FaceNeutral,
  FaceSlightlySmiling,
};

export function LessonView({
  lesson,
  displaySubjectName,
  closeLessonDetail,
  renderLessonClassworkCards,
  fmtDate,
}: LessonViewProps) {
  const navigate = useNavigate();
  const [isContentExpanded, setIsContentExpanded] = useState(false);
  const [masteryIndex, setMasteryIndex] = useState(1);
  const currentMastery = MASTERY_LEVELS[masteryIndex];
  const toggleMastery = () =>
    setMasteryIndex((prev) => (prev + 1) % MASTERY_LEVELS.length);

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

      <div className="-mt-4! flex min-w-0 flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 md:px-6">
        {/* ── Hero Lesson Information Card ── */}
        <Card className="block w-full border-2 border-black bg-primary p-4 sm:p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start gap-2 justify-between">
              <div className="flex min-w-0 items-center">
                {/* Lesson Title & Competency */}
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl sm:text-2xl font-extrabold text-black leading-tight break-words">
                    {lesson.title}
                  </h1>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 -mt-2">
              {lesson.content && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-end justify-between">
                    <span className="text-base font-semibold">Lesson Content</span>
                  </div>
                  <Card
                    className={cn(
                      "min-w-0 shadow-none relative transition-all duration-200 px-4 py-3",
                      !isContentExpanded && "max-h-32 overflow-hidden"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                      {lesson.content}
                    </p>
                    {!isContentExpanded && (
                      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white dark:from-background to-transparent pointer-events-none" />
                    )}
                  </Card>
                </div>
              )}

              <div className="flex flex-row gap-3 justify-between -mt-1">
                {(lesson.updated_at || lesson.created_at) && (
                  <p className="text-sm text-foreground/80">
                    {lesson.updated_at && (!lesson.created_at || lesson.updated_at !== lesson.created_at)
                      ? `Updated ${fmtDate(lesson.updated_at)}`
                      : `Created ${fmtDate(lesson.created_at!)}`}
                  </p>
                )}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => setIsContentExpanded((prev) => !prev)}
                  className="text-foreground p-0 text-sm gap-1 shadow-none"
                >
                  {isContentExpanded ? (
                    <>
                      Show less
                      <ChevronUp size={14} />
                    </>
                  ) : (
                    <>
                      See more
                      <ChevronDown size={14} />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-20 gap-4 items-start">
          {/* ── Main Section ── */}
          <main className="lg:col-span-14 flex flex-col gap-4 min-w-0">
            <section className="flex flex-col gap-3">
              <h2 className="text-2xl font-bold -mb-2">Classworks</h2>
              {renderLessonClassworkCards(lesson)}
            </section>
          </main>

          {/* ── Aside (Right: Stat Cards) ── */}
          <aside aria-label="Lesson Statistics" className="lg:col-span-6 flex flex-col gap-3 min-w-0">
            <Card className="@container/card flex min-w-0 flex-col transition-all duration-200">
              <Card.Header className="flex flex-row items-center justify-between gap-2">
                <Card.Description className="text-lg sm:text-2xl font-bold text-foreground">
                  Lesson Mastery
                </Card.Description>
                <Badge
                  variant={currentMastery.badgeVariant}
                  size="sm"
                  className={cn("capitalize cursor-pointer select-none", currentMastery.badgeLabel === "Not rated" ? "bg-muted text-foreground" : "")}
                  onClick={toggleMastery}
                  title="Click to toggle mastery level"
                >
                  {currentMastery.badgeLabel}
                </Badge>
              </Card.Header>

              <Card.Content className="flex flex-1 flex-col gap-3 -mt-1">
                <Card
                  role="button"
                  tabIndex={0}
                  onClick={toggleMastery}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleMastery();
                    }
                  }}
                  className={cn(
                    "shadow-none items-center flex flex-col p-3 cursor-pointer select-none transition-all duration-150 border-2 hover:border-black",
                    currentMastery.bgClass,
                  )}
                  title="Click to cycle mastery level"
                >
                  <currentMastery.icon className={cn("size-8 transition-colors", currentMastery.colorClass)} />
                  <p className={cn("text-base font-bold text-center", currentMastery.colorClass)}>
                    {currentMastery.label}
                  </p>

                </Card>
                <p className="text-sm text-muted-foreground px-1 -mt-1">
                  {currentMastery.description}
                </p>
              </Card.Content>
            </Card>

            <Card className="flex flex-col p-4 gap-2">
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center text-xs font-semibold">
                  <Card.Description className="text-lg sm:text-2xl font-bold text-foreground">
                    Lesson Completion
                  </Card.Description>
                  <Badge variant="surface" size="sm">
                    {currentMastery.percentage > 0 ? `${currentMastery.percentage}%` : "--"}
                  </Badge>
                </div>

                <p className="text-lg font-semibold">2 out of 4 classworks done</p>
                <Progress
                  value={currentMastery.percentage}
                  className="h-3"
                  aria-label={`Lesson completion: ${currentMastery.percentage}%`}
                />
              </div>

              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Badge variant="surface" size="sm">
                  {currentMastery.completedCount} Completed
                </Badge>
                <Badge variant="outline" size="sm" className="bg-white text-black">
                  {currentMastery.pendingCount} Pending
                </Badge>
              </div>
            </Card>

          </aside>
        </div>


      </div>
    </>
  );
}

export const StudentLessonDetailScreen = LessonView;
export default LessonView;
