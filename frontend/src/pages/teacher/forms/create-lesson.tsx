import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CheckCheck, Loader2, Save, Upload, X } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { useToast } from "@/components/retroui/use-toast";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import Field from "@/components/admin/classes/fields/Field";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { apiFetch } from "@/lib/api";

import { useTeacherClasses } from "@/hooks/use-teacher-classes";
import { useRegisterDirtyGuard } from "@/context/AcademicPeriodContext";
import type { TeacherClassItem } from "@/lib/api";

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
  const toast = useToast();
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

  const {
    classes: classLoads,
    isLoading: loadingClasses,
    error: classesError,
  } = useTeacherClasses({ includeAdvisory: false });

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoading = loadingClasses || isSubmitting;
  const displayError = error || (classesError ? classesError.message : "");

  const isDirty = Boolean(
    title.trim() || description.trim() || content.trim(),
  );

  useRegisterDirtyGuard(isDirty, {
    message: "You have unsaved changes in this lesson. Switching terms will discard your draft.",
    onDiscard: () => {
      setTitle("");
      setDescription("");
      setContent("");
      setError("");
    },
  });

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
    if (classLoads.length === 0) {
      setSubjectId("");
      setClassIds([]);
      return;
    }
    const contextSubject = initialSubjectId
      ? classLoads.find((load) => load.subject_id === Number(initialSubjectId))
      : null;
    const contextClass = initialClassId
      ? classLoads.find((load) => load.class_id === Number(initialClassId))
      : null;

    setSubjectId((curr) => {
      if (curr && classLoads.some((l) => String(l.subject_id) === curr)) {
        return curr;
      }
      return String(
        contextSubject?.subject_id ||
        contextClass?.subject_id ||
        classLoads[0]?.subject_id ||
        "",
      );
    });

    if (contextClass) {
      setClassIds((curr) =>
        curr.length === 0
          ? [contextClass.class_id]
          : curr.filter((id) => classLoads.some((l) => l.class_id === id)),
      );
    } else {
      setClassIds((curr) =>
        curr.filter((id) => classLoads.some((l) => l.class_id === id)),
      );
    }
  }, [classLoads, initialClassId, initialSubjectId]);

  const subjects = useMemo(() => {
    const bySubject = new Map<number, TeacherClassItem>();
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

      toast.success({ title: "Lesson created" });
      handleCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create lesson.");
      toast.error({ title: "Unable to create lesson", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open disablePointerDismissal={true} onOpenChange={(open) => !open && handleClose()}>
      <Dialog.Content size="lg">
        <Dialog.Header position="static">
          <div>
            <h2 className="font-sans text-xl font-bold">Add Lesson</h2>

          </div>
        </Dialog.Header>

        <section className="flex flex-col gap-4 p-4">
          {displayError && (
            <Alert status="error">
              <Alert.Description>{displayError}</Alert.Description>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label="Subject" isRequired={true}>
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
                  className="w-full min-w-0"
                >
                  <Select.Value placeholder="Select Subject" />
                </Select.Trigger>
                <Select.Content>
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
            </Field>

            <Field label="Lesson order">
              <Input
                id="lesson-order"
                type="number"
                min="1"
                step="1"
                value={orderIndex}
                onChange={(event) => setOrderIndex(event.target.value)}
                disabled={isSubmitting}
                className="w-full h-10"
              />
            </Field>
          </div>

          {/* ── Competency Selection ── */}
          <Field label="Learning Competency" isRequired={true}>
            {competencies.length === 0 ? (
              <Alert status="warning">
                ⚠️ No learning competencies found for this subject. Please create a Learning Competency first before adding lessons.
              </Alert>
            ) : (
              <Select
                value={competencyId}
                onValueChange={(v) => setCompetencyId(v)}
              >
                <Select.Trigger
                  id="competency"
                  disabled={isSubmitting || !subjectId}
                  className="w-full min-w-0"
                >
                  <Select.Value placeholder="Select a learning competency..." />
                </Select.Trigger>
                <Select.Content className="max-h-60">
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
          </Field>

          <Field label="Lesson Name" isRequired={true}>
            <Input
              id="lesson"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full"
              placeholder="e.g. Term 1: Variables and Expressions"
              disabled={isSubmitting}
            />
          </Field>

          <Field label="Lesson Content">
            <textarea
              id="lesson-content"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="w-full resize-none rounded! border-2 border-border bg-background px-4 py-2 text-sm shadow-md transition focus:outline-hidden focus:shadow-xs"
              placeholder="Write the lesson notes or learning content students will read."
              disabled={isSubmitting}
            />
          </Field>

          <div className="mt-2">
            <Field label="Assign to sections">
              {classesForSubject.length > 0 && (
                <div className="flex items-center justify-end -mt-8 mb-2">
                  <Button
                    size="sm"
                    className="shadow-none -mt-1"
                    autoIcon={false}
                    onClick={() =>
                      setClassIds(
                        classesForSubject.map((load) => load.class_id),
                      )
                    }
                    disabled={isSubmitting}
                  >
                    <CheckCheck className="size-4 mr-2" />
                    Select All
                  </Button>
                </div>
              )}

              {classesForSubject.length > 0 ? (
                <Card className="-mt-1 grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {classesForSubject.map((load) => {
                    const isSelected = classIds.includes(load.class_id);
                    return (
                      <button
                        key={load.subject_load_id}
                        type="button"
                        onClick={() => toggleClass(load.class_id)}
                        disabled={isSubmitting}
                        className={`group relative flex items-center justify-between gap-3 rounded! border-2 border-black p-3 text-left transition-all shadow-none hover:translate-y-0.5 active:translate-y-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${isSelected
                          ? "bg-primary text-black"
                          : "bg-white text-black hover:bg-accent"
                          }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <p className="font-bold text-base truncate">
                              {load.section_name}
                            </p>
                            <div
                              className={`flex size-5 shrink-0 items-center justify-center rounded border-2 border-black transition-colors ${isSelected ? "bg-black text-white" : "bg-white text-transparent"
                                }`}
                            >
                              <Check className="size-3.5 stroke-[3]" />
                            </div>
                          </div>

                          <div className="mt-1 flex items-center justify-between w-full">
                            <p
                              className={`text-xs font-medium ${isSelected
                                ? "text-foreground"
                                : "text-muted-foreground"
                                }`}
                            >
                              {load.grade_level || "Active Section"}
                            </p>
                            {typeof load.student_count === "number" && (
                              <p
                                className={`text-xs font-medium ${isSelected
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                                  }`}
                              >
                                {load.student_count} {load.student_count === 1 ? "student" : "students"}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </Card>
              ) : (
                <Empty className="shadow-md hover:shadow-none transition-shadow">
                  <EmptyHeader>
                    <EmptyTitle>No Sections Found</EmptyTitle>
                    <EmptyDescription className="text-center">
                      No active sections are assigned to this subject.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </Field>
          </div>
        </section>

        <Dialog.Footer position="static" className="flex-wrap">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
            className="gap-2"
          >
            <X className="size-4" />
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => submitLesson(false)}
            disabled={isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isSubmitting ? "Saving..." : "Save as Draft"}
          </Button>
          <Button
            type="button"
            onClick={() => submitLesson(true)}
            disabled={isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {isSubmitting ? "Saving..." : "Publish Lesson"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
