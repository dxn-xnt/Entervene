import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Lightbulb, Send } from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
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
  const [success, setSuccess] = useState("");

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
      setSuccess("");
    }
  }, [isModalOpen]);

  async function submitSuggestion(e?: React.FormEvent) {
    if (e) e.preventDefault();

    const selected = resources.find((resource) => resource.id === resourceId);
    if (!selected) {
      setFormError("Select a lesson or classwork resource.");
      return;
    }
    if (!title.trim()) {
      setFormError("Suggestion title is required.");
      return;
    }

    setIsSubmitting(true);
    setFormError("");
    setSuccess("");
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
      setSuccess("Suggestion sent to student successfully.");
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

    setIsGenerating(true);
    setFormError("");
    setSuccess("");
    try {
      const result = await generateRecommendationDrafts({
        class_id: classId,
        subject_id: subjectId,
        low_score_threshold: recommendationThreshold,
      });
      setSuccess(
        `Generated ${result.suggestions.length} draft recommendation${result.suggestions.length === 1 ? "" : "s"} for teacher review.`,
      );
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
        className="w-[95vw] max-w-2xl p-0 overflow-hidden"
      >
        <Dialog.Header>
          <div className="flex items-center gap-2.5">
            <Lightbulb className="size-6 text-black" />
            <div>
              <h2 className="text-lg font-black text-black">
                Suggest Study Material
              </h2>
              <p className="text-xs font-semibold text-black/60">
                For {student.full_name}
              </p>
            </div>
          </div>
        </Dialog.Header>

        <div className="max-h-[80vh] overflow-y-auto p-6 space-y-4">
          {formError && (
            <Alert status="error" className="text-xs">
              {formError}
            </Alert>
          )}
          {success && (
            <Alert status="success" className="text-xs">
              {success}
            </Alert>
          )}

          {/* AI Drafts Generator Card */}
          <div className="border-2 border-black bg-[#F6E9B2]/40 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-32 flex-1 text-xs font-bold">
                Low score threshold (%)
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={recommendationThreshold}
                  onChange={(event) =>
                    setRecommendationThreshold(Number(event.target.value))
                  }
                  className="mt-1 w-full rounded-none border-black bg-white px-2 h-10 text-xs shadow-none"
                />
              </label>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={generateDrafts}
                disabled={isGenerating || !subjectId}
                className="h-10 border-black bg-[#79bd80] font-black hover:bg-[#79bd80] disabled:opacity-50"
              >
                <Bot size={14} className="mr-1 inline" />
                {isGenerating ? "Generating..." : "Generate AI Drafts"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-black/60">
              Scans low classwork results and saves suggested materials as teacher-approved drafts.
            </p>
          </div>

          <form onSubmit={submitSuggestion} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-gray-900">
                Subject <span className="text-red-500">*</span>
                <select
                  value={subjectId}
                  onChange={(event) => setSubjectId(Number(event.target.value))}
                  className="mt-1 w-full border-2 border-black bg-[#fffdf5] px-2 py-2 text-xs font-medium outline-none focus:border-black"
                >
                  {activeSubjects.map((subject) => (
                    <option
                      key={subject.subject_load_id}
                      value={subject.subject_id}
                    >
                      {subject.subject_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-bold text-gray-900">
                Resource Type <span className="text-red-500">*</span>
                <select
                  value={resourceType}
                  onChange={(event) =>
                    setResourceType(
                      event.target.value as SuggestionResourceType,
                    )
                  }
                  className="mt-1 w-full border-2 border-black bg-[#fffdf5] px-2 py-2 text-xs font-medium outline-none focus:border-black"
                >
                  <option value="CLASSWORK">Classwork or Reading</option>
                  <option value="LESSON">Lesson</option>
                </select>
              </label>
            </div>

            <label className="block text-xs font-bold text-gray-900">
              Resource <span className="text-red-500">*</span>
              <select
                value={resourceId}
                onChange={(event) => setResourceId(event.target.value)}
                disabled={isResourceLoading || resources.length === 0}
                className="mt-1 w-full border-2 border-black bg-[#fffdf5] px-2 py-2 text-xs font-medium outline-none focus:border-black disabled:opacity-60"
              >
                {resources.length ? (
                  resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.label} - {resource.meta}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {isResourceLoading ? "Loading resources..." : "No resources found"}
                  </option>
                )}
              </select>
            </label>

            <label className="block text-xs font-bold text-gray-900">
              Title <span className="text-red-500">*</span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full rounded-none border-2 border-black bg-[#fffdf5] px-2 py-2 text-xs font-medium shadow-none"
                placeholder="e.g. Review this material"
                required
              />
            </label>

            <label className="block text-xs font-bold text-gray-900">
              Reason / Teacher's Note
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 w-full border-2 border-black bg-[#fffdf5] p-2 text-xs font-medium outline-none focus:border-black resize-none"
                placeholder="Why this material will help the student..."
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 items-center">
              <label className="text-xs font-bold text-gray-900">
                Priority
                <select
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as SuggestionPriority)
                  }
                  className="mt-1 w-full h-10 border-2 border-black bg-[#fffdf5] px-2 text-xs font-medium outline-none focus:border-black"
                >
                  {priorities.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="pt-4 border-t-2 border-black/10 flex items-center justify-end gap-3">
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
                type="submit"
                variant="default"
                size="sm"
                disabled={isSubmitting || !resources.length}
        className="border-2 border-black bg-[#79bd80] hover:bg-[#79bd80] text-black font-bold px-5 text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
              >
                <Send size={14} className="mr-1 inline" />
                {isSubmitting ? "Sending..." : "Send Suggestion"}
              </Button>
            </div>
          </form>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

export default SuggestionPanel;
