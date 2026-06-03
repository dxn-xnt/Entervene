import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, ClipboardList, FileText, Info, Plus, Search, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { apiFetch } from "@/lib/api";

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
  const [isCreatingClasswork, setIsCreatingClasswork] = useState(false);
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
    setClassworkLesson(lesson);
    setClassworkDraft(emptyClassworkDraft);
    setExpandedLessonId(lesson.lesson_id);
  };

  const closeClassworkForm = () => {
    if (isCreatingClasswork) return;
    setClassworkLesson(null);
    setClassworkDraft(emptyClassworkDraft);
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
              <span className="text-sm text-gray-500">Search lessons</span>
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
          ) : lessons.length > 0 ? (
            lessons.map((lesson) => {
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
                          <div
                            key={classwork.classwork_assignment_id}
                            className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
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
                          </div>
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
    </AppLayout>
  );
}
