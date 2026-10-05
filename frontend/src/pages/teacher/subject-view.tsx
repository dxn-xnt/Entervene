import { useEffect, useMemo, useState } from "react";
import { Award, BookOpen, BookOpenCheck, ClipboardList, Info, Paperclip, Plus, Users, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import AppLayout from "@/layouts/app-layout";
import { API_URL, apiFetch } from "@/lib/api";
import AttachmentDisplay from "@/components/attachment-display";
import CreateLessonModal from "@/pages/teacher/forms/create-lesson";
import {
  getTeacherRecordPeriods,
  getTeacherStudentRoster,
} from "@/lib/student-record-api";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Card } from "@/components/retroui/Card";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Badge } from "@/components/retroui/Badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import ClassworkFormModal from "./subject-details/classwork-form-modal";
import CompetencyModal from "./forms/competency-modal";
import ManageLessonModal from "./forms/manage-lesson";
import SubjectLessonList from "./subject-details/lesson-classwork-list";
import SubjectClassworkTab from "./subject-details/subject-classwork-tab";
import TeacherLessonDetailScreen from "./lesson-view";
import TOSGeneratorScreen from "./subject-details/tos-generator-screen";
import {
  LOCKED_CLASSWORK_MESSAGE,
  allowedMaterialExtensions,
  emptyClassworkDraft,
  maxMaterialSize,
} from "./subject-details/constants";
import type {
  ClassworkDetail,
  ClassworkDraft,
  CompetencyItem,
  Lesson,
  LessonDraft,
  LinkedClasswork,
  SubmissionTracking,
  TeacherClassLoad,
} from "./subject-details/types";

const tabs: Array<TabItem<"lessons" | "classwork">> = [
  { id: "lessons", label: "Lessons", icon: BookOpen },
  { id: "classwork", label: "Classwork", icon: ClipboardList },
];

