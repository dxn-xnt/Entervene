import { useEffect, useMemo, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

type LessonResponse = {
  lesson_id: number;
};

async function responseError(response: Response, fallback: string) {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") {
    return data.detail;
  }
  return fallback;
}

export default function CreateLesson() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialClassId = searchParams.get("classId");
  const initialSubjectId = searchParams.get("subjectId");
  const [classLoads, setClassLoads] = useState<TeacherClassLoad[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [classIds, setClassIds] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [orderIndex, setOrderIndex] = useState("1");
  const [isPublished, setIsPublished] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadTeacherClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await apiFetch("/api/v1/classwork-assignments/teacher/classes");
        if (!response.ok) {
          throw new Error("Unable to load your assigned subjects.");
        }

        const data = (await response.json()) as TeacherClassLoad[];
        const contextSubject = initialSubjectId
          ? data.find((load) => load.subject_id === Number(initialSubjectId))
          : null;
        const contextClass = initialClassId
          ? data.find((load) => load.class_id === Number(initialClassId))
          : null;

        setClassLoads(data);
        setSubjectId(String(contextSubject?.subject_id || contextClass?.subject_id || data[0]?.subject_id || ""));
        setClassIds(contextClass ? [contextClass.class_id] : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load your assigned subjects.");
      } finally {
        setIsLoading(false);
      }
    };

    loadTeacherClasses();
  }, [initialClassId, initialSubjectId]);

  const subjects = useMemo(() => {
    const bySubject = new Map<number, TeacherClassLoad>();
    classLoads.forEach((load) => {
      if (!bySubject.has(load.subject_id)) {
        bySubject.set(load.subject_id, load);
      }
    });

    return Array.from(bySubject.values()).sort((a, b) =>
      a.subject_name.localeCompare(b.subject_name)
    );
  }, [classLoads]);

  const classesForSubject = useMemo(() => {
    return classLoads
      .filter((load) => load.subject_id === Number(subjectId))
      .sort((a, b) => a.section_name.localeCompare(b.section_name));
  }, [classLoads, subjectId]);

  const closeToSubject = () => {
    if (initialClassId && subjectId) {
      navigate(`/teacher/classes/${initialClassId}/subjects/${subjectId}`);
      return;
    }

    navigate("/teacher/classes");
  };

  const toggleClass = (classId: number) => {
    setClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId]
    );
  };

  const submitLesson = async () => {
    setError("");

    if (!title.trim()) {
      setError("Lesson name is required.");
      return;
    }
    if (!subjectId) {
      setError("Select a subject.");
      return;
    }
    if (classIds.length === 0) {
      setError("Select at least one class or section.");
      return;
    }

    const parsedOrderIndex = Number(orderIndex);
    if (!Number.isInteger(parsedOrderIndex) || parsedOrderIndex < 1) {
      setError("Lesson order must be a positive whole number.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiFetch("/api/v1/lessons/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          content: content.trim() || null,
          subject_id: Number(subjectId),
          order_index: parsedOrderIndex,
          is_published: isPublished,
          is_draft: !isPublished,
        }),
      });

      if (!response.ok) {
        throw new Error(await responseError(response, "Unable to create lesson."));
      }

      const created = (await response.json()) as LessonResponse;

      const assignResponse = await apiFetch(`/api/v1/lessons/${created.lesson_id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_ids: classIds,
          is_published: isPublished,
        }),
      });

      if (!assignResponse.ok) {
        throw new Error(await responseError(assignResponse, "Lesson was created, but class assignment failed."));
      }

      closeToSubject();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create lesson.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <main className="flex min-h-[calc(100vh-2rem)] items-center justify-center bg-[#FFFDF5] px-5 py-10">
        <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black bg-[#7ABA78] px-5 py-4">
            <div className="flex items-center gap-2">
              <FolderPlus size={20} />
              <div>
                <h1 className="text-lg font-bold">Add Lesson</h1>
                <p className="text-xs font-medium">Create a draft or publish it to selected sections.</p>
              </div>
            </div>
            <button type="button" onClick={closeToSubject} className="rounded p-1 hover:bg-white/30">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4 p-5">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div>
                <label htmlFor="subject" className="mb-1 block text-sm font-semibold">Subject</label>
                <select
                  id="subject"
                  value={subjectId}
                  onChange={(event) => {
                    setSubjectId(event.target.value);
                    setClassIds([]);
                  }}
                  disabled={isLoading || isSubmitting}
                  className="w-full rounded-lg border border-gray-700 px-3 py-2"
                >
                  {subjects.map((subject) => (
                    <option key={subject.subject_id} value={subject.subject_id}>
                      {subject.subject_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lesson-order" className="mb-1 block text-sm font-semibold">Lesson order</label>
                <input
                  id="lesson-order"
                  type="number"
                  min="1"
                  step="1"
                  value={orderIndex}
                  onChange={(event) => setOrderIndex(event.target.value)}
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-gray-700 px-3 py-2"
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Class or section</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {classesForSubject.map((item) => (
                  <label key={item.subject_load_id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={classIds.includes(item.class_id)}
                      onChange={() => toggleClass(item.class_id)}
                      disabled={isSubmitting}
                    />
                    {item.section_name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="lesson" className="mb-1 block text-sm font-semibold">Lesson name</label>
              <input
                id="lesson"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-lg border border-gray-700 px-3 py-2"
                placeholder="Term 1: Variables and Expressions"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="description" className="mb-1 block text-sm font-semibold">Description</label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2"
                placeholder="Short lesson summary"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="lesson-content" className="mb-1 block text-sm font-semibold">Lesson content</label>
              <textarea
                id="lesson-content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-44 w-full rounded-lg border border-gray-700 px-3 py-2"
                placeholder="Write the lesson notes or learning content students will read."
                disabled={isSubmitting}
              />
            </div>

            <div className="rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              Upload lesson materials as Reading classworks so they can be scheduled, locked, and tracked with student classwork.
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(event) => setIsPublished(event.target.checked)}
                disabled={isSubmitting}
              />
              {isPublished ? "Publish lesson for selected sections" : "Save as draft for selected sections"}
            </label>
          </div>

          <div className="sticky bottom-0 flex justify-end gap-3 border-t border-black bg-white px-5 py-4">
            <button
              type="button"
              onClick={closeToSubject}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitLesson}
              disabled={isSubmitting}
              className="rounded-lg border border-gray-700 bg-[#7ABA78] px-4 py-2 text-sm font-semibold hover:brightness-95 disabled:opacity-60"
            >
              {isSubmitting ? "Saving..." : isPublished ? "Publish Lesson" : "Save Draft"}
            </button>
          </div>
        </section>
      </main>
    </AppLayout>
  );
}
