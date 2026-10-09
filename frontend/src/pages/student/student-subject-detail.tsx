import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, Calendar, ClipboardList } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { SubjectClassHeader } from "@/components/subject-class-header";
import SubjectLessonTab from "./subjects-view/tabs/subject-lesson-tab";
import SubjectClassworkTab from "./subjects-view/tabs/subject-classwork-tab";
import { routes } from "@/../routes";
import { getMySubjects, type StudentSubjectItem } from "@/lib/api";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";

const tabs: TabItem<"lessons" | "classwork">[] = [
  { id: "lessons", label: "Lessons", icon: BookOpen },
  { id: "classwork", label: "Classwork", icon: ClipboardList },
];

const StudentSubjectDetail = () => {
  const { classId, subjectId } = useParams<{
    classId: string;
    subjectId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedPeriodId } = useAcademicPeriod();
  const requestedTab = searchParams.get("tab");
  const activeTab = (requestedTab === "classwork" ? "classwork" : "lessons") as
    | "lessons"
    | "classwork";
  const isLessonDetailScreen =
    activeTab === "lessons" && Boolean(searchParams.get("lessonId"));
  const [subjectInfo, setSubjectInfo] = useState<StudentSubjectItem | null>(null);
  const [, setIsLoading] = useState(true);

  const numericClassId = classId ? parseInt(classId, 10) : undefined;
  const numericSubjectId = subjectId ? parseInt(subjectId, 10) : undefined;

  const handleTabChange = (tabId: "lessons" | "classwork") => {
    const nextParams = new URLSearchParams(searchParams);
    if (tabId === "lessons") nextParams.delete("tab");
    else nextParams.set("tab", tabId);
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (!numericClassId || !numericSubjectId) return;
    let isMounted = true;
    setIsLoading(true);

    getMySubjects(selectedPeriodId ?? undefined)
      .then((data) => {
        if (!isMounted) return;
        const match = data.find(
          (s) =>
            s.class_id === numericClassId && s.subject_id === numericSubjectId,
        );
        if (match) {
          setSubjectInfo(match);
        } else {
          return getMySubjects().then((allData) => {
            if (!isMounted) return;
            const fallbackMatch = allData.find(
              (s) =>
                s.class_id === numericClassId &&
                s.subject_id === numericSubjectId,
            );
            if (fallbackMatch) setSubjectInfo(fallbackMatch);
          });
        }
      })
      .catch((err) => {
        console.error("Failed to load subject info", err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [numericClassId, numericSubjectId, selectedPeriodId]);

  // Guard: invalid URL params
  if (!numericClassId || !numericSubjectId) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <p className="text-red-500 text-lg font-semibold">
            Invalid subject or class.
          </p>
          <Button
            variant="outline"
            onClick={() => navigate(routes.student.subjects)}
          >
            Back to Subjects
          </Button>
        </div>
      </AppLayout>
    );
  }

  const subjectName = subjectInfo?.subject_name || "Subject";
  const academicLevel = [subjectInfo?.year_label, subjectInfo?.section_name]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* ── Page header: breadcrumb ── */}
            {!isLessonDetailScreen ? (
              <>
                <div data-page-tabs-sticky-region>
                  <header className="flex min-w-0 items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <SidebarTrigger className="shrink-0 md:hidden" />
                      <Breadcrumb className="min-w-0">
                        <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 text-lg font-extrabold tracking-tight text-black sm:gap-2 sm:text-2xl md:text-3xl [&_a]:!font-inherit [&_a]:!text-inherit [&_a]:!text-muted-foreground [&_button]:!font-inherit [&_button]:!text-inherit [&_button]:!text-muted-foreground [&_[aria-current=page]]:!font-extrabold [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!text-black">
                          <Breadcrumb.Item>
                            <Breadcrumb.Link
                              onClick={() => navigate(routes.student.subjects)}
                              className="cursor-pointer whitespace-nowrap text-lg text-black/50 hover:text-black sm:text-2xl md:text-4xl"
                            >
                              Subjects
                            </Breadcrumb.Link>
                          </Breadcrumb.Item>
                          <Breadcrumb.Separator />
                          <Breadcrumb.Item className="min-w-0">
                            <Breadcrumb.Page className="block truncate text-lg sm:text-xl md:text-3xl">
                              {subjectName}
                            </Breadcrumb.Page>
                          </Breadcrumb.Item>
                        </Breadcrumb.List>
                      </Breadcrumb>
                    </div>

                  </header>

                  <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                    <Tabs
                      tabs={tabs}
                      activeTab={activeTab}
                      onTabChange={handleTabChange}
                    />
                  </div>
                </div>

                <div className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-4 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
                  {/* Subject Banner Header */}
                  <SubjectClassHeader
                    detail={{
                      class_id: numericClassId,
                      section_name: subjectInfo?.section_name,
                      academic_level: academicLevel || undefined,
                    }}
                    currentSubject={{
                      subject_id: numericSubjectId,
                      subject_name: subjectName,
                    }}
                    statusLabel={
                      subjectInfo?.is_current_period ? "Active" : "Enrolled"
                    }
                    showViewSubjectButton={false}
                  />

                  {/* ── Tab content ── */}
                  <div className="min-w-0 py-2">
                    {activeTab === "lessons" && (
                      <SubjectLessonTab
                        classId={numericClassId}
                        subjectId={numericSubjectId}
                        subjectName={subjectInfo?.subject_name}
                        teacherName={subjectInfo?.teacher_name}
                      />
                    )}
                    {activeTab === "classwork" && (
                      <SubjectClassworkTab
                        classId={numericClassId}
                        subjectId={numericSubjectId}
                      />
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="min-w-0">
                {activeTab === "lessons" && (
                  <SubjectLessonTab
                    classId={numericClassId}
                    subjectId={numericSubjectId}
                    subjectName={subjectInfo?.subject_name}
                    teacherName={subjectInfo?.teacher_name}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default StudentSubjectDetail;
