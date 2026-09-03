import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpDown,
  Award,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Filter,
  Lightbulb,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Text } from "@/components/retroui/Text";
import { Select } from "@/components/retroui/Select";
import { OverviewCard } from "@/components/overview-cards";
import { Table } from "@/components/retroui/Table";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Avatar } from "@/components/retroui/Avatar";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";

import CompetencyModal from "./subject-details/CompetencyModal";
import CreateLessonModal from "@/pages/teacher/create-lesson";
import ClassworkCard from "../classworks/classwork-card";
import ClassworkView from "../classwork-view";
import CreateClassworkModal from "../forms/create-classwork";
import CreateClassworkQuizModal from "../forms/create-classwork-quiz";
import { isQuizType } from "@/lib/classwork-utils";
import type {
  ClassworkKind,
  SortMode,
  TabId,
  TeacherClassLoad,
  TeacherClasswork,
} from "@/types/classwork";
import ClassworkFormModal from "./subject-details/ClassworkFormModal";
import TeacherLessonDetailScreen from "./subject-details/TeacherLessonDetailScreen";
import TeacherCompetencyDetailScreen from "./subject-details/TeacherCompetencyDetailScreen";
import { StudentRecordDetail } from "./subject-details/StudentRecordsPanel";
import {
  getTeacherRecordPeriods,
  getTeacherStudentRecordDetail,
  type StudentRecordDetailResponse,
  type StudentRecordPeriodOption,
} from "@/lib/student-record-api";
import {
  emptyClassworkDraft,
  allowedMaterialExtensions,
  maxMaterialSize,
} from "./subject-details/constants";
import type {
  ClassworkDetail,
  ClassworkDraft,
  CompetencyItem,
  LessonDraft,
} from "./subject-details/types";

import { SuggestionPanel } from "@/components/teacher/suggestions/suggestion-panel-modal";
import { API_URL, apiFetch, getTeacherAdvisoryClassDetail } from "@/lib/api";
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
  total_points?: number | null;
  attachment_count?: number;
  is_published?: boolean;
  is_locked?: boolean;
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
  const { classId, subjectId: paramSubjectId } = useParams<{
    classId: string;
    subjectId?: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<DetailTab>("lessons");
  const [detail, setDetail] =
    useState<TeacherAdvisoryClassDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const initialSubjectId =
    paramSubjectId ? Number(paramSubjectId) : searchParams.get("subjectId")
      ? Number(searchParams.get("subjectId"))
      : null;

  const currentSubject = useMemo(() => {
    return (
      detail?.subject_loads.find((l) => l.subject_id === initialSubjectId) ||
      detail?.subject_loads[0] ||
      null
    );
  }, [detail?.subject_loads, initialSubjectId]);

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
        <div className="@container/main flex min-w-0 max-w-full flex-1 flex-col">
          <div className="flex min-w-0 max-w-full flex-1 flex-col">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-background py-4 px-4 md:px-6 min-w-0">
              <div className="flex items-center gap-3 min-w-0">
                <SidebarTrigger className="md:hidden" />
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
                      <Breadcrumb.Link
                        onClick={() => navigate("/teacher/classes")}
                        className="cursor-pointer"
                      >
                        {detail.section_name}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    {currentSubject && (
                      <>
                        <Breadcrumb.Separator />
                        <Breadcrumb.Item>
                          <Breadcrumb.Page>
                            {currentSubject.subject_name}
                          </Breadcrumb.Page>
                        </Breadcrumb.Item>
                      </>
                    )}
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
            <div className="px-4 md:px-6 bg-background -mt-[1px]">
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
            </div>

            <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">

            <Card className="block w-full border-black bg-primary transition-none hover:shadow-md">
              <Card.Content>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Card.Title className="mb-0 text-2xl sm:text-3xl font-extrabold">
                      {currentSubject?.subject_name || detail.section_name}
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
                <p className="text-sm font-semibold text-gray-900 mt-1">
                  Section: {detail.section_name} • {detail.academic_level} - {detail.academic_year} | Active
                  since {activeSince}
                </p>
              </Card.Content>
            </Card>

            {tab === "lessons" && (
              <OverviewTab
                detail={detail}
                initialSubjectId={initialSubjectId}
              />
            )}
            {tab === "students" && (
              <StudentsTab
                detail={detail}
                subjectId={currentSubject?.subject_id || initialSubjectId}
              />
            )}
            {tab === "classwork" && (
              <ClassworkTab
                detail={detail}
                subjectId={currentSubject?.subject_id || initialSubjectId}
              />
            )}
          </div>
        </div>
      </div>
      </div>
    </AppLayout>
  );
}

