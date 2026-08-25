import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
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
  if (
    data &&
    typeof data === "object" &&
    "detail" in data &&
    typeof data.detail === "string"
  ) {
    return data.detail;
  }
  return fallback;
}

interface CreateLessonModalProps {
  classId?: string;
  subjectId?: string;
  initialCompetencyId?: number;
  onClose?: () => void;
  onCreated?: () => void;
}

export default function CreateLessonModal({
  classId: initialClassId,
  subjectId: initialSubjectId,
  initialCompetencyId,
  onClose,
  onCreated,
}: CreateLessonModalProps) {
  const navigate = useNavigate();
  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  };
  const handleCreated = () => {
    if (onCreated) {
      onCreated();
    } else {
      navigate(-1);
    }
  };
  const [classLoads, setClassLoads] = useState<TeacherClassLoad[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [competencies, setCompetencies] = useState<
    Array<{ competency_id: number; statement: string; competency_code?: string | null }>
  >([]);
  const [competencyId, setCompetencyId] = useState(
    initialCompetencyId ? String(initialCompetencyId) : "",
  );
  const [classIds, setClassIds] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [orderIndex, setOrderIndex] = useState("1");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (initialCompetencyId) {
      setCompetencyId(String(initialCompetencyId));
    }
  }, [initialCompetencyId]);

  useEffect(() => {
    const fetchCompetencies = async () => {
      if (!subjectId) {
        setCompetencies([]);
        return;
      }
      try {
        const res = await apiFetch(`/api/v1/competencies/subject/${subjectId}`);
        if (res.ok) {
          const data = await res.json();
          setCompetencies(data);
          if (data.length > 0) {
            setCompetencyId((curr) => {
              if (curr && data.some((c: any) => String(c.competency_id) === curr)) return curr;
              if (initialCompetencyId && data.some((c: any) => c.competency_id === initialCompetencyId)) {
                return String(initialCompetencyId);
              }
              return String(data[0].competency_id);
            });
          }
        }
      } catch {
        // Silently keep empty list if competencies cannot be loaded
      }
    };
    fetchCompetencies();
  }, [subjectId]);

  useEffect(() => {
    const loadTeacherClasses = async () => {
      setIsLoading(true);
      setError("");

      try {
        const response = await apiFetch(
          "/api/v1/classwork-assignments/teacher/classes",
        );
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
        setSubjectId(
          String(
            contextSubject?.subject_id ||
              contextClass?.subject_id ||
              data[0]?.subject_id ||
              "",
          ),
        );
        setClassIds(contextClass ? [contextClass.class_id] : []);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load your assigned subjects.",
        );
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
      a.subject_name.localeCompare(b.subject_name),
    );
  }, [classLoads]);

  const classesForSubject = useMemo(() => {
    return classLoads
      .filter((load) => load.subject_id === Number(subjectId))
      .sort((a, b) => a.section_name.localeCompare(b.section_name));
  }, [classLoads, subjectId]);

  const toggleClass = (classId: number) => {
    setClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const submitLesson = async (publish: boolean) => {
    setError("");

    if (!title.trim()) {
      setError("Lesson name is required.");
      return;
    }
    if (!subjectId) {
      setError("Select a subject.");
      return;
    }
    if (!competencyId || competencyId === "none") {
      setError("Learning Competency is required. Please select a competency.");
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
          competency_id: Number(competencyId),
          order_index: parsedOrderIndex,
          is_published: publish,
          is_draft: !publish,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await responseError(response, "Unable to create lesson."),
        );
      }

      const created = (await response.json()) as LessonResponse;

      const assignResponse = await apiFetch(
        `/api/v1/lessons/${created.lesson_id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            class_ids: classIds,
            is_published: publish,
          }),
        },
      );

      if (!assignResponse.ok) {
        throw new Error(
          await responseError(
            assignResponse,
            "Lesson was created, but class assignment failed.",
          ),
        );
      }

      handleCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create lesson.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open disablePointerDismissal={true} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Content
        size="md"
        className="w-[95vw] max-w-2xl max-h-[88vh] flex flex-col border-2 border-black bg-[#FBFBEE] p-0 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden"
      >
        <Dialog.Header className="shrink-0 bg-[#F6E9B2] border-b-2 border-black px-6 py-4">
          <div className="flex items-center gap-2.5">
            <BookOpen className="size-6 text-black" />
            <div>
              <h2 className="text-xl font-black text-black leading-tight">Add Lesson</h2>
              <p className="text-xs text-black/70 font-medium">
                Create a draft or publish it to selected sections.
              </p>
            </div>
          </div>
        </Dialog.Header>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 p-6">
          {error && (
            <div className="rounded border-2 border-red-600 bg-red-50 p-3 text-xs font-bold text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="subject"
                className="text-xs font-bold text-gray-900"
              >
                Subject
              </label>
              <Select
                value={subjectId}
                onValueChange={(v) => {
                  setSubjectId(v);
                  setClassIds([]);
                  setCompetencyId("");
                }}
              >
                <Select.Trigger
                  id="subject"
                  disabled={isLoading || isSubmitting}
                  className="h-10 w-full border-2 border-black bg-white text-xs font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                  <Select.Value placeholder="Select Subject" />
                </Select.Trigger>
                <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  {subjects.map((subject) => (
                    <Select.Item
                      key={subject.subject_id}
                      value={String(subject.subject_id)}
                    >
                      {subject.subject_name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="lesson-order"
                className="text-xs font-bold text-gray-900"
              >
                Lesson order
              </label>
              <Input
                id="lesson-order"
                type="number"
                min="1"
                step="1"
                value={orderIndex}
                onChange={(event) => setOrderIndex(event.target.value)}
                disabled={isSubmitting}
                className="h-10 w-full border-2 border-black bg-white text-xs font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              />
            </div>
          </div>

          {/* ── Competency Selection ── */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="competency"
              className="text-xs font-bold text-gray-900"
            >
              Learning Competency <span className="text-red-500">*</span>
            </label>
            {competencies.length === 0 ? (
              <div className="rounded border-2 border-amber-400 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                ⚠️ No learning competencies found for this subject. Please create a Learning Competency first before adding lessons.
              </div>
            ) : (
              <Select
                value={competencyId}
                onValueChange={(v) => setCompetencyId(v)}
              >
                <Select.Trigger
                  id="competency"
                  disabled={isSubmitting || !subjectId}
                  className="h-10 w-full border-2 border-black bg-white text-xs font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                >
                  <Select.Value placeholder="Select a learning competency..." />
                </Select.Trigger>
                <Select.Content className="max-h-60 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  {competencies.map((comp) => (
                    <Select.Item
                      key={comp.competency_id}
                      value={String(comp.competency_id)}
                    >
                      {comp.competency_code ? `[${comp.competency_code}] ` : ""}
                      {comp.statement}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-bold text-gray-900">Class or section</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {classesForSubject.map((item) => (
                <label
                  key={item.subject_load_id}
                  className="flex items-center gap-2 rounded border-2 border-black bg-white px-3 py-2 text-xs font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer hover:bg-yellow-50"
                >
                  <input
                    type="checkbox"
                    checked={classIds.includes(item.class_id)}
                    onChange={() => toggleClass(item.class_id)}
                    disabled={isSubmitting}
                    className="accent-black size-4"
                  />
                  {item.section_name}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="lesson"
              className="text-xs font-bold text-gray-900"
            >
              Lesson name <span className="text-red-500">*</span>
            </label>
            <Input
              id="lesson"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 w-full border-2 border-black bg-white text-xs font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              placeholder="e.g. Term 1: Variables and Expressions"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="description"
              className="text-xs font-bold text-gray-900"
            >
              Description / Topic
            </label>
            <textarea
              id="description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded border-2 border-black bg-white p-3 text-xs font-medium outline-none focus:ring-2 focus:ring-primary shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] resize-none"
              placeholder="Short lesson summary or unit overview"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="lesson-content"
              className="text-xs font-bold text-gray-900"
            >
              Lesson content
            </label>
            <textarea
              id="lesson-content"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="w-full rounded border-2 border-black bg-white p-3 text-xs font-medium outline-none focus:ring-2 focus:ring-primary shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] resize-none"
              placeholder="Write the lesson notes or learning content students will read."
              disabled={isSubmitting}
            />
          </div>

          <Card className="block border-2 border-black bg-yellow-50/60 shadow-none p-3">
            <p className="text-xs text-black/80 font-medium">
              💡 Tip: Upload lesson materials as Reading classworks so they can be
              scheduled, locked, and tracked alongside quizzes and activities.
            </p>
          </Card>
        </div>

        <Dialog.Footer className="shrink-0 flex items-center justify-end gap-3 border-t-2 border-black bg-white px-6 py-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
            className="border-2 border-black bg-white hover:bg-gray-100 font-bold px-4 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => submitLesson(false)}
            disabled={isSubmitting}
            className="border-2 border-black bg-white hover:bg-yellow-50 text-black font-bold px-4 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            {isSubmitting ? "Saving..." : "Save as Draft"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => submitLesson(true)}
            disabled={isSubmitting}
            className="border-2 border-black bg-primary hover:opacity-90 text-black font-bold px-5 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
          >
            {isSubmitting ? "Saving..." : "Publish Lesson"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
