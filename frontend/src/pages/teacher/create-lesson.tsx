import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
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
  onClose?: () => void;
  onCreated?: () => void;
}

export default function CreateLessonModal({
  classId: initialClassId,
  subjectId: initialSubjectId,
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
            is_published: isPublished,
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isSubmitting) handleClose();
      }}
    >
      <Dialog.Content
        size="4xl"
        className="no-scrollbar h-fit max-h-[92vh] !overflow-y-auto overflow-x-hidden border-black p-0"
        overlay={{ className: "bg-black/50" }}
      >
        <Dialog.Header
          asChild
          className="border-b-2 border-black bg-primary px-5 py-4"
        >
          <>
            <div className="flex items-center gap-2">
              <div>
                <p className="text-lg font-bold">Add Lesson</p>
                <p className="text-xs text-black">
                  Create a draft or publish it to selected sections.
                </p>
              </div>
            </div>
            <Dialog.Close
              title="Close"
              className="cursor-pointer rounded p-1 hover:bg-white/30"
              disabled={isSubmitting}
            >
              <X size={16} />
            </Dialog.Close>
          </>
        </Dialog.Header>

        <div className="space-y-4 p-5">
          {error && (
            <div className="border-2 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div>
              <label
                htmlFor="subject"
                className="mb-1 block text-sm font-semibold"
              >
                Subject
              </label>
              <Select
                value={subjectId}
                onValueChange={(v) => {
                  setSubjectId(v);
                  setClassIds([]);
                }}
              >
                <Select.Trigger
                  id="subject"
                  disabled={isLoading || isSubmitting}
                  className="h-10 w-full border-2 border-black bg-white text-sm !shadow-none"
                >
                  <Select.Value />
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
            <div>
              <label
                htmlFor="lesson-order"
                className="mb-1 block text-sm font-semibold"
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
                className="h-10 w-full rounded-none border-black !shadow-none"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Class or section</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {classesForSubject.map((item) => (
                <label
                  key={item.subject_load_id}
                  className="flex items-center gap-2 border-2 border-black px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={classIds.includes(item.class_id)}
                    onChange={() => toggleClass(item.class_id)}
                    disabled={isSubmitting}
                    className="accent-black"
                  />
                  {item.section_name}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="lesson"
              className="mb-1 block text-sm font-semibold"
            >
              Lesson name
            </label>
            <Input
              id="lesson"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 w-full rounded-none border-black !shadow-none"
              placeholder="Term 1: Variables and Expressions"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="mb-1 block text-sm font-semibold"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-20 w-full border-2 border-black px-3 py-2 text-sm outline-none focus:border-black"
              placeholder="Short lesson summary"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label
              htmlFor="lesson-content"
              className="mb-1 block text-sm font-semibold"
            >
              Lesson content
            </label>
            <textarea
              id="lesson-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-44 w-full border-2 border-black px-3 py-2 text-sm outline-none focus:border-black"
              placeholder="Write the lesson notes or learning content students will read."
              disabled={isSubmitting}
            />
          </div>

          <Card className="block shadow-none">
            <Card.Content>
              <p className="text-black">
                Upload lesson materials as Reading classworks so they can be
                scheduled, locked, and tracked with student classwork.
              </p>
            </Card.Content>
          </Card>

          <label className="flex items-center gap-3 border-2 border-black bg-primary px-4 py-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(event) => setIsPublished(event.target.checked)}
              disabled={isSubmitting}
              className="accent-black"
            />
            {isPublished
              ? "Publish lesson for selected sections"
              : "Save as draft for selected sections"}
          </label>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t-2 border-black bg-white px-5 py-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
            className="border-black font-semibold"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={submitLesson}
            disabled={isSubmitting}
            className="border-black bg-[#7ABA78] font-semibold hover:bg-[#7ABA78] hover:brightness-95 disabled:opacity-60"
          >
            {isSubmitting
              ? "Saving..."
              : isPublished
                ? "Publish Lesson"
                : "Save Draft"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