export default function SubjectDetails() {
  const { classId, subjectId } = useParams<{
    classId: string;
    subjectId: string;
  }>();
  const navigate = useNavigate();
  const [competencies, setCompetencies] = useState<CompetencyItem[]>([]);
  const [isCompetencyModalOpen, setIsCompetencyModalOpen] = useState(false);
  const [isTOSOpen, setIsTOSOpen] = useState(false);
  const [editingCompetency, setEditingCompetency] = useState<CompetencyItem | null>(null);
  const [selectedCompetencyIdForNewLesson, setSelectedCompetencyIdForNewLesson] = useState<number | undefined>(undefined);
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentAcademicPeriodId, setCurrentAcademicPeriodId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"lessons" | "classwork">("lessons");
  const [isCreatingLesson, setIsCreatingLesson] = useState(false);
  const [activeLessonDetail, setActiveLessonDetail] = useState<Lesson | null>(null);
  const [isCreatingSubjectClasswork, setIsCreatingSubjectClasswork] = useState(false);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [subjectAssignments, setSubjectAssignments] = useState<LinkedClasswork[]>([]);
  const [classworkCount, setClassworkCount] = useState<number | null>(null);
  const [overviewMastery, setOverviewMastery] = useState<number>(0);
  const [overviewCompletion, setOverviewCompletion] = useState<number>(0);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [lessonDraft, setLessonDraft] = useState<LessonDraft | null>(null);
  const [lessonClassIds, setLessonClassIds] = useState<number[]>([]);
  const [isSavingLesson, setIsSavingLesson] = useState(false);
  const [isArchivingLesson, setIsArchivingLesson] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [removingLessonAttachmentId, setRemovingLessonAttachmentId] = useState<number | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<number | null>(null);
  const [linkedClassworks, setLinkedClassworks] = useState<Record<number, LinkedClasswork[]>>({});
  const [loadingClassworkId, setLoadingClassworkId] = useState<number | null>(null);
  const [classworkLesson, setClassworkLesson] = useState<Lesson | null>(null);
  const [classworkDraft, setClassworkDraft] = useState<ClassworkDraft>(emptyClassworkDraft);
  const [classworkMaterials, setClassworkMaterials] = useState<File[]>([]);
  const [isCreatingClasswork, setIsCreatingClasswork] = useState(false);
  const [selectedClasswork, setSelectedClasswork] = useState<ClassworkDetail | null>(null);
  const [selectedTracking, setSelectedTracking] = useState<SubmissionTracking | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");
  const [lessonSearch, setLessonSearch] = useState("");
  const [lessonSort, setLessonSort] = useState<"order" | "newest" | "oldest" | "title">("order");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  void isLoading;

  const refreshSubjectData = async () => {
    if (!classId || !subjectId) return;
    try {
      const [lessonsRes, compsRes] = await Promise.all([
        apiFetch(`/api/v1/lessons/my-class/${classId}/subject/${subjectId}`),
        apiFetch(`/api/v1/competencies/subject/${subjectId}`),
      ]);
      if (lessonsRes.ok) {
        const lessonData = (await lessonsRes.json()) as Lesson[];
        const validLessons = lessonData.filter((lesson) => !lesson.is_archived);
        setLessons(validLessons);

        if (classId) {
          try {
            const cwPromises = validLessons.map(async (l) => {
              try {
                const res = await apiFetch(
                  `/api/v1/lessons/my-class/${classId}/lesson/${l.lesson_id}/linked-classwork`,
                );
                if (res.ok) {
                  const cwList = (await res.json()) as LinkedClasswork[];
                  return { lessonId: l.lesson_id, classworks: cwList };
                }
              } catch {
                // ignore
              }
              return { lessonId: l.lesson_id, classworks: [] };
            });
            const cwResults = await Promise.all(cwPromises);
            const map: Record<number, LinkedClasswork[]> = {};
            cwResults.forEach(({ lessonId, classworks }) => {
              map[lessonId] = classworks;
            });
            setLinkedClassworks(map);
          } catch {
            // ignore
          }
        }
      }
      if (compsRes.ok) {
        const compData = (await compsRes.json()) as CompetencyItem[];
        setCompetencies(compData);
      }
    } catch {
      // Ignored
    }
  };

  const openCompetencyForm = (comp?: CompetencyItem | null) => {
    setEditingCompetency(comp || null);
    setIsCompetencyModalOpen(true);
  };

  const handleCompetencySaved = (savedComp?: CompetencyItem) => {
    if (savedComp) {
      setCompetencies((prev) => {
        const idx = prev.findIndex((c) => c.competency_id === savedComp.competency_id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = savedComp;
          return next;
        }
        return [...prev, savedComp];
      });
    }
    refreshSubjectData();
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
      if (!res.ok) throw new Error("Failed to archive competency.");
      if (res.ok) {
        setCompetencies((prev) =>
          prev.filter((c) => c.competency_id !== competencyId),
        );
        setLessons((prev) =>
          prev.map((l) =>
            l.competency_id === competencyId
              ? { ...l, competency_id: null, competency_code: null, competency_statement: null }
              : l,
          ),
        );
        toast.success("Competency archived.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive competency.");
    }
  };

  const handleAddLessonToCompetency = (competencyId: number) => {
    setSelectedCompetencyIdForNewLesson(competencyId);
    setIsCreatingLesson(true);
  };

  const openLessonDetail = async (lesson: Lesson) => {
    setActiveLessonDetail(lesson);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("lessonId", String(lesson.lesson_id));
    setSearchParams(nextParams, { replace: true });
    if (classId && !linkedClassworks[lesson.lesson_id]) {
      await loadLessonClassworks(lesson.lesson_id);
    }
  };

  const closeLessonDetail = () => {
    setActiveLessonDetail(null);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("lessonId");
    setSearchParams(nextParams, { replace: true });
  };

  useEffect(() => {
    const loadContext = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [classesResponse, lessonsResponse, assignmentsResponse, competenciesResponse] =
          await Promise.all([
            apiFetch("/api/v1/classwork-assignments/teacher/classes"),
            classId && subjectId
              ? apiFetch(
                `/api/v1/lessons/my-class/${classId}/subject/${subjectId}`,
              )
              : Promise.resolve(null),
            classId && subjectId
              ? apiFetch(
                `/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`,
              )
              : Promise.resolve(null),
            subjectId
              ? apiFetch(`/api/v1/competencies/subject/${subjectId}`)
              : Promise.resolve(null),
          ]);

        if (!classesResponse.ok) {
          throw new Error("Unable to load subject context.");
        }

        setLoads((await classesResponse.json()) as TeacherClassLoad[]);

        if (lessonsResponse) {
          if (!lessonsResponse.ok) {
            throw new Error("Unable to load lessons.");
          }
          const lessonData = (await lessonsResponse.json()) as Lesson[];
          const validLessons = lessonData.filter((lesson) => !lesson.is_archived);
          setLessons(validLessons);

          if (classId) {
            try {
              const cwPromises = validLessons.map(async (l) => {
                try {
                  const res = await apiFetch(
                    `/api/v1/lessons/my-class/${classId}/lesson/${l.lesson_id}/linked-classwork`,
                  );
                  if (res.ok) {
                    const cwList = (await res.json()) as LinkedClasswork[];
                    return { lessonId: l.lesson_id, classworks: cwList };
                  }
                } catch {
                  // ignore
                }
                return { lessonId: l.lesson_id, classworks: [] };
              });
              const cwResults = await Promise.all(cwPromises);
              const map: Record<number, LinkedClasswork[]> = {};
              cwResults.forEach(({ lessonId, classworks }) => {
                map[lessonId] = classworks;
              });
              setLinkedClassworks(map);
            } catch {
              // ignore
            }
          }
        }

        if (assignmentsResponse) {
          if (!assignmentsResponse.ok) {
            throw new Error("Unable to load classwork overview.");
          }
          const assignmentsData =
            (await assignmentsResponse.json()) as LinkedClasswork[];
          setSubjectAssignments(assignmentsData);
          setClassworkCount(assignmentsData.length);
        }

        if (competenciesResponse) {
          if (competenciesResponse.ok) {
            const compData = (await competenciesResponse.json()) as CompetencyItem[];
            setCompetencies(compData);
          }
        }

        if (classId && subjectId) {
          try {
            const periods = await getTeacherRecordPeriods(classId, subjectId);
            const periodId =
              periods.default_academic_period_id ||
              periods.periods[0]?.academic_period_id;
            if (periodId) {
              setCurrentAcademicPeriodId(periodId);
              const roster = await getTeacherStudentRoster(
                classId,
                subjectId,
                periodId,
              );
              setOverviewMastery(
                averageRosterMetric(
                  roster.students,
                  "running_classwork_percentage",
                ),
              );
              setOverviewCompletion(
                averageRosterMetric(roster.students, "completion_rate"),
              );
            } else {
              setOverviewMastery(0);
              setOverviewCompletion(0);
            }
          } catch (rosterErr) {
            console.warn("Failed to load roster overview metrics:", rosterErr);
            setOverviewMastery(0);
            setOverviewCompletion(0);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load subject details.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadContext();
  }, [classId, subjectId]);

  useEffect(() => {
    const isOpen = Boolean(selectedClasswork || detailLoadingId || detailError);
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [selectedClasswork, detailLoadingId, detailError]);

  useEffect(() => {
    const targetId = Number(searchParams.get("lessonId"));
    if (!targetId || lessons.length === 0) return;
    const targetLesson = lessons.find((l) => l.lesson_id === targetId);
    if (!targetLesson) return;
    setActiveLessonDetail(targetLesson);
    if (classId && !linkedClassworks[targetId]) {
      void loadLessonClassworks(targetId);
    }
  }, [classId, lessons, searchParams]);

  const subjectLoad = useMemo(() => {
    return loads.find(
      (load) =>
        load.class_id === Number(classId) &&
        load.subject_id === Number(subjectId),
    );
  }, [classId, loads, subjectId]);

  const subjectName = subjectLoad?.subject_name || "Subject";
  const sectionName = subjectLoad?.section_name;
  const classesForSubject = useMemo(() => {
    return loads
      .filter((load) => load.subject_id === Number(subjectId))
      .sort((a, b) => a.section_name.localeCompare(b.section_name));
  }, [loads, subjectId]);
  const filteredLessons = useMemo(() => {
    const query = lessonSearch.trim().toLowerCase();
    const visibleLessons = query
      ? lessons.filter((lesson) =>
        [lesson.title, lesson.description]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query)),
      )
      : lessons;

    return [...visibleLessons].sort((a, b) => {
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

  const toggleLesson = async (lessonId: number) => {
    if (expandedLessonId === lessonId) {
      setExpandedLessonId(null);
      return;
    }

    setExpandedLessonId(lessonId);
    if (!classId || linkedClassworks[lessonId]) return;

    setLoadingClassworkId(lessonId);
    setError("");
    try {
      const response = await apiFetch(
        `/api/v1/lessons/my-class/${classId}/lesson/${lessonId}/linked-classwork`,
      );
      if (!response.ok) {
        throw new Error("Unable to load classworks for this lesson.");
      }

      const data = (await response.json()) as LinkedClasswork[];
      setLinkedClassworks((current) => ({
        ...current,
        [lessonId]: data,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load classworks for this lesson.",
      );
    } finally {
      setLoadingClassworkId(null);
    }
  };

  const loadLessonClassworks = async (lessonId: number) => {
    if (!classId) return;

    setLoadingClassworkId(lessonId);
    setError("");
    try {
      const response = await apiFetch(
        `/api/v1/lessons/my-class/${classId}/lesson/${lessonId}/linked-classwork`,
      );
      if (!response.ok) {
        throw new Error("Unable to load classworks for this lesson.");
      }

      const data = (await response.json()) as LinkedClasswork[];
      setLinkedClassworks((current) => ({
        ...current,
        [lessonId]: data,
      }));
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load classworks for this lesson.",
      );
    } finally {
      setLoadingClassworkId(null);
    }
  };

  const openClassworkForm = (lesson: Lesson) => {
    setError("");
    setClassworkLesson(lesson);
    setClassworkDraft(emptyClassworkDraft);
    setClassworkMaterials([]);
    setExpandedLessonId(lesson.lesson_id);
  };

  const openLessonManager = (lesson: Lesson) => {
    setError("");
    setSelectedLesson(lesson);
    setLessonDraft({
      title: lesson.title,
      description: lesson.description || "",
      content: lesson.content || "",
      order_index: String(lesson.order_index || 1),
      is_published: lesson.is_published,
      show_scores: lesson.show_scores,
    });
    setLessonClassIds(classId ? [Number(classId)] : []);
  };

  const closeLessonManager = () => {
    if (
      isSavingLesson ||
      isArchivingLesson ||
      removingLessonAttachmentId !== null
    )
      return;
    setSelectedLesson(null);
    setLessonDraft(null);
    setLessonClassIds([]);
    setShowArchiveConfirm(false);
    setError("");
  };

  const toggleLessonClass = (targetClassId: number) => {
    setLessonClassIds((current) =>
      current.includes(targetClassId)
        ? current.filter((id) => id !== targetClassId)
        : [...current, targetClassId],
    );
  };

  const saveLesson = async () => {
    if (!selectedLesson || !lessonDraft) return;

    setError("");
    if (!lessonDraft.title.trim()) {
      setError("Lesson title is required.");
      return;
    }
    if (lessonClassIds.length === 0) {
      setError("Select at least one class or section.");
      return;
    }
    const orderIndex = Number(lessonDraft.order_index);
    if (!Number.isInteger(orderIndex) || orderIndex < 1) {
      setError("Lesson order must be a positive whole number.");
      return;
    }

    setIsSavingLesson(true);
    try {
      const updateResponse = await apiFetch(
        `/api/v1/lessons/${selectedLesson.lesson_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: lessonDraft.title.trim(),
            description: lessonDraft.description.trim() || null,
            content: lessonDraft.content.trim() || null,
            order_index: orderIndex,
            is_published: lessonDraft.is_published,
            is_draft: !lessonDraft.is_published,
          }),
        },
      );
      if (!updateResponse.ok) {
        throw new Error("Unable to update lesson.");
      }

      let updatedLesson = (await updateResponse.json()) as Lesson;

      const assignResponse = await apiFetch(
        `/api/v1/lessons/${selectedLesson.lesson_id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_ids: lessonClassIds,
            is_published: lessonDraft.is_published,
          }),
        },
      );
      if (!assignResponse.ok) {
        throw new Error(
          "Lesson details were saved, but section assignment failed.",
        );
      }

      if (lessonDraft.is_published) {
        const publishResponse = await apiFetch(
          `/api/v1/lessons/${selectedLesson.lesson_id}/publish`,
          {
            method: "PUT",
          },
        );
        if (!publishResponse.ok) {
          throw new Error("Lesson details were saved, but publishing failed.");
        }
      }

      const detailResponse = await apiFetch(
        `/api/v1/lessons/${selectedLesson.lesson_id}`,
      );
      if (detailResponse.ok) {
        updatedLesson = (await detailResponse.json()) as Lesson;
      }
      setLessons((current) =>
        current
          .map((lesson) =>
            lesson.lesson_id === updatedLesson.lesson_id
              ? updatedLesson
              : lesson,
          )
          .sort((a, b) => a.order_index - b.order_index),
      );
      setSelectedLesson(updatedLesson);
      setLessonDraft({
        title: updatedLesson.title,
        description: updatedLesson.description || "",
        content: updatedLesson.content || "",
        order_index: String(updatedLesson.order_index || 1),
        is_published: updatedLesson.is_published,
        show_scores: updatedLesson.show_scores,
      });
      toast.success("Lesson updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update lesson.");
      toast.error(err instanceof Error ? err.message : "Unable to update lesson.");
    } finally {
      setIsSavingLesson(false);
    }
  };

  const removeLessonAttachment = async (attachmentId: number) => {
    if (!selectedLesson) return;

    setRemovingLessonAttachmentId(attachmentId);
    setError("");
    try {
      const response = await apiFetch(
        `/api/v1/lessons/${selectedLesson.lesson_id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error("Unable to remove lesson material.");
      }

      const updatedLesson = {
        ...selectedLesson,
        attachments: selectedLesson.attachments.filter(
          (attachment) => attachment.lesson_attachment_id !== attachmentId,
        ),
      };
      setSelectedLesson(updatedLesson);
      setLessons((current) =>
        current.map((lesson) =>
          lesson.lesson_id === updatedLesson.lesson_id ? updatedLesson : lesson,
        ),
      );
      toast.success("Lesson material removed.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to remove lesson material.",
      );
      toast.error(err instanceof Error ? err.message : "Unable to remove lesson material.");
    } finally {
      setRemovingLessonAttachmentId(null);
    }
  };

  const handleArchiveLessonDirect = async (lesson: Lesson) => {
    const response = await apiFetch(
      `/api/v1/lessons/${lesson.lesson_id}/archive`,
      {
        method: "PUT",
      },
    );
    if (!response.ok) {
      throw new Error("Unable to archive lesson.");
    }
    setLessons((current) =>
      current.filter((item) => item.lesson_id !== lesson.lesson_id),
    );
    if (selectedLesson?.lesson_id === lesson.lesson_id) {
      setSelectedLesson(null);
      setLessonDraft(null);
      setLessonClassIds([]);
      setShowArchiveConfirm(false);
    }
    toast.success("Lesson archived.");
  };

  const archiveLesson = async () => {
    if (!selectedLesson) return;

    setIsArchivingLesson(true);
    setError("");
    try {
      await handleArchiveLessonDirect(selectedLesson);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to archive lesson.",
      );
      toast.error(err instanceof Error ? err.message : "Unable to archive lesson.");
    } finally {
      setIsArchivingLesson(false);
    }
  };

  const closeClassworkForm = () => {
    if (isCreatingClasswork) return;
    setClassworkLesson(null);
    setClassworkDraft(emptyClassworkDraft);
    setClassworkMaterials([]);
    setError("");
  };

  const addClassworkMaterials = (files: FileList | null) => {
    if (!files) return;

    const selected = Array.from(files);
    const invalidType = selected.find((file) => {
      const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
      return !allowedMaterialExtensions.includes(extension);
    });
    if (invalidType) {
      const msg = `${invalidType.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`;
      setError(msg);
      toast.error(msg);
      return;
    }

    const oversized = selected.find((file) => file.size > maxMaterialSize);
    if (oversized) {
      const msg = `${oversized.name} is larger than the 10 MB file limit.`;
      setError(msg);
      toast.error(msg);
      return;
    }

    setError("");
    setClassworkMaterials((current) => {
      const existing = new Set(
        current.map((file) => `${file.name}-${file.size}`),
      );
      return [
        ...current,
        ...selected.filter(
          (file) => !existing.has(`${file.name}-${file.size}`),
        ),
      ];
    });
  };

  const removeClassworkMaterial = (index: number) => {
    setClassworkMaterials((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  const openClassworkDetail = async (classwork: LinkedClasswork) => {
    setDetailLoadingId(classwork.classwork_assignment_id);
    setDetailError("");

    try {
      const [detailResponse, trackingResponse] = await Promise.all([
        apiFetch(
          `/api/v1/classwork-assignments/assignment/${classwork.classwork_assignment_id}`,
        ),
        apiFetch(
          `/api/v1/submissions/assignment/${classwork.classwork_assignment_id}/tracking`,
        ),
      ]);

      if (!detailResponse.ok) {
        const body = await detailResponse.json().catch(() => ({}));
        const detail = String(body.detail || "");
        throw new Error(
          detail.includes("locked") || detail.includes("not available")
            ? LOCKED_CLASSWORK_MESSAGE
            : "Unable to load classwork details.",
        );
      }

      if (!trackingResponse.ok) {
        throw new Error("Unable to load submission tracking.");
      }

      setSelectedClasswork((await detailResponse.json()) as ClassworkDetail);
      setSelectedTracking(
        (await trackingResponse.json()) as SubmissionTracking,
      );
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
    setSelectedTracking(null);
    setDetailError("");
  };

  const createClassworkForLesson = async () => {
    if (!classworkLesson || !classId || !subjectId) return;

    // Sentinel: lesson_id === 0 means this is a subject-level (quarterly assessment) classwork.
    const isSubjectLevel = classworkLesson.lesson_id === 0;

    setError("");
    const isReadingClasswork = classworkDraft.classwork_type === "READING";
    // Quiz question files go through the quiz import flow, not classwork attachments.
    const allowsMaterialUpload = classworkDraft.classwork_type !== "QUIZ";
    if (!classworkDraft.title.trim()) {
      const msg = "Classwork title is required.";
      setError(msg);
      toast.error(msg);
      return;
    }
    const totalPoints = Number(classworkDraft.total_points);
    if (
      !isReadingClasswork &&
      classworkDraft.total_points &&
      Number.isNaN(totalPoints)
    ) {
      const msg = "Total points must be a number.";
      setError(msg);
      toast.error(msg);
      return;
    }

    setIsCreatingClasswork(true);
    try {
      const createResponse = await apiFetch("/api/v1/classwork-assignments/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: classworkDraft.title.trim(),
          description: classworkDraft.description.trim() || null,
          instructions: classworkDraft.instructions.trim() || null,
          classwork_type: classworkDraft.classwork_type,
          classwork_category: classworkDraft.classwork_category || null,
          total_points: isReadingClasswork
            ? null
            : classworkDraft.total_points
              ? totalPoints
              : null,
          subject_id: Number(subjectId),
          is_published: classworkDraft.is_published,
          show_scores: classworkDraft.show_scores,
          // Subject-level classworks (quarterly assessments) are not linked to any lesson.
          lesson_ids: isSubjectLevel ? [] : [classworkLesson.lesson_id],
        }),
      });

      if (!createResponse.ok) {
        throw new Error("Unable to create classwork.");
      }

      const created = (await createResponse.json()) as { classwork_id: number };

      for (const material of allowsMaterialUpload ? classworkMaterials : []) {
        const formData = new FormData();
        formData.append("file", material);
        const uploadResponse = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${created.classwork_id}/attachments`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!uploadResponse.ok) {
          const uploadError = await uploadResponse.json().catch(() => ({}));
          throw new Error(
            uploadError.detail ||
            `Classwork was created, but ${material.name} could not be uploaded.`,
          );
        }
      }

      const activeLoad = loads.find(
        (l) =>
          String(l.class_id) === String(classId) &&
          String(l.subject_id) === String(subjectId),
      );

      const assignResponse = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${created.classwork_id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_ids: [Number(classId)],
            academic_period_id: activeLoad?.academic_period_id || currentAcademicPeriodId || undefined,
            due_date: classworkDraft.due_date
              ? new Date(classworkDraft.due_date).toISOString()
              : null,
            allow_late_submissions: classworkDraft.allow_late_submissions,
            is_published: classworkDraft.is_published,
          }),
        },
      );

      if (!assignResponse.ok) {
        const assignError = await assignResponse.json().catch(() => ({}));
        const detail = assignError.detail;
        if (Array.isArray(detail)) {
          const msgs = detail
            .map((e: { loc?: (string | number)[]; msg?: string }) => {
              const field = (e.loc || []).filter((x) => x !== "body").join(".");
              return field ? `${field}: ${e.msg}` : (e.msg || "Validation error");
            })
            .join("; ");
          throw new Error(msgs || "Assignment failed.");
        }
        throw new Error(
          typeof detail === "string" ? detail : "Classwork was created, but assignment failed.",
        );
      }

      if (isSubjectLevel) {
        // Refresh the subject-level assignments count so the new quarterly assessment appears.
        const refreshResponse = await apiFetch(
          `/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`,
        );
        if (refreshResponse.ok) {
          const refreshed = (await refreshResponse.json()) as LinkedClasswork[];
          setClassworkCount(refreshed.length);
        }
      } else if (classworkLesson) {
        await loadLessonClassworks(classworkLesson.lesson_id);
      }

      setClassworkLesson(null);
      setClassworkDraft(emptyClassworkDraft);
      setClassworkMaterials([]);
      toast.success("Classwork created.");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unable to create classwork.";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsCreatingClasswork(false);
    }
  };


  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {activeLessonDetail ? (
              <>
                {error && (
                  <div className="mx-3 mt-3 sm:mx-4 md:mx-6 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <TeacherLessonDetailScreen
                  lesson={activeLessonDetail}
                  subjectName={subjectName}
                  closeLessonDetail={closeLessonDetail}
                  openLessonManager={openLessonManager}
                  openClassworkForm={openClassworkForm}
                  openClassworkDetail={openClassworkDetail}
                  linkedClassworks={
                    linkedClassworks[activeLessonDetail.lesson_id] || []
                  }
                  isLoadingClasswork={
                    loadingClassworkId === activeLessonDetail.lesson_id
                  }
                />
              </>
            ) : isTOSOpen && subjectId ? (
              <main>
                <TOSGeneratorScreen
                  subjectId={Number(subjectId)}
                  subjectName={subjectName || "Subject"}
                  competencies={competencies}
                  onBack={() => setIsTOSOpen(false)}
                />
              </main>
            ) : (
              <>
                <div data-page-tabs-sticky-region>
                  <header className="flex min-w-0 flex-col gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <SidebarTrigger className="shrink-0 md:hidden" />
                      <Breadcrumb className="min-w-0">
                        <Breadcrumb.List className="flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-2">
                          <Breadcrumb.Item>
                            <Breadcrumb.Link href="/teacher/classes" className="whitespace-nowrap">
                              Classes
                            </Breadcrumb.Link>
                          </Breadcrumb.Item>

                          <Breadcrumb.Separator />
                          <Breadcrumb.Item className="min-w-0">
                            <Breadcrumb.Page className="block truncate">{subjectName}</Breadcrumb.Page>
                          </Breadcrumb.Item>
                        </Breadcrumb.List>
                      </Breadcrumb>
                    </div>

                    <div className="flex flex-wrap w-full gap-2 md:flex md:w-auto md:flex-nowrap md:items-center">
                      <Button
                        type="button"
                        size="header"
                        variant="outline"
                        onClick={() =>
                          navigate(
                            `/teacher/classes/${classId}/subjects/${subjectId}/lesson-planner`,
                          )
                        }
                        className="w-full whitespace-nowrap md:w-auto"
                      >
                        <BookOpenCheck size={16} />
                        Lesson Planner
                      </Button>
                      {activeTab === "lessons" && (
                        <>
                          <Button
                            type="button"
                            size="header"
                            variant="outline"
                            onClick={() => openCompetencyForm(null)}
                            className="w-full whitespace-nowrap md:w-auto"
                          >
                            <Award size={16} />
                            Add Competency
                          </Button>
                          <Button
                            type="button"
                            size="header"
                            variant="default"
                            onClick={() => {
                              setSelectedCompetencyIdForNewLesson(undefined);
                              setIsCreatingLesson(true);
                            }}
                            className="w-full whitespace-nowrap md:w-auto"
                          >
                            <Plus size={16} />
                            Add Lesson
                          </Button>
                        </>
                      )}
                      {activeTab === "classwork" && (
                        <Button
                          type="button"
                          size="header"
                          variant="default"
                          onClick={() => setIsCreatingSubjectClasswork(true)}
                          className="w-full whitespace-nowrap md:w-auto"
                        >
                          <Plus size={16} />
                          New Classwork
                        </Button>
                      )}


                    </div>
                  </header>
                  <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                    <Tabs
                      tabs={tabs}
                      activeTab={activeTab}
                      onTabChange={setActiveTab}
                    />
                  </div>
                </div>

                <div className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-4 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
                  {error && (
                    <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <Card className="block bg-primary">
                    <Card.Content className="flex items-start justify-between gap-4">
                      <div>
                        <Card.Title className="break-words text-2xl font-bold sm:text-3xl">
                          {subjectName}
                        </Card.Title>
                        <p className="text-xs text-black">
                          {sectionName
                            ? `Section assigned: ${sectionName}`
                            : "Section assigned for this subject"}
                        </p>
                      </div>
                      <Info size={16} />
                    </Card.Content>
                  </Card>

                  {activeTab === "classwork" && subjectId ? (
                    <SubjectClassworkTab
                      classId={classId}
                      subjectId={subjectId}
                      subjectName={subjectName}
                      sectionName={sectionName}
                      isCreateOpen={isCreatingSubjectClasswork}
                      onCloseCreate={() => setIsCreatingSubjectClasswork(false)}
                    />
                  ) : (
                    <SubjectLessonList
                      lessonSearch={lessonSearch}
                      setLessonSearch={setLessonSearch}
                      lessonSort={lessonSort}
                      setLessonSort={setLessonSort}
                      filteredLessons={filteredLessons}
                      totalLessons={lessons.length}
                      expandedLessonId={expandedLessonId}
                      linkedClassworks={linkedClassworks}
                      loadingClassworkId={loadingClassworkId}
                      toggleLesson={toggleLesson}
                      openLessonManager={openLessonManager}
                      openClassworkForm={openClassworkForm}
                      openClassworkDetail={openClassworkDetail}
                      subjectAssignments={subjectAssignments}
                      openLessonDetail={openLessonDetail}
                      competencies={competencies}
                      openCompetencyForm={openCompetencyForm}
                      onAddLessonToCompetency={handleAddLessonToCompetency}
                      onArchiveCompetency={handleArchiveCompetency}
                      onArchiveLesson={handleArchiveLessonDirect}
                      overviewMastery={overviewMastery}
                      classworkCount={classworkCount}
                      overviewCompletion={overviewCompletion}
                    />
                  )}
                </div>
              </>
            )}

            {selectedLesson && lessonDraft && (
              <ManageLessonModal
                selectedLesson={selectedLesson}
                lessonDraft={lessonDraft}
                setLessonDraft={setLessonDraft}
                classesForSubject={classesForSubject}
                classId={classId}
                lessonClassIds={lessonClassIds}
                isSavingLesson={isSavingLesson}
                isArchivingLesson={isArchivingLesson}
                removingLessonAttachmentId={removingLessonAttachmentId}
                error={error}
                showArchiveConfirm={showArchiveConfirm}
                setShowArchiveConfirm={setShowArchiveConfirm}
                closeLessonManager={closeLessonManager}
                saveLesson={saveLesson}
                archiveLesson={archiveLesson}
                toggleLessonClass={toggleLessonClass}
                removeLessonAttachment={removeLessonAttachment}
              />
            )}

            {classworkLesson && (
              <ClassworkFormModal
                classworkLesson={classworkLesson}
                classworkDraft={classworkDraft}
                setClassworkDraft={setClassworkDraft}
                classworkMaterials={classworkMaterials}
                isCreatingClasswork={isCreatingClasswork}
                error={error}
                closeClassworkForm={closeClassworkForm}
                addClassworkMaterials={addClassworkMaterials}
                removeClassworkMaterial={removeClassworkMaterial}
                createClassworkForLesson={createClassworkForLesson}
              />
            )}

            {isCreatingLesson && (
              <CreateLessonModal
                classId={classId}
                subjectId={subjectId}
                initialCompetencyId={selectedCompetencyIdForNewLesson}
                onClose={() => {
                  setIsCreatingLesson(false);
                  setSelectedCompetencyIdForNewLesson(undefined);
                }}
                onCreated={() => {
                  setIsCreatingLesson(false);
                  setSelectedCompetencyIdForNewLesson(undefined);
                  window.location.reload();
                }}
              />
            )}

            {(selectedClasswork || detailLoadingId || detailError) && (
              <Dialog
                open={Boolean(
                  selectedClasswork || detailLoadingId || detailError,
                )}
                onOpenChange={(open) => {
                  if (!open) closeClassworkDetail();
                }}
              >
                <Dialog.Content
                  size="4xl"
                  className="no-scrollbar h-fit max-h-[90vh] overflow-x-hidden"
                  overlay={{ className: "bg-black/50" }}
                >
                  <Dialog.Header asChild>
                    <>
                      <div>
                        <p className="text-xs font-bold uppercase">
                          Teacher classwork detail
                        </p>
                        <p className="text-xl font-bold">
                          {selectedClasswork?.title || "Classwork"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger render={<button
                            type="button"
                            onClick={closeClassworkDetail}
                            aria-label="Close modal"
                            className={dialogHeaderCloseButtonClassName}
                          >
                            <X className="size-4" />
                          </button>} />
                          <TooltipContent>Close modal</TooltipContent>
                        </Tooltip>
                      </div>
                    </>
                  </Dialog.Header>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {detailLoadingId ? (
                      <div className="p-8 text-center text-sm font-semibold text-gray-600">
                        Loading classwork details...
                      </div>
                    ) : detailError ? (
                      <div className="m-5 border-2 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {detailError}
                      </div>
                    ) : selectedClasswork ? (
                      <div className="grid grid-cols-1 gap-5 p-5">
                        <div className="space-y-4">
                          <Card className="block">
                            <Card.Content className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="secondary"
                                  className="text-xs font-semibold"
                                >
                                  {selectedClasswork.classwork_type || "Classwork"}
                                </Badge>
                                {selectedClasswork.classwork_category && (
                                  <Badge
                                    variant="solid"
                                    className="text-xs font-semibold"
                                  >
                                    {selectedClasswork.classwork_category.replace(
                                      /_/g,
                                      " ",
                                    )}
                                  </Badge>
                                )}
                                <Badge
                                  variant="solid"
                                  className="text-xs font-semibold"
                                >
                                  {selectedClasswork.is_published
                                    ? "Published"
                                    : "Draft"}
                                </Badge>
                                {selectedClasswork.is_locked && (
                                  <Badge variant="destructive" size="sm" className="font-semibold">
                                    Locked
                                  </Badge>
                                )}
                              </div>

                              <Card.Title className="text-3xl font-bold">
                                {selectedClasswork.title}
                              </Card.Title>
                              <div className="grid gap-3 text-sm sm:grid-cols-3">
                                <div className="border-2 border-black bg-gray-50 p-3">
                                  <p className="font-semibold text-gray-600">
                                    Due date
                                  </p>
                                  <p className="font-bold">
                                    {selectedClasswork.due_date
                                      ? new Date(
                                        selectedClasswork.due_date,
                                      ).toLocaleString()
                                      : "No due date"}
                                  </p>
                                </div>
                                <div className="border-2 border-black bg-gray-50 p-3">
                                  <p className="font-semibold text-gray-600">
                                    Points
                                  </p>
                                  <p className="font-bold">
                                    {selectedClasswork.total_points ?? "Not set"}
                                  </p>
                                </div>
                                <div className="border-2 border-black bg-gray-50 p-3">
                                  <p className="font-semibold text-gray-600">
                                    Section
                                  </p>
                                  <p className="font-bold">
                                    {selectedClasswork.section_name ||
                                      sectionName ||
                                      "Class"}
                                  </p>
                                </div>
                              </div>
                            </Card.Content>
                          </Card>

                          {(selectedClasswork.description ||
                            selectedClasswork.instructions) && (
                              <Card className="block">
                                <Card.Content className="space-y-3">
                                  {selectedClasswork.description && (
                                    <div>
                                      <Card.Title className="mb-0 font-bold">
                                        Description
                                      </Card.Title>
                                      <p className="mt-1 text-sm">
                                        {selectedClasswork.description}
                                      </p>
                                    </div>
                                  )}
                                  {selectedClasswork.instructions && (
                                    <div>
                                      <Card.Title className="mb-0 font-bold">
                                        Instructions
                                      </Card.Title>
                                      <p className="mt-1 whitespace-pre-wrap text-sm">
                                        {selectedClasswork.instructions}
                                      </p>
                                    </div>
                                  )}
                                </Card.Content>
                              </Card>
                            )}

                          <Card className="block">
                            <Card.Content className="space-y-3">
                              <div className="flex items-center gap-2">
                                <Paperclip size={18} />
                                <Card.Title className="mb-0 text-base font-bold">
                                  Reference Files
                                </Card.Title>
                                <Badge
                                  variant="secondary"
                                  size="sm"
                                  className="ml-auto"
                                >
                                  {selectedClasswork.attachments?.length || 0}
                                </Badge>
                              </div>
                              {selectedClasswork.attachments?.length ? (
                                <AttachmentDisplay
                                  attachments={selectedClasswork.attachments}
                                  type="classwork"
                                  downloadUrl={(attachmentId) =>
                                    `${API_URL}/api/v1/classwork-assignments/classwork/${selectedClasswork.classwork_id}/attachments/${attachmentId}/download`
                                  }
                                />
                              ) : (
                                <p className="text-sm text-gray-600">
                                  No classwork files attached.
                                </p>
                              )}
                            </Card.Content>
                          </Card>
                        </div>

                        <aside className="space-y-4">
                          <Card className="block bg-primary">
                            <Card.Content>
                              <div className="flex items-center gap-2">
                                <Users size={18} />
                                <Card.Title className="mb-0 text-base font-bold">
                                  Submission Tracking
                                </Card.Title>
                              </div>
                              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                                <div className="border-2 border-black bg-white p-2">
                                  <p className="text-2xl font-bold">
                                    {selectedTracking?.total_students ?? 0}
                                  </p>
                                  <p className="text-[11px] font-semibold">
                                    Students
                                  </p>
                                </div>
                                <div className="border-2 border-black bg-white p-2">
                                  <p className="text-2xl font-bold">
                                    {selectedTracking?.submitted_count ?? 0}
                                  </p>
                                  <p className="text-[11px] font-semibold">
                                    Submitted
                                  </p>
                                </div>
                                <div className="border-2 border-black bg-white p-2">
                                  <p className="text-2xl font-bold">
                                    {selectedTracking?.missing_count ?? 0}
                                  </p>
                                  <p className="text-[11px] font-semibold">
                                    Pending
                                  </p>
                                </div>
                              </div>
                            </Card.Content>
                          </Card>

                          <Card className="block">
                            <Card.Content>
                              <Card.Title className="mb-3 text-base font-bold">
                                Submitted Students
                              </Card.Title>
                              <div className="space-y-2">
                                {(selectedTracking?.submitted ?? [])
                                  .slice(0, 6)
                                  .map((student) => (
                                    <div
                                      key={student.student_id}
                                      className="border-2 border-black px-3 py-2 text-sm"
                                    >
                                      <p className="font-semibold">
                                        {student.student_name}
                                      </p>
                                      <p className="text-xs text-gray-600">
                                        {student.status}
                                        {student.submitted_at
                                          ? ` | ${new Date(student.submitted_at).toLocaleString()}`
                                          : ""}
                                        {student.grade != null
                                          ? ` | Grade ${student.grade}`
                                          : ""}
                                      </p>
                                    </div>
                                  ))}
                                {(selectedTracking?.submitted ?? []).length ===
                                  0 && (
                                    <p className="text-sm text-gray-600">
                                      No submissions yet.
                                    </p>
                                  )}
                              </div>
                            </Card.Content>
                          </Card>

                          <Card className="block">
                            <Card.Content>
                              <Card.Title className="mb-3 text-base font-bold">
                                Needs Follow-up
                              </Card.Title>
                              <div className="space-y-2">
                                {(selectedTracking?.missing ?? [])
                                  .slice(0, 6)
                                  .map((student) => (
                                    <div
                                      key={student.student_id}
                                      className="border-2 border-black px-3 py-2 text-sm"
                                    >
                                      <p className="font-semibold">
                                        {student.student_name}
                                      </p>
                                      <p className="text-xs text-gray-600">
                                        {student.status.replace(/_/g, " ")}
                                      </p>
                                    </div>
                                  ))}
                                {(selectedTracking?.missing ?? []).length === 0 && (
                                  <p className="text-sm text-gray-600">
                                    Everyone is accounted for.
                                  </p>
                                )}
                              </div>
                            </Card.Content>
                          </Card>
                        </aside>
                      </div>
                    ) : null}
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="header"
                      onClick={() => selectedClasswork && navigate(`/teacher/classworks/${selectedClasswork.classwork_id}`)}
                      disabled={!selectedClasswork}
                    >
                      View classwork details
                    </Button>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>
            )}

            {/* ── Competency Create/Edit Modal ── */}
            {isCompetencyModalOpen && subjectId && (
              <CompetencyModal
                open={isCompetencyModalOpen}
                onOpenChange={setIsCompetencyModalOpen}
                subjectId={Number(subjectId)}
                initialData={editingCompetency}
                onSuccess={handleCompetencySaved}
              />
            )}

            {/* ── Lesson Create Modal ── */}
            {isCreatingLesson && (
              <CreateLessonModal
                classId={classId}
                subjectId={subjectId}
                initialCompetencyId={selectedCompetencyIdForNewLesson}
                onClose={() => {
                  setIsCreatingLesson(false);
                  setSelectedCompetencyIdForNewLesson(undefined);
                }}
                onCreated={async () => {
                  setIsCreatingLesson(false);
                  setSelectedCompetencyIdForNewLesson(undefined);
                  await refreshSubjectData();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function averageRosterMetric<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
) {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => {
    const value = row[key];
    return (
      sum + (typeof value === "number" && Number.isFinite(value) ? value : 0)
    );
  }, 0);
  return Number((total / rows.length).toFixed(2));
}
