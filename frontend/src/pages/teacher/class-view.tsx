import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Award,
  BookOpen,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileText,
  Lightbulb,
  Paperclip,
  Pencil,
  Search,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Accordion } from "@/components/retroui/Accordion";
import { Tabs } from "@/components/retroui/Tabs";
import AppLayout from "@/layouts/app-layout";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { useToast } from "@/components/retroui/use-toast";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Text } from "@/components/retroui/Text";
import { Select } from "@/components/retroui/Select";
import { OverviewCard } from "@/components/overview-cards";
import { Table } from "@/components/retroui/Table";
import { DialogueSelect } from "@/components/dialogue-select";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Avatar } from "@/components/retroui/Avatar";
import { LessonGoalProgress } from "@/components/lesson-goal-progress";
import SetLessonGoalModal from "./subject-details/set-lesson-goal-modal";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { useTeacherClasses } from "@/hooks/use-teacher-classes";

import CompetencyModal from "./subject-details/competency-modal";
import CreateLessonModal from "@/pages/teacher/create-lesson";
import ClassworkCard from "./classworks/classwork-card";
import ClassworkView from "./classwork-view";
import CreateClassworkModal from "./forms/create-classwork";
import CreateClassworkQuizModal from "./forms/create-classwork-quiz";
import ClassworkDetailModal from "./forms/classwork-detail-modal";
import { isQuizType } from "@/lib/classwork-utils";
import type {
  ClassworkKind,
  SortMode,
  TabId,
  TeacherClassLoad,
  TeacherClasswork,
} from "@/types/classwork";
import ClassworkFormModal from "./subject-details/classwork-form-modal";
import TeacherLessonDetailScreen from "./subject-details/teacher-lesson-detail-screen";
import TeacherCompetencyDetailScreen from "./subject-details/teacher-competency-detail-screen";
import { StudentRecordDetail } from "./subject-details/student-records-panel";
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
import { ManualSuggestionPanel } from "@/components/teacher/suggestions/manual-suggestion-panel";
import {
  apiFetch,
  getLessonGoals,
  getTeacherAdvisoryClassDetail,
  type LessonGoalItemResponse,
} from "@/lib/api";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

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
  const [isSetGoalModalOpen, setIsSetGoalModalOpen] = useState(false);
  const [studentInterfaceStudent, setStudentInterfaceStudent] =
    useState<TeacherAdvisoryStudentItem | null>(null);
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
            className="rounded border-2 border-black bg-[#79bd80] px-3 py-1 text-xs font-bold"
          >
            Back to Classes
          </button>
        </StatePanel>
      </AppLayout>
    );
  }
  const statusLabel = detail.is_archived ? "Archived" : "Active";

  return (
    <AppLayout>
      <div className="flex min-w-0 max-w-full flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex min-w-0 max-w-full flex-1 flex-col">
          <div className="flex min-w-0 max-w-full flex-1 flex-col">
            <div
              data-page-tabs-sticky-region={
                studentInterfaceStudent ? undefined : ""
              }
              data-student-detail-sticky-region={
                studentInterfaceStudent ? "" : undefined
              }
              className={
                studentInterfaceStudent
                  ? "sticky top-0 z-40 shrink-0 bg-background"
                  : undefined
              }
            >
              <header
                data-student-detail-header={
                  studentInterfaceStudent ? "" : undefined
                }
                className="flex min-w-0 flex-col gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:px-6"
              >
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <SidebarTrigger className="shrink-0 md:hidden" />
                  <Breadcrumb className="min-w-0">
                    <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-2">
                      <Breadcrumb.Item>
                        <Breadcrumb.Link
                          onClick={() => navigate("/teacher/classes")}
                          className="cursor-pointer whitespace-nowrap text-muted-foreground hover:text-black"
                        >
                          Classes
                        </Breadcrumb.Link>
                      </Breadcrumb.Item>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item className="min-w-0">
                        <Breadcrumb.Link
                          onClick={() => navigate(`/teacher/classes/${detail.class_id}/subjects/${currentSubject?.subject_id}`)}
                          className="cursor-pointer whitespace-nowrap !text-lg text-muted-foreground hover:text-black"
                        >
                          {currentSubject?.subject_name || "Subject"}
                        </Breadcrumb.Link>
                      </Breadcrumb.Item>
                      <Breadcrumb.Separator />
                      <Breadcrumb.Item className="min-w-0">
                        <Breadcrumb.Page className="block truncate">
                          {studentInterfaceStudent?.full_name || detail.section_name}
                        </Breadcrumb.Page>
                      </Breadcrumb.Item>
                    </Breadcrumb.List>
                  </Breadcrumb>
                </div>

                <div className="flex w-full items-center gap-2 md:w-auto md:shrink-0">
                  {studentInterfaceStudent ? (
                    <ManualSuggestionPanel
                      classId={detail.class_id}
                      student={studentInterfaceStudent}
                      subjectLoads={detail.subject_loads}
                      displayMode="header"
                    />
                  ) : tab === "lessons" ? (
                    <>
                      <div className="flex flex-row gap-2">
                        <Button
                          className="w-full md:w-auto whitespace-nowrap"
                          onClick={() => setIsSetGoalModalOpen(true)}
                        >
                          <Pencil className="mr-2 size-4" /> Set Lesson Goal
                        </Button>
                        {(detail.subject_loads[0]?.subject_id) && (
                          <Button
                            variant="default"
                            onClick={() => {
                              const targetId =
                                detail.subject_loads[0]?.subject_id;
                              if (targetId) {
                                navigate(
                                  `/teacher/classes/${detail.class_id}/subjects/${targetId}`,
                                );
                              }
                            }}
                            className="h-10 w-full gap-2 whitespace-nowrap"
                          >
                            <BookOpen size={16} />
                            View Subject
                          </Button>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </header>
              {!studentInterfaceStudent && (
                <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
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
                    onTabChange={(nextTab) => {
                      setStudentInterfaceStudent(null);
                      setTab(nextTab);
                    }}
                  />
                </div>
              )}
            </div>

            <div
              className={`flex min-w-0 flex-col gap-4 px-3 py-3 sm:px-4 sm:py-4 md:px-6 ${studentInterfaceStudent
                ? ""
                : "-mt-[1px] border-t-1 border-border"
                }`}
            >

              {!studentInterfaceStudent && (
                <Card className="block w-full border-black bg-primary transition-none hover:shadow-md pt-3 pb-4">
                  <Card.Content>
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Tooltip>
                          <TooltipTrigger render={<Card.Title
                            className="mb-0 truncate text-2xl font-extrabold sm:text-3xl"
                            tabIndex={0}
                          >
                            {currentSubject?.subject_name || detail.section_name}
                          </Card.Title>} />
                          <TooltipContent>{currentSubject?.subject_name || detail.section_name}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex shrink-0 flex-row items-center gap-2">
                        <Badge
                          variant="outline"
                          size="sm"
                          className="w-fit font-black"
                        >
                          {statusLabel}
                        </Badge>
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex"><Button
                            variant="secondary"
                            className="shadow-none w-7 p-1"
                            size="sm"
                            aria-label={`View ${currentSubject?.subject_name || detail.section_name}`}
                            onClick={() => {
                              if (currentSubject) {
                                navigate(
                                  `/teacher/classes/${detail.class_id}/subjects/${currentSubject.subject_id}`,
                                );
                              }
                            }}
                          >
                            <ArrowUpRight className="size-4" />
                          </Button></span>} />
                          <TooltipContent>View subject</TooltipContent>
                        </Tooltip>
                      </div>

                    </div>
                    <p className="text-sm mt-1">
                      {detail.section_name} | {detail.academic_level}
                    </p>
                  </Card.Content>
                </Card>
              )}

              {tab === "lessons" && (
                <OverviewTab
                  detail={detail}
                  initialSubjectId={initialSubjectId}
                  isSetGoalModalOpen={isSetGoalModalOpen}
                  setIsSetGoalModalOpen={setIsSetGoalModalOpen}
                />
              )}
              {tab === "students" && (
                <StudentsTab
                  detail={detail}
                  subjectId={currentSubject?.subject_id || initialSubjectId}
                  onDetailViewChange={setStudentInterfaceStudent}
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
  isSetGoalModalOpen,
  setIsSetGoalModalOpen,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
  initialSubjectId?: number | null;
  isSetGoalModalOpen?: boolean;
  setIsSetGoalModalOpen?: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { selectedPeriodId, periods } = useAcademicPeriod();
  const [internalSetGoalModalOpen, setInternalSetGoalModalOpen] = useState(false);
  const isGoalModalOpen = isSetGoalModalOpen !== undefined ? isSetGoalModalOpen : internalSetGoalModalOpen;
  const setGoalModalOpen = setIsSetGoalModalOpen || setInternalSetGoalModalOpen;

  const [curatedGoals, setCuratedGoals] = useState<LessonGoalItemResponse[]>([]);
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
  const [lessonFilter, setLessonFilter] = useState("all");
  const [lessonSort, setLessonSort] = useState<
    "order" | "newest" | "oldest" | "title"
  >("order");
  const [collapsedCompetencies, setCollapsedCompetencies] = useState<
    Record<number, boolean>
  >({});
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState(true);

  useEffect(() => {
    if (
      lessonFilter !== "all" &&
      !lessons.some((l) => String(l.lesson_id) === lessonFilter)
    ) {
      setLessonFilter("all");
    }
  }, [lessons, lessonFilter]);

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

  const loadCuratedGoals = useCallback(async () => {
    if (!detail.class_id || !selectedSubjectId || !selectedPeriodId) {
      setCuratedGoals([]);
      return;
    }
    try {
      const res = await getLessonGoals(detail.class_id, selectedSubjectId, selectedPeriodId);
      setCuratedGoals(res.items || []);
    } catch {
      setCuratedGoals([]);
    }
  }, [detail.class_id, selectedSubjectId, selectedPeriodId]);

  useEffect(() => {
    void loadCuratedGoals();
  }, [loadCuratedGoals]);

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
    const list =
      lessonFilter === "all"
        ? lessons
        : lessons.filter((l) => String(l.lesson_id) === lessonFilter);

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
  }, [lessonFilter, lessonSort, lessons]);

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
      <Accordion
        key={lesson.lesson_id}
        value={isExpanded ? [String(lesson.lesson_id)] : []}
        onValueChange={() => toggleLesson(lesson.lesson_id)}
        className="w-full"
      >
        <Accordion.Item
          value={String(lesson.lesson_id)}
          className="border-2 border-black bg-primary shadow-md!"
        >
          <Accordion.Header className="p-4 items-center shadow-none">
            <div className="flex flex-col w-full items-start gap-1 min-w-0 text-left">
              <div className="flex flex-wrap items-center w-full justify-between gap-2 min-w-0 pr-3">
                <h4 className="text-xl sm:text-2xl font-semibold text-black break-words line-clamp-2">
                  {lesson.title}
                </h4>
                <div className="flex flex-row gap-2">
                  <Badge
                    variant={lesson.is_published ? "solid" : "default"}
                    size="sm"
                    className="shrink-0 text-xs font-bold"
                  >
                    {lesson.is_published ? "Published" : "Draft"}
                  </Badge>
                  {lesson.attachments && lesson.attachments.length > 0 && (
                    <Badge
                      size="sm"
                      variant="solid"
                    >
                      <Paperclip size={10} />
                      {lesson.attachments.length} material
                      {lesson.attachments.length === 1 ? "" : "s"}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    size="sm"
                    className=""
                  >
                    {classworks.length} classwork{classworks.length === 1 ? "" : "s"}
                  </Badge>
                </div>
              </div>
            </div>
          </Accordion.Header>

          <Accordion.Content className="p-3 border-t-2 border-black bg-white space-y-2">
            {isLoadingCw ? (
              <LoadingPanel label="Loading classworks..." />
            ) : classworks.length === 0 ? (
              <div className="flex items-center justify-between rounded border-2 border-dashed border-black/40 bg-white p-3 text-xs text-gray-500 font-medium">
                <span>No classworks assigned to this lesson yet.</span>
              </div>
            ) : (
              classworks.map((cw) => (
                <Card
                  key={cw.classwork_assignment_id}
                  onClick={() => openClassworkDetail(cw)}
                  className="flex items-center justify-between gap-3 border-2 border-black bg-white p-3 hover:bg-retro shadow-none hover:translate-x-0.5 transition-all cursor-pointer min-w-0 group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="shrink-0 text-black">
                      <ClassworkIcon type={cw.classwork_type} size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate text-black">
                        {cw.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {cw.due_date
                          ? `Due ${new Date(cw.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                          : "No due date"}
                        {/* {cw.total_points !== null && cw.total_points !== undefined
                          ? ` • ${cw.total_points} pts`
                          : ""} */}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {cw.classwork_category && (
                      <Badge variant="surface" size="sm" className="capitalize">
                        {cw.classwork_category.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    )}
                  </div>
                </Card>
              ))
            )}
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
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
          {/* Main Content Area */}
          <section className="flex flex-col gap-4 min-w-0">
            <div className="flex flex-col gap-4 min-w-0">
              <div className="flex flex-col gap-3 min-w-0">
                {/* Header toolbar */}
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Text as="h3" className="text-xl font-bold tracking-tight sm:text-2xl">
                      Lessons & Competencies
                    </Text>
                  </div>
                </div>

                {/* Filter & Sort Controls */}
                <div className="-mt-1 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="w-full min-w-0 flex-1 lg:max-w-md">
                    <Select
                      value={lessonFilter}
                      onValueChange={(val) => setLessonFilter(val)}
                    >
                      <Select.Trigger className="h-10 w-full border-2 border-black bg-white text-sm">
                        <Select.Value placeholder="Filter by lesson" />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black bg-white max-h-72 overflow-y-auto">
                        <Select.Item value="all">All Lessons</Select.Item>
                        {lessons.map((lesson) => (
                          <Select.Item
                            key={lesson.lesson_id}
                            value={String(lesson.lesson_id)}
                          >
                            {lesson.title}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </div>

                  <div className="grid w-full grid-cols-2 items-stretch gap-2 lg:flex lg:w-auto lg:items-center">
                    <Select
                      value={lessonSort}
                      onValueChange={(v) =>
                        setLessonSort(
                          v as "order" | "newest" | "oldest" | "title",
                        )
                      }
                    >
                      <Select.Trigger className="h-10 w-full border-2 border-black bg-white text-sm lg:w-40">
                        <Select.Value placeholder="Sort by" />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black bg-white">
                        <Select.Item value="order">Lesson order</Select.Item>
                        <Select.Item value="newest">Newest first</Select.Item>
                        <Select.Item value="oldest">Oldest first</Select.Item>
                        <Select.Item value="title">Title A-Z</Select.Item>
                      </Select.Content>
                    </Select>
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
                      lessonFilter !== "all"
                        ? false
                        : (collapsedCompetencies[comp.competency_id] ?? true);

                    if (lessonFilter !== "all" && compLessons.length === 0) {
                      return null;
                    }

                    return (
                      <Card
                        key={comp.competency_id}
                        className="flex min-w-0 flex-col overflow-hidden border-2 border-black bg-white p-0 shadow-md hover:shadow-md"
                      >
                        {/* Competency Header Bar */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleCompetencyCollapse(comp.competency_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleCompetencyCollapse(comp.competency_id);
                            }
                          }}
                          className="group flex w-full min-w-0 cursor-pointer select-none items-center justify-between gap-3 border-b-2 border-black bg-primary px-3 py-3 sm:px-4 sm:py-3.5"
                          aria-label={isCollapsed ? "Expand competency" : "Collapse competency"}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
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
                        </div>

                        {/* Competency Body when expanded */}
                        {!isCollapsed && (
                          <Card.Content className="flex flex-col gap-3 bg-white p-4">
                            {compLessons.length > 0 ? (
                              compLessons.map(renderLessonCard)
                            ) : (
                              <div className="flex items-center justify-between border-2 border-dashed border-black bg-[#FFFDF0] p-4">
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
                    <div className="flex flex-col p-0 min-w-0 w-full">
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
                            className="flex items-center justify-between border-b-2 border-black bg-background text-left cursor-pointer group min-w-0 w-full"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="rounded border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] group-hover:bg-yellow-50 transition-colors shrink-0">
                                {isUnassignedExpanded || lessonFilter !== "all" ? (
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

                          {(isUnassignedExpanded || lessonFilter !== "all") && (
                            <div className="flex flex-col gap-3 p-4 bg-white min-w-0 w-full">
                              {unassignedLessons.map(renderLessonCard)}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col gap-3 bg-white min-w-0 w-full">
                          {unassignedLessons.map(renderLessonCard)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Empty state when no competencies and no lessons */}
                  {competencies.length === 0 &&
                    unassignedLessons.length === 0 && (
                      <Empty className="shadow-md hover:shadow-none transition-shadow">
                        <EmptyHeader>
                          <EmptyMedia>
                          </EmptyMedia>
                          <EmptyTitle>No Competencies or Lessons Yet</EmptyTitle>
                          <EmptyDescription className="whitespace-nowrap text-center">
                            No learning competencies or lessons have been added for this subject yet.
                          </EmptyDescription>
                        </EmptyHeader>
                        {(selectedSubjectId || currentSubjectLoad?.subject_id || detail.subject_loads[0]?.subject_id) && (
                          <EmptyContent className="mt-2">
                            <Button
                              type="button"
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
                              className=""
                            >
                              <BookOpen size={14} className="mr-1.5" />
                              Go to Subject View
                            </Button>
                          </EmptyContent>
                        )}
                      </Empty>
                    )}
                </div>
              )}
            </div>
          </section>

          {/* Weekly Goals Sidebar Progress */}
          <aside className="flex flex-col gap-3 min-w-0 xl:row-span-2">
            <LessonGoalProgress
              goalItems={curatedGoals}
              isTeacher
              onSetGoal={() => setGoalModalOpen(true)}
              className="w-full flex-1 min-w-0"
            />
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
          </aside>
        </div>
      )}

      {/* ── Reused Classwork Detail & Tracking Dialog ── */}
      <ClassworkDetailModal
        selectedClasswork={selectedClasswork}
        detailLoadingId={detailLoadingId}
        detailError={detailError}
        onClose={closeClassworkDetail}
        sectionName={detail.section_name}
      />

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
          <Dialog.Content className="w-full max-w-4xl p-0">
            <Dialog.Header className="border-border">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide">
                  Teacher lesson management
                </p>
                <h2 className="text-xl font-bold">{selectedLesson.title}</h2>
              </div>
            </Dialog.Header>

            <div className="flex flex-col gap-5 p-5">
              <div className="space-y-4">
                <Card className="block w-full border-border shadow-none">
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
                          className="h-10 w-full rounded-none border-border bg-background text-foreground !shadow-none"
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
                          className="h-10 w-full rounded-none border-border bg-background text-foreground !shadow-none"
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
                        className="min-h-20 w-full rounded-none border-2 border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/35"
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
                        className="min-h-40 w-full rounded-none border-2 border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/35"
                        placeholder="Write the lesson notes or learning content."
                      />
                    </div>
                  </Card.Content>
                </Card>

              </div>
            </div>
            <Dialog.Footer className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowArchiveConfirm(true)}
                className="border-2 border-red-600 bg-red-50 font-bold text-red-700 hover:bg-red-100"
              >
                <Archive size={14} className="mr-1" />
                Archive Lesson
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeLessonManager}
                  className="font-bold"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={saveLessonDetails}
                  disabled={isSavingLesson}
                  className="font-bold"
                >
                  Save Changes
                </Button>
              </div>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog>
      )}

      {/* ── Archive Confirmation Modal ── */}
      {showArchiveConfirm && selectedLesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="block w-full max-w-md border-2 border-border bg-background text-foreground shadow-[4px_4px_0_#000] hover:shadow-[4px_4px_0_#000]">
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
                Archive Lesson
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

      {/* ── Set Lesson Goal Modal ── */}
      {selectedSubjectId && selectedPeriodId && (
        <SetLessonGoalModal
          isOpen={isGoalModalOpen}
          onClose={() => setGoalModalOpen(false)}
          classId={detail.class_id}
          subjectId={selectedSubjectId}
          academicPeriodId={selectedPeriodId}
          periodName={periods.find((p) => p.id === selectedPeriodId)?.period}
          lessons={lessons.map((l) => ({
            lesson_id: l.lesson_id,
            title: l.title,
            is_published: l.is_published,
          }))}
          linkedClassworks={linkedClassworks as any}
          currentGoals={curatedGoals}
          onSaved={(updated) => {
            setCuratedGoals(updated.items || []);
          }}
        />
      )}
    </div>
  );
}

function StudentsTab({
  detail,
  subjectId,
  onDetailViewChange,
}: {
  detail: TeacherAdvisoryClassDetailResponse;
  subjectId?: number | null;
  onDetailViewChange?: (student: TeacherAdvisoryStudentItem | null) => void;
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
    onDetailViewChange?.(student);
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
            size="header"
            onClick={() => {
              setSelectedStudent(null);
              setStudentDetail(null);
              onDetailViewChange?.(null);
            }}
          >
            <ArrowLeft />
            Back to students
          </Button>

          <div className="flex flex-wrap items-center justify-end gap-2">
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
        </div>

        {detailError && (
          <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
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
            showSuggestionPanel={false}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start min-w-0">
      <section className="flex flex-col min-w-0">
        <div className="mb-4 flex flex-col gap-2 sm:items-start sm:justify-between">
          <h3 className="text-xl sm:text-2xl font-bold sm:-mb-">Students</h3>
          <label className="relative flex-1 sm:min-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50 z-10" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search students"
              className="h-10 w-full border-black pl-9 pr-3"
            />
          </label>
        </div>
        {!detail.students.length ? (
          <StateInline message="No students are currently enrolled in this class." />
        ) : !filteredStudents.length ? (
          <StateInline message="No students match your search." />
        ) : (
          <Accordion
            multiple
            defaultValue={groupedStudents.map(([gender]) => gender)}
            className="flex flex-col gap-3 no-scrollbar"
          >
            {groupedStudents.map(([gender, students]) => (
              <Accordion.Item
                key={gender}
                value={gender}
                className="overflow-hidden rounded border-2 border-black bg-white shadow-none no-scrollbar"
              >
                <Accordion.Header className="items-center bg-primary px-4 py-3 text-base font-black">
                  <div className="flex items-center justify-between w-full mr-2">
                    <span>{gender}</span>
                    <Badge variant="outline" size="sm">
                      {students.length} student{students.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </Accordion.Header>
                <Accordion.Content className="p-0 border-t-2 border-black overflow-hidden no-scrollbar">
                  <div className="w-full overflow-x-auto overflow-y-hidden no-scrollbar">
                    <table className="w-full border-collapse caption-bottom text-sm border-0 shadow-none">
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
                    </table>
                  </div>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </section>

      <aside className="flex flex-col gap-3 min-w-0">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
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
      </aside>
    </div>
  );
}

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

  const {
    classes: loads,
    isLoading: loadingClasses,
    error: classesError,
    selectedPeriodId,
    refetch: refetchClasses,
  } = useTeacherClasses({ includeAdvisory: false });

  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [activeTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode] = useState<SortMode>("newest");
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [itemsError, setItemsError] = useState("");

  const loadClassworks = useCallback(async () => {
    setLoadingItems(true);
    setItemsError("");
    try {
      const periodQuery = selectedPeriodId ? `?academic_period_id=${selectedPeriodId}` : "";
      const classworksResponse = await apiFetch(
        `/api/v1/classwork-assignments/my-classworks${periodQuery}`,
      );
      if (!classworksResponse.ok) {
        throw new Error("Unable to load your classworks.");
      }
      const allItems = (await classworksResponse.json()) as TeacherClasswork[];
      setItems(allItems);
    } catch (err) {
      setItemsError(
        err instanceof Error ? err.message : "Unable to load your classworks.",
      );
    } finally {
      setLoadingItems(false);
    }
  }, [selectedPeriodId]);

  useEffect(() => {
    void loadClassworks();
  }, [loadClassworks]);

  const isLoading = loadingClasses || loadingItems;
  const error = itemsError || (classesError ? classesError.message : "");

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
    <div className="flex flex-col gap-2 min-w-0">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Text as="h3" className="text-xl sm:text-2xl font-bold ">
            Classwork
          </Text>
        </div>
      </header>

      <main className="flex flex-col gap-4">
        {error && (
          <div className=" border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between min-w-0">
          <label className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search classwork..."
              className="h-10 w-full border-2 border-black pl-9 pr-3 bg-white"
            />
          </label>

          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={statusFilter}
              onValueChange={(val) => setStatusFilter(val)}
            >
              <Select.Trigger className="h-10 text-sm bg-white">
                <Select.Value placeholder="Filter status" />
              </Select.Trigger>
              <Select.Content className="border-2 border-black bg-white">
                <Select.Item value="all">All statuses</Select.Item>
                <Select.Item value="published">Published</Select.Item>
                <Select.Item value="draft">Draft</Select.Item>
              </Select.Content>
            </Select>
          </div>
        </div>

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
          <>
            <Empty className="shadow-md hover:shadow-none transition-shadow">
              <EmptyHeader>
                <EmptyMedia>
                  <div className="flex items-center gap-2">
                    <div className="flex size-10 items-center justify-center border-2 border-black bg-primary">
                      <BookOpen className="size-5 text-black" />
                    </div>
                    <div className="flex size-10 items-center justify-center border-2 border-black bg-primary">
                      <CheckSquare className="size-5 text-black" />
                    </div>
                    <div className="flex size-10 items-center justify-center border-2 border-black bg-primary">
                      <FileText className="size-5 text-black" />
                    </div>
                    <div className="flex size-10 items-center justify-center border-2 border-black bg-primary">
                      <ClipboardList className="size-5 text-black" />
                    </div>
                  </div>
                </EmptyMedia>
                <EmptyTitle>No Classworks Found</EmptyTitle>
                <EmptyDescription className="text-center whitespace-nowrap">
                  No classwork items match the selected filter criteria for this subject.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" variant="default" onClick={openCreateWizard}>
                  Create Classwork
                </Button>
              </EmptyContent>
            </Empty>
          </>

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
                    Create Classwork
                  </Text>
                  <Tooltip>
                    <TooltipTrigger render={<button
                      type="button"
                      onClick={closeCreateWizard}
                      className={dialogHeaderCloseButtonClassName}
                      aria-label="Close modal"
                    >
                      <X className="size-4" />
                    </button>} />
                    <TooltipContent>Close modal</TooltipContent>
                  </Tooltip>
                </div>
              </Dialog.Header>
              <section className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {classworkCreateOptions.map((option) => {
                    return (
                      <DialogueSelect
                        key={option.type}
                        title={option.title}
                        description={option.description}
                        icon={option.icon}
                        onClick={() => setSelectedType(option.type)}
                      />
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
              loads={loads as unknown as TeacherClassLoad[]}
              initialSubjectId={activeSubjectId ? String(activeSubjectId) : undefined}
              onClose={closeCreateWizard}
              onSuccess={async () => {
                await Promise.all([loadClassworks(), refetchClasses()]);
                closeCreateWizard();
              }}
              onBack={() => setSelectedType(null)}
            />
          ) : (
            <CreateClassworkModal
              selectedType={selectedType}
              subjects={subjects}
              loads={loads as unknown as TeacherClassLoad[]}
              initialSubjectId={activeSubjectId ? String(activeSubjectId) : undefined}
              onClose={closeCreateWizard}
              onSuccess={async () => {
                await Promise.all([loadClassworks(), refetchClasses()]);
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
  const toast = useToast();
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
      toast.success({ title: `Suggestion ${action === "approve" ? "approved" : action === "dismiss" ? "dismissed" : "archived"}` });
      await loadHistory();
    } catch (err) {
      setHistoryError(
        err instanceof Error ? err.message : "Unable to update suggestion.",
      );
      toast.error({ title: "Unable to update suggestion", description: err instanceof Error ? err.message : undefined });
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
                src={student.avatar || "/avatars/student-avatars/1.svg"}
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
              className="border-2 border-black bg-success hover:bg-[#fae498] text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
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
  if (gender === "Female" || gender === "Male")
    return gender;
  return "Unspecified";
}

function groupStudents(students: TeacherAdvisoryStudentItem[]) {
  const order = ["Male", "Female", "Unspecified"];
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
