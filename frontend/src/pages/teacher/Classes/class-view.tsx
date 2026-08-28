import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  ExternalLink,
  FileText,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Search,
  Users,
  X,
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
import { Table } from "@/components/retroui/Table";
import { Alert } from "@/components/retroui/Alert";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";
import CompetencyModal from "./subject-details/CompetencyModal";
import CreateLessonModal from "@/pages/teacher/create-lesson";
import { SuggestionPanel } from "@/components/teacher/suggestions/suggestion-panel-modal";
import { apiFetch, getTeacherAdvisoryClassDetail } from "@/lib/api";
import {
  approveSuggestion,
  archiveSuggestion,
  dismissSuggestion,
  getTeacherSuggestions,
} from "@/lib/suggestion-api";
import type {
  TeacherAdvisoryClassDetailResponse,
  TeacherAdvisoryStudentItem,
} from "@/types/adminClasses";
import type { SuggestionResponse } from "@/types/suggestion";
import type { CompetencyItem } from "./subject-details/types";
import { Button } from "@/components/retroui/Button";
import { Avatar } from "@/components/retroui/Avatar";

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
  competency_id?: number | null;
  competency_code?: string | null;
  competency_statement?: string | null;
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
      <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex min-w-0 max-w-full flex-1 flex-col gap-2">
          <div className="flex min-w-0 max-w-full flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between -mb-[5px] min-w-0">

              <div className="flex items-center gap-3 min-w-0">
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
                      <Breadcrumb.Page>
                        {detail.section_name}
                      </Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {tab === "lessons" && (
                  <Button>
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
  const navigate = useNavigate();
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    detail.subject_loads[0]?.subject_id ?? null,
  );
  const [competencies, setCompetencies] = useState<CompetencyItem[]>([]);
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
  const [collapsedCompetencies, setCollapsedCompetencies] = useState<
    Record<number, boolean>
  >({});
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(true);

  // Modals state
  const [isCompetencyModalOpen, setIsCompetencyModalOpen] = useState(false);
  const [editingCompetency, setEditingCompetency] = useState<CompetencyItem | null>(null);
  const [isCreatingLesson, setIsCreatingLesson] = useState(false);
  const [selectedCompetencyIdForNewLesson, setSelectedCompetencyIdForNewLesson] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!selectedSubjectId && detail.subject_loads.length > 0) {
      setSelectedSubjectId(detail.subject_loads[0].subject_id);
    }
  }, [detail.subject_loads, selectedSubjectId]);

  const loadLessonsAndCompetencies = async () => {
    if (!selectedSubjectId || !detail.class_id) {
      setLessons([]);
      setCompetencies([]);
      setIsLoadingLessons(false);
      return;
    }

    setIsLoadingLessons(true);
    setLessonsError("");

    try {
      const [lessonsRes, compRes] = await Promise.all([
        apiFetch(
          `/api/v1/lessons/my-class/${detail.class_id}/subject/${selectedSubjectId}`,
        ),
        apiFetch(`/api/v1/competencies/subject/${selectedSubjectId}`),
      ]);

      if (lessonsRes.ok) {
        const data = (await lessonsRes.json()) as LessonItem[];
        setLessons(data.filter((l) => !l.is_archived));
      }
      if (compRes.ok) {
        const compData = (await compRes.json()) as CompetencyItem[];
        setCompetencies(compData);
        setCollapsedCompetencies((prev) => {
          const next = { ...prev };
          compData.forEach((c, idx) => {
            if (next[c.competency_id] === undefined) {
              next[c.competency_id] = idx !== 0;
            }
          });
          return next;
        });
        setIsUnassignedExpanded(compData.length === 0);
      }
    } catch (err) {
      setLessonsError(
        err instanceof Error ? err.message : "Unable to load lessons.",
      );
      setLessons([]);
      setCompetencies([]);
    } finally {
      setIsLoadingLessons(false);
    }
  };

  useEffect(() => {
    void loadLessonsAndCompetencies();
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

  const toggleCompetencyCollapse = (compId: number) => {
    setCollapsedCompetencies((prev) => ({
      ...prev,
      [compId]: !prev[compId],
    }));
  };

  const openAddLessonForCompetency = (compId?: number) => {
    setSelectedCompetencyIdForNewLesson(compId);
    setIsCreatingLesson(true);
  };

  const filteredLessons = useMemo(() => {
    const query = lessonSearch.trim().toLowerCase();
    const list = query
      ? lessons.filter((l) =>
        [l.title, l.description, l.competency_statement, l.competency_code]
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

  const { lessonsByCompetency, unassignedLessons } = useMemo(() => {
    const byComp = new Map<number, LessonItem[]>();
    const unassigned: LessonItem[] = [];
    const activeCompIds = new Set(competencies.map((c) => c.competency_id));

    filteredLessons.forEach((lesson) => {
      if (lesson.competency_id && activeCompIds.has(lesson.competency_id)) {
        const list = byComp.get(lesson.competency_id) || [];
        list.push(lesson);
        byComp.set(lesson.competency_id, list);
      } else {
        unassigned.push(lesson);
      }
    });

    return { lessonsByCompetency: byComp, unassignedLessons: unassigned };
  }, [filteredLessons, competencies]);

  const renderLessonCard = (lesson: LessonItem) => {
    const isExpanded = expandedLessonId === lesson.lesson_id;
    const classworks = linkedClassworks[lesson.lesson_id] || [];
    const isLoadingCw = loadingClassworkId === lesson.lesson_id;

    return (
      <div key={lesson.lesson_id} className="flex flex-col gap-2 min-w-0 w-full">
        <div className="w-full min-w-0 rounded border-2 border-black bg-[#F6E9B2] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-all">
          <div className="flex items-center justify-between gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1 min-w-0">
                <h4 className="text-base sm:text-lg md:text-xl font-bold text-black break-words line-clamp-2">
                  {lesson.title}
                </h4>
                <Badge
                  variant="outline"
                  size="sm"
                  className="border border-black bg-white font-bold shrink-0"
                >
                  {lesson.is_published ? "Published" : "Draft"}
                </Badge>
                {lesson.attachments && lesson.attachments.length > 0 && (
                  <Badge
                    size="sm"
                    className="border border-black bg-[#7ABA78] text-white font-bold shrink-0"
                  >
                    {lesson.attachments.length} material
                    {lesson.attachments.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
              <p className="text-xs font-medium text-black/70 break-words line-clamp-2">
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
                isExpanded ? "Collapse classworks" : "Expand classworks"
              }
            >
              {isExpanded ? (
                <ChevronDown size={18} />
              ) : (
                <ChevronRight size={18} />
              )}
            </button>
          </div>
        </div>

        {/* Expanded linked classworks */}
        {isExpanded && (
          <div className="ml-4 pl-3 border-l-2 border-black space-y-2 py-1 min-w-0">
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
                  className="flex items-center justify-between gap-3 border-2 border-black bg-white p-3 rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 transition-colors min-w-0"
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
  };

  return (
    <div className="grid gap-4 min-w-0">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-[auto_1fr] items-stretch min-w-0">
        <div className="flex flex-col gap-2 min-w-0">
          <h3 className="text-xl font-semibold">Overview</h3>
          <div className="grid gap-4 md:grid-cols-2 min-w-0">
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

        <aside className="flex flex-col gap-2 min-w-0 xl:row-span-2">
          <LessonGoalProgress
            sortedGoalLessons={lessons as any}
            classworksByLesson={linkedClassworks as any}
            className="w-full flex-1 min-w-0"
          />
        </aside>

        <section className="flex flex-col gap-4 min-w-0">
          <div className="flex flex-col gap-3 min-w-0">
            {/* Header toolbar with quick actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap min-w-0">
              <Text as="h3" className="text-xl font-semibold">
                Lessons & Competencies
              </Text>

              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {selectedSubjectId && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/teacher/classes/${detail.class_id}/subjects/${selectedSubjectId}`,
                        )
                      }
                      className="gap-1.5 border-2 border-black bg-white hover:bg-gray-50 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      title="Open full subject management page"
                    >
                      <ExternalLink size={14} />
                      Full Subject View
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingCompetency(null);
                        setIsCompetencyModalOpen(true);
                      }}
                      className="gap-1.5 border-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <Award size={14} />
                      Add Competency
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => openAddLessonForCompetency(undefined)}
                      className="gap-1.5 border-2 border-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <Plus size={14} />
                      Add Lesson
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Search & Sort Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
              <label className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                <Input
                  value={lessonSearch}
                  onChange={(e) => setLessonSearch(e.target.value)}
                  placeholder="Search competencies or lessons..."
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

          {/* Lessons List with Competencies Hierarchy */}
          {isLoadingLessons ? (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500 font-medium">
              <Loader2 className="animate-spin mr-2 size-5" /> Loading lessons...
            </div>
          ) : lessonsError ? (
            <div className="rounded border-2 border-red-300 bg-red-50 p-4 text-sm text-red-700 font-medium">
              {lessonsError}
            </div>
          ) : (
            <div className="space-y-4 min-w-0">
              {/* Render Competency Accordions */}
              {competencies.map((comp) => {
                const compLessons = lessonsByCompetency.get(comp.competency_id) || [];
                const isCollapsed = collapsedCompetencies[comp.competency_id] ?? true;

                if (lessonSearch.trim()) {
                  const query = lessonSearch.toLowerCase();
                  const matches =
                    comp.statement.toLowerCase().includes(query) ||
                    (comp.competency_code && comp.competency_code.toLowerCase().includes(query));
                  if (!matches && compLessons.length === 0) return null;
                }

                return (
                  <div
                    key={comp.competency_id}
                    className="flex flex-col rounded-lg border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden min-w-0"
                  >
                    {/* Competency Header Bar */}
                    <div className="flex items-center justify-between border-b-2 border-black bg-[#F6E9B2] px-4 py-3.5 gap-3 min-w-0 w-full">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCompetencyCollapse(comp.competency_id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            toggleCompetencyCollapse(comp.competency_id);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer group"
                      >
                        <div className="rounded border-2 border-black bg-white p-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-yellow-50 transition-colors shrink-0">
                          {isCollapsed ? <ChevronRight size={16} className="text-black" /> : <ChevronDown size={16} className="text-black" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex flex-wrap items-center gap-2 min-w-0">
                            <Award size={20} className="text-black shrink-0" />
                            <h4 className="text-base sm:text-lg md:text-xl font-bold text-gray-950 break-words line-clamp-2">
                              {comp.competency_code || comp.statement}
                            </h4>
                            <Badge
                              variant="secondary"
                              size="sm"
                              className="border-2 border-black bg-white text-black text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0"
                            >
                              {compLessons.length} lesson{compLessons.length === 1 ? "" : "s"}
                            </Badge>
                            {(comp.target_hours || 0) > 0 && (
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="border-2 border-black bg-white text-black text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0"
                              >
                                {comp.target_hours} hrs
                              </Badge>
                            )}
                          </div>
                          {comp.competency_code && comp.statement && (
                            <p className="text-xs font-medium text-gray-700 break-words line-clamp-2">
                              {comp.statement}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAddLessonForCompetency(comp.competency_id);
                          }}
                          className="gap-1 border-2 border-black bg-white hover:bg-yellow-50 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <Plus size={14} />
                          Add Lesson
                        </Button>
                      </div>
                    </div>

                    {/* Competency Body */}
                    {!isCollapsed && (
                      <div className="flex flex-col gap-3 p-4 bg-white">
                        {compLessons.length > 0 ? (
                          compLessons.map(renderLessonCard)
                        ) : (
                          <div className="flex items-center justify-between rounded-lg border-2 border-dashed border-black bg-[#FFFDF0] p-4">
                            <div className="flex items-center gap-2 text-xs font-bold text-black">
                              <BookOpen size={16} className="text-black" />
                              <span>No lessons assigned to this competency yet.</span>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openAddLessonForCompetency(comp.competency_id)}
                              className="border-2 border-black bg-white hover:bg-yellow-50 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            >
                              <Plus size={14} />
                              Create First Lesson
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Standalone / Unassigned Lessons Section */}
              {unassignedLessons.length > 0 && (
                <div className="flex flex-col rounded-lg border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden min-w-0 w-full">
                  {competencies.length > 0 ? (
                    <>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setIsUnassignedExpanded((prev) => !prev)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            setIsUnassignedExpanded((prev) => !prev);
                        }}
                        className="flex items-center justify-between border-b-2 border-black bg-[#F6E9B2] px-4 py-3.5 text-left cursor-pointer group min-w-0 w-full"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="rounded border-2 border-black bg-white p-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-yellow-50 transition-colors shrink-0">
                            {isUnassignedExpanded ? <ChevronDown size={16} className="text-black" /> : <ChevronRight size={16} className="text-black" />}
                          </div>
                          <BookOpen size={18} className="text-black shrink-0" />
                          <h4 className="text-sm md:text-base font-bold text-black">
                            Unassigned Lessons
                          </h4>
                          <Badge
                            variant="secondary"
                            size="sm"
                            className="border-2 border-black bg-white text-black text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] shrink-0"
                          >
                            {unassignedLessons.length} to assign
                          </Badge>
                        </div>
                      </div>

                      {isUnassignedExpanded && (
                        <div className="flex flex-col gap-3 p-4 bg-white min-w-0 w-full">
                          {unassignedLessons.map(renderLessonCard)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex flex-col gap-3 p-4 bg-white min-w-0 w-full">
                      {unassignedLessons.map(renderLessonCard)}
                    </div>
                  )}
                </div>
              )}

              {/* Empty state when no competencies and no lessons */}
              {competencies.length === 0 && unassignedLessons.length === 0 && (
                <Card className="block w-full border-2 border-black bg-white p-8 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
                    <Award size={40} className="text-gray-400" />
                    <Card.Title className="text-2xl font-bold text-black">
                      No Competencies or Lessons Yet
                    </Card.Title>
                    <p className="font-semibold text-xs text-gray-600 max-w-md">
                      Get started by creating a Learning Competency for this subject or adding a lesson directly.
                    </p>
                    {selectedSubjectId && (
                      <div className="flex gap-2 mt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingCompetency(null);
                            setIsCompetencyModalOpen(true);
                          }}
                          className="border-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <Award size={16} />
                          Add Competency
                        </Button>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => openAddLessonForCompetency(undefined)}
                          className="border-2 border-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <Plus size={16} />
                          Add Lesson
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Competency Modal ── */}
      {isCompetencyModalOpen && selectedSubjectId && (
        <CompetencyModal
          open={isCompetencyModalOpen}
          onOpenChange={setIsCompetencyModalOpen}
          subjectId={selectedSubjectId}
          initialData={editingCompetency}
          onSuccess={async () => {
            await loadLessonsAndCompetencies();
          }}
        />
      )}

      {/* ── Create Lesson Modal ── */}
      {isCreatingLesson && (
        <CreateLessonModal
          classId={detail.class_id ? String(detail.class_id) : undefined}
          subjectId={selectedSubjectId ? String(selectedSubjectId) : undefined}
          initialCompetencyId={selectedCompetencyIdForNewLesson}
          onClose={() => {
            setIsCreatingLesson(false);
            setSelectedCompetencyIdForNewLesson(undefined);
          }}
          onCreated={async () => {
            setIsCreatingLesson(false);
            setSelectedCompetencyIdForNewLesson(undefined);
            await loadLessonsAndCompetencies();
          }}
        />
      )}
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
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h3 className="text-xl font-bold">Students</h3>
          <Input
            className="w-[400px]!"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search students"
          />
        </div>
        <Card className="block w-full border-black">
          <Card.Content >
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
                    <summary className="flex cursor-pointer list-none items-center justify-between bg-primary px-4 py-3 text-base font-black">
                      <span>{gender}</span>
                      <span className="flex items-center gap-3">
                        <Badge
                          variant="outline"
                          size="sm"
                        >
                          {students.length} student
                          {students.length !== 1 ? "s" : ""}
                        </Badge>
                        <ChevronRight className="size-4 transition-transform duration-200 group-open:rotate-90" />
                      </span>
                    </summary>
                    <Table
                      wrapperClassName="overflow-visible h-auto"
                      className="w-full border-0 shadow-none"
                    >
                      <Table.Body>
                        {students.map((student) => (
                          <StudentRow
                            key={student.student_id}
                            student={student}
                            classId={detail.class_id}
                            subjectLoads={detail.subject_loads}
                          />
                        ))}
                      </Table.Body>
                    </Table>
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
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SuggestionResponse[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await getTeacherSuggestions({
        classId,
        studentId: student.student_id,
      });
      setHistory(data.suggestions);
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Unable to load suggestions.",
      );
    } finally {
      setIsHistoryLoading(false);
    }
  }, [classId, student.student_id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function updateSuggestion(
    id: number,
    action: "approve" | "dismiss" | "archive",
  ) {
    setHistoryError("");
    try {
      if (action === "approve") await approveSuggestion(id);
      else if (action === "dismiss") await dismissSuggestion(id);
      else await archiveSuggestion(id);
      await loadHistory();
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Unable to update suggestion.",
      );
    }
  }

  const activeCount = history.filter((item) => item.status === "ACTIVE").length;
  const draftCount = history.filter((item) => item.status === "DRAFT").length;

  return (
    <>
      <Table.Row className="border-b-2 border-black bg-white transition-colors">
        {/* Column 1: Student Details */}
        <Table.Cell className="py-2.5 px-4">
          <div className="flex items-center gap-3">
            <Avatar variant="student" className="size-10 shrink-0">
              <Avatar.Image
                src="/avatars/student-avatars/1.svg"
                alt={student.full_name}
              />
              <Avatar.Fallback>
                {(student.avatar_initial || student.full_name || "?")
                  .charAt(0)
                  .toUpperCase()}
              </Avatar.Fallback>
            </Avatar>
            <div className="min-w-0">
              <span className="block text-base font-semibold truncate">
                {student.full_name}
              </span>
              {student.student_lrn && (
                <span className="text-xs font-semibold text-muted-foreground">
                  {student.student_lrn}
                </span>
              )}
            </div>
          </div>
        </Table.Cell>

        {/* Column 2: Suggestion Status */}
        <Table.Cell className="py-2.5 px-4">
          {isHistoryLoading ? (
            <span className="text-xs text-black/50">Loading...</span>
          ) : activeCount > 0 || draftCount > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeCount > 0 && (
                <Badge
                  variant="solid"
                  size="sm"
                  className="border border-black bg-[#79bd80] font-bold text-black text-[11px]"
                >
                  {activeCount} Active
                </Badge>
              )}
              {draftCount > 0 && (
                <Badge
                  variant="outline"
                  size="sm"
                  className="border border-black bg-amber-100 font-bold text-amber-900 text-[11px]"
                >
                  {draftCount} Draft{draftCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          ) : (
            <span className="text-xs font-semibold text-black/40">
              No active suggestions
            </span>
          )}
        </Table.Cell>

        {/* Column 3: Action */}
        <Table.Cell className="py-2.5 px-4 text-right">
          <div className="flex items-center justify-end gap-2">
            {history.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowHistory((prev) => !prev)}
                className="gap-2"
              >
                {showHistory ? (
                  <>
                    <ChevronUp size={13} />
                    Hide History
                  </>
                ) : (
                  <>
                    <ChevronDown size={13} />
                    History ({history.length})
                  </>
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="gap-2"
            >
              <Lightbulb size={13} />
              Suggest Material
            </Button>
          </div>
        </Table.Cell>
      </Table.Row>

      {showHistory && (
        <Table.Row className="border-b-2 border-black bg-[#fffdf5]/60 hover:bg-[#fffdf5]/80">
          <Table.Cell colSpan={3} className="p-3">
            <Card className="block w-full border-black bg-white p-3 shadow-none transition-none hover:shadow-none">
              <h4 className="mb-2 text-sm font-black">
                Suggestion History for {student.full_name}
              </h4>
              {historyError && (
                <Alert status="error" className="mb-2 text-xs">
                  {historyError}
                </Alert>
              )}
              {isHistoryLoading ? (
                <p className="text-xs font-semibold text-black/60">
                  Loading suggestions...
                </p>
              ) : history.length ? (
                <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                  {history.map((item) => (
                    <Card
                      key={item.student_suggestion_id}
                      className="block w-full border-black bg-[#fffdf5] p-2.5 text-xs shadow-none transition-none hover:shadow-none"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-black">{item.title}</p>
                          <p className="font-semibold text-black/60">
                            {item.resource.title}
                          </p>
                        </div>
                        <span className="border border-black bg-white px-2 py-0.5 font-black text-[10px]">
                          {item.status}
                        </span>
                      </div>
                      {item.description && (
                        <p className="mt-1 text-black/70">{item.description}</p>
                      )}
                      {item.source_metrics ? (
                        <div className="mt-2 border border-black bg-white px-2 py-1 text-[11px] font-semibold text-black/70">
                          <p>
                            Reason:{" "}
                            {String(
                              item.source_metrics.source_title ?? "Low result",
                            )}
                          </p>
                          <p>
                            Score:{" "}
                            {String(item.source_metrics.score_percent ?? "?")}%
                            {item.source_metrics.threshold_percent
                              ? ` below ${String(item.source_metrics.threshold_percent)}% threshold`
                              : ""}
                          </p>
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.status === "DRAFT" && (
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={() =>
                              updateSuggestion(
                                item.student_suggestion_id,
                                "approve",
                              )
                            }
                            className="gap-1 border-black bg-[#79bd80] px-2 py-1 font-bold shadow-none hover:bg-[#79bd80]"
                          >
                            <CheckCircle2 size={12} />
                            Approve
                          </Button>
                        )}
                        {item.status === "ACTIVE" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              updateSuggestion(
                                item.student_suggestion_id,
                                "dismiss",
                              )
                            }
                            className="gap-1 border-black px-2 py-1 font-bold shadow-none"
                          >
                            <X size={12} />
                            Dismiss
                          </Button>
                        )}
                        {(item.status === "COMPLETED" ||
                          item.status === "DISMISSED") && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                updateSuggestion(
                                  item.student_suggestion_id,
                                  "archive",
                                )
                              }
                              className="gap-1 border-black px-2 py-1 font-bold shadow-none"
                            >
                              <Archive size={12} />
                              Archive
                            </Button>
                          )}
                        {item.status === "COMPLETED" && (
                          <span className="inline-flex items-center gap-1 font-bold text-green-700">
                            <CheckCircle2 size={12} />
                            Completed by student
                          </span>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-semibold text-black/60">
                  No suggestions yet.
                </p>
              )}
            </Card>
          </Table.Cell>
        </Table.Row>
      )}

      <SuggestionPanel
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        classId={classId}
        student={student}
        subjectLoads={subjectLoads}
        onSuccess={loadHistory}
      />
    </>
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
