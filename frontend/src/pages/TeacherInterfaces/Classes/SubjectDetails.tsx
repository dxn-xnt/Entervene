import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, ClipboardList, Eye, FileText, Info, Paperclip, Plus, Search, Trash2, Upload, Users, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { API_URL, apiFetch } from "@/lib/api";
import AttachmentDisplay from "@/components/AttachmentDisplay";

type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

type Lesson = {
  lesson_id: number;
  title: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
  is_published: boolean;
  is_draft: boolean;
};

type LinkedClasswork = {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  due_date?: string | null;
  attachment_count?: number;
};

type ClassworkAttachment = {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
};

type ClassworkDetail = {
  classwork_assignment_id: number;
  classwork_id: number;
  class_id: number;
  section_name?: string | null;
  title: string;
  description?: string | null;
  instructions?: string | null;
  classwork_type?: string | null;
  classwork_category?: string | null;
  total_points?: number | null;
  due_date?: string | null;
  is_published: boolean;
  is_locked?: boolean;
  teacher_name?: string | null;
  attachments: ClassworkAttachment[];
};

type TrackingStudent = {
  student_id: string;
  student_name: string;
  status: string;
  submitted_at?: string | null;
  grade?: number | null;
  attachment_count?: number;
};

type SubmissionTracking = {
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: TrackingStudent[];
  missing: TrackingStudent[];
};

type ClassworkDraft = {
  title: string;
  description: string;
  instructions: string;
  classwork_type: string;
  classwork_category: string;
  total_points: string;
  due_date: string;
  is_published: boolean;
};

const emptyClassworkDraft: ClassworkDraft = {
  title: "",
  description: "",
  instructions: "",
  classwork_type: "ACTIVITY",
  classwork_category: "WRITTEN_WORK",
  total_points: "100",
  due_date: "",
  is_published: true,
};

const allowedMaterialExtensions = [".pdf", ".docx", ".pptx", ".jpg", ".jpeg", ".png"];
const maxMaterialSize = 4 * 1024 * 1024;

function MetricCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <p className="font-semibold text-gray-900">{title}</p>
      <p className="mt-2 text-4xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium text-gray-700">{note}</p>
    </div>
  );
}

