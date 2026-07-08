import { useEffect, useMemo, useState } from "react";
import { Archive, ChevronRight, Info, Paperclip, Plus, Trash2, Users, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { API_URL, apiFetch } from "@/lib/api";
import AttachmentDisplay from "@/components/attachment-display";
import { getTeacherRecordPeriods, getTeacherStudentRoster } from "@/lib/student-record-api";
import ClassworkFormModal from "./subject-details/ClassworkFormModal";
import LessonClassworkList from "./subject-details/LessonClassworkList";
import MetricCard from "./subject-details/MetricCard";
import StudentRecordsPanel from "./subject-details/StudentRecordsPanel";
import {
  LOCKED_CLASSWORK_MESSAGE,
  allowedMaterialExtensions,
  emptyClassworkDraft,
  maxMaterialSize,
} from "./subject-details/constants";
import type {
  ClassworkDetail,
  ClassworkDraft,
  Lesson,
  LessonDraft,
  LinkedClasswork,
  SubmissionTracking,
  TeacherClassLoad,
} from "./subject-details/types";

export default function SubjectDetails() {
  const { classId, subjectId } = useParams<{ classId: string; subjectId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"lessons" | "students">("lessons");
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
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

  useEffect(() => {
    const loadContext = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [classesResponse, lessonsResponse, assignmentsResponse] = await Promise.all([
          apiFetch("/api/v1/classwork-assignments/teacher/classes"),
          classId && subjectId
            ? apiFetch(`/api/v1/lessons/my-class/${classId}/subject/${subjectId}`)
            : Promise.resolve(null),
          classId && subjectId
            ? apiFetch(`/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`)
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
          setLessons(lessonData.filter((lesson) => !lesson.is_archived));
        }

        if (assignmentsResponse) {
          if (!assignmentsResponse.ok) {
            throw new Error("Unable to load classwork overview.");
          }
          const assignments = (await assignmentsResponse.json()) as unknown[];
          setClassworkCount(assignments.length);
        }

        if (classId && subjectId) {
          const periods = await getTeacherRecordPeriods(classId, subjectId);
          const periodId = periods.default_academic_period_id || periods.periods[0]?.academic_period_id;
          if (periodId) {
            const roster = await getTeacherStudentRoster(classId, subjectId, periodId);
            setOverviewMastery(averageRosterMetric(roster.students, "running_classwork_percentage"));
            setOverviewCompletion(averageRosterMetric(roster.students, "completion_rate"));
          } else {
            setOverviewMastery(0);
            setOverviewCompletion(0);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load subject details.");
      } finally {
        setIsLoading(false);
      }
    };

    loadContext();
  }, [classId, subjectId]);

  const subjectLoad = useMemo(() => {
    return loads.find(
      (load) =>
        load.class_id === Number(classId) && load.subject_id === Number(subjectId)
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
        .some((value) => value?.toLowerCase().includes(query))
      )
      : lessons;

    return [...visibleLessons].sort((a, b) => {
      if (lessonSort === "title") return a.title.localeCompare(b.title);
      if (lessonSort === "newest") {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      if (lessonSort === "oldest") {
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      }
      return (a.order_index || 0) - (b.order_index || 0) || a.title.localeCompare(b.title);
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
      const response = await apiFetch(`/api/v1/lessons/my-class/${classId}/lesson/${lessonId}/linked-classwork`);
      if (!response.ok) {
        throw new Error("Unable to load classworks for this lesson.");
      }

      const data = (await response.json()) as LinkedClasswork[];
      setLinkedClassworks((current) => ({
        ...current,
        [lessonId]: data,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load classworks for this lesson.");
    } finally {
      setLoadingClassworkId(null);
    }
  };

  const loadLessonClassworks = async (lessonId: number) => {
    if (!classId) return;

    setLoadingClassworkId(lessonId);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/lessons/my-class/${classId}/lesson/${lessonId}/linked-classwork`);
      if (!response.ok) {
        throw new Error("Unable to load classworks for this lesson.");
      }

      const data = (await response.json()) as LinkedClasswork[];
      setLinkedClassworks((current) => ({
        ...current,
        [lessonId]: data,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load classworks for this lesson.");
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
    });
    setLessonClassIds(classId ? [Number(classId)] : []);
  };

  const closeLessonManager = () => {
    if (isSavingLesson || isArchivingLesson || removingLessonAttachmentId !== null) return;
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
        : [...current, targetClassId]
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
      const updateResponse = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}`, {
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
      });
      if (!updateResponse.ok) {
        throw new Error("Unable to update lesson.");
      }

      let updatedLesson = (await updateResponse.json()) as Lesson;

      const assignResponse = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_ids: lessonClassIds,
          is_published: lessonDraft.is_published,
        }),
      });
      if (!assignResponse.ok) {
        throw new Error("Lesson details were saved, but section assignment failed.");
      }

      if (lessonDraft.is_published) {
        const publishResponse = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}/publish`, {
          method: "PUT",
        });
        if (!publishResponse.ok) {
          throw new Error("Lesson details were saved, but publishing failed.");
        }
      }

      const detailResponse = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}`);
      if (detailResponse.ok) {
        updatedLesson = (await detailResponse.json()) as Lesson;
      }
      setLessons((current) =>
        current
          .map((lesson) => lesson.lesson_id === updatedLesson.lesson_id ? updatedLesson : lesson)
          .sort((a, b) => a.order_index - b.order_index)
      );
      setSelectedLesson(updatedLesson);
      setLessonDraft({
        title: updatedLesson.title,
        description: updatedLesson.description || "",
        content: updatedLesson.content || "",
        order_index: String(updatedLesson.order_index || 1),
        is_published: updatedLesson.is_published,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update lesson.");
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
        { method: "DELETE" }
      );
      if (!response.ok) {
        throw new Error("Unable to remove lesson material.");
      }

      const updatedLesson = {
        ...selectedLesson,
        attachments: selectedLesson.attachments.filter(
          (attachment) => attachment.lesson_attachment_id !== attachmentId
        ),
      };
      setSelectedLesson(updatedLesson);
      setLessons((current) =>
        current.map((lesson) => lesson.lesson_id === updatedLesson.lesson_id ? updatedLesson : lesson)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove lesson material.");
    } finally {
      setRemovingLessonAttachmentId(null);
    }
  };

  const archiveLesson = async () => {
    if (!selectedLesson) return;

    setIsArchivingLesson(true);
    setError("");
    try {
      const response = await apiFetch(`/api/v1/lessons/${selectedLesson.lesson_id}/archive`, {
        method: "PUT",
      });
      if (!response.ok) {
        throw new Error("Unable to archive lesson.");
      }
      setLessons((current) => current.filter((lesson) => lesson.lesson_id !== selectedLesson.lesson_id));
      setSelectedLesson(null);
      setLessonDraft(null);
      setLessonClassIds([]);
      setShowArchiveConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive lesson.");
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
      setError(`${invalidType.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`);
      return;
    }

    const oversized = selected.find((file) => file.size > maxMaterialSize);
    if (oversized) {
      setError(`${oversized.name} is larger than the 4 MB file limit.`);
      return;
    }

    setError("");
    setClassworkMaterials((current) => {
      const existing = new Set(current.map((file) => `${file.name}-${file.size}`));
      return [...current, ...selected.filter((file) => !existing.has(`${file.name}-${file.size}`))];
    });
  };

  const removeClassworkMaterial = (index: number) => {
    setClassworkMaterials((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const openClassworkDetail = async (classwork: LinkedClasswork) => {
    setDetailLoadingId(classwork.classwork_assignment_id);
    setDetailError("");

    try {
      const [detailResponse, trackingResponse] = await Promise.all([
        apiFetch(`/api/v1/classwork-assignments/assignment/${classwork.classwork_assignment_id}`),
        apiFetch(`/api/v1/submissions/assignment/${classwork.classwork_assignment_id}/tracking`),
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
      setSelectedTracking((await trackingResponse.json()) as SubmissionTracking);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to load classwork details.");
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

    setError("");
    const isReadingClasswork = classworkDraft.classwork_type === "READING";
    // Quiz question files go through the quiz import flow, not classwork attachments.
    const allowsMaterialUpload = classworkDraft.classwork_type !== "QUIZ";
    if (!classworkDraft.title.trim()) {
      setError("Classwork title is required.");
      return;
    }
    const totalPoints = Number(classworkDraft.total_points);
    if (!isReadingClasswork && classworkDraft.total_points && Number.isNaN(totalPoints)) {
      setError("Total points must be a number.");
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
          total_points: isReadingClasswork ? null : classworkDraft.total_points ? totalPoints : null,
          subject_id: Number(subjectId),
          is_published: classworkDraft.is_published,
          lesson_ids: [classworkLesson.lesson_id],
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
          }
        );

        if (!uploadResponse.ok) {
          const uploadError = await uploadResponse.json().catch(() => ({}));
          throw new Error(
            uploadError.detail || `Classwork was created, but ${material.name} could not be uploaded.`
          );
        }
      }

      const assignResponse = await apiFetch(`/api/v1/classwork-assignments/classwork/${created.classwork_id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_ids: [Number(classId)],
          due_date: classworkDraft.due_date ? new Date(classworkDraft.due_date).toISOString() : null,
          allow_late_submissions: classworkDraft.allow_late_submissions,
          is_published: classworkDraft.is_published,
        }),
      });

      if (!assignResponse.ok) {
        throw new Error("Classwork was created, but assignment failed.");
      }

      await loadLessonClassworks(classworkLesson.lesson_id);
      setClassworkLesson(null);
      setClassworkDraft(emptyClassworkDraft);
      setClassworkMaterials([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create classwork.");
    } finally {
      setIsCreatingClasswork(false);
    }
  };

  return (
    <AppLayout>
      <header className="border-b border-gray-300 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/teacher/classes/subjects")}
              className="text-2xl font-bold text-gray-950"
            >
              Subjects
            </button>
            <ChevronRight size={20} />
            <h1 className="text-xl font-bold text-gray-950">{subjectName}</h1>
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(`/teacher/lessons/create?classId=${classId || ""}&subjectId=${subjectId || ""}`)
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-black bg-[#7ABA78] px-5 py-2 font-semibold text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
          >
            <Plus size={16} />
            Add Lesson
          </button>
        </div>
      </header>

      <main className="flex flex-col gap-5 px-5 py-5">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold">{subjectName}</h2>
              <p className="text-xs font-medium">
                {sectionName ? `Section assigned: ${sectionName}` : "Section assigned for this subject"}
              </p>
            </div>
            <Info size={16} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-bold">Subject Overview</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard title="Lesson Mastery" value={`${overviewMastery}%`} note="Average graded classwork performance" />
            <MetricCard title="Classwork Assigned" value={String(classworkCount ?? 0)} note="Active classworks in this subject" />
            <MetricCard title="Completion Percentage" value={`${overviewCompletion}%`} note="Average submitted classwork completion" />
          </div>
        </section>

        <div className="flex flex-wrap gap-2 border-b border-black">
          <button
            type="button"
            onClick={() => setActiveTab("lessons")}
            className={`rounded-t-lg border border-b-0 border-black px-4 py-2 font-semibold ${
              activeTab === "lessons" ? "bg-white" : "bg-[#F6E9B2]"
            }`}
          >
            Lessons & Classwork
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("students")}
            className={`rounded-t-lg border border-b-0 border-black px-4 py-2 font-semibold ${
              activeTab === "students" ? "bg-white" : "bg-[#F6E9B2]"
            }`}
          >
            Students
          </button>
        </div>

        {activeTab === "students" && classId && subjectId ? (
          <StudentRecordsPanel classId={classId} subjectId={subjectId} />
        ) : isLoading ? (
          <p className="py-8 text-center text-gray-500">Loading lessons...</p>
        ) : (
          <LessonClassworkList
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
          />
        )}
      </main>

      {selectedLesson && lessonDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black bg-[#F6E9B2] px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-700">Teacher lesson management</p>
                <h2 className="text-xl font-bold">{selectedLesson.title}</h2>
              </div>
              <button type="button" onClick={closeLessonManager} className="rounded p-1 hover:bg-white/60">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1.25fr_0.85fr]">
              <div className="space-y-4">
                {error && (
                  <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                  </div>
                )}

                <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
                    <div>
                      <label htmlFor="manage-lesson-title" className="mb-1 block text-sm font-semibold">Lesson title</label>
                      <input
                        id="manage-lesson-title"
                        value={lessonDraft.title}
                        onChange={(event) =>
                          setLessonDraft((current) => current ? { ...current, title: event.target.value } : current)
                        }
                        disabled={isSavingLesson}
                        className="w-full rounded-lg border border-gray-700 px-3 py-2"
                      />
                    </div>
                    <div>
                      <label htmlFor="manage-lesson-order" className="mb-1 block text-sm font-semibold">Order</label>
                      <input
                        id="manage-lesson-order"
                        type="number"
                        min="1"
                        step="1"
                        value={lessonDraft.order_index}
                        onChange={(event) =>
                          setLessonDraft((current) => current ? { ...current, order_index: event.target.value } : current)
                        }
                        disabled={isSavingLesson}
                        className="w-full rounded-lg border border-gray-700 px-3 py-2"
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label htmlFor="manage-lesson-description" className="mb-1 block text-sm font-semibold">Description</label>
                    <textarea
                      id="manage-lesson-description"
                      value={lessonDraft.description}
                      onChange={(event) =>
                        setLessonDraft((current) => current ? { ...current, description: event.target.value } : current)
                      }
                      disabled={isSavingLesson}
                      className="min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2"
                      placeholder="Short lesson summary"
                    />
                  </div>

                  <div className="mt-4">
                    <label htmlFor="manage-lesson-content" className="mb-1 block text-sm font-semibold">Lesson content</label>
                    <textarea
                      id="manage-lesson-content"
                      value={lessonDraft.content}
                      onChange={(event) =>
                        setLessonDraft((current) => current ? { ...current, content: event.target.value } : current)
                      }
                      disabled={isSavingLesson}
                      className="min-h-52 w-full rounded-lg border border-gray-700 px-3 py-2"
                      placeholder="Write the lesson notes or learning content students will read."
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center gap-2">
                    <Paperclip size={18} />
                    <h3 className="font-bold">Current Materials</h3>
                  </div>
                  {selectedLesson.attachments.length > 0 ? (
                    <>
                      <AttachmentDisplay
                        attachments={selectedLesson.attachments}
                        type="lesson"
                        downloadUrl={(attachmentId) =>
                          `${API_URL}/api/v1/lessons/${selectedLesson.lesson_id}/attachments/${attachmentId}/download`
                        }
                      />
                      <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
                        {selectedLesson.attachments.map((attachment) => (
                          <div key={attachment.lesson_attachment_id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                            <p className="truncate text-sm font-semibold">{attachment.file_name}</p>
                            <button
                              type="button"
                              onClick={() => removeLessonAttachment(attachment.lesson_attachment_id)}
                              disabled={removingLessonAttachmentId !== null || isSavingLesson}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                              {removingLessonAttachmentId === attachment.lesson_attachment_id ? "Removing..." : "Remove"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-600">No lesson materials attached.</p>
                  )}
                </div>

                <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  Lesson file uploads now live under Reading classworks so materials can be scheduled, locked, and tracked like the rest of the classwork flow.
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <h3 className="font-bold">Publication</h3>
                  <label className="mt-3 flex items-start gap-3 rounded-lg border border-black bg-white px-3 py-3 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={lessonDraft.is_published}
                      onChange={(event) =>
                        setLessonDraft((current) => current ? { ...current, is_published: event.target.checked } : current)
                      }
                      disabled={isSavingLesson}
                    />
                    <span>
                      {lessonDraft.is_published ? "Published to assigned sections" : "Saved as draft"}
                      <span className="mt-1 block text-xs font-normal text-gray-600">
                        Draft lessons stay hidden from students.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  <h3 className="font-bold">Assigned Sections</h3>
                  <p className="mt-1 text-xs text-gray-600">
                    Select sections to keep or add. Existing assignments cannot be removed by the current lesson API.
                  </p>
                  <div className="mt-3 space-y-2">
                    {classesForSubject.map((item) => (
                      <label key={item.subject_load_id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={lessonClassIds.includes(item.class_id)}
                          onChange={() => toggleLessonClass(item.class_id)}
                          disabled={isSavingLesson || item.class_id === Number(classId)}
                        />
                        <span className="flex-1">{item.section_name}</span>
                        {item.class_id === Number(classId) && (
                          <span className="text-[10px] font-bold uppercase text-gray-500">Current</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-red-300 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-800">
                    <Archive size={17} />
                    <h3 className="font-bold">Archive Lesson</h3>
                  </div>
                  <p className="mt-2 text-xs text-red-700">
                    Archive hides this lesson from the routed teacher list and student lesson views.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowArchiveConfirm(true)}
                    disabled={isArchivingLesson || isSavingLesson}
                    className="mt-3 w-full rounded-lg border border-red-400 bg-white px-3 py-2 text-sm font-bold text-red-700 transition hover:border-red-700 hover:bg-red-600 hover:text-white disabled:opacity-50 disabled:hover:border-red-400 disabled:hover:bg-white disabled:hover:text-red-700"
                  >
                    {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
                  </button>
                </div>
              </aside>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-black bg-white px-5 py-4">
              <button
                type="button"
                onClick={closeLessonManager}
                disabled={isSavingLesson || isArchivingLesson || removingLessonAttachmentId !== null}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={saveLesson}
                disabled={isSavingLesson || isArchivingLesson || removingLessonAttachmentId !== null}
                className="rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
              >
                {isSavingLesson ? "Saving..." : lessonDraft.is_published ? "Save and Publish" : "Save Draft"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showArchiveConfirm && selectedLesson && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <section className="w-full max-w-md rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex items-center justify-between border-b border-black bg-red-100 px-5 py-3">
              <div className="flex items-center gap-2 text-red-800">
                <Archive size={18} />
                <h2 className="font-bold">Archive Lesson?</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={isArchivingLesson}
                className="rounded p-1 hover:bg-white/60 disabled:opacity-50"
                aria-label="Close archive confirmation"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-sm font-medium">
                Are you sure you want to archive <span className="font-bold">"{selectedLesson.title}"</span>?
              </p>
              <p className="text-xs text-gray-600">
                This hides the lesson from the teacher lesson list and student lesson views. You can restore it later from the backend archive flow.
              </p>
            </div>
            <div className="flex justify-end gap-3 border-t border-black px-5 py-4">
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={isArchivingLesson}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={archiveLesson}
                disabled={isArchivingLesson}
                className="rounded-lg border border-black bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-red-700 disabled:opacity-50"
              >
                {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
              </button>
            </div>
          </section>
        </div>
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

      {(selectedClasswork || detailLoadingId || detailError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="sticky top-0 flex items-center justify-between border-b border-black bg-[#F6E9B2] px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-700">Teacher classwork detail</p>
                <h2 className="text-xl font-bold">
                  {selectedClasswork?.title || "Classwork"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {selectedClasswork && (
                  <button
                    type="button"
                    onClick={() => navigate(`/teacher/classworks?classworkId=${selectedClasswork.classwork_id}`)}
                    className="rounded-lg border border-black bg-white px-3 py-1.5 text-xs font-bold hover:bg-[#7ABA78]"
                  >
                    Click for more details
                  </button>
                )}
                <button type="button" onClick={closeClassworkDetail} className="rounded p-1 hover:bg-white/60">
                  <X size={18} />
                </button>
              </div>
            </div>

            {detailLoadingId ? (
              <div className="p-8 text-center text-sm font-semibold text-gray-600">Loading classwork details...</div>
            ) : detailError ? (
              <div className="m-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {detailError}
              </div>
            ) : selectedClasswork ? (
              <div className="grid gap-5 p-5 lg:grid-cols-[1.4fr_1fr]">
                <div className="space-y-4">
                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-black bg-[#7ABA78] px-3 py-1 text-xs font-bold">
                        {selectedClasswork.classwork_type || "Classwork"}
                      </span>
                      {selectedClasswork.classwork_category && (
                        <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold">
                          {selectedClasswork.classwork_category.replace(/_/g, " ")}
                        </span>
                      )}
                      <span className="rounded-full border border-gray-300 px-3 py-1 text-xs font-semibold">
                        {selectedClasswork.is_published ? "Published" : "Draft"}
                      </span>
                      {selectedClasswork.is_locked && (
                        <span className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                          Locked
                        </span>
                      )}
                    </div>

                    <h3 className="mt-4 text-3xl font-bold">{selectedClasswork.title}</h3>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Due date</p>
                        <p className="font-bold">
                          {selectedClasswork.due_date
                            ? new Date(selectedClasswork.due_date).toLocaleString()
                            : "No due date"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Points</p>
                        <p className="font-bold">{selectedClasswork.total_points ?? "Not set"}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-3">
                        <p className="font-semibold text-gray-600">Section</p>
                        <p className="font-bold">{selectedClasswork.section_name || sectionName || "Class"}</p>
                      </div>
                    </div>
                  </div>

                  {(selectedClasswork.description || selectedClasswork.instructions) && (
                    <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      {selectedClasswork.description && (
                        <div>
                          <h4 className="font-bold">Description</h4>
                          <p className="mt-1 text-sm text-gray-700">{selectedClasswork.description}</p>
                        </div>
                      )}
                      {selectedClasswork.instructions && (
                        <div className="mt-4">
                          <h4 className="font-bold">Instructions</h4>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{selectedClasswork.instructions}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="mb-3 flex items-center gap-2">
                      <Paperclip size={18} />
                      <h4 className="font-bold">Reference Files</h4>
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
                      <p className="text-sm text-gray-600">No classwork files attached.</p>
                    )}
                  </div>
                </div>

                <aside className="space-y-4">
                  <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <div className="flex items-center gap-2">
                      <Users size={18} />
                      <h3 className="font-bold">Submission Tracking</h3>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border border-black bg-white p-2">
                        <p className="text-2xl font-bold">{selectedTracking?.total_students ?? 0}</p>
                        <p className="text-[11px] font-semibold">Students</p>
                      </div>
                      <div className="rounded-lg border border-black bg-white p-2">
                        <p className="text-2xl font-bold">{selectedTracking?.submitted_count ?? 0}</p>
                        <p className="text-[11px] font-semibold">Submitted</p>
                      </div>
                      <div className="rounded-lg border border-black bg-white p-2">
                        <p className="text-2xl font-bold">{selectedTracking?.missing_count ?? 0}</p>
                        <p className="text-[11px] font-semibold">Pending</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <h4 className="mb-3 font-bold">Submitted Students</h4>
                    <div className="space-y-2">
                      {(selectedTracking?.submitted ?? []).slice(0, 6).map((student) => (
                        <div key={student.student_id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                          <p className="font-semibold">{student.student_name}</p>
                          <p className="text-xs text-gray-600">
                            {student.status}
                            {student.submitted_at ? ` | ${new Date(student.submitted_at).toLocaleString()}` : ""}
                            {student.grade != null ? ` | Grade ${student.grade}` : ""}
                          </p>
                        </div>
                      ))}
                      {(selectedTracking?.submitted ?? []).length === 0 && (
                        <p className="text-sm text-gray-600">No submissions yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <h4 className="mb-3 font-bold">Needs Follow-up</h4>
                    <div className="space-y-2">
                      {(selectedTracking?.missing ?? []).slice(0, 6).map((student) => (
                        <div key={student.student_id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                          <p className="font-semibold">{student.student_name}</p>
                          <p className="text-xs text-gray-600">{student.status.replace(/_/g, " ")}</p>
                        </div>
                      ))}
                      {(selectedTracking?.missing ?? []).length === 0 && (
                        <p className="text-sm text-gray-600">Everyone is accounted for.</p>
                      )}
                    </div>
                  </div>
                </aside>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </AppLayout>
  );
}

function averageRosterMetric<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => {
    const value = row[key];
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
  return Number((total / rows.length).toFixed(2));
}