function OverviewTab({
  detail,
  initialSubjectId,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
  initialSubjectId?: number | null;
}) {
  const navigate = useNavigate();
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    initialSubjectId || detail.subject_loads[0]?.subject_id || null,
  );
  const [competencies, setCompetencies] = useState<CompetencyItem[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);
  const [isLoadingLessons, setIsLoadingLessons] = useState(false);
  const [lessonsError, setLessonsError] = useState("");
  const [expandedLessonId, setExpandedLessonId] = useState<number | null>(null);
  const [linkedClassworks, setLinkedClassworks] = useState<
    Record<number, LinkedClassworkItem[]>
  >({});
  const [loadingClassworkId, setLoadingClassworkId] = useState<number | null>(
    null,
  );
  const [lessonSearch, setLessonSearch] = useState("");
  const [lessonSort, setLessonSort] = useState<
    "order" | "newest" | "oldest" | "title"
  >("order");
  const [collapsedCompetencies, setCollapsedCompetencies] = useState<
    Record<number, boolean>
  >({});
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(true);

  // Drill-down states
  const [activeCompetency, setActiveCompetency] =
    useState<CompetencyItem | null>(null);
  const [activeLessonDetail, setActiveLessonDetail] =
    useState<LessonItem | null>(null);

  // Modals state
  const [isCompetencyModalOpen, setIsCompetencyModalOpen] = useState(false);
  const [editingCompetency, setEditingCompetency] =
    useState<CompetencyItem | null>(null);
  const [isCreatingLesson, setIsCreatingLesson] = useState(false);
  const [selectedCompetencyIdForNewLesson, setSelectedCompetencyIdForNewLesson] =
    useState<number | undefined>(undefined);

  // Classwork Detail Dialog state (reused from Image 2)
  const [selectedClasswork, setSelectedClasswork] =
    useState<ClassworkDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");

  // Classwork Form Modal state
  const [classworkLesson, setClassworkLesson] = useState<LessonItem | null>(
    null,
  );
  const [classworkDraft, setClassworkDraft] =
    useState<ClassworkDraft>(emptyClassworkDraft);
  const [classworkMaterials, setClassworkMaterials] = useState<File[]>([]);
  const [isCreatingClasswork, setIsCreatingClasswork] = useState(false);

  // Lesson Management Modal state
  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);
  const [lessonDraft, setLessonDraft] = useState<LessonDraft | null>(null);
  const [isSavingLesson, setIsSavingLesson] = useState(false);
  const [isArchivingLesson, setIsArchivingLesson] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const currentSubjectLoad = useMemo(() => {
    return (
      detail.subject_loads.find((l) => l.subject_id === selectedSubjectId) ||
      detail.subject_loads[0] ||
      null
    );
  }, [detail.subject_loads, selectedSubjectId]);

  useEffect(() => {
    if (initialSubjectId) {
      setSelectedSubjectId(initialSubjectId);
    } else if (!selectedSubjectId && detail.subject_loads.length > 0) {
      setSelectedSubjectId(detail.subject_loads[0].subject_id);
    }
  }, [detail.subject_loads, initialSubjectId, selectedSubjectId]);

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
        const validLessons = data.filter((l) => !l.is_archived);
        setLessons(validLessons);

        // Fetch linked classworks for all lessons upfront
        try {
          const cwPromises = validLessons.map(async (l) => {
            try {
              const res = await apiFetch(
                `/api/v1/lessons/my-class/${detail.class_id}/lesson/${l.lesson_id}/linked-classwork`,
              );
              if (res.ok) {
                const cwList = (await res.json()) as LinkedClassworkItem[];
                return { lessonId: l.lesson_id, classworks: cwList };
              }
            } catch {
              // ignore error
            }
            return { lessonId: l.lesson_id, classworks: [] };
          });
          const cwResults = await Promise.all(cwPromises);
          const map: Record<number, LinkedClassworkItem[]> = {};
          cwResults.forEach(({ lessonId, classworks }) => {
            map[lessonId] = classworks;
          });
          setLinkedClassworks(map);
        } catch {
          // ignore
        }
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

  const openCompetencyForm = (comp?: CompetencyItem | null) => {
    setEditingCompetency(comp || null);
    setIsCompetencyModalOpen(true);
  };

  const handleCompetencySaved = (savedComp?: CompetencyItem) => {
    if (savedComp) {
      setCompetencies((prev) => {
        const idx = prev.findIndex(
          (c) => c.competency_id === savedComp.competency_id,
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = savedComp;
          return next;
        }
        return [...prev, savedComp];
      });
      if (
        activeCompetency &&
        activeCompetency.competency_id === savedComp.competency_id
      ) {
        setActiveCompetency(savedComp);
      }
    }
    void loadLessonsAndCompetencies();
  };

  const handleArchiveCompetency = async (competencyId: number) => {
    if (
      !window.confirm(
        "Are you sure you want to archive this learning competency? Any attached lessons will become standalone.",
      )
    )
      return;
    try {
      const res = await apiFetch(`/api/v1/competencies/${competencyId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setCompetencies((prev) =>
          prev.filter((c) => c.competency_id !== competencyId),
        );
        if (
          activeCompetency &&
          activeCompetency.competency_id === competencyId
        ) {
          setActiveCompetency(null);
        }
      }
    } catch {
      alert("Failed to archive competency.");
    }
  };

  const openAddLessonForCompetency = (compId?: number) => {
    setSelectedCompetencyIdForNewLesson(compId);
    setIsCreatingLesson(true);
  };

  // Classwork Detail Dialog opener (reused from Image 2)
  const openClassworkDetail = async (cw: LinkedClassworkItem) => {
    setDetailLoadingId(cw.classwork_id);
    setDetailError("");
    try {
      const res = await apiFetch(`/api/v1/classworks/${cw.classwork_id}`);
      if (res.ok) {
        const fullDetail = (await res.json()) as ClassworkDetail;
        setSelectedClasswork(fullDetail);
      } else {
        setSelectedClasswork({
          classwork_assignment_id: cw.classwork_assignment_id,
          classwork_id: cw.classwork_id,
          class_id: detail.class_id,
          section_name: detail.section_name,
          title: cw.title,
          classwork_type: cw.classwork_type,
          classwork_category: cw.classwork_category,
          due_date: cw.due_date,
          total_points: cw.total_points,
          is_published: cw.is_published ?? true,
          show_scores: true,
          attachments: [],
        });
      }
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Unable to load classwork details.",
      );
    } finally {
      setDetailLoadingId(null);
    }
  };

  const closeClassworkDetail = () => {
    setSelectedClasswork(null);
    setDetailError("");
    setDetailLoadingId(null);
  };

  // Classwork Form Modal Handlers
  const openClassworkForm = (lesson: LessonItem) => {
    setClassworkLesson(lesson);
    setClassworkDraft(emptyClassworkDraft);
    setClassworkMaterials([]);
  };

  const closeClassworkForm = () => {
    setClassworkLesson(null);
    setClassworkDraft(emptyClassworkDraft);
    setClassworkMaterials([]);
  };

  const addClassworkMaterials = (files: FileList | null) => {
    if (!files) return;
    const nextFiles = Array.from(files).filter((file) => {
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      return allowedMaterialExtensions.includes(ext) && file.size <= maxMaterialSize;
    });
    setClassworkMaterials((prev) => [...prev, ...nextFiles]);
  };

  const removeClassworkMaterial = (index: number) => {
    setClassworkMaterials((prev) => prev.filter((_, idx) => idx !== index));
  };

  const createClassworkForLesson = async () => {
    if (!classworkLesson || !selectedSubjectId) return;
    setIsCreatingClasswork(true);
    try {
      const payload = {
        title: classworkDraft.title,
        description: classworkDraft.description,
        instructions: classworkDraft.instructions,
        classwork_type: classworkDraft.classwork_type,
        classwork_category: classworkDraft.classwork_category,
        total_points: Number(classworkDraft.total_points) || 100,
        due_date: classworkDraft.due_date ? new Date(classworkDraft.due_date).toISOString() : null,
        allow_late_submissions: classworkDraft.allow_late_submissions,
        is_published: classworkDraft.is_published,
        show_scores: classworkDraft.show_scores,
        subject_id: selectedSubjectId,
        lesson_id: classworkLesson.lesson_id,
        class_ids: [detail.class_id],
      };

      const res = await apiFetch("/api/v1/classworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        closeClassworkForm();
        // Refresh linked classworks for this lesson
        setLinkedClassworks((prev) => {
          const next = { ...prev };
          delete next[classworkLesson.lesson_id];
          return next;
        });
        await toggleLesson(classworkLesson.lesson_id);
      }
    } catch {
      alert("Failed to create classwork.");
    } finally {
      setIsCreatingClasswork(false);
    }
  };

  // Lesson Management Modal Handlers
  const openLessonManager = (lesson: LessonItem) => {
    setSelectedLesson(lesson);
    setLessonDraft({
      title: lesson.title,
      description: lesson.description || "",
      content: lesson.content || "",
      order_index: String(lesson.order_index || 1),
      is_published: lesson.is_published,
      show_scores: lesson.show_scores,
      competency_id: lesson.competency_id,
    });
  };

  const closeLessonManager = () => {
    setSelectedLesson(null);
    setLessonDraft(null);
    setShowArchiveConfirm(false);
  };

  const saveLessonDetails = async () => {
    if (!selectedLesson || !lessonDraft) return;
    setIsSavingLesson(true);
    try {
      const res = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: lessonDraft.title,
          description: lessonDraft.description,
          content: lessonDraft.content,
          order_index: Number(lessonDraft.order_index) || 1,
          is_published: lessonDraft.is_published,
          show_scores: lessonDraft.show_scores,
          competency_id: lessonDraft.competency_id,
        }),
      });
      if (res.ok) {
        closeLessonManager();
        await loadLessonsAndCompetencies();
      }
    } catch {
      alert("Failed to save lesson.");
    } finally {
      setIsSavingLesson(false);
    }
  };

  const archiveLesson = async () => {
    if (!selectedLesson) return;
    setIsArchivingLesson(true);
    try {
      const res = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        closeLessonManager();
        if (activeLessonDetail?.lesson_id === selectedLesson.lesson_id) {
          setActiveLessonDetail(null);
        }
        await loadLessonsAndCompetencies();
      }
    } catch {
      alert("Failed to archive lesson.");
    } finally {
      setIsArchivingLesson(false);
    }
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
        {/* Lesson Card */}
        <Card
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => toggleLesson(lesson.lesson_id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleLesson(lesson.lesson_id);
            }
          }}
          title={isExpanded ? "Collapse classworks" : "Expand classworks"}
          className="block w-full min-w-0 cursor-pointer border-black bg-primary p-4 transition-none hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-1.5 min-w-0">
                <Card.Title className="text-base font-bold text-black sm:text-lg break-words line-clamp-2">
                  {lesson.title}
                </Card.Title>
                <Badge
                  variant="outline"
                  size="sm"
                  className="shrink-0 border border-black bg-white text-xs font-bold text-black"
                >
                  {lesson.is_published ? "Published" : "Draft"}
                </Badge>
                {lesson.attachments && lesson.attachments.length > 0 && (
                  <Badge
                    size="sm"
                    className="shrink-0 gap-1 border border-black bg-white text-xs font-bold text-black"
                  >
                    <Paperclip size={10} />
                    {lesson.attachments.length} material
                    {lesson.attachments.length === 1 ? "" : "s"}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  size="sm"
                  className="shrink-0 border border-black bg-white text-xs font-bold text-black"
                >
                  {classworks.length} classwork{classworks.length === 1 ? "" : "s"}
                </Badge>
              </div>
              <p className="text-xs font-medium text-gray-800 break-words line-clamp-2">
                {lesson.description || lesson.content || "Lesson folder"}
              </p>
            </div>

          </div>
        </Card>

        {/* Expanded linked classworks (White Card with Yellow Badges) */}
        {isExpanded && (
          <div className="ml-4 pl-3 border-l-2 border-black space-y-2 py-1 min-w-0">
            {isLoadingCw ? (
              <LoadingPanel label="Loading classworks..." />
            ) : classworks.length === 0 ? (
              <Card className="block w-full border-dashed border-black/40 bg-white p-3 text-xs font-medium text-gray-500 transition-none hover:shadow-md">
                <span>No classworks assigned to this lesson yet.</span>
              </Card>
            ) : (
              classworks.map((cw) => (
                <Card
                  key={cw.classwork_assignment_id}
                  onClick={() => openClassworkDetail(cw)}
                  className="group flex min-w-0 w-full cursor-pointer items-center justify-between gap-3 border-black bg-white p-3.5 transition-none hover:shadow-md"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 text-black">
                      <ClassworkIcon type={cw.classwork_type} size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate text-black group-hover:underline">
                        {cw.title}
                      </p>
                      <p className="text-[11px] text-gray-600 font-bold uppercase tracking-wider">
                        {cw.classwork_type || "Classwork"}
                        {cw.due_date
                          ? ` • Due ${new Date(cw.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                          : " • No due date"}
                        {cw.total_points !== null && cw.total_points !== undefined
                          ? ` • ${cw.total_points} pts`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cw.classwork_category && (
                      <Badge
                        variant="secondary"
                        size="sm"
                        className="rounded-none border-2 border-black bg-primary text-[11px] font-black uppercase text-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                      >
                        {cw.classwork_category.replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                </Card>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4 min-w-0">
      {activeLessonDetail ? (
        /* ── State 1: Full-Screen Lesson Detail View ── */
        <TeacherLessonDetailScreen
          lesson={activeLessonDetail as any}
          subjectName={currentSubjectLoad?.subject_name || "Subject"}
          closeLessonDetail={() => setActiveLessonDetail(null)}
          openLessonManager={(l) => openLessonManager(l as any)}
          openClassworkForm={(l) => openClassworkForm(l as any)}
          openClassworkDetail={(cw) => openClassworkDetail(cw as any)}
          linkedClassworks={
            (linkedClassworks[activeLessonDetail.lesson_id] || []) as any
          }
          isLoadingClasswork={
            loadingClassworkId === activeLessonDetail.lesson_id
          }
        />
      ) : activeCompetency ? (
        /* ── State 2: Full-Screen Competency Detail View with Back Button ── */
        <TeacherCompetencyDetailScreen
          competency={activeCompetency}
          lessons={lessons.filter(
            (l) => l.competency_id === activeCompetency.competency_id,
          )}
          linkedClassworks={linkedClassworks}
          loadingClassworkId={loadingClassworkId}
          expandedLessonId={expandedLessonId}
          toggleLesson={toggleLesson}
          onBack={() => setActiveCompetency(null)}
          onAddLesson={(compId) => openAddLessonForCompetency(compId)}
          onEditCompetency={(comp) => openCompetencyForm(comp)}
          onArchiveCompetency={handleArchiveCompetency}
          onOpenClassworkForm={(l) => openClassworkForm(l as any)}
          onOpenClassworkDetail={(cw) => openClassworkDetail(cw as any)}
          onOpenLessonDetail={(l) => setActiveLessonDetail(l as any)}
          onOpenLessonManager={(l) => openLessonManager(l as any)}
        />
      ) : (
        /* ── State 3: Default All-Competencies Overview (Image 1 Layout) ── */
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:grid-rows-[auto_1fr] items-stretch min-w-0">
          <div className="flex flex-col gap-2 min-w-0">
            <h3 className="text-xl font-semibold">Overview</h3>
            <div className="grid gap-4 md:grid-cols-3 min-w-0">
              <OverviewCard
                title="Total Students"
                count={String(detail.student_count ?? 0)}
                statDescription="Assigned to section"
              />
              <OverviewCard
                title="Total Lessons"
                count={String(lessons.length)}
                statDescription="In this subject"
              />
              <OverviewCard
                title="Total Subjects"
                count={String(detail.subject_count ?? 0)}
                statDescription="Active subject loads"
              />
            </div>
          </div>

          {/* Weekly Goals Sidebar Progress (Preserved from Image 1) */}
          <aside className="flex flex-col gap-2 min-w-0 xl:row-span-2">
            <LessonGoalProgress
              sortedGoalLessons={lessons as any}
              classworksByLesson={linkedClassworks as any}
              className="w-full flex-1 min-w-0"
            />
          </aside>

          {/* Main Content Area */}
          <section className="flex flex-col gap-4 min-w-0">
            <div className="flex flex-col gap-4 min-w-0">
              <div className="flex flex-col gap-3 min-w-0">
                {/* Header toolbar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap min-w-0">
                  <div className="flex items-center gap-2">
                    <Text as="h3" className="text-xl font-semibold">
                      Lessons & Competencies
                    </Text>
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

                  <div className="flex items-center gap-2 flex-wrap">
                    <Select
                      value={lessonSort}
                      onValueChange={(v) =>
                        setLessonSort(
                          v as "order" | "newest" | "oldest" | "title",
                        )
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

                    {(selectedSubjectId || currentSubjectLoad?.subject_id || detail.subject_loads[0]?.subject_id) && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const targetId =
                            selectedSubjectId ||
                            currentSubjectLoad?.subject_id ||
                            detail.subject_loads[0]?.subject_id;
                          if (targetId) {
                            navigate(
                              `/teacher/classes/${detail.class_id}/subjects/${targetId}`,
                            );
                          }
                        }}
                        className="h-10 gap-1.5 border-black bg-primary text-black text-sm font-bold whitespace-nowrap"
                        title="Go to Subject View"
                      >
                        <BookOpen size={16} />
                        Subject View
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Lessons List with Competencies Hierarchy */}
              {isLoadingLessons ? (
                <LoadingPanel label="Loading lessons..." />
              ) : lessonsError ? (
                <div className="rounded border-2 border-red-300 bg-red-50 p-4 text-sm text-red-700 font-medium">
                  {lessonsError}
                </div>
              ) : (
                <div className="space-y-4 min-w-0">
                  {/* Render Competency Accordions */}
                  {competencies.map((comp) => {
                    const compLessons =
                      lessonsByCompetency.get(comp.competency_id) || [];
                    const isCollapsed =
                      collapsedCompetencies[comp.competency_id] ?? true;

                    if (lessonSearch.trim()) {
                      const query = lessonSearch.toLowerCase();
                      const matches =
                        comp.statement.toLowerCase().includes(query) ||
                        (comp.competency_code &&
                          comp.competency_code.toLowerCase().includes(query));
                      if (!matches && compLessons.length === 0) return null;
                    }

                    return (
                      <Card
                        key={comp.competency_id}
                        className="flex w-full min-w-0 flex-col overflow-hidden border-black bg-white p-0 transition-none hover:shadow-md"
                      >
                        {/* Competency Header Bar */}
                        <Card.Header className="mb-0 flex-row items-center justify-between gap-3 border-b-2 border-black bg-primary px-4 py-3.5">
                          <div
                            role="button"
                            tabIndex={0}
                            aria-expanded={!isCollapsed}
                            onClick={() => toggleCompetencyCollapse(comp.competency_id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleCompetencyCollapse(comp.competency_id);
                              }
                            }}
                            className="min-w-0 flex-1 cursor-pointer text-left select-none"
                            title={isCollapsed ? "Expand competency" : "Collapse competency"}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-2 min-w-0">
                                <Award
                                  size={20}
                                  className="text-black shrink-0"
                                />
                                <Card.Title className="text-base font-bold text-gray-950 sm:text-lg md:text-xl break-words line-clamp-2">
                                  {comp.competency_code || comp.statement}
                                </Card.Title>
                                <Badge
                                  variant="secondary"
                                  size="sm"
                                  className="shrink-0 border border-black bg-white text-xs font-bold text-black"
                                >
                                  {compLessons.length} lesson
                                  {compLessons.length === 1 ? "" : "s"}
                                </Badge>
                                {(comp.target_hours || 0) > 0 && (
                                  <Badge
                                    variant="secondary"
                                    size="sm"
                                    className="shrink-0 border border-black bg-white text-xs font-bold text-black"
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
                        </Card.Header>

                        {/* Competency Body when expanded */}
                        {!isCollapsed && (
                          <Card.Content className="flex flex-col gap-3 bg-white p-4">
                            {compLessons.length > 0 ? (
                              compLessons.map(renderLessonCard)
                            ) : (
                              <div className="flex items-center justify-between rounded-lg border-2 border-dashed border-black bg-[#FFFDF0] p-4">
                                <div className="flex items-center gap-2 text-xs font-bold text-black">
                                  <BookOpen size={16} className="text-black" />
                                  <span>
                                    No lessons assigned to this competency yet.
                                  </span>
                                </div>
                              </div>
                            )}
                          </Card.Content>
                        )}
                      </Card>
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
                            onClick={() =>
                              setIsUnassignedExpanded((prev) => !prev)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ")
                                setIsUnassignedExpanded((prev) => !prev);
                            }}
                            className="flex items-center justify-between border-b-2 border-black bg-[#F6E9B2] px-4 py-3.5 text-left cursor-pointer group min-w-0 w-full"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="rounded border-2 border-black bg-white p-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-yellow-50 transition-colors shrink-0">
                                {isUnassignedExpanded ? (
                                  <ChevronDown
                                    size={16}
                                    className="text-black"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={16}
                                    className="text-black"
                                  />
                                )}
                              </div>
                              <BookOpen
                                size={18}
                                className="text-black shrink-0"
                              />
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
                  {competencies.length === 0 &&
                    unassignedLessons.length === 0 && (
                      <Card className="block w-full border-2 border-black bg-white px-6 py-12 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex flex-col items-center justify-center gap-3 text-gray-500">
                          <Award size={40} className="text-gray-400" />
                          <Card.Title className="text-base font-bold text-black">
                            No Competencies or Lessons Yet
                          </Card.Title>
                          <p className="max-w-md text-sm font-normal text-gray-500">
                            No learning competencies or lessons have been added
                            for this subject yet. Manage them in the Subject
                            View.
                          </p>
                          {(selectedSubjectId || currentSubjectLoad?.subject_id || detail.subject_loads[0]?.subject_id) && (
                            <div className="flex gap-2 mt-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const targetId =
                                    selectedSubjectId ||
                                    currentSubjectLoad?.subject_id ||
                                    detail.subject_loads[0]?.subject_id;
                                  if (targetId) {
                                    navigate(
                                      `/teacher/classes/${detail.class_id}/subjects/${targetId}`,
                                    );
                                  }
                                }}
                                className="border-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              >
                                <BookOpen size={14} className="mr-1.5" />
                                Go to Subject View
                              </Button>
                            </div>
                          )}
                        </div>
                      </Card>
                    )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── Reused Classwork Detail & Tracking Dialog (From Image 2) ── */}
      {(selectedClasswork || detailLoadingId || detailError) && (
        <Dialog
          open={Boolean(selectedClasswork || detailLoadingId || detailError)}
          onOpenChange={(open) => {
            if (!open) closeClassworkDetail();
          }}
        >
          <Dialog.Content
            size="4xl"
            className="no-scrollbar h-fit max-h-[90vh] !overflow-y-auto overflow-x-hidden border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
            overlay={{ className: "bg-black/50" }}
          >
            <Dialog.Header asChild className="border-black">
              <>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-black/70">
                    Teacher Classwork Detail
                  </p>
                  <p className="text-xl font-bold text-black">
                    {selectedClasswork?.title || "Classwork"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedClasswork && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/teacher/classworks?classworkId=${selectedClasswork.classwork_id}`,
                        )
                      }
                      className="border-2 border-black bg-white hover:bg-gray-50 font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-xs"
                    >
                      Click for more details
                    </Button>
                  )}
                  <Dialog.Close
                    title="Close"
                    className="cursor-pointer rounded p-1 hover:bg-white/60 transition-colors"
                  >
                    <X size={18} />
                  </Dialog.Close>
                </div>
              </>
            </Dialog.Header>

            {detailLoadingId ? (
              <div className="p-8 text-center text-sm font-semibold text-gray-600">
                Loading classwork details...
              </div>
            ) : detailError ? (
              <div className="m-5 border-2 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
                {detailError}
              </div>
            ) : selectedClasswork ? (
              <div className="grid gap-5 p-5 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4">
                  <Card className="block border-2 border-black">
                    <Card.Content className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="bg-[#7ABA78] text-xs font-bold border border-black text-black"
                        >
                          {selectedClasswork.classwork_type || "Classwork"}
                        </Badge>
                        {selectedClasswork.classwork_category && (
                          <Badge
                            variant="solid"
                            className="text-xs font-bold border border-black bg-[#F6E9B2] text-black"
                          >
                            {selectedClasswork.classwork_category.replace(
                              /_/g,
                              " ",
                            )}
                          </Badge>
                        )}
                        <Badge
                          variant="solid"
                          className="text-xs font-bold border border-black bg-white text-black"
                        >
                          {selectedClasswork.is_published
                            ? "Published"
                            : "Draft"}
                        </Badge>
                        {selectedClasswork.is_locked && (
                          <Badge className="rounded-none border-2 border-red-600 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                            Locked
                          </Badge>
                        )}
                      </div>

                      <Card.Title className="text-2xl font-bold">
                        {selectedClasswork.title}
                      </Card.Title>
                      <div className="grid gap-3 text-sm sm:grid-cols-3">
                        <div className="border-2 border-black bg-gray-50 p-3 rounded">
                          <p className="font-semibold text-gray-600 text-xs">
                            Due date
                          </p>
                          <p className="font-bold text-sm">
                            {selectedClasswork.due_date
                              ? new Date(
                                  selectedClasswork.due_date,
                                ).toLocaleString()
                              : "No due date"}
                          </p>
                        </div>
                        <div className="border-2 border-black bg-gray-50 p-3 rounded">
                          <p className="font-semibold text-gray-600 text-xs">
                            Points
                          </p>
                          <p className="font-bold text-sm">
                            {selectedClasswork.total_points ?? "Not set"}
                          </p>
                        </div>
                        <div className="border-2 border-black bg-gray-50 p-3 rounded">
                          <p className="font-semibold text-gray-600 text-xs">
                            Section
                          </p>
                          <p className="font-bold text-sm truncate">
                            {selectedClasswork.section_name ||
                              detail.section_name ||
                              "Class"}
                          </p>
                        </div>
                      </div>
                    </Card.Content>
                  </Card>

                  {(selectedClasswork.description ||
                    selectedClasswork.instructions) && (
                    <Card className="block border-2 border-black">
                      <Card.Content className="space-y-3">
                        {selectedClasswork.description && (
                          <div>
                            <Card.Title className="mb-1 font-bold text-sm">
                              Description
                            </Card.Title>
                            <p className="text-sm text-gray-800">
                              {selectedClasswork.description}
                            </p>
                          </div>
                        )}
                        {selectedClasswork.instructions && (
                          <div>
                            <Card.Title className="mb-1 font-bold text-sm">
                              Instructions
                            </Card.Title>
                            <p className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-3 border border-gray-200 rounded">
                              {selectedClasswork.instructions}
                            </p>
                          </div>
                        )}
                      </Card.Content>
                    </Card>
                  )}

                  {/* Reference Materials / Attachments */}
                  <Card className="block border-2 border-black">
                    <Card.Content className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Paperclip size={18} />
                        <Card.Title className="mb-0 text-base font-bold">
                          Reference Files
                        </Card.Title>
                        <Badge variant="outline" size="sm" className="font-bold">
                          {selectedClasswork.attachments?.length || 0}
                        </Badge>
                      </div>
                      {selectedClasswork.attachments &&
                      selectedClasswork.attachments.length > 0 ? (
                        <div className="space-y-2">
                          {selectedClasswork.attachments.map((file) => (
                            <div
                              key={file.classwork_attachment_id}
                              className="flex items-center justify-between border-2 border-black p-3 bg-gray-50 rounded"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText size={16} className="shrink-0" />
                                <span className="text-sm font-semibold truncate">
                                  {file.file_name}
                                </span>
                              </div>
                              <a
                                href={`${API_URL}/api/v1/classworks/attachments/${file.classwork_attachment_id}/download`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-bold text-blue-700 underline shrink-0 hover:text-blue-900"
                              >
                                Download
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-gray-500">
                          No reference files attached to this classwork.
                        </p>
                      )}
                    </Card.Content>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card className="block border-2 border-black bg-primary">
                    <Card.Content className="space-y-3">
                      <Card.Title className="text-lg font-bold">
                        Submissions & Grading
                      </Card.Title>
                      <p className="text-xs text-gray-800 leading-relaxed">
                        To view student submissions, grade written works, or review quiz results, click the button below.
                      </p>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() =>
                          navigate(
                            `/teacher/classworks?classworkId=${selectedClasswork.classwork_id}`,
                          )
                        }
                        className="w-full border-2 border-black bg-black text-white font-bold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-800"
                      >
                        Open Submissions Workspace
                      </Button>
                    </Card.Content>
                  </Card>
                </div>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog>
      )}

      {/* ── Classwork Form Modal ── */}
      {classworkLesson && (
        <ClassworkFormModal
          classworkLesson={classworkLesson as any}
          classworkDraft={classworkDraft}
          setClassworkDraft={setClassworkDraft}
          classworkMaterials={classworkMaterials}
          isCreatingClasswork={isCreatingClasswork}
          error={lessonsError}
          closeClassworkForm={closeClassworkForm}
          addClassworkMaterials={addClassworkMaterials}
          removeClassworkMaterial={removeClassworkMaterial}
          createClassworkForLesson={createClassworkForLesson}
        />
      )}

      {/* ── Lesson Management Dialog ── */}
      {selectedLesson && lessonDraft && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeLessonManager();
          }}
        >
          <Dialog.Content className="block w-full max-w-4xl border-2 border-black bg-white p-0 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] max-h-[92vh] overflow-y-auto">
            <Dialog.Header className="sticky top-0 z-10 border-black">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide">
                  Teacher lesson management
                </p>
                <h2 className="text-xl font-bold">{selectedLesson.title}</h2>
              </div>
              <Dialog.Close
                title="Close"
                className="cursor-pointer rounded p-1 hover:bg-white/60"
              >
                <X size={18} />
              </Dialog.Close>
            </Dialog.Header>

            <div className="flex flex-col gap-5 p-5">
              <div className="space-y-4">
                <Card className="block w-full border-2 border-black shadow-none">
                  <Card.Content className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
                      <div>
                        <label
                          htmlFor="manage-lesson-title"
                          className="mb-1 block text-sm font-semibold"
                        >
                          Lesson title
                        </label>
                        <Input
                          id="manage-lesson-title"
                          value={lessonDraft.title}
                          onChange={(event) =>
                            setLessonDraft((current) =>
                              current
                                ? { ...current, title: event.target.value }
                                : current,
                            )
                          }
                          disabled={isSavingLesson}
                          className="rounded-none border-2 border-black !shadow-none h-10 w-full"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="manage-lesson-order"
                          className="mb-1 block text-sm font-semibold"
                        >
                          Order
                        </label>
                        <Input
                          id="manage-lesson-order"
                          type="number"
                          min="1"
                          step="1"
                          value={lessonDraft.order_index}
                          onChange={(event) =>
                            setLessonDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    order_index: event.target.value,
                                  }
                                : current,
                            )
                          }
                          disabled={isSavingLesson}
                          className="rounded-none border-2 border-black !shadow-none h-10 w-full"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="manage-lesson-description"
                        className="mb-1 block text-sm font-semibold"
                      >
                        Description
                      </label>
                      <textarea
                        id="manage-lesson-description"
                        value={lessonDraft.description}
                        onChange={(event) =>
                          setLessonDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  description: event.target.value,
                                }
                              : current,
                          )
                        }
                        disabled={isSavingLesson}
                        className="min-h-20 w-full rounded-none border-2 border-black px-3 py-2 text-sm"
                        placeholder="Short lesson summary"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="manage-lesson-content"
                        className="mb-1 block text-sm font-semibold"
                      >
                        Lesson content
                      </label>
                      <textarea
                        id="manage-lesson-content"
                        value={lessonDraft.content}
                        onChange={(event) =>
                          setLessonDraft((current) =>
                            current
                              ? { ...current, content: event.target.value }
                              : current,
                          )
                        }
                        disabled={isSavingLesson}
                        className="min-h-40 w-full rounded-none border-2 border-black px-3 py-2 text-sm"
                        placeholder="Write the lesson notes or learning content."
                      />
                    </div>
                  </Card.Content>
                </Card>

                <div className="flex items-center justify-between border-t-2 border-black pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowArchiveConfirm(true)}
                    className="border-2 border-red-600 bg-red-50 text-red-700 font-bold hover:bg-red-100"
                  >
                    <Archive size={14} className="mr-1" />
                    Archive Lesson
                  </Button>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeLessonManager}
                      className="border-2 border-black font-bold"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      onClick={saveLessonDetails}
                      disabled={isSavingLesson}
                      className="border-2 border-black bg-[#79bd80] text-black font-bold hover:bg-[#68a966]"
                    >
                      {isSavingLesson ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog>
      )}

      {/* ── Archive Confirmation Modal ── */}
      {showArchiveConfirm && selectedLesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <Card className="block w-full max-w-md border-2 border-black">
            <div className="flex items-center justify-between border-b-2 border-black bg-red-100 px-5 py-3">
              <div className="flex items-center gap-2 text-red-800">
                <Archive size={18} />
                <Card.Title className="mb-0 text-base font-bold text-red-800">
                  Archive Lesson?
                </Card.Title>
              </div>
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={isArchivingLesson}
                className="rounded p-1 hover:bg-white/60 disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>
            <Card.Content className="space-y-3 p-4">
              <p className="text-sm font-medium">
                Are you sure you want to archive{" "}
                <span className="font-bold">"{selectedLesson.title}"</span>?
              </p>
              <p className="text-xs text-gray-600">
                This hides the lesson from the student view.
              </p>
            </Card.Content>
            <div className="flex justify-end gap-3 border-t-2 border-black px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={isArchivingLesson}
                className="border-2 border-black font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={archiveLesson}
                disabled={isArchivingLesson}
                className="border-2 border-black bg-red-600 font-bold text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-red-700"
              >
                {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Competency Create / Edit Modal ── */}
      {isCompetencyModalOpen && selectedSubjectId && (
        <CompetencyModal
          isOpen={isCompetencyModalOpen}
          subjectId={selectedSubjectId}
          editingCompetency={editingCompetency}
          onClose={() => {
            setIsCompetencyModalOpen(false);
            setEditingCompetency(null);
          }}
          onSuccess={handleCompetencySaved}
        />
      )}

      {/* ── Create Lesson Modal ── */}
      {isCreatingLesson && selectedSubjectId && (
        <CreateLessonModal
          classId={String(detail.class_id)}
          subjectId={String(selectedSubjectId)}
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
  subjectId,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
  subjectId?: number | null;
}) {
  const activeSubjectId =
    subjectId || detail.subject_loads[0]?.subject_id || null;

  const [search, setSearch] = useState("");
  const [selectedStudent, setSelectedStudent] =
    useState<TeacherAdvisoryStudentItem | null>(null);
  const [studentDetail, setStudentDetail] =
    useState<StudentRecordDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [periods, setPeriods] = useState<StudentRecordPeriodOption[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");

  useEffect(() => {
    if (!detail.class_id || !activeSubjectId) return;
    let isMounted = true;
    const loadPeriods = async () => {
      try {
        const data = await getTeacherRecordPeriods(
          detail.class_id,
          activeSubjectId,
        );
        if (!isMounted) return;
        setPeriods(data.periods);
        setSelectedPeriodId(
          String(
            data.default_academic_period_id ||
              data.periods[0]?.academic_period_id ||
              "",
          ),
        );
      } catch {
        // ignore
      }
    };
    void loadPeriods();
    return () => {
      isMounted = false;
    };
  }, [detail.class_id, activeSubjectId]);

  const loadStudentAnalytics = useCallback(
    async (student: TeacherAdvisoryStudentItem, periodId?: string) => {
      if (!detail.class_id || !activeSubjectId) return;
      setIsDetailLoading(true);
      setDetailError("");
      setStudentDetail(null);
      try {
        const data = await getTeacherStudentRecordDetail(
          detail.class_id,
          activeSubjectId,
          student.student_id,
          periodId || selectedPeriodId || undefined,
        );
        setStudentDetail(data);
      } catch (err) {
        setDetailError(
          err instanceof Error
            ? err.message
            : "Unable to load student analytics.",
        );
      } finally {
        setIsDetailLoading(false);
      }
    },
    [detail.class_id, activeSubjectId, selectedPeriodId],
  );

  const handleSelectStudent = (student: TeacherAdvisoryStudentItem) => {
    setSelectedStudent(student);
    void loadStudentAnalytics(student, selectedPeriodId);
  };

  const handlePeriodChange = (newPeriodId: string) => {
    setSelectedPeriodId(newPeriodId);
    if (selectedStudent) {
      void loadStudentAnalytics(selectedStudent, newPeriodId);
    }
  };

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

  if (selectedStudent) {
    return (
      <div className="flex flex-col gap-4 min-w-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedStudent(null);
              setStudentDetail(null);
            }}
            className="gap-2 border-2 border-black bg-white font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#F6E9B2]"
          >
            <ArrowLeft size={16} />
            Back to students
          </Button>

          {periods.length > 1 && (
            <Select
              value={selectedPeriodId}
              onValueChange={handlePeriodChange}
            >
              <Select.Trigger className="h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold min-w-[200px]">
                <Select.Value placeholder="Select period" />
              </Select.Trigger>
              <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                {periods.map((p) => (
                  <Select.Item
                    key={p.academic_period_id}
                    value={String(p.academic_period_id)}
                  >
                    {p.period_name} ({p.year_label})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          )}
        </div>

        {detailError && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
            {detailError}
          </div>
        )}

        {isDetailLoading || !studentDetail ? (
          <p className="py-12 text-center text-sm font-semibold text-gray-500">
            Loading student analytics...
          </p>
        ) : (
          <StudentRecordDetail
            detail={studentDetail}
            classId={detail.class_id}
            subjectLoads={detail.subject_loads as any}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2">
        <Text as="h3" className="text-xl font-semibold">
          Overview
        </Text>
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
          <Card.Content>
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
                        <Badge variant="outline" size="sm">
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
                            onSelectStudent={handleSelectStudent}
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

const classworkTabs: Array<TabItem<TabId>> = [
  { id: "all", label: "All", icon: ClipboardList },
  { id: "readings", label: "Readings", icon: BookOpen },
  { id: "activities", label: "Activities", icon: CheckSquare },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "quizzes", label: "Quizzes", icon: ClipboardList },
];

const classworkCreateOptions: Array<{
  type: ClassworkKind;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "READING",
    title: "Reading",
    description: "Create and publish class topics or resources for learners",
    icon: BookOpen,
  },
  {
    type: "QUIZ",
    title: "Quiz",
    description: "Build and assign quizzes to assess learner understanding",
    icon: ClipboardList,
  },
  {
    type: "ASSIGNMENT",
    title: "Assignment",
    description: "Post tasks or projects for students to complete and submit",
    icon: FileText,
  },
  {
    type: "ACTIVITY",
    title: "Activity",
    description: "Design interactive tasks to enhance learner engagement",
    icon: CheckSquare,
  },
];

const classworkTabType: Partial<Record<TabId, string>> = {
  readings: "READING",
  activities: "ACTIVITY",
  assignments: "ASSIGNMENT",
  quizzes: "QUIZ",
};

function ClassworkTab({
  detail,
  subjectId,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
  subjectId?: number | null;
}) {
  const activeSubjectId =
    subjectId || detail.subject_loads[0]?.subject_id || null;

  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClassworks = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [classworksResponse, loadsResponse] = await Promise.all([
        apiFetch("/api/v1/classwork-assignments/my-classworks"),
        apiFetch("/api/v1/classwork-assignments/teacher/classes"),
      ]);
      if (!classworksResponse.ok || !loadsResponse.ok) {
        throw new Error("Unable to load your classworks.");
      }
      const allLoads = (await loadsResponse.json()) as TeacherClassLoad[];
      const allItems = (await classworksResponse.json()) as TeacherClasswork[];
      setLoads(allLoads);
      setItems(allItems);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load your classworks.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClassworks();
  }, [loadClassworks]);

  const subjects = useMemo(
    () =>
      Array.from(
        new Map(
          loads.map((load) => [
            load.subject_id,
            { id: load.subject_id, name: load.subject_name },
          ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [loads],
  );

  const filteredItems = useMemo(() => {
    const targetType = classworkTabType[activeTab];
    const normalizedSearch = search.trim().toLowerCase();
    const result = items.filter((item) => {
      // Must match active subject
      if (activeSubjectId && item.subject_id !== activeSubjectId) return false;

      const matchesType =
        !targetType || item.classwork_type.toUpperCase() === targetType;
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.subject_name?.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "published" ? item.is_published : !item.is_published);
      return matchesType && matchesSearch && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const first = new Date(a.created_at ?? 0).getTime();
      const second = new Date(b.created_at ?? 0).getTime();
      return sortMode === "oldest" ? first - second : second - first;
    });
  }, [activeTab, items, search, sortMode, statusFilter, activeSubjectId]);

  const openCreateWizard = () => {
    const preferredType = classworkTabType[activeTab] as ClassworkKind | undefined;
    setSelectedType(preferredType ?? null);
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    setShowCreateWizard(false);
    setSelectedType(null);
  };

  const cycleSort = () => {
    setSortMode((current) =>
      current === "newest"
        ? "oldest"
        : current === "oldest"
          ? "title"
          : "newest",
    );
  };

  if (selected) {
    return (
      <ClassworkView
        classwork={selected}
        onClose={() => setSelected(null)}
        onUpdated={(updated) => {
          setItems((current) =>
            current.map((item) =>
              item.classwork_id === updated.classwork_id ? updated : item,
            ),
          );
          setSelected(updated);
        }}
        onArchived={(classworkId) => {
          setItems((current) =>
            current.filter((item) => item.classwork_id !== classworkId),
          );
          setSelected(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Text as="h3" className="text-xl font-bold">
            Classwork
          </Text>
        </div>

        <Button
          type="button"
          onClick={openCreateWizard}
          className="gap-2"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">New Classwork</span>
          <span className="sm:hidden">New</span>
        </Button>
      </header>

      <Tabs
        tabs={classworkTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <main className="flex flex-col gap-4 pt-1">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label className="relative shadow-md transition-shadow hover:shadow-none">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search classwork..."
              className="h-10 w-full border-black pl-9 pr-3 shadow-none"
            />
          </label>

          <Button
            variant="outline"
            size="md"
            onClick={() => setShowFilters((current) => !current)}
            className="gap-1.5"
          >
            <Filter size={15} />
            Add Filter
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={cycleSort}
            className="gap-1.5"
            title={`Current sort: ${sortMode}`}
          >
            {sortMode === "title" ? (
              <ArrowDownAZ size={15} />
            ) : (
              <ArrowUpDown size={15} />
            )}
            Sort By
          </Button>

          {statusFilter !== "all" && (
            <Badge
              variant="secondary"
              size="sm"
              className="flex w-fit items-center gap-2 capitalize cursor-pointer"
              onClick={() => setStatusFilter("all")}
            >
              {statusFilter}
              <X size={13} />
            </Badge>
          )}
        </div>

        {showFilters && (
          <section className="grid gap-3 rounded-lg border border-black bg-[#F6E9B2] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:grid-cols-2">
            <label className="text-xs font-bold">
              Publication status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
              >
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </label>
          </section>
        )}

        {isLoading ? (
          <p className="py-12 text-center text-sm font-semibold text-gray-500">
            Loading classworks...
          </p>
        ) : filteredItems.length > 0 ? (
          <section className="space-y-3">
            {filteredItems.map((item) => (
              <ClassworkCard
                key={item.classwork_id}
                item={item}
                onOpen={(cw) => setSelected(cw)}
              />
            ))}
          </section>
        ) : (
          <Card className="flex flex-col justify-center items-center p-8">
            <ClipboardList className="mx-auto mb-2 text-gray-400" size={28} />
            <p className="font-bold">No classworks found</p>
            <p className="mt-1 text-sm text-gray-500">
              No classwork items match the selected filter criteria for this subject.
            </p>
          </Card>
        )}
      </main>

      {/* Creation Modal Wizard Dialog */}
      <Dialog
        open={showCreateWizard}
        onOpenChange={(open) => {
          if (!open) closeCreateWizard();
        }}
      >
        {showCreateWizard &&
          (selectedType === null ? (
            <Dialog.Content size="lg">
              <Dialog.Header position="fixed" asChild>
                <div className="flex items-center justify-between w-full">
                  <Text as="h5" className="font-sans text-xl font-bold">
                    Choose Classwork Type
                  </Text>
                  <button
                    type="button"
                    onClick={closeCreateWizard}
                    className="cursor-pointer text-white hover:text-gray-200"
                  >
                    <X size={18} />
                  </button>
                </div>
              </Dialog.Header>
              <section className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {classworkCreateOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => setSelectedType(option.type)}
                        className="rounded-lg border-2 border-black bg-[#7ABA78] p-5 text-left shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 cursor-pointer text-black"
                      >
                        <div className="flex items-center gap-2">
                          <Icon size={20} className="text-black" />
                          <h3 className="text-lg font-bold text-black">
                            {option.title}
                          </h3>
                        </div>
                        <p className="mt-2 text-xs font-semibold text-black/80">
                          {option.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>
              <Dialog.Footer position="fixed">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeCreateWizard}
                >
                  Cancel
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          ) : isQuizType(selectedType) ? (
            <CreateClassworkQuizModal
              selectedType={selectedType}
              subjects={subjects}
              loads={loads}
              initialSubjectId={activeSubjectId ? String(activeSubjectId) : undefined}
              onClose={closeCreateWizard}
              onSuccess={async () => {
                await loadClassworks();
                closeCreateWizard();
              }}
              onBack={() => setSelectedType(null)}
            />
          ) : (
            <CreateClassworkModal
              selectedType={selectedType}
              subjects={subjects}
              loads={loads}
              initialSubjectId={activeSubjectId ? String(activeSubjectId) : undefined}
              onClose={closeCreateWizard}
              onSuccess={async () => {
                await loadClassworks();
                closeCreateWizard();
              }}
              onBack={() => setSelectedType(null)}
            />
          ))}
      </Dialog>
    </div>
  );
}

function StudentRow({
  student,
  classId,
  subjectLoads,
  onSelectStudent,
}: {
  student: TeacherAdvisoryStudentItem;
  classId: number;
  subjectLoads: TeacherAdvisoryClassDetailResponse["subject_loads"];
  onSelectStudent?: (student: TeacherAdvisoryStudentItem) => void;
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
      <Table.Row
        className={`border-b-2 border-black bg-white transition-colors ${onSelectStudent ? "cursor-pointer hover:bg-[#F6E9B2]/40 group" : ""}`}
        onClick={() => onSelectStudent?.(student)}
      >
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
              <span className="block text-base font-semibold truncate group-hover:underline">
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
        <Table.Cell
          className="py-2.5 px-4 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIsDialogOpen(true);
              }}
              className="border-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <Lightbulb size={14} className="mr-1" />
              Intervention
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setShowHistory((prev) => !prev);
              }}
              className="border-2 border-black bg-white hover:bg-gray-100 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              History
              <ChevronDown
                size={14}
                className={`ml-1 transition-transform ${showHistory ? "rotate-180" : ""}`}
              />
            </Button>
          </div>
        </Table.Cell>
      </Table.Row>

      {showHistory && (
        <Table.Row className="bg-gray-50/70 border-b-2 border-black">
          <Table.Cell colSpan={3} className="p-3">
            <Card className="block w-full border-2 border-black bg-white p-3 shadow-none">
              <h5 className="font-bold text-xs uppercase mb-2 text-gray-700">
                Suggestion History for {student.full_name}
              </h5>
              {historyError ? (
                <p className="text-xs font-semibold text-red-600">
                  {historyError}
                </p>
              ) : isHistoryLoading ? (
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