export default function SubjectDetails() {
  const { classId, subjectId } = useParams<{ classId: string; subjectId: string }>();
  const navigate = useNavigate();
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
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
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadContext = async () => {
      setIsLoading(true);
      setError("");

      try {
        const [classesResponse, lessonsResponse] = await Promise.all([
          apiFetch("/api/v1/classwork-assignments/teacher/classes"),
          classId && subjectId
            ? apiFetch(`/api/v1/lessons/my-class/${classId}/subject/${subjectId}`)
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
          setLessons((await lessonsResponse.json()) as Lesson[]);
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
  const filteredLessons = useMemo(() => {
    const query = lessonSearch.trim().toLowerCase();
    if (!query) return lessons;

    return lessons.filter((lesson) =>
      [lesson.title, lesson.description]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query))
    );
  }, [lessonSearch, lessons]);

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
        throw new Error("Unable to load classwork details.");
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
    if (!classworkDraft.title.trim()) {
      setError("Classwork title is required.");
      return;
    }
    const totalPoints = Number(classworkDraft.total_points);
    if (classworkDraft.total_points && Number.isNaN(totalPoints)) {
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
          total_points: classworkDraft.total_points ? totalPoints : null,
          subject_id: Number(subjectId),
          is_published: classworkDraft.is_published,
          lesson_ids: [classworkLesson.lesson_id],
        }),
      });

      if (!createResponse.ok) {
        throw new Error("Unable to create classwork.");
      }

      const created = (await createResponse.json()) as { classwork_id: number };

      for (const material of classworkMaterials) {
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
            <MetricCard title="Lesson Mastery" value="98%" note="12% increased from last month" />
            <MetricCard title="Classwork Assigned" value="23" note="12% increased from last month" />
            <MetricCard title="Completion Percentage" value="20%" note="12% increased from last month" />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 md:w-80">
              <Search size={16} className="text-gray-500" />
              <input
                type="search"
                value={lessonSearch}
                onChange={(event) => setLessonSearch(event.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
                placeholder="Search lessons"
              />
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium"
            >
              <ChevronDown size={16} />
              Sort By
            </button>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-gray-500">Loading lessons...</p>
          ) : filteredLessons.length > 0 ? (
            filteredLessons.map((lesson) => {
              const isExpanded = expandedLessonId === lesson.lesson_id;
              const classworks = linkedClassworks[lesson.lesson_id] || [];

              return (
                <div key={lesson.lesson_id} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => toggleLesson(lesson.lesson_id)}
                    className="flex items-center justify-between rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <div>
                      <p className="text-2xl font-bold text-gray-950">{lesson.title}</p>
                      <p className="text-xs font-medium text-gray-700">
                        {lesson.description ||
                          (lesson.created_at
                            ? `Created ${new Date(lesson.created_at).toLocaleDateString()}`
                            : "Lesson folder")}
                      </p>
                    </div>
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </button>

                  {isExpanded && (
                    <div className="ml-3 flex flex-col gap-2 border-l-2 border-black pl-3">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => openClassworkForm(lesson)}
                          className="inline-flex items-center gap-2 rounded-lg border border-black bg-[#7ABA78] px-3 py-2 text-sm font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <Plus size={16} />
                          Add Classwork
                        </button>
                      </div>
                      {loadingClassworkId === lesson.lesson_id ? (
                        <div className="rounded-lg border border-black bg-white px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                          Loading classworks...
                        </div>
                      ) : classworks.length > 0 ? (
                        classworks.map((classwork) => (
                          <button
                            type="button"
                            key={classwork.classwork_assignment_id}
                            onClick={() => openClassworkDetail(classwork)}
                            className="flex w-full items-center justify-between rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5"
                          >
                            <div className="flex items-center gap-3">
                              <FileText size={20} />
                              <div>
                                <p className="text-lg font-bold">{classwork.title}</p>
                                <p className="text-xs font-medium text-gray-700">
                                  {classwork.classwork_type || "Classwork"}
                                  {classwork.due_date ? ` | Due ${new Date(classwork.due_date).toLocaleDateString()}` : ""}
                                </p>
                              </div>
                            </div>
                            {classwork.attachment_count ? (
                              <span className="rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
                                File {classwork.attachment_count}
                              </span>
                            ) : null}
                            <span className="ml-3 inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold">
                              <Eye size={14} />
                              Details
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                          <div className="flex items-center gap-3">
                            <ClipboardList size={20} />
                            <div>
                              <p className="text-lg font-bold">No classworks yet</p>
                              <p className="text-xs font-medium">
                                Readings, activities, assignments, and quizzes linked to this lesson will appear here.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : lessons.length > 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <div>
                <p className="text-lg font-bold">No matching lessons</p>
                <p className="text-xs font-medium">Try a different lesson name or description.</p>
              </div>
              <Search size={20} />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div>
                  <p className="text-2xl font-bold">No lessons yet</p>
                  <p className="text-xs font-medium">Use Add Lesson to create the first lesson for this subject.</p>
                </div>
                <BookOpen size={20} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-3">
                  <ClipboardList size={20} />
                  <div>
                    <p className="text-lg font-bold">Classwork</p>
                    <p className="text-xs font-medium">Assignments and activities for this subject appear here.</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {classworkLesson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <div className="sticky top-0 flex items-center justify-between border-b border-black bg-[#7ABA78] px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">Add Classwork</h2>
                <p className="text-xs font-medium">Lesson: {classworkLesson.title}</p>
              </div>
              <button type="button" onClick={closeClassworkForm} className="rounded p-1 hover:bg-white/30">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              {error && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="classwork-title" className="mb-1 block text-sm font-semibold">Title</label>
                <input
                  id="classwork-title"
                  value={classworkDraft.title}
                  onChange={(event) =>
                    setClassworkDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  disabled={isCreatingClasswork}
                  className="w-full rounded-lg border border-gray-700 px-3 py-2"
                  placeholder="Activity 1"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="classwork-type" className="mb-1 block text-sm font-semibold">Type</label>
                  <select
                    id="classwork-type"
                    value={classworkDraft.classwork_type}
                    onChange={(event) =>
                      setClassworkDraft((current) => ({ ...current, classwork_type: event.target.value }))
                    }
                    disabled={isCreatingClasswork}
                    className="w-full rounded-lg border border-gray-700 px-3 py-2"
                  >
                    <option value="READING">Reading</option>
                    <option value="ACTIVITY">Activity</option>
                    <option value="ASSIGNMENT">Assignment</option>
                    <option value="QUIZ">Quiz</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="classwork-category" className="mb-1 block text-sm font-semibold">Category</label>
                  <select
                    id="classwork-category"
                    value={classworkDraft.classwork_category}
                    onChange={(event) =>
                      setClassworkDraft((current) => ({ ...current, classwork_category: event.target.value }))
                    }
                    disabled={isCreatingClasswork}
                    className="w-full rounded-lg border border-gray-700 px-3 py-2"
                  >
                    <option value="WRITTEN_WORK">Written Work</option>
                    <option value="PERFORMANCE_TASK">Performance Task</option>
                    <option value="PERIODICAL_EXAM">Periodical Exam</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="classwork-points" className="mb-1 block text-sm font-semibold">Total points</label>
                  <input
                    id="classwork-points"
                    type="number"
                    min="0"
                    step="0.01"
                    value={classworkDraft.total_points}
                    onChange={(event) =>
                      setClassworkDraft((current) => ({ ...current, total_points: event.target.value }))
                    }
                    disabled={isCreatingClasswork}
                    className="w-full rounded-lg border border-gray-700 px-3 py-2"
                  />
                </div>

                <div>
                  <label htmlFor="classwork-due" className="mb-1 block text-sm font-semibold">Due date</label>
                  <input
                    id="classwork-due"
                    type="datetime-local"
                    value={classworkDraft.due_date}
                    onChange={(event) =>
                      setClassworkDraft((current) => ({ ...current, due_date: event.target.value }))
                    }
                    disabled={isCreatingClasswork}
                    className="w-full rounded-lg border border-gray-700 px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="classwork-description" className="mb-1 block text-sm font-semibold">Description</label>
                <textarea
                  id="classwork-description"
                  value={classworkDraft.description}
                  onChange={(event) =>
                    setClassworkDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  disabled={isCreatingClasswork}
                  className="min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2"
                  placeholder="Optional summary"
                />
              </div>

              <div>
                <label htmlFor="classwork-instructions" className="mb-1 block text-sm font-semibold">Instructions</label>
                <textarea
                  id="classwork-instructions"
                  value={classworkDraft.instructions}
                  onChange={(event) =>
                    setClassworkDraft((current) => ({ ...current, instructions: event.target.value }))
                  }
                  disabled={isCreatingClasswork}
                  className="min-h-24 w-full rounded-lg border border-gray-700 px-3 py-2"
                  placeholder="What students need to do"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="classwork-materials" className="block text-sm font-semibold">
                    Upload Material
                  </label>
                  <span className="text-xs font-medium text-gray-500">
                    PDF, DOCX, PPTX, JPG, PNG | 4 MB each
                  </span>
                </div>

                <label
                  htmlFor="classwork-materials"
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-sm font-semibold transition-colors ${
                    isCreatingClasswork
                      ? "cursor-not-allowed border-gray-300 bg-gray-100 text-gray-400"
                      : "border-gray-700 bg-gray-50 hover:bg-[#F6E9B2]"
                  }`}
                >
                  <Upload size={18} />
                  Select material files
                </label>
                <input
                  id="classwork-materials"
                  type="file"
                  multiple
                  accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                  onChange={(event) => {
                    addClassworkMaterials(event.target.files);
                    event.target.value = "";
                  }}
                  disabled={isCreatingClasswork}
                  className="hidden"
                />

                {classworkMaterials.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {classworkMaterials.map((material, index) => (
                      <div
                        key={`${material.name}-${material.size}`}
                        className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2"
                      >
                        <FileText size={17} className="shrink-0 text-gray-700" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{material.name}</p>
                          <p className="text-xs text-gray-500">
                            {(material.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeClassworkMaterial(index)}
                          disabled={isCreatingClasswork}
                          className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          aria-label={`Remove ${material.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={classworkDraft.is_published}
                  onChange={(event) =>
                    setClassworkDraft((current) => ({ ...current, is_published: event.target.checked }))
                  }
                  disabled={isCreatingClasswork}
                />
                Publish for this class
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-black px-5 py-4">
              <button
                type="button"
                onClick={closeClassworkForm}
                disabled={isCreatingClasswork}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createClassworkForLesson}
                disabled={isCreatingClasswork}
                className="rounded-lg border border-gray-700 bg-[#7ABA78] px-4 py-2 text-sm font-semibold hover:brightness-95 disabled:opacity-60"
              >
                {isCreatingClasswork ? "Adding..." : "Add Classwork"}
              </button>
            </div>
          </section>
        </div>
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
              <button type="button" onClick={closeClassworkDetail} className="rounded p-1 hover:bg-white/60">
                <X size={18} />
              </button>
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
