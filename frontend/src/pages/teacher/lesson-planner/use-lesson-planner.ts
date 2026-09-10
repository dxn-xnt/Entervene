import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LearnerContext {
  checklist: string[];
  text: string;
  // Backward compatibility
  strengths?: boolean;
  interests?: boolean;
  barriers?: boolean;
}

export interface FlowStep {
  id: string;
  phase: "before" | "during" | "after";
  description: string;
}

export interface AssessmentTask {
  id: string;
  description: string;
}

export interface LessonPlanDraft {
  status: "DRAFT" | "SUBMITTED";

  // Info
  title: string;
  learning_area: string;
  grade_section: string;
  date: string;
  sessions: string;
  references: string;
  ai_declaration: string;

  // Intentions (I)
  intentions: {
    competencies: string[];
    content_standard: string;
    performance_standard: string;
    objectives: string;
    context: LearnerContext;
  };

  // Learning Experience (L)
  learning_experience: {
    pre_lesson: string;
    flow: FlowStep[];
    resources: string;
    integration: string;
  };

  // Assessment (A)
  assessment: {
    formative: string;
    tasks: AssessmentTask[];
  };

  // Ways Forward (W)
  ways_forward: {
    extended_opportunities: string;
    reflections: string;
  };
}

const DEFAULT_DRAFT: LessonPlanDraft = {
  status: "DRAFT",
  title: "",
  learning_area: "",
  grade_section: "",
  date: "",
  sessions: "",
  references: "",
  ai_declaration: "",
  intentions: {
    competencies: [""],
    content_standard: "",
    performance_standard: "",
    objectives: "",
    context: {
      checklist: [],
      text: "",
    },
  },
  learning_experience: {
    pre_lesson: "",
    flow: [
      { id: crypto.randomUUID(), phase: "before", description: "" },
      { id: crypto.randomUUID(), phase: "during", description: "" },
      { id: crypto.randomUUID(), phase: "after", description: "" },
    ],
    resources: "",
    integration: "",
  },
  assessment: {
    formative: "",
    tasks: [{ id: crypto.randomUUID(), description: "" }],
  },
  ways_forward: {
    extended_opportunities: "",
    reflections: "",
  },
};

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidationErrors = Partial<Record<string, string>>;

