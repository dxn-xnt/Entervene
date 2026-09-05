import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen, ClipboardList } from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tabs, type TabItem } from "../../components/retroui/Tabs";
import SubjectLessonTab from "./Subjects/tabs/subject-lesson-tab";
import SubjectClassworkTab from "./Subjects/tabs/subject-classwork-tab";
import { routes } from "@/../routes";
import { apiFetch } from "@/lib/api";

interface SubjectInfo {
  subject_name: string;
  teacher_name: string;
  class_id: number;
  subject_id: number;
}

const tabs: TabItem[] = [
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
  const requestedTab = searchParams.get("tab");
  const activeTab = requestedTab === "classwork" ? "classwork" : "lessons";
  const isLessonDetailScreen =
    activeTab === "lessons" && Boolean(searchParams.get("lessonId"));
  const [subjectInfo, setSubjectInfo] = useState<SubjectInfo | null>(null);

  const numericClassId = classId ? parseInt(classId, 10) : undefined;
  const numericSubjectId = subjectId ? parseInt(subjectId, 10) : undefined;

  const handleTabChange = (tabId: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (tabId === "lessons") nextParams.delete("tab");
    else nextParams.set("tab", tabId);
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    if (!numericClassId || !numericSubjectId) return;
    apiFetch("/api/v1/students/me/subjects")
      .then((r) => r.json())
      .then((data: SubjectInfo[]) => {
        const match = data.find(
          (s) =>
            s.class_id === numericClassId && s.subject_id === numericSubjectId,
        );
        if (match) setSubjectInfo(match);
      })
      .catch(() => {});
  }, [numericClassId, numericSubjectId]);

  // Guard: invalid URL params
  if (!numericClassId || !numericSubjectId) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-screen gap-3">
          <p className="text-red-500 text-lg">Invalid subject or class.</p>
          <button
            onClick={() => navigate(routes.student.subjects)}
            className="text-sm underline text-gray-500 hover:text-gray-800"
          >
            Back to Subjects
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* ── Page header: breadcrumb ── */}
            {!isLessonDetailScreen ? (
              <>
                <header className="flex items-center gap-3 bg-background py-4 px-4 md:px-6">
                  <SidebarTrigger className="md:hidden" />
                  <Breadcrumb>
                    <Breadcrumb.List className="flex items-center gap-2 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black [&_a]:!text-muted-foreground [&_a]:!text-inherit [&_a]:!font-inherit [&_button]:!text-muted-foreground [&_button]:!text-inherit [&_button]:!font-inherit [&_[aria-current=page]]:!text-black [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!font-extrabold">
                      <Breadcrumb.Item>
                        <Breadcrumb.Link
                          onClick={() => navigate(routes.student.subjects)}
                          className="text-2xl md:text-4xl text-black/50 hover:text-black cursor-pointer"
                        >
                          Subjects
                        </Breadcrumb.Link>
                      </Breadcrumb.Item>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item>
                        {subjectInfo ? (
                          <Breadcrumb.Page className="text-xl md:text-3xl">
                            {subjectInfo.subject_name}
                          </Breadcrumb.Page>
                        ) : (
                          <span className="text-lg text-gray-400">
                            Loading subject...
                          </span>
                        )}
                      </Breadcrumb.Item>
                    </Breadcrumb.List>
                  </Breadcrumb>
                </header>
                <div className="px-4 md:px-6 bg-background -mt-[1px]">
                  <Tabs
                    tabs={tabs}
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                  />
                </div>

                <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-3">

                  {/* ── Tab content ── */}
                  <div className="py-2">
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
              <div className="py-4 px-4 md:px-6">
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
