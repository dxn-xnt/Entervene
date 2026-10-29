import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Lightbulb, Send } from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/teacher/button";
import { useToast } from "@/components/retroui/Toast";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import {
  createManualSuggestion,
  generateRecommendationDrafts,
} from "@/lib/suggestion-api";
import type {
  TeacherAdvisoryStudentItem,
  TeacherAdvisorySubjectLoadItem,
} from "@/types/adminClasses";
import type {
  SuggestionPriority,
  SuggestionResourceType,
} from "@/types/suggestion";

type LessonOption = {
  lesson_id: number;
  title: string;
  is_published?: boolean;
};

type ClassworkOption = {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type: string;
  is_published: boolean;
};

type ResourceOption = {
  id: string;
  label: string;
  kind: SuggestionResourceType;
  meta: string;
  lessonId?: number;
  classworkAssignmentId?: number;
};

export type SuggestionPanelProps = {
  open?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  classId: number;
  student: TeacherAdvisoryStudentItem;
  subjectLoads: TeacherAdvisorySubjectLoadItem[];
  onSuccess?: () => void;
};

const priorities: SuggestionPriority[] = ["NORMAL", "HIGH", "URGENT", "LOW"];

export function SuggestionPanel({
  open,
  isOpen,
  onOpenChange,
  onClose,
  classId,
  student,
  subjectLoads,
  onSuccess,
}: SuggestionPanelProps) {
  const toast = useToast();
  const isModalOpen = open !== undefined ? open : (isOpen ?? false);

  const activeSubjects = useMemo(() => {
    const seen = new Set<number>();
    return subjectLoads.filter((load) => {
      if (seen.has(load.subject_id)) return false;
      seen.add(load.subject_id);
      return true;
    });
  }, [subjectLoads]);

  const [subjectId, setSubjectId] = useState(
    activeSubjects[0]?.subject_id ?? 0,
  );
  const [resourceType, setResourceType] =
    useState<SuggestionResourceType>("CLASSWORK");
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<SuggestionPriority>("NORMAL");
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendationThreshold, setRecommendationThreshold] = useState(75);
  const [formError, setFormError] = useState("");
  const [titleError, setTitleError] = useState("");
  const [thresholdError, setThresholdError] = useState("");
  const [resourceError, setResourceError] = useState("");
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formError) {
      alertRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      alertRef.current?.focus({ preventScroll: true });
    }
  }, [formError]);

  const handleClose = () => {
    if (onOpenChange) onOpenChange(false);
    if (onClose) onClose();
  };

  const loadResources = useCallback(async () => {
    if (!subjectId) {
      setResources([]);
      setResourceId("");
      return;
    }
    setIsResourceLoading(true);
    setFormError("");
    try {
      const path =
        resourceType === "LESSON"
          ? `/api/v1/lessons/my-class/${classId}/subject/${subjectId}`
          : `/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`;
      const response = await apiFetch(path);
      if (!response.ok) throw new Error("Unable to load suggestion resources.");
      const data = await response.json();
      const options =
        resourceType === "LESSON"
          ? (data as LessonOption[]).map((lesson) => ({
            id: `LESSON:${lesson.lesson_id}`,
            kind: "LESSON" as const,
            lessonId: lesson.lesson_id,
            label: lesson.title,
            meta: lesson.is_published ? "Published lesson" : "Draft lesson",
          }))
          : (data as ClassworkOption[]).map((classwork) => ({
            id: `CLASSWORK:${classwork.classwork_assignment_id}`,
            kind: "CLASSWORK" as const,
            classworkAssignmentId: classwork.classwork_assignment_id,
            label: classwork.title,
            meta: `${classwork.classwork_type || "Classwork"}${classwork.is_published ? "" : " draft"}`,
          }));
      setResources(options);
      setResourceId(options[0]?.id ?? "");
    } catch (err) {
      setResources([]);
      setResourceId("");
      setFormError(
        err instanceof Error
          ? err.message
          : "Unable to load suggestion resources.",
      );
    } finally {
      setIsResourceLoading(false);
    }
  }, [classId, resourceType, subjectId]);

  useEffect(() => {
    if (!subjectId && activeSubjects[0]) {
      setSubjectId(activeSubjects[0].subject_id);
    }
  }, [activeSubjects, subjectId]);

  useEffect(() => {
    if (!isModalOpen || !subjectId) return;
    void loadResources();
  }, [isModalOpen, loadResources, subjectId]);

  // Reset form when modal opens
  useEffect(() => {
    if (isModalOpen) {
      setFormError("");
      setTitleError("");
      setThresholdError("");
      setResourceError("");
    }
  }, [isModalOpen]);

  async function submitSuggestion(e?: React.FormEvent) {
    if (e) e.preventDefault();

    const selected = resources.find((resource) => resource.id === resourceId);
    if (!selected) {
      setResourceError("Select a lesson or classwork resource.");
      return;
    }
    if (!title.trim()) {
      setTitleError("Enter a suggestion title.");
      return;
    }

    setIsSubmitting(true);
    setFormError("");
    try {
      await createManualSuggestion({
        student_id: student.student_id,
        subject_id: subjectId,
        resource_type: selected.kind,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        lesson_id: selected.lessonId ?? null,
        classwork_assignment_id: selected.classworkAssignmentId ?? null,
      });
      toast.success({ title: "Suggestion sent to student" });
      setTitle("");
      setDescription("");
      if (onSuccess) onSuccess();
      setTimeout(() => {
        handleClose();
      }, 800);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Unable to create suggestion.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateDrafts() {
    if (!subjectId) {
      setFormError("Select a subject before generating recommendation drafts.");
      return;
    }
    if (!Number.isFinite(recommendationThreshold) || recommendationThreshold < 0 || recommendationThreshold > 100) {
      setThresholdError("Enter a threshold from 0 to 100.");
      return;
    }

    setIsGenerating(true);
    setFormError("");
    try {
      const result = await generateRecommendationDrafts({
        class_id: classId,
        subject_id: subjectId,
        low_score_threshold: recommendationThreshold,
      });
      toast.success({ title: `${result.suggestions.length} recommendation draft${result.suggestions.length === 1 ? "" : "s"} generated` });
      if (onSuccess) onSuccess();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Unable to generate recommendation drafts.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Dialog
      open={isModalOpen}
      disablePointerDismissal={true}
      onOpenChange={(val) => !val && handleClose()}
    >
      <Dialog.Content
        size="lg"
        className="w-[95vw] max-w-2xl p-0"
      >
        <Dialog.Header>
          <div className="flex items-center gap-2.5">
            <Lightbulb className="size-6" />
            <div>
              <h2 className="text-lg font-black">
                Suggest Study Material
              </h2>
            </div>
          </div>
        </Dialog.Header>

        <div className="space-y-4 p-6">
          <Dialog.Description className="text-sm text-muted-foreground">
            For {student.full_name}
          </Dialog.Description>
          {formError && (
            <div ref={alertRef} tabIndex={-1}>
              <Alert
                status="error"
                aria-live="assertive"
                className="border-0 bg-transparent p-0 text-sm font-medium text-destructive shadow-none"
              >
                {formError}
              </Alert>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-32 flex-1 text-sm font-medium">
                Low score threshold (%)
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={recommendationThreshold}
                  aria-invalid={Boolean(thresholdError)}
                  aria-describedby={thresholdError ? "suggestion-threshold-error" : undefined}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setRecommendationThreshold(value);
                    if (Number.isFinite(value) && value >= 0 && value <= 100) {
                      setThresholdError("");
                      setFormError("");
                    }
                  }}
                  className="mt-1 w-full shadow-none aria-[invalid=true]:border-destructive"
                />
                {thresholdError && <span id="suggestion-threshold-error" className="mt-1 block text-sm text-destructive">{thresholdError}</span>}
              </label>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={generateDrafts}
                disabled={isGenerating || !subjectId}
                className="h-10 disabled:opacity-50"
              >
                <Bot size={14} className="mr-1 inline" />
                {isGenerating ? "Generating..." : "Generate AI Drafts"}
              </Button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Scans low classwork results and saves suggested materials as teacher-approved drafts.
            </p>
          </div>

          <form id="suggestion-form" onSubmit={submitSuggestion} noValidate className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-foreground">
                Subject <span className="text-red-500">*</span>
                <Select value={String(subjectId)} onValueChange={(value) => setSubjectId(Number(value))}>
                  <Select.Trigger className="mt-1 w-full"><Select.Value /></Select.Trigger>
                  <Select.Content>
                  {activeSubjects.map((subject) => (
                    <Select.Item
                      key={subject.subject_load_id}
                      value={String(subject.subject_id)}
                    >
                      {subject.subject_name}
                    </Select.Item>
                  ))}
                  </Select.Content>
                </Select>
              </label>

              <label className="text-sm font-medium text-foreground">
                Resource Type <span className="text-red-500">*</span>
                <Select value={resourceType} onValueChange={(value) => setResourceType(value as SuggestionResourceType)}>
                  <Select.Trigger className="mt-1 w-full"><Select.Value /></Select.Trigger>
                  <Select.Content>
                    <Select.Item value="CLASSWORK">Classwork or Reading</Select.Item>
                    <Select.Item value="LESSON">Lesson</Select.Item>
                  </Select.Content>
                </Select>
              </label>
            </div>

            <label className="block text-sm font-medium text-foreground">
              Resource <span className="text-red-500">*</span>
              <Select value={resourceId} onValueChange={(value) => {
                setResourceId(value);
                setResourceError("");
                setFormError("");
              }} disabled={isResourceLoading || resources.length === 0}>
                <Select.Trigger aria-invalid={Boolean(resourceError)} aria-describedby={resourceError ? "suggestion-resource-error" : undefined} className="mt-1 w-full aria-[invalid=true]:border-destructive"><Select.Value placeholder={isResourceLoading ? "Loading resources..." : "No resources found"} /></Select.Trigger>
                <Select.Content>
                {resources.length ? (
                  resources.map((resource) => (
                    <Select.Item key={resource.id} value={resource.id}>
                      {resource.label} - {resource.meta}
                    </Select.Item>
                  ))
                ) : null}
                </Select.Content>
              </Select>
              {resourceError && <span id="suggestion-resource-error" className="mt-1 block text-sm text-destructive">{resourceError}</span>}
            </label>

            <label className="block text-sm font-medium text-foreground">
              Title <span className="text-red-500">*</span>
              <Input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                  if (event.target.value.trim()) {
                    setTitleError("");
                    setFormError("");
                  }
                }}
                aria-invalid={Boolean(titleError)}
                aria-describedby={titleError ? "suggestion-title-error" : undefined}
                className="mt-1 w-full shadow-none aria-[invalid=true]:border-destructive"
                placeholder="e.g. Review this material"
              />
              {titleError && <span id="suggestion-title-error" className="mt-1 block text-sm text-destructive">{titleError}</span>}
            </label>

            <label className="block text-sm font-medium text-foreground">
              Reason / Teacher's Note
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 w-full resize-none rounded! border-2 border-border bg-background p-2 font-sans text-sm text-foreground"
                placeholder="Why this material will help the student..."
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 items-center">
              <label className="text-sm font-medium text-foreground">
                Priority
                <Select value={priority} onValueChange={(value) => setPriority(value as SuggestionPriority)}>
                  <Select.Trigger className="mt-1 w-full"><Select.Value /></Select.Trigger>
                  <Select.Content>
                  {priorities.map((item) => (
                    <Select.Item key={item} value={item}>
                      {item.charAt(0) + item.slice(1).toLowerCase()}
                    </Select.Item>
                  ))}
                  </Select.Content>
                </Select>
              </label>
            </div>

          </form>
        </div>
        <Dialog.Footer>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4"
          >
            Cancel
          </Button>
          <Button
            form="suggestion-form"
            type="submit"
            size="sm"
            disabled={isSubmitting || !resources.length}
            className="px-5 disabled:opacity-50"
          >
            <Send size={14} className="mr-1 inline" />
            {isSubmitting ? "Sending..." : "Send Suggestion"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default SuggestionPanel;
