import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Users,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tabs } from "@/components/retroui/Tabs";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { Text } from "@/components/retroui/Text";
import { Select } from "@/components/retroui/Select";
import { OverviewCard } from "@/components/overview-cards";
import { ManualSuggestionPanel } from "@/components/teacher/suggestions/ManualSuggestionPanel";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";
import { apiFetch, getTeacherAdvisoryClassDetail } from "@/lib/api";
import type {
  TeacherAdvisoryClassDetailResponse,
  TeacherAdvisoryStudentItem,
} from "@/types/adminClasses";
import { Button } from "@/components/retroui/Button";

interface LessonAttachment {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface LessonItem {
  lesson_id: number;
  title: string;
  description?: string | null;
  content?: string | null;
  order_index: number;
  created_at?: string;
  updated_at?: string;
  is_published: boolean;
  show_scores: boolean;
  is_draft: boolean;
  is_archived: boolean;
  attachments: LessonAttachment[];
}

interface LinkedClassworkItem {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  due_date?: string | null;
  attachment_count?: number;
}

function ClassworkIcon({
  type,
  size = 16,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toLowerCase()) {
    case "quiz":
      return <ClipboardList size={size} />;
    case "assignment":
      return <BookOpen size={size} />;
    default:
      return <FileText size={size} />;
  }
}

type DetailTab = "lessons" | "students" | "classwork";

export default function TeacherClassDetail() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("lessons");
  const [detail, setDetail] =
    useState<TeacherAdvisoryClassDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadDetail() {
      if (!classId) {
        setError("Class not found.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError("");
      try {
        const data = await getTeacherAdvisoryClassDetail(classId);
        if (isMounted) setDetail(data);
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load class details.",
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [classId]);

  if (isLoading) {
    return (
      <AppLayout>
        <StatePanel message="Loading class details..." />
      </AppLayout>
    );
  }

  if (error || !detail) {
    return (
      <AppLayout>
        <StatePanel message={error || "Unable to load class details."}>
          <button
            type="button"
            onClick={() => navigate("/teacher/classes")}
            className="rounded-md border-2 border-black bg-[#79bd80] px-3 py-1 text-xs font-bold"
          >
            Back to Classes
          </button>
        </StatePanel>
      </AppLayout>
    );
  }

  const statusLabel = detail.is_archived ? "Archived" : "Active";
  const activeSince = detail.active_since || formatClassDate(detail.created_at);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between -mb-[5px]">

              <div className="flex items-center gap-3">
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link
                        onClick={() => navigate("/teacher/classes")}
                        className="cursor-pointer"
                      >
                        Classes
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page className="text-2xl">
                        {detail.section_name}
                      </Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <div className="flex items-center gap-2">
                {tab === "lessons" && (
                  <Button >
                    <Pencil className="mr-2 size-4" /> Set Lesson Goal
                  </Button>
                )}
              </div>
            </header>

            <Tabs<DetailTab>
              tabs={[
                {
                  id: "lessons",
                  label: "Lessons",
                  icon: BookOpen,
                },
                {
                  id: "students",
                  label: "Students",
                  icon: Users,
                },
                {
                  id: "classwork",
                  label: "Classwork",
                  icon: ClipboardList,
                },
              ]}
              activeTab={tab}
              onTabChange={setTab}
            />

            <Card className="block w-full border-black bg-primary transition-none hover:shadow-md">
              <Card.Content>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Card.Title className="mb-0">
                      {detail.section_name}
                    </Card.Title>

                  </div>
                  <Badge
                    variant="outline"
                    size="sm"
                    className="w-fit font-black"
                  >
                    {statusLabel}
                  </Badge>
                </div>
                <p className="text-sm font-normal">
                  {detail.academic_level} - {detail.academic_year} | Active
                  since {activeSince}
                </p>
              </Card.Content>
            </Card>

            {tab === "lessons" && <OverviewTab detail={detail} />}
            {tab === "students" && <StudentsTab detail={detail} />}
            {tab === "classwork" && <ClassworkTab detail={detail} />}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function OverviewTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    detail.subject_loads[0]?.subject_id ?? null,
  );
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [isLoadingLessons, setIsLoadingLessons] = useState(false);
  const [lessonsError, setLessonsError] = useState("");
  const [expandedLessonId, setExpandedLessonId] = useState<number | null>(null);
  const [linkedClassworks, setLinkedClassworks] = useState<
    Record<number, LinkedClassworkItem[]>
  >({});
  const [loadingClassworkId, setLoadingClassworkId] = useState<number | null>(null);
  const [lessonSearch, setLessonSearch] = useState("");
  const [lessonSort, setLessonSort] = useState<
    "order" | "newest" | "oldest" | "title"
  >("order");

  useEffect(() => {
    if (!selectedSubjectId && detail.subject_loads.length > 0) {
      setSelectedSubjectId(detail.subject_loads[0].subject_id);
    }
  }, [detail.subject_loads, selectedSubjectId]);

  useEffect(() => {
    if (!selectedSubjectId || !detail.class_id) {
      setLessons([]);
      setIsLoadingLessons(false);
      return;
    }

    let isMounted = true;
    setIsLoadingLessons(true);
    setLessonsError("");

    apiFetch(
      `/api/v1/lessons/my-class/${detail.class_id}/subject/${selectedSubjectId}`,
    )
      .then(async (res) => {
        if (!res.ok)
          throw new Error("Unable to load lessons for this subject.");
        return (await res.json()) as LessonItem[];
      })
      .then((data) => {
        if (isMounted) {
          setLessons(data.filter((l) => !l.is_archived));
        }
      })
      .catch((err) => {
        if (isMounted) {
          setLessonsError(
            err instanceof Error ? err.message : "Unable to load lessons.",
          );
          setLessons([]);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingLessons(false);
      });

    return () => {
      isMounted = false;
    };
  }, [detail.class_id, selectedSubjectId]);

  const toggleLesson = async (lessonId: number) => {
    if (expandedLessonId === lessonId) {
      setExpandedLessonId(null);
      return;
    }

    setExpandedLessonId(lessonId);
    if (linkedClassworks[lessonId] !== undefined) return;

    setLoadingClassworkId(lessonId);
    try {
      const res = await apiFetch(
        `/api/v1/lessons/my-class/${detail.class_id}/lesson/${lessonId}/linked-classwork`,
      );
      const data = res.ok
        ? ((await res.json()) as LinkedClassworkItem[])
        : [];
      setLinkedClassworks((prev) => ({ ...prev, [lessonId]: data }));
    } catch {
      setLinkedClassworks((prev) => ({ ...prev, [lessonId]: [] }));
    } finally {
      setLoadingClassworkId(null);
    }
  };

  const filteredLessons = useMemo(() => {
    const query = lessonSearch.trim().toLowerCase();
    const list = query
      ? lessons.filter((l) =>
        [l.title, l.description]
          .filter(Boolean)
          .some((v) => v?.toLowerCase().includes(query)),
      )
      : lessons;

    return [...list].sort((a, b) => {
      if (lessonSort === "title") return a.title.localeCompare(b.title);
      if (lessonSort === "newest") {
        return (
          new Date(b.created_at || 0).getTime() -
          new Date(a.created_at || 0).getTime()
        );
      }
      if (lessonSort === "oldest") {
        return (
          new Date(a.created_at || 0).getTime() -
          new Date(b.created_at || 0).getTime()
        );
      }
      return (
        (a.order_index || 0) - (b.order_index || 0) ||
        a.title.localeCompare(b.title)
      );
    });
  }, [lessonSearch, lessonSort, lessons]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_320px] xl:grid-rows-[auto_1fr] items-stretch">
        <div className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold">Overview</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <OverviewCard
              title="Total Students"
              count={String(detail.student_count ?? 0)}
              statDescription="Real assigned students"
            />
            <OverviewCard
              title="Total Subjects"
              count={String(detail.subject_count ?? 0)}
              statDescription="Active and historical subject loads"
            />
          </div>
        </div>

        <aside className="flex flex-col gap-2 xl:row-span-2">
          <LessonGoalProgress
            sortedGoalLessons={lessons as any}
            classworksByLesson={linkedClassworks as any}
            className="w-full flex-1"
          />
        </aside>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Text as="h3" className="text-xl font-semibold">
                Lessons
              </Text>
            </div>

            {/* Search & Sort Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                <Input
                  value={lessonSearch}
                  onChange={(e) => setLessonSearch(e.target.value)}
                  placeholder="Search lessons..."
                  className="h-10 w-full border-2 border-black pl-9 pr-3 shadow-none bg-white font-medium"
                />
              </label>

              <Select
                value={lessonSort}
                onValueChange={(v) =>
                  setLessonSort(v as "order" | "newest" | "oldest" | "title")
                }
              >
                <Select.Trigger className="h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
                  <Select.Value placeholder="Sort by" />
                </Select.Trigger>
                <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <Select.Item value="order">Lesson order</Select.Item>
                  <Select.Item value="newest">Newest first</Select.Item>
                  <Select.Item value="oldest">Oldest first</Select.Item>
                  <Select.Item value="title">Title A-Z</Select.Item>
                </Select.Content>
              </Select>
            </div>
          </div>

          {/* Lessons List */}
          {isLoadingLessons ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500 font-medium">
              <Loader2 className="animate-spin mr-2 size-5" /> Loading lessons...
            </div>
          ) : lessonsError ? (
            <div className="rounded border-2 border-red-300 bg-red-50 p-4 text-sm text-red-700 font-medium">
              {lessonsError}
            </div>
          ) : filteredLessons.length === 0 ? (
            <Card className="block w-full border-2 border-black bg-white p-8 text-center">
              <div className="flex flex-col items-center justify-center gap-2 text-gray-500">
                <BookOpen size={36} className="opacity-40" />
                <p className="font-semibold text-sm">
                  {lessonSearch.trim()
                    ? "No lessons match your search."
                    : "No lessons available for this subject."}
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredLessons.map((lesson) => {
                const isExpanded = expandedLessonId === lesson.lesson_id;
                const classworks = linkedClassworks[lesson.lesson_id] || [];
                const isLoadingCw = loadingClassworkId === lesson.lesson_id;

                return (
                  <div key={lesson.lesson_id} className="flex flex-col gap-2">
                    <Card className="bg-primary border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all">
                      <Card.Content className="flex items-center justify-between gap-3 p-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <Card.Title className="truncate text-lg md:text-xl font-bold text-black">
                              {lesson.title}
                            </Card.Title>
                            <Badge
                              variant="outline"
                              size="sm"
                              className="border border-black bg-white font-bold"
                            >
                              {lesson.is_published ? "Published" : "Draft"}
                            </Badge>
                            {lesson.attachments &&
                              lesson.attachments.length > 0 && (
                                <Badge
                                  size="sm"
                                  className="border border-black bg-[#7ABA78] text-white font-bold"
                                >
                                  {lesson.attachments.length} material
                                  {lesson.attachments.length === 1 ? "" : "s"}
                                </Badge>
                              )}
                          </div>
                          <p className="truncate text-xs font-medium text-black/70">
                            {lesson.description ||
                              (lesson.created_at
                                ? `Created ${new Date(lesson.created_at).toLocaleDateString()}`
                                : "Lesson folder")}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleLesson(lesson.lesson_id)}
                          className="p-1.5 rounded-full border border-black bg-white hover:bg-yellow-50 transition-colors cursor-pointer shrink-0"
                          title={
                            isExpanded
                              ? "Collapse classworks"
                              : "Expand classworks"
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown size={18} />
                          ) : (
                            <ChevronRight size={18} />
                          )}
                        </button>
                      </Card.Content>
                    </Card>

                    {/* Expanded linked classworks */}
                    {isExpanded && (
                      <div className="ml-4 pl-3 border-l-2 border-black space-y-2 py-1">
                        {isLoadingCw ? (
                          <div className="flex items-center gap-2 py-3 text-xs text-gray-500 font-medium">
                            <Loader2 className="size-4 animate-spin" /> Loading
                            classworks...
                          </div>
                        ) : classworks.length === 0 ? (
                          <div className="rounded border border-black/20 bg-white p-3 text-xs text-gray-500 font-medium">
                            No classworks linked to this lesson.
                          </div>
                        ) : (
                          classworks.map((cw) => (
                            <div
                              key={cw.classwork_assignment_id}
                              className="flex items-center justify-between gap-3 border-2 border-black bg-white p-3 rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 transition-colors"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="shrink-0">
                                  <ClassworkIcon
                                    type={cw.classwork_type}
                                    size={16}
                                  />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold truncate text-black">
                                    {cw.title}
                                  </p>
                                  <p className="text-[11px] text-gray-600 font-medium">
                                    {cw.classwork_type || "Classwork"}
                                    {cw.due_date
                                      ? ` • Due ${new Date(cw.due_date).toLocaleDateString()}`
                                      : ""}
                                  </p>
                                </div>
                              </div>
                              {cw.classwork_category && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] font-bold shrink-0 bg-[#F6E9B2] border border-black"
                                >
                                  {cw.classwork_category.replace(/_/g, " ")}
                                </Badge>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StudentsTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  const [search, setSearch] = useState("");
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return detail.students
      .filter(
        (student) =>
          !query || student.full_name.toLocaleLowerCase().includes(query),
      )
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [detail.students, search]);
  const groupedStudents = groupStudents(filteredStudents);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2">
        <Text as="h3" className="text-xl font-semibold">Overview</Text>
        <div className="grid gap-4 md:grid-cols-3">
          <OverviewCard
            title="Students"
            count={String(detail.student_count ?? 0)}
            statDescription="Full class roster"
          />
          <OverviewCard
            title="Male"
            count={String(detail.male_count ?? 0)}
          />
          <OverviewCard
            title="Female"
            count={String(detail.female_count ?? 0)}
          />
        </div>
      </div>

      <section>
        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h3 className="text-xl font-bold">Students</h3>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students..."
          />
        </div>
        <Card className="block w-full border-black">
          <Card.Content className="max-h-[560px] overflow-y-auto p-4">
            {!detail.students.length ? (
              <StateInline message="No students are currently enrolled in this class." />
            ) : !filteredStudents.length ? (
              <StateInline message="No students match your search." />
            ) : (
              <div className="grid items-start gap-3">
                {groupedStudents.map(([gender, students]) => (
                  <details
                    key={gender}
                    open
                    className="group overflow-hidden border-2 border-black bg-white"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between bg-primary border-b-2 px-4 py-3 text-sm font-black">
                      <span>{gender.toUpperCase()}</span>
                      <span className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          size="sm"
                          className="rounded-none"
                        >
                          {students.length} student
                          {students.length !== 1 ? "s" : ""}
                        </Badge>
                        <ChevronDown className="size-4" />
                      </span>
                    </summary>
                    <div>
                      {students.map((student) => (
                        <StudentRow
                          key={student.student_id}
                          student={student}
                          classId={detail.class_id}
                          subjectLoads={detail.subject_loads}
                        />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Card.Content>
        </Card>
      </section>
    </div>
  );
}

function ClassworkTab({
  detail,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
}) {
  if (!detail.subject_loads.length) {
    return <EmptyInline message="No subject load assigned yet." />;
  }

  return (
    <section>
      <Text as="h3" className="text-xl font-semibold">Classworks</Text>
    </section>
  );
}

function StudentRow({
  student,
  classId,
  subjectLoads,
}: {
  student: TeacherAdvisoryStudentItem;
  classId: number;
  subjectLoads: TeacherAdvisoryClassDetailResponse["subject_loads"];
}) {
  return (
    <div className="border-b-2 border-black bg-white px-3 py-2 text-sm last:border-b-0">
      <div className="flex min-h-12 items-center gap-3">
        <Avatar text={student.avatar_initial || student.full_name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {student.full_name}
          </span>
          {student.student_lrn && (
            <span className="block text-[10px] font-semibold text-black/55">
              LRN {student.student_lrn}
            </span>
          )}
        </span>
      </div>
      <ManualSuggestionPanel
        classId={classId}
        student={student}
        subjectLoads={subjectLoads}
      />
    </div>
  );
}

function StatePanel({
  message,
  children,
}: {
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-4 md:px-6 md:py-5">
      <Card className="block w-full border-black">
        <Card.Content className="p-8 text-center text-sm text-black/60">
          <p className="font-bold text-black">{message}</p>
          {children && (
            <div className="mt-3 flex justify-center">{children}</div>
          )}
        </Card.Content>
      </Card>
    </main>
  );
}

function StateInline({ message }: { message: string }) {
  return (
    <div className="p-6 text-center text-sm font-semibold text-black/60">
      {message}
    </div>
  );
}

function EmptyInline({ message }: { message: string }) {
  return (
    <Card className="block w-full border-black">
      <Card.Content className="p-8 text-center text-sm font-semibold text-black/60">
        {message}
      </Card.Content>
    </Card>
  );
}

function Avatar({ text }: { text: string }) {
  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
      {(text || "?").charAt(0)}
    </span>
  );
}

function normalizedStudentGender(gender: string) {
  if (gender === "Female" || gender === "Male" || gender === "Other")
    return gender;
  return "Unspecified";
}

function groupStudents(students: TeacherAdvisoryStudentItem[]) {
  const order = ["Male", "Female", "Other", "Unspecified"];
  return order
    .map(
      (gender) =>
        [
          gender,
          students.filter(
            (student) => normalizedStudentGender(student.gender) === gender,
          ),
        ] as const,
    )
    .filter(([, group]) => group.length > 0);
}

function formatClassDate(value: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