export function validateDraft(draft: LessonPlanDraft): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!draft.title.trim()) errors["title"] = "Lesson title is required.";
  if (!draft.learning_area.trim()) errors["learning_area"] = "Learning area is required.";
  if (!draft.grade_section.trim()) errors["grade_section"] = "Grade & section is required.";
  if (!draft.intentions.objectives.trim())
    errors["objectives"] = "Learning objectives are required.";
  return errors;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function draftToPayload(draft: LessonPlanDraft, targetStatus: "DRAFT" | "SUBMITTED") {
  return {
    status: targetStatus,
    title: draft.title,
    learning_area: draft.learning_area,
    grade_section: draft.grade_section,
    date: draft.date,
    sessions: draft.sessions,
    references: draft.references,
    ai_declaration: draft.ai_declaration,
    intentions: draft.intentions,
    learning_experience: draft.learning_experience,
    assessment: draft.assessment,
    ways_forward: draft.ways_forward,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLessonPlanner(planId?: number) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<LessonPlanDraft>(DEFAULT_DRAFT);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [apiError, setApiError] = useState<string>("");

  // Load existing plan if editing
  useEffect(() => {
    if (!planId) return;
    const load = async () => {
      setIsFetching(true);
      try {
        const res = await apiFetch(`/api/v1/lesson-plans/${planId}`);
        if (!res.ok) throw new Error("Unable to load lesson plan.");
        const data = await res.json();
        setDraft({
          ...DEFAULT_DRAFT,
          ...data,
          status: data.status || "DRAFT",
          intentions: {
            ...DEFAULT_DRAFT.intentions,
            ...(data.intentions ?? {}),
            context: {
              checklist: Array.isArray(data.intentions?.context?.checklist)
                ? data.intentions.context.checklist
                : [],
              text:
                typeof data.intentions?.context?.text === "string"
                  ? data.intentions.context.text
                  : typeof data.intentions?.context === "string"
                  ? data.intentions.context
                  : "",
            },
          },
          learning_experience: { ...DEFAULT_DRAFT.learning_experience, ...(data.learning_experience ?? {}) },
          assessment: { ...DEFAULT_DRAFT.assessment, ...(data.assessment ?? {}) },
          ways_forward: { ...DEFAULT_DRAFT.ways_forward, ...(data.ways_forward ?? {}) },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load plan.";
        setApiError(msg);
        toast.error(msg);
      } finally {
        setIsFetching(false);
      }
    };
    load();
  }, [planId]);

  // Generic field setters
  const setField = useCallback(
    <K extends keyof LessonPlanDraft>(key: K, value: LessonPlanDraft[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
      setApiError("");
    },
    []
  );

  const setNestedField = useCallback(
    <K extends "intentions" | "learning_experience" | "assessment" | "ways_forward">(
      section: K,
      key: keyof LessonPlanDraft[K],
      value: unknown
    ) => {
      setDraft((prev) => ({
        ...prev,
        [section]: { ...prev[section], [key]: value },
      }));
      setErrors((prev) => ({ ...prev, [String(key)]: undefined }));
      setApiError("");
    },
    []
  );

  // Save draft (no validation, stays on current page)
  const saveDraft = useCallback(async () => {
    setIsSaving(true);
    setApiError("");
    setSaveSuccess(false);
    try {
      let res: Response;
      if (planId) {
        res = await apiFetch(`/api/v1/lesson-plans/${planId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToPayload(draft, "DRAFT")),
        });
      } else {
        res = await apiFetch("/api/v1/lesson-plans/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToPayload(draft, "DRAFT")),
        });
        if (res.ok) {
          const created = await res.json();
          navigate(`/teacher/lesson-planner/${created.plan_id}`, { replace: true });
        }
      }
      if (!res.ok) throw new Error("Unable to save draft.");
      setSaveSuccess(true);
      toast.success("Lesson plan draft saved successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      setApiError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  }, [draft, planId, navigate]);

  // Submit (enforces validation, marks status as SUBMITTED, navigates to list)
  const submitPlan = useCallback(async () => {
    const errs = validateDraft(draft);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);

      const missingLabels: string[] = [];
      if (errs["title"]) missingLabels.push("Lesson Title");
      if (errs["learning_area"]) missingLabels.push("Learning Area / Subject");
      if (errs["grade_section"]) missingLabels.push("Grade Level & Section");
      if (errs["objectives"]) missingLabels.push("Learning Objectives");

      const errorMsg = `Please fill in the required inputs to create a plan: ${missingLabels.join(", ")}.`;
      setApiError(errorMsg);
      toast.error(errorMsg, { duration: 6000 });

      let targetTab: "info" | "intentions" = "info";
      if (errs["title"] || errs["learning_area"] || errs["grade_section"]) {
        targetTab = "info";
      } else if (errs["objectives"]) {
        targetTab = "intentions";
      }

      return { success: false, targetTab };
    }

    setIsSubmitting(true);
    setApiError("");
    try {
      let res: Response;
      if (planId) {
        res = await apiFetch(`/api/v1/lesson-plans/${planId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToPayload(draft, "SUBMITTED")),
        });
      } else {
        res = await apiFetch("/api/v1/lesson-plans/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftToPayload(draft, "SUBMITTED")),
        });
      }
      if (!res.ok) throw new Error("Unable to submit plan.");
      toast.success("Lesson plan submitted successfully!");
      // Navigation is intentionally deferred to the caller so exports
      // can complete before the component unmounts.
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Submission failed.";
      setApiError(msg);
      toast.error(msg);
      return { success: false };
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, planId]);

  return {
    draft,
    setField,
    setNestedField,
    saveDraft,
    submitPlan,
    isSaving,
    isSubmitting,
    isFetching,
    errors,
    saveSuccess,
    apiError,
  };
}
