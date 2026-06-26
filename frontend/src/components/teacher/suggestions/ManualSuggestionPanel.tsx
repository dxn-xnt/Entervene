import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Bot, CheckCircle2, Lightbulb, Send, X } from "lucide-react";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import {
  approveSuggestion,
  archiveSuggestion,
  createManualSuggestion,
  dismissSuggestion,
  generateRecommendationDrafts,
  getTeacherSuggestions,
} from "@/lib/suggestion-api";
import type { TeacherAdvisoryStudentItem, TeacherAdvisorySubjectLoadItem } from "@/types/adminClasses";
import type { SuggestionPriority, SuggestionResourceType, SuggestionResponse } from "@/types/suggestion";

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

type Props = {
  classId: number;
  student: TeacherAdvisoryStudentItem;
  subjectLoads: TeacherAdvisorySubjectLoadItem[];
};

const priorities: SuggestionPriority[] = ["NORMAL", "HIGH", "URGENT", "LOW"];

export function ManualSuggestionPanel({ classId, student, subjectLoads }: Props) {
  const activeSubjects = useMemo(() => {
    const seen = new Set<number>();
    return subjectLoads.filter((load) => {
      if (seen.has(load.subject_id)) return false;
      seen.add(load.subject_id);
      return true;
    });
  }, [subjectLoads]);

  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<SuggestionResponse[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [subjectId, setSubjectId] = useState(activeSubjects[0]?.subject_id ?? 0);
  const [resourceType, setResourceType] = useState<SuggestionResourceType>("CLASSWORK");
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<SuggestionPriority>("NORMAL");
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendationThreshold, setRecommendationThreshold] = useState(75);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await getTeacherSuggestions({ classId, studentId: student.student_id });
      setHistory(data.suggestions);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Unable to load suggestions.");
    } finally {
      setIsHistoryLoading(false);
    }
  }, [classId, student.student_id]);

  const loadResources = useCallback(async () => {
    setIsResourceLoading(true);
    setFormError("");
    try {
      const path = resourceType === "LESSON"
        ? `/api/v1/lessons/my-class/${classId}/subject/${subjectId}`
        : `/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`;
      const response = await apiFetch(path);
      if (!response.ok) throw new Error("Unable to load suggestion resources.");
      const data = await response.json();
      const options = resourceType === "LESSON"
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
      setFormError(err instanceof Error ? err.message : "Unable to load suggestion resources.");
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
    if (!isOpen) return;
    void loadHistory();
  }, [isOpen, loadHistory]);

  useEffect(() => {
    if (!isOpen || !subjectId) return;
    void loadResources();
  }, [isOpen, loadResources, subjectId]);

  async function submitSuggestion() {
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
      setSuccess("Suggestion sent to student.");
      setTitle("");
      setDescription("");
      await loadHistory();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to create suggestion.");
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
      setSuccess(`Generated ${result.suggestions.length} draft recommendation${result.suggestions.length === 1 ? "" : "s"} for teacher review.`);
      await loadHistory();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to generate recommendation drafts.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function updateSuggestion(id: number, action: "approve" | "dismiss" | "archive") {
    setHistoryError("");
    try {
      if (action === "approve") await approveSuggestion(id);
      else if (action === "dismiss") await dismissSuggestion(id);
      else await archiveSuggestion(id);
      await loadHistory();
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Unable to update suggestion.");
    }
  }

  const activeCount = history.filter((item) => item.status === "ACTIVE").length;
  const draftCount = history.filter((item) => item.status === "DRAFT").length;

  return (
    <div className="mt-2 rounded-lg border border-black/20 bg-[#fffdf5] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-wide">Study Suggestions</p>
          <p className="text-[11px] font-semibold text-black/60">
            {activeCount} active, {draftCount} draft
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          className="inline-flex items-center gap-1 rounded-md border border-black bg-[#79bd80] px-3 py-1 text-xs font-black shadow-[2px_2px_0_#000]"
        >
          <Lightbulb size={14} />
          {isOpen ? "Close" : "Suggest Material"}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
          <section className="rounded-md border border-black bg-white p-3">
            <h4 className="mb-2 text-sm font-black">Create Suggestion</h4>
            {formError && <Alert status="error" className="mb-2 text-xs">{formError}</Alert>}
            {success && <Alert status="success" className="mb-2 text-xs">{success}</Alert>}
            <div className="mb-3 rounded-md border border-black bg-[#F6E9B2] p-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-32 flex-1 text-xs font-bold">
                  Low score threshold
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={recommendationThreshold}
                    onChange={(event) => setRecommendationThreshold(Number(event.target.value))}
                    className="mt-1 w-full rounded-md border border-black bg-white px-2 py-2 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={generateDrafts}
                  disabled={isGenerating || !subjectId}
                  className="rounded-md border border-black bg-[#79bd80] px-3 py-2 text-xs font-black shadow-[2px_2px_0_#000] disabled:opacity-50"
                >
                  <Bot size={14} className="mr-1 inline" />
                  {isGenerating ? "Generating..." : "Generate Drafts"}
                </button>
              </div>
              <p className="mt-1 text-[11px] font-semibold text-black/60">
                Finds low classwork results and saves suggested materials as teacher-approved drafts.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-bold">
                Subject
                <select
                  value={subjectId}
                  onChange={(event) => setSubjectId(Number(event.target.value))}
                  className="mt-1 w-full rounded-md border border-black bg-[#fffdf5] px-2 py-2 text-xs"
                >
                  {activeSubjects.map((subject) => (
                    <option key={subject.subject_load_id} value={subject.subject_id}>
                      {subject.subject_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold">
                Resource type
                <select
                  value={resourceType}
                  onChange={(event) => setResourceType(event.target.value as SuggestionResourceType)}
                  className="mt-1 w-full rounded-md border border-black bg-[#fffdf5] px-2 py-2 text-xs"
                >
                  <option value="CLASSWORK">Classwork or Reading</option>
                  <option value="LESSON">Lesson</option>
                </select>
              </label>
            </div>

            <label className="mt-2 block text-xs font-bold">
              Resource
              <select
                value={resourceId}
                onChange={(event) => setResourceId(event.target.value)}
                disabled={isResourceLoading || resources.length === 0}
                className="mt-1 w-full rounded-md border border-black bg-[#fffdf5] px-2 py-2 text-xs disabled:opacity-60"
              >
                {resources.length ? resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.label} - {resource.meta}
                  </option>
                )) : (
                  <option value="">No resources found</option>
                )}
              </select>
            </label>

            <label className="mt-2 block text-xs font-bold">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full rounded-md border border-black bg-[#fffdf5] px-2 py-2 text-xs"
                placeholder="Review this material"
              />
            </label>

            <label className="mt-2 block text-xs font-bold">
              Reason
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 min-h-16 w-full rounded-md border border-black bg-[#fffdf5] px-2 py-2 text-xs"
                placeholder="Why this material will help"
              />
            </label>

            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
              <label className="text-xs font-bold">
                Priority
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as SuggestionPriority)}
                  className="mt-1 w-full rounded-md border border-black bg-[#fffdf5] px-2 py-2 text-xs"
                >
                  {priorities.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={submitSuggestion}
                disabled={isSubmitting || !resources.length}
                className="self-end rounded-md border border-black bg-[#79bd80] px-3 py-2 text-xs font-black shadow-[2px_2px_0_#000] disabled:opacity-50"
              >
                <Send size={14} className="mr-1 inline" />
                {isSubmitting ? "Sending..." : "Send"}
              </button>
            </div>
          </section>

          <section className="rounded-md border border-black bg-white p-3">
            <h4 className="mb-2 text-sm font-black">History</h4>
            {historyError && <Alert status="error" className="mb-2 text-xs">{historyError}</Alert>}
            {isHistoryLoading ? (
              <p className="text-xs font-semibold text-black/60">Loading suggestions...</p>
            ) : history.length ? (
              <div className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                {history.map((item) => (
                  <article key={item.student_suggestion_id} className="rounded-md border border-black/30 bg-[#fffdf5] p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-black">{item.title}</p>
                        <p className="font-semibold text-black/60">{item.resource.title}</p>
                      </div>
                      <span className="rounded-full border border-black/30 bg-white px-2 py-0.5 font-black">
                        {item.status}
                      </span>
                    </div>
                    {item.description && <p className="mt-1 text-black/70">{item.description}</p>}
                    {item.source_metrics ? (
                      <div className="mt-2 rounded border border-black/20 bg-white px-2 py-1 text-[11px] font-semibold text-black/70">
                        <p>Reason: {String(item.source_metrics.source_title ?? "Low result")}</p>
                        <p>
                          Score: {String(item.source_metrics.score_percent ?? "?")}%
                          {item.source_metrics.threshold_percent ? ` below ${String(item.source_metrics.threshold_percent)}% threshold` : ""}
                        </p>
                      </div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.status === "DRAFT" && (
                        <button
                          type="button"
                          onClick={() => updateSuggestion(item.student_suggestion_id, "approve")}
                          className="inline-flex items-center gap-1 rounded border border-black bg-[#79bd80] px-2 py-1 font-bold"
                        >
                          <CheckCircle2 size={12} />
                          Approve
                        </button>
                      )}
                      {item.status === "ACTIVE" && (
                        <button
                          type="button"
                          onClick={() => updateSuggestion(item.student_suggestion_id, "dismiss")}
                          className="inline-flex items-center gap-1 rounded border border-black px-2 py-1 font-bold"
                        >
                          <X size={12} />
                          Dismiss
                        </button>
                      )}
                      {(item.status === "COMPLETED" || item.status === "DISMISSED") && (
                        <button
                          type="button"
                          onClick={() => updateSuggestion(item.student_suggestion_id, "archive")}
                          className="inline-flex items-center gap-1 rounded border border-black px-2 py-1 font-bold"
                        >
                          <Archive size={12} />
                          Archive
                        </button>
                      )}
                      {item.status === "COMPLETED" && (
                        <span className="inline-flex items-center gap-1 font-bold text-green-700">
                          <CheckCircle2 size={12} />
                          Completed by student
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-xs font-semibold text-black/60">No suggestions yet.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
