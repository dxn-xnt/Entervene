import { Fragment, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { unorderedValues } from "@/lib/form-changes";
import { FormMessage, NoChangesMessage } from "@/components/retroui/FormMessage";
import { useNavigate } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { useToast } from "@/components/retroui/Toast";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Avatar } from "@/components/retroui/Avatar";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Select } from "@/components/retroui/Select";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Accordion } from "@/components/retroui/Accordion";
import { Empty } from "@/components/retroui/Empty";
import ClassworkItemLine from "@/components/item-line/classwork";
import { Activity, BookOpen, Plus, Sparkles, Pencil, RefreshCw } from "lucide-react";
import AiRemediationDraftModal, {
  type DraftValidationResult,
} from "./ai-remediation-draft-modal";
import AIQuizGeneratorModal, {
  type RemediationQuizGeneratorConfig,
} from "./ai-quiz-generator-modal";
import PracticeAssessmentModal from "./practice-assessment-modal";
import {
  type PracticeAssessmentDetail,
  type PracticeAttemptSummary,
  PracticeAssessmentApiError,
  getTeacherPracticeAssessment,
  listTeacherPracticeAttempts,
} from "@/lib/practice-assessment-api";
import { InterventionPredictionHistory } from "@/components/teacher/intervention-prediction-history";
import {
  remediationProgressState,
} from "./remediation-progress-status";
import { RemediationProgressNotice } from "./remediation-progress-notice";
import {
  createSupportMaterial,
  generateStudentReviewer,
  listSupportMaterials,
  saveSupportMaterial,
  sendStudentReviewer,
  getRemediationWorkspace,
  saveRemediationPlan,
  generateRemediationAdvisory,
  previewScoreAdjustment,
  projectSubjectGrade,
  generateRemediationDraft,
  refreshRemediationEvidence,
  eligibleRemediationLessonIds,
  preflightRemediationDraft,
  createRemediationAssessment,
  InterventionApiError,
  type RemediationGeneratedDraft,
  type RemediationAssessmentCreateResult,
  type RemediationQuizDraft,
  type RemediationClassworkDraft,
  type RemediationQuizQuestionDraft,
  type RemediationTeacherAnswerKey,
  type RemediationTaskDraft,
  type RemediationDeliverableDraft,
  type RemediationRubricLevelDraft,
  type RemediationTeacherClassworkGuide,
  type SubjectGradeProjectionResponse,
  type ClassworkScorePreview,
  type RemediationFormat,
  type RemediationPlan,
  type RemediationResource,
  type RemediationFocus,
  type RemediationProgress,
  type RemediationPredictionImpact,
  type RemedialDraft,
  type ReviewerDraft,
  type SupportMaterial,
  type TeacherInterventionDetail,
  type TeacherInterventionSummary,
  type OriginalExamination,
  type RemediationGenerationEligibility,
  type InterventionRecipientScopes,
  type ResourceRecipientScope,
} from "@/lib/teacher-interventions-api";
import { SubjectGradeProjectionCard } from "./subject-grade-projection-card";
import { InterventionResourceRecipientSelector } from "./intervention-resource-recipient-selector";
import { formatResourceScopeBadgeLabel } from "@/lib/intervention-resource-scope";
import { formatToTitleCase } from "@/lib/formatters";
import CreateClassworkModal from "./create-classwork";
import EditClassworkModal from "./edit-classwork";
import { apiFetch, getTeacherClasses } from "@/lib/api";
import type { TeacherClassLoad, TeacherClasswork } from "@/types/classwork";
import Field from "@/components/admin/classes/fields/Field";
import IconContainer from "@/components/icon-container";

const date = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const methods: Array<{ value: RemediationFormat; label: string; detail: string; aiRecommendable: boolean }> = [
  { value: "QUIZ", label: "Quiz", detail: "Focused practice in the existing Quiz builder", aiRecommendable: true },
  { value: "CLASSWORK", label: "Classwork", detail: "Targeted activity in the existing Classwork creator", aiRecommendable: true },
];

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const componentLabel = (value: string | null | undefined) =>
  value
    ? value
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Teacher review required";

const isGraded = (choice: RemediationFormat | null) =>
  choice === "QUIZ" || choice === "CLASSWORK";

const newRemediationRequestId = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const isSupportedAIRecommendation = (
  suggestion: RemediationPlan["ai_suggestion"],
  focus: RemediationFocus | null,
  originalExams: OriginalExamination[]
) => {
  if (!suggestion) return false;
  if (suggestion.recommended_format === "EXISTING_MATERIAL_ONLY") {
    return suggestion.recommended_grade_treatment == null;
  }
  const method = methods.find((item) => item.value === suggestion.recommended_format);
  if (!method?.aiRecommendable) return false;
  const treatment = suggestion.recommended_grade_treatment;
  if (!focus || treatment == null) return false;
  if (treatment !== "PRACTICE_ONLY" && treatment !== focus.component) return false;
  if (focus.component === "PERFORMANCE_TASK" && suggestion.recommended_format !== "CLASSWORK") return false;
  if (focus.component === "EXAMINATION" && suggestion.recommended_format !== "QUIZ") return false;
  if (
    treatment === "EXAMINATION" &&
    (!focus.exam_subtype || !originalExams.some((exam) => exam.subtype === focus.exam_subtype))
  ) return false;
  return true;
};

const validateCap = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return "Target-score ceiling is required.";
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return "Target-score ceiling must be a valid number.";
  if (parsed < 0) return "Target-score ceiling cannot be negative.";
  if (parsed >= 100) {
    return "Full Replacement (100%) is not permitted under remediation policy. The target-score ceiling must be less than 100%.";
  }
  return null;
};

const isInstructionalResource = (item: RemediationResource) =>
  item.kind === "CLASSWORK" &&
  item.classwork_type?.toUpperCase() === "READING" &&
  item.is_graded === false;

const reconcileSelectedResources = (
  selectedResources: RemediationPlan["selected_resources"],
  availableResources: RemediationResource[]
) => {
  const eligible = new Set(
    availableResources
      .filter(
        (item) =>
          item.match_level !== "SOURCE_ACTIVITY" && isInstructionalResource(item)
      )
      .map((item) => `${item.kind}:${item.id}`)
  );
  const seen = new Set<string>();
  const reconciled: RemediationPlan["selected_resources"] = [];
  selectedResources.forEach((item) => {
    const key = `${item.kind}:${item.id}`;
    if (!eligible.has(key) || seen.has(key)) return;
    seen.add(key);
    reconciled.push({ kind: item.kind, id: item.id });
  });
  return reconciled;
};

const validateDraftCompleteness = (
  draft: RemediationGeneratedDraft | null
): DraftValidationResult => {
  if (!draft) return { isValid: false, issues: ["No draft loaded."] };
  const issues: string[] = [];

  if (!draft.title?.trim()) {
    issues.push("Remediation title is required.");
  }

  if (draft.draft_format === "QUIZ") {
    const quizDraft = draft as RemediationQuizDraft;
    if (!quizDraft.instructions?.trim()) {
      issues.push("Student instructions are required.");
    }
    if (!quizDraft.questions || quizDraft.questions.length === 0) {
      issues.push("At least one quiz question is required.");
    } else {
      quizDraft.questions.forEach((q, idx) => {
        const itemNum = q.display_order || idx + 1;
        if (!q.question_text?.trim()) {
          issues.push(`Item ${itemNum}: Question prompt is required.`);
        }
        if (!q.points || Number(q.points) <= 0) {
          issues.push(`Item ${itemNum}: Points must be greater than 0.`);
        }
        if (q.options && q.options.length > 0) {
          const hasEmptyOpt = q.options.some((opt) => !opt.option_text?.trim());
          if (hasEmptyOpt) {
            issues.push(`Item ${itemNum}: All option choices must have text.`);
          }
        }
        if (!q.teacher_answer_key?.correct_answer?.trim()) {
          issues.push(`Item ${itemNum}: Correct answer is required.`);
        }
        if (!q.teacher_answer_key?.explanation?.trim()) {
          issues.push(`Item ${itemNum}: Teacher explanation is required.`);
        }
      });
    }
  } else if (draft.draft_format === "CLASSWORK") {
    const cwDraft = draft as RemediationClassworkDraft;
    if (!cwDraft.description?.trim()) {
      issues.push("Activity overview is required.");
    }
    if (!cwDraft.student_instructions?.trim()) {
      issues.push("Student instructions are required.");
    }
    if (!cwDraft.tasks || cwDraft.tasks.length === 0) {
      issues.push("At least one task is required.");
    } else {
      cwDraft.tasks.forEach((t, idx) => {
        const tNum = t.task_number || idx + 1;
        if (!t.title?.trim()) {
          issues.push(`Task ${tNum}: Title is required.`);
        }
        if (!t.instructions?.trim()) {
          issues.push(`Task ${tNum}: Instructions are required.`);
        }
      });
    }
    if (!cwDraft.deliverables || cwDraft.deliverables.length === 0) {
      issues.push("At least one deliverable is required.");
    } else {
      cwDraft.deliverables.forEach((d, idx) => {
        if (!d.deliverable_name?.trim()) {
          issues.push(`Deliverable ${idx + 1}: Name is required.`);
        }
      });
    }
    if (!cwDraft.rubric_levels || cwDraft.rubric_levels.length === 0) {
      issues.push("At least one rubric level is required.");
    } else {
      cwDraft.rubric_levels.forEach((r, idx) => {
        if (!r.level_name?.trim()) {
          issues.push(`Rubric level ${idx + 1}: Name is required.`);
        }
        if (r.points == null || Number(r.points) < 0) {
          issues.push(`Rubric level ${idx + 1}: Points cannot be negative.`);
        }
      });
    }
    if (!draft.teacher_guide?.exemplar_or_expected_response?.trim()) {
      issues.push("Teacher guide exemplar or expected response is required.");
    }
    if (!draft.teacher_guide?.evaluation_notes?.trim()) {
      issues.push("Teacher evaluation notes are required.");
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
};

type GradeTreatment = NonNullable<RemediationPlan["grade_treatment"]>;
type DiagnosisActivity = NonNullable<
  TeacherInterventionDetail["diagnosis_snapshot"]["supporting_activities"]
>[number];

const canonicalAssignmentId = (
  activity: DiagnosisActivity,
  originalExams: OriginalExamination[]
) => {
  if (activity.classwork_assignment_id != null) {
    return activity.classwork_assignment_id;
  }
  if (activity.component === "EXAMINATION") {
    return originalExams.find(
      (exam) =>
        exam.assignment_id === activity.classwork_id || exam.title === activity.title
    )?.assignment_id ?? null;
  }
  return activity.classwork_id ?? null;
};

const reconcileTargetAssignmentIds = (
  existingTargets: number[] | undefined,
  linkedIds: ReadonlySet<number>,
  activeUnlinkedTargetId: number | null
): number[] => {
  const linkedInOrder: number[] = [];
  for (const id of existingTargets ?? []) {
    if (linkedIds.has(id) && !linkedInOrder.includes(id)) {
      linkedInOrder.push(id);
    }
  }
  for (const id of linkedIds) {
    if (!linkedInOrder.includes(id)) {
      linkedInOrder.push(id);
    }
  }
  if (activeUnlinkedTargetId != null && !linkedIds.has(activeUnlinkedTargetId)) {
    return [...linkedInOrder, activeUnlinkedTargetId];
  }
  return linkedInOrder;
};

const isEligibleGradeTreatment = (
  treatment: RemediationPlan["grade_treatment"],
  focus: RemediationFocus
) =>
  treatment == null ||
  treatment === "PRACTICE_ONLY" ||
  treatment === focus.component;

const reconcileGradeTreatment = (
  plan: RemediationPlan,
  focus: RemediationFocus,
  hasAssessment: boolean = false
): RemediationPlan =>
  hasAssessment || isEligibleGradeTreatment(plan.grade_treatment, focus)
    ? plan
    : {
      ...plan,
      grade_treatment: null,
      target_assignment_ids: [],
      original_exam_assignment_id: null,
    };

export interface SaveAdjustmentsOptions {
  silentIfUnchanged?: boolean;
  readingsOnly?: boolean;
}

export interface InterventionSupportMaterialsHandle {
  saveAdjustments: (options?: SaveAdjustmentsOptions) => Promise<boolean>;
  validateStep: (step: number) => boolean;
}

export interface InterventionSupportMaterialsProps {
  navigation?: import("react").ReactNode;
  onChangesChange?: (hasChanges: boolean) => void;
  detail: TeacherInterventionDetail;
  page?: "overview" | "plan";
  previousResolved?: TeacherInterventionSummary;
  onAddInterventionActivity?: () => void;
  onNavigateToStep?: (step: number) => void;
  wizardStep?: number;
}

const InterventionSupportMaterials = forwardRef<
  InterventionSupportMaterialsHandle,
  InterventionSupportMaterialsProps
>(function InterventionSupportMaterials(
  { detail, page = "overview", previousResolved, onAddInterventionActivity, onNavigateToStep, onChangesChange, wizardStep, navigation },
  ref
) {
  const toast = useToast();
  const {
    intervention_id: interventionId,
    subject_id: subjectId,
    subject_name: subjectName,
  } = detail;
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<SupportMaterial[]>([]);
  const [resources, setResources] = useState<RemediationResource[]>([]);
  const [focus, setFocus] = useState<RemediationFocus | null>(null);
  const [recipientScopes, setRecipientScopes] = useState<InterventionRecipientScopes | null>(null);
  const [resourceRecipientScope, setResourceRecipientScope] = useState<ResourceRecipientScope>("THIS_STUDENT");
  const [generationEligibility, setGenerationEligibility] = useState<RemediationGenerationEligibility | null>(null);
  const latestEligibilityRef = useRef<RemediationGenerationEligibility | null>(null);
  const targetScopeRequestRef = useRef(0);
  const [refreshingEvidence, setRefreshingEvidence] = useState(false);
  const [progress, setProgress] = useState<RemediationProgress | null>(null);
  const [predictionImpact, setPredictionImpact] = useState<RemediationPredictionImpact | null>(null);
  const [originalExams, setOriginalExams] = useState<OriginalExamination[]>([]);
  const [plan, setPlan] = useState<RemediationPlan>({
    teacher_choice: null,
    grade_treatment: null,
    selected_resources: [],
    ai_suggestion: null,
  });
  const [reviewerDraft, setReviewerDraft] = useState<ReviewerDraft | null>(null);
  const [panel, setPanel] = useState<"" | "reviewer" | "materials" | "classworks">("");
  const [selectedActivityIds, setSelectedActivityIds] = useState<number[]>([]);
  const [lessonFilter, setLessonFilter] = useState("ALL");
  const [resourceSearch, setResourceSearch] = useState("");
  const [capInput, setCapInput] = useState<string>("75");
  const [savedPlanValues, setSavedPlanValues] = useState<unknown>(null);
  const [capError, setCapError] = useState<string | null>(null);
  const [wizardError, setWizardError] = useState<string | null>(null);
  useEffect(() => {
    setWizardError(null);
  }, [wizardStep]);
  const [scorePreviews, setScorePreviews] = useState<ClassworkScorePreview[]>([]);
  const [projectionResponse, setProjectionResponse] = useState<SubjectGradeProjectionResponse | null>(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const [actualOutcome, setActualOutcome] = useState<SubjectGradeProjectionResponse | null>(null);
  const [actualOutcomeLoading, setActualOutcomeLoading] = useState(false);
  const projectionRequestRef = useRef(0);
  const lastRequestedKey = useRef("");
  const [recommendationPreviewReady, setRecommendationPreviewReady] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [isCreatingReading, setIsCreatingReading] = useState(false);
  const [teacherLoads, setTeacherLoads] = useState<TeacherClassLoad[]>([]);
  const [practiceAssessment, setPracticeAssessment] = useState<PracticeAssessmentDetail | null>(null);
  const [practiceAttempts, setPracticeAttempts] = useState<PracticeAttemptSummary[]>([]);
  const [practiceAssessmentLoading, setPracticeAssessmentLoading] = useState(true);
  const [practiceAssessmentError, setPracticeAssessmentError] = useState<string | null>(null);
  const [editingClasswork, setEditingClasswork] = useState<TeacherClasswork | null>(null);
  const [isLoadingClasswork, setIsLoadingClasswork] = useState(false);

  const handleOpenEditClasswork = async (classworkId: number) => {
    if (isLoadingClasswork) return;
    setIsLoadingClasswork(true);
    try {
      const res = await apiFetch(`/api/v1/classwork-assignments/classwork/${classworkId}`);
      if (res.ok) {
        const data = (await res.json()) as TeacherClasswork;
        setEditingClasswork(data);
      } else {
        toast.error({ title: "Failed to load classwork details." });
      }
    } catch {
      toast.error({ title: "Failed to load classwork details." });
    } finally {
      setIsLoadingClasswork(false);
    }
  };
  const [isPracticeModalOpen, setIsPracticeModalOpen] = useState(false);
  const [savedReadingIds, setSavedReadingIds] = useState<number[]>([]);

  useEffect(() => {
    let active = true;
    getTeacherClasses(detail.academic_period_id)
      .then((data) => {
        if (active && Array.isArray(data)) {
          setTeacherLoads(data as unknown as TeacherClassLoad[]);
        }
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, [detail.academic_period_id]);

  const effectiveLoads = useMemo<TeacherClassLoad[]>(() => {
    if (teacherLoads.length > 0) return teacherLoads;
    return [
      {
        subject_load_id: 0,
        subject_id: detail.subject_id,
        subject_name: detail.subject_name,
        class_id: detail.class_id,
        section_name: detail.class_name,
        academic_period_id: detail.academic_period_id,
      } as unknown as TeacherClassLoad,
    ];
  }, [teacherLoads, detail]);

  const teacherSubjects = useMemo(() => {
    const map = new Map<number, { id: number; name: string }>();
    map.set(detail.subject_id, { id: detail.subject_id, name: detail.subject_name });
    for (const load of teacherLoads) {
      if (load.subject_id && load.subject_name) {
        map.set(load.subject_id, { id: load.subject_id, name: load.subject_name });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [teacherLoads, detail]);

  const handleReadingCreated = async (createdData?: unknown) => {
    setIsCreatingReading(false);
    try {
      const currentTargetId =
        plan.grade_treatment === "EXAMINATION"
          ? plan.original_exam_assignment_id ?? selectedActivityIds[0] ?? null
          : selectedActivityIds[0] ?? null;
      const updatedWorkspace = await getRemediationWorkspace(interventionId, currentTargetId);
      setResources(updatedWorkspace.resources);
      setFocus(updatedWorkspace.focus);
      setGenerationEligibility(updatedWorkspace.generation_eligibility);
      latestEligibilityRef.current = updatedWorkspace.generation_eligibility;
      setRecipientScopes(updatedWorkspace.recipient_scopes ?? null);

      const createdObj = createdData as { classwork_id?: number; id?: number; title?: string } | undefined;
      const createdId = createdObj?.classwork_id ?? createdObj?.id;
      const newResource = createdId != null
        ? updatedWorkspace.resources.find((r) => r.kind === "CLASSWORK" && r.id === createdId)
        : (createdObj?.title
          ? updatedWorkspace.resources.find((r) => r.kind === "CLASSWORK" && r.title === createdObj.title)
          : updatedWorkspace.resources.find(
            (r) => !resources.some((existing) => existing.kind === r.kind && existing.id === r.id)
          ));

      if (newResource) {
        setPlan((current) => {
          if (
            current.selected_resources.some(
              (r) => r.kind === newResource.kind && r.id === newResource.id
            )
          ) {
            return current;
          }
          return {
            ...current,
            selected_resources: [
              ...current.selected_resources,
              {
                kind: newResource.kind,
                id: newResource.id,
              },
            ],
          };
        });
        toast.success({ title: `Added "${newResource.title}" to supporting readings.` });
      } else {
        toast.success({ title: "Reading created and updated in resources." });
      }
    } catch {
      toast.error({ title: "Reading created, but failed to refresh workspace resources." });
    }
  };
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [advisoryError, setAdvisoryError] = useState<string | null>(null);
  const choiceOrigin = useRef<"none" | "manual" | "ai">("none");
  const advisoryAttemptedRef = useRef<Set<number>>(new Set());
  const advisoryInFlightRef = useRef<Set<number>>(new Set());
  const previousAdvisoryActiveRef = useRef(false);
  const persistedPlanRef = useRef<RemediationPlan | null>(null);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<RemediationGeneratedDraft | null>(null);
  const [showDraftPreview, setShowDraftPreview] = useState(false);
  const [isRemediationQuizAiModalOpen, setIsRemediationQuizAiModalOpen] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [draftSaveState, setDraftSaveState] = useState<"idle" | "validating" | "saving" | "saved" | "error">("idle");
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [savedAssessment, setSavedAssessment] = useState<RemediationAssessmentCreateResult | null>(null);
  const draftRequestIdRef = useRef<string | null>(null);
  const preModalSelectedIdsRef = useRef<number[]>([]);

  const resetDraftCreationState = useCallback(() => {
    setGeneratingDraft(false);
    setGenerationError(null);
    setGeneratedDraft(null);
    setShowDraftPreview(false);
    setIsRemediationQuizAiModalOpen(false);
    setIsEditingDraft(false);
    setDraftSaveState("idle");
    setDraftSaveError(null);
    setSavedAssessment(null);
    draftRequestIdRef.current = null;
  }, []);

  const hasSavedAssessment = Boolean(
    (progress?.assigned_remediation && progress.assigned_remediation.length > 0) ||
    (progress?.completed_remediation && progress.completed_remediation.length > 0) ||
    savedAssessment !== null
  );

  useEffect(() => {
    if (wizardStep == null || loading || hasSavedAssessment || !focus?.component || !isGraded(plan.teacher_choice)) return;
    setPlan((current) => current.grade_treatment != null
      ? current
      : { ...current, grade_treatment: focus.component });
  }, [wizardStep, loading, hasSavedAssessment, focus?.component, plan.teacher_choice]);

  const setNotice = (message: string) => {
    if (message) toast.success({ title: message });
  };

  const practiceAssessmentLoadMessage = (cause: unknown) => {
    if (cause instanceof PracticeAssessmentApiError) {
      if (cause.status === 401) {
        return "Your session expired. Sign in again, then retry loading the Practice Assessment.";
      }
      if (cause.status === 403) {
        return "You no longer have permission to view this Practice Assessment.";
      }
      if (cause.status >= 500) {
        return "The Practice Assessment service is unavailable right now. Please retry.";
      }
    }
    if (cause instanceof TypeError) {
      return "Unable to reach the server. Check your connection and retry.";
    }
    return "Unable to load the Practice Assessment. Please retry.";
  };

  const loadPracticeAssessment = async () => {
    setPracticeAssessmentLoading(true);
    setPracticeAssessmentError(null);
    try {
      const practiceData = await getTeacherPracticeAssessment(interventionId);
      const attemptData = practiceData
        ? await listTeacherPracticeAttempts(interventionId)
        : [];
      setPracticeAssessment(practiceData);
      setPracticeAttempts(attemptData ?? []);
      return true;
    } catch (cause) {
      setPracticeAssessmentError(practiceAssessmentLoadMessage(cause));
      return false;
    } finally {
      setPracticeAssessmentLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setWorkspaceError(null);
    try {
      const [support, workspace] = await Promise.all([
        listSupportMaterials(interventionId),
        getRemediationWorkspace(interventionId),
      ]);
      setMaterials(support.items);
      setResources(workspace.resources);
      setRecipientScopes(workspace.recipient_scopes ?? null);
      setResourceRecipientScope("THIS_STUDENT");
      const hasExistingAssessment = Boolean(
        (workspace.progress?.assigned_remediation && workspace.progress.assigned_remediation.length > 0) ||
        (workspace.progress?.completed_remediation && workspace.progress.completed_remediation.length > 0)
      );
      const loadedPlan = reconcileGradeTreatment(
        {
          ...workspace.plan,
          selected_resources: reconcileSelectedResources(
            workspace.plan.selected_resources,
            workspace.resources
          ),
        },
        workspace.focus,
        hasExistingAssessment
      );
      const primaryAssigned = workspace.progress?.assigned_remediation?.[0];
      if (hasExistingAssessment && !loadedPlan.grade_treatment && primaryAssigned) {
        loadedPlan.grade_treatment = primaryAssigned.is_graded === false ? "PRACTICE_ONLY" : (primaryAssigned.component as GradeTreatment | null);
      }
      const loadedTargets =
        loadedPlan.target_assignment_ids && loadedPlan.target_assignment_ids.length > 0
          ? loadedPlan.target_assignment_ids
          : loadedPlan.original_exam_assignment_id != null
            ? [loadedPlan.original_exam_assignment_id]
            : primaryAssigned?.original_assignment_id != null
              ? [primaryAssigned.original_assignment_id]
              : [];
      const linkedOriginalIds = new Set(
        (workspace.progress?.assigned_remediation ?? [])
          .map((item) => item.original_assignment_id)
          .filter((id): id is number => id != null)
      );
      const unlinkedTargets = loadedTargets.filter((id) => !linkedOriginalIds.has(id));
      const currentTarget = unlinkedTargets.at(-1) ?? null;
      const reconciledTargets = reconcileTargetAssignmentIds(
        loadedTargets,
        linkedOriginalIds,
        currentTarget
      );
      const loadedExamTarget =
        loadedPlan.grade_treatment === "EXAMINATION"
          ? loadedPlan.original_exam_assignment_id ?? (reconciledTargets[0] ?? null)
          : null;
      const loadedCap = loadedPlan.score_adjustment_cap ?? 75;
      setSelectedActivityIds(currentTarget == null ? [] : [currentTarget]);
      setCapInput(String(loadedCap));
      setCapError(null);
      if (workspace.score_previews && workspace.score_previews.length > 0) {
        setScorePreviews(workspace.score_previews);
      }
      setRecommendationPreviewReady(false);

      choiceOrigin.current = loadedPlan.teacher_choice ? "manual" : "none";
      const initialRecommendation = isSupportedAIRecommendation(
        loadedPlan.ai_suggestion,
        workspace.focus,
        workspace.original_exams ?? []
      );
      const nextLoadedPlan: RemediationPlan = {
        ...loadedPlan,
        target_assignment_ids: reconciledTargets,
        score_adjustment_cap: loadedCap,
        original_exam_assignment_id: loadedExamTarget,
        ai_suggestion: initialRecommendation ? loadedPlan.ai_suggestion : null,
      };
      persistedPlanRef.current = nextLoadedPlan;
      setPlan(nextLoadedPlan);
      setSavedPlanValues(planValues(
        nextLoadedPlan,
        currentTarget == null ? [] : [currentTarget],
        String(loadedCap),
        workspace.resources
      ));
      const initialSavedReadings = (loadedPlan.selected_resources || [])
        .filter((r) => r.kind === "CLASSWORK")
        .map((r) => r.id);
      setSavedReadingIds(initialSavedReadings);

      setAdvisoryError(
        loadedPlan.ai_suggestion && !initialRecommendation
          ? "No supported remediation recommendation is available right now."
          : null
      );
      setFocus(workspace.focus);
      setGenerationEligibility(workspace.generation_eligibility);
      latestEligibilityRef.current = workspace.generation_eligibility;
      setProgress(workspace.progress);
      setPredictionImpact(workspace.prediction_impact ?? null);
      setOriginalExams(workspace.original_exams ?? []);
      const existingReviewer = support.items.find(
        (item) => item.kind === "STUDENT_REVIEWER"
      );
      setReviewerDraft(
        existingReviewer ? (existingReviewer.current_content as ReviewerDraft) : null
      );

      await loadPracticeAssessment();
    } catch (cause) {
      setWorkspaceError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Unable to load support workspace. Please retry."
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePracticeAssessmentUpdated = async (updated: PracticeAssessmentDetail | null) => {
    setPracticeAssessment(updated);
    setPracticeAssessmentError(null);
    if (updated) {
      try {
        const atts = await listTeacherPracticeAttempts(interventionId);
        setPracticeAttempts(atts ?? []);
      } catch (cause) {
        setPracticeAssessmentError(practiceAssessmentLoadMessage(cause));
      }
    } else {
      setPracticeAttempts([]);
    }
  };

  useEffect(() => {
    void load();
  }, [interventionId, detail.current_prediction_revision, detail.current_predicted_grade]);

  useEffect(() => {
    const isAdvisoryView = page === "plan" && (wizardStep == null || wizardStep === 3);
    const enteredAdvisoryView = isAdvisoryView && !previousAdvisoryActiveRef.current;
    previousAdvisoryActiveRef.current = isAdvisoryView;
    if (enteredAdvisoryView && !advisoryInFlightRef.current.has(interventionId)) {
      advisoryAttemptedRef.current.delete(interventionId);
    }

    const supportedRecommendation = isSupportedAIRecommendation(
      plan.ai_suggestion,
      focus,
      originalExams
    );
    // Never replace or interrupt an existing teacher-authored method choice.
    if (
      !isAdvisoryView ||
      loading ||
      Boolean(workspaceError) ||
      supportedRecommendation ||
      plan.teacher_choice ||
      hasSavedAssessment
    ) {
      return;
    }
    if (
      advisoryAttemptedRef.current.has(interventionId) ||
      advisoryInFlightRef.current.has(interventionId)
    ) {
      return;
    }

    let active = true;
    advisoryAttemptedRef.current.add(interventionId);
    advisoryInFlightRef.current.add(interventionId);
    setAdvisoryError(null);
    void generateRemediationAdvisory(interventionId)
      .then((advisoryRes) => {
        if (!active) return;
        const suggestion = advisoryRes.plan?.ai_suggestion;
        const supported = isSupportedAIRecommendation(
          suggestion ?? null,
          advisoryRes.focus,
          advisoryRes.original_exams ?? []
        );
        if (!suggestion || !supported) {
          setAdvisoryError("No supported remediation recommendation is available right now.");
          return;
        }
        setPlan((current) => ({ ...current, ai_suggestion: suggestion }));
        if (persistedPlanRef.current) {
          persistedPlanRef.current = { ...persistedPlanRef.current, ai_suggestion: suggestion };
        }
        setAdvisoryError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setAdvisoryError(
          cause instanceof Error && cause.message
            ? cause.message
            : "No supported remediation recommendation is available right now."
        );
      })
      .finally(() => {
        advisoryInFlightRef.current.delete(interventionId);
      });
    return () => {
      active = false;
    };
  }, [focus, hasSavedAssessment, interventionId, loading, originalExams, page, plan.ai_suggestion, plan.teacher_choice, wizardStep, workspaceError]);

  const reviewer = materials.find((item) => item.kind === "STUDENT_REVIEWER");
  const oldAssessment = materials.find((item) => item.kind === "REMEDIAL_ASSESSMENT");
  const oldDraft = oldAssessment?.current_content as RemedialDraft | undefined;
  const hasOldDraft = Boolean(
    oldDraft &&
    (oldDraft.title.trim() ||
      oldDraft.instructions.trim() ||
      oldDraft.questions.length)
  );
  const selected = useMemo(
    () => new Set(plan.selected_resources.map((item) => `${item.kind}:${item.id}`)),
    [plan]
  );
  const selectedResources = useMemo(
    () => {
      const unique = new Map<string, RemediationResource>();
      resources.forEach((item) => {
        const key = `${item.kind}:${item.id}`;
        if (
          item.match_level !== "SOURCE_ACTIVITY" &&
          isInstructionalResource(item) &&
          selected.has(key) &&
          !unique.has(key)
        ) {
          unique.set(key, item);
        }
      });
      return Array.from(unique.values());
    },
    [resources, selected]
  );
  const selectedReadingIds = useMemo(() => {
    return selectedResources
      .filter((r) => r.kind === "CLASSWORK" && (r.classwork_type === "READING" || !r.classwork_type))
      .map((r) => r.id);
  }, [selectedResources]);
  const NO_LESSON = "__NO_LESSON__";
  const lessonKey = (item: RemediationResource) => item.lesson?.trim() || NO_LESSON;
  const materialPool = useMemo(() => {
    const unique = new Map<string, RemediationResource>();
    resources.forEach((item) => {
      if (item.match_level === "SOURCE_ACTIVITY" || !isInstructionalResource(item)) return;
      const key = `${item.kind}:${item.id}`;
      if (!unique.has(key)) unique.set(key, item);
    });
    return Array.from(unique.values()).sort(
      (left, right) =>
        Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)) ||
        left.title.localeCompare(right.title)
    );
  }, [resources]);

  const linkedReadingLessons = useMemo(() => {
    const set = new Set<string>();
    for (const item of selectedResources) {
      const lessonName = item.lesson?.trim();
      if (lessonName && lessonName !== NO_LESSON) {
        set.add(lessonName);
      }
    }
    return Array.from(set);
  }, [selectedResources]);
  const lessonOptions = Array.from(new Set(materialPool.map(lessonKey)));
  const visible = materialPool.filter(
    (item) => lessonFilter === "ALL" || lessonKey(item) === lessonFilter
  );
  const visibleRecommended = visible.filter((item) => item.recommended);
  const visibleRemaining = visible.filter((item) => !item.recommended);
  const groupedRemaining = Array.from(
    visibleRemaining.reduce((groups, item) => {
      const key = lessonKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
      return groups;
    }, new Map<string, RemediationResource[]>())
  );
  const persistedActivities = useMemo(
    () => progress?.assigned_remediation ?? [],
    [progress?.assigned_remediation]
  );
  const linkedOriginalIds = useMemo(
    () =>
      new Set(
        persistedActivities
          .map((item) => item.original_assignment_id)
          .filter((id): id is number => id != null)
      ),
    [persistedActivities]
  );
  const treatmentActivities = useMemo<DiagnosisActivity[]>(() => {
    if (!plan.grade_treatment) return [];
    const all = detail.diagnosis_snapshot.supporting_activities ?? [];
    if (plan.grade_treatment === "PRACTICE_ONLY") {
      return all;
    }
    if (plan.grade_treatment !== focus?.component) return [];
    const filtered = [...all.filter((a) => a.component === plan.grade_treatment)];
    if (
      plan.grade_treatment === "EXAMINATION" &&
      filtered.length === 0 &&
      originalExams.length > 0
    ) {
      return originalExams.map((e) => ({
        classwork_id: e.assignment_id,
        classwork_assignment_id: e.assignment_id,
        title: e.title,
        component: "EXAMINATION",
        score: e.score,
        possible_score: e.total_points,
        percent: e.total_points > 0 ? (e.score / e.total_points) * 100 : 0,
      }));
    }
    if (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") {
      const seenAssignmentIds = new Set(
        filtered
          .map((item) => canonicalAssignmentId(item, originalExams))
          .filter((id): id is number => id != null)
      );
      const liveGains = [
        ...(actualOutcome?.eligible_target_gains ?? []),
        ...(projectionResponse?.eligible_target_gains ?? []),
      ];
      for (const gain of liveGains) {
        if (gain.component === plan.grade_treatment && !seenAssignmentIds.has(gain.assignment_id)) {
          seenAssignmentIds.add(gain.assignment_id);
          filtered.push({
            classwork_id: gain.assignment_id,
            classwork_assignment_id: gain.assignment_id,
            title: gain.title,
            component: gain.component,
            score: gain.original_score,
            possible_score: gain.max_points,
            percent: gain.max_points > 0 ? (gain.original_score / gain.max_points) * 100 : 0,
          });
        }
      }
    }
    return filtered;
  }, [
    actualOutcome?.eligible_target_gains,
    detail.diagnosis_snapshot.supporting_activities,
    focus?.component,
    originalExams,
    plan.grade_treatment,
    projectionResponse?.eligible_target_gains,
  ]);
  const chosenActivities = useMemo(() => {
    if (!plan.grade_treatment) return [];
    const selectedSet = new Set(selectedActivityIds);
    if (plan.grade_treatment === "EXAMINATION" && plan.original_exam_assignment_id != null) {
      selectedSet.add(plan.original_exam_assignment_id);
    }
    const matched: typeof treatmentActivities = [];
    for (const a of treatmentActivities) {
      const targetId = canonicalAssignmentId(a, originalExams);
      if (targetId != null && selectedSet.has(targetId)) {
        matched.push(a);
      }
    }
    if (plan.grade_treatment === "EXAMINATION") {
      for (const exam of originalExams) {
        if (selectedSet.has(exam.assignment_id)) {
          if (!matched.some((m) => m.title === exam.title || canonicalAssignmentId(m, originalExams) === exam.assignment_id)) {
            matched.push({
              classwork_id: exam.assignment_id,
              title: exam.title,
              component: "EXAMINATION",
              score: exam.score,
              possible_score: exam.total_points,
              percent: exam.total_points > 0 ? (exam.score / exam.total_points) * 100 : 0,
            });
          }
        }
      }
    }
    return matched;
  }, [
    plan.grade_treatment,
    plan.original_exam_assignment_id,
    selectedActivityIds,
    treatmentActivities,
    originalExams,
  ]);

  const toggleActivitySelection = (activity: (typeof treatmentActivities)[number]) => {
    const targetId = canonicalAssignmentId(activity, originalExams) ?? activity.classwork_id;
    const matchingExam =
      originalExams.find((e) => e.assignment_id === targetId) ??
      originalExams.find(
        (e) => e.title === activity.title || e.assignment_id === activity.classwork_id
      );
    if (linkedOriginalIds.has(targetId)) return;
    const examTargetId = matchingExam?.assignment_id ?? targetId;
    setSelectedActivityIds([targetId]);
    setWizardError(null);
    setPlan((current) => ({
      ...current,
      target_assignment_ids: reconcileTargetAssignmentIds(
        current.target_assignment_ids,
        linkedOriginalIds,
        targetId
      ),
      original_exam_assignment_id:
        current.grade_treatment === "EXAMINATION" ? examTargetId : null,
    }));
  };

  const selectedScorePreviews = useMemo(() => {
    const selectedIds = new Set(selectedActivityIds);
    if (plan.grade_treatment === "EXAMINATION" && plan.original_exam_assignment_id != null) {
      selectedIds.add(plan.original_exam_assignment_id);
    }
    return scorePreviews.filter((preview) => selectedIds.has(preview.assignment_id));
  }, [plan.grade_treatment, plan.original_exam_assignment_id, scorePreviews, selectedActivityIds]);

  const selectedTargetMaximum = useMemo(() => {
    if (!plan.grade_treatment || plan.grade_treatment === "PRACTICE_ONLY") return 20;
    if (plan.grade_treatment === "EXAMINATION") {
      const exam = originalExams.find(
        (item) =>
          item.assignment_id === plan.original_exam_assignment_id ||
          selectedActivityIds.includes(item.assignment_id)
      );
      return exam?.total_points ?? chosenActivities[0]?.possible_score ?? 20;
    }
    return selectedScorePreviews[0]?.max_points ?? chosenActivities[0]?.possible_score ?? 20;
  }, [
    chosenActivities,
    originalExams,
    plan.grade_treatment,
    plan.original_exam_assignment_id,
    selectedActivityIds,
    selectedScorePreviews,
  ]);

  const recommendedAssignmentId = useMemo(() => {
    if (plan.grade_treatment === "PRACTICE_ONLY") {
      return null;
    }
    if (projectionResponse?.recommended_target_assignment_id != null) {
      return projectionResponse.recommended_target_assignment_id;
    }
    if (!recommendationPreviewReady) {
      return null;
    }
    const eligibleIds = new Set(
      treatmentActivities
        .map((activity) => canonicalAssignmentId(activity, originalExams))
        .filter((id): id is number => id != null)
    );
    const candidates = scorePreviews
      .filter(
        (preview) =>
          eligibleIds.has(preview.assignment_id) &&
          Number.isFinite(preview.possible_gain) &&
          preview.possible_gain > 0
      )
      .sort(
        (left, right) =>
          right.possible_gain - left.possible_gain ||
          left.assignment_id - right.assignment_id
      );
    return candidates[0]?.assignment_id ?? null;
  }, [
    originalExams,
    plan.grade_treatment,
    projectionResponse?.recommended_target_assignment_id,
    recommendationPreviewReady,
    scorePreviews,
    treatmentActivities,
  ]);

  const fetchProjection = useCallback((targetIds?: number[], force = false) => {
    if (
      !plan.grade_treatment ||
      plan.grade_treatment === "PRACTICE_ONLY" ||
      plan.grade_treatment === "EXAMINATION"
    ) {
      setProjectionResponse(null);
      setProjectionError(null);
      setProjectionLoading(false);
      lastRequestedKey.current = "";
      return;
    }

    const currentCapError = validateCap(capInput);
    const parsedCap = Number(capInput);
    const effectiveCap = !currentCapError && Number.isFinite(parsedCap) ? parsedCap : (plan.score_adjustment_cap ?? 75);

    const ids = (targetIds ?? selectedActivityIds).filter((id) => !linkedOriginalIds.has(id));
    const persistedKey = persistedActivities
      .map((item) => `${item.assignment_id}:${item.submission_status ?? ""}:${item.grade ?? ""}`)
      .join("|");
    const reqKey = `${interventionId}:${plan.grade_treatment}:${effectiveCap}:${ids.slice().sort().join(",")}:${persistedKey}`;
    if (!force && reqKey === lastRequestedKey.current) {
      return;
    }
    lastRequestedKey.current = reqKey;
    const reqId = ++projectionRequestRef.current;
    setProjectionLoading(true);
    setProjectionError(null);

    projectSubjectGrade(interventionId, {
      target_assignment_ids: ids,
      score_adjustment_cap: effectiveCap,
    })
      .then((res) => {
        if (reqId === projectionRequestRef.current) {
          setProjectionResponse(res);
        }
      })
      .catch((err) => {
        if (reqId === projectionRequestRef.current) {
          lastRequestedKey.current = "";
          setProjectionError(
            err instanceof Error ? err.message : "Unable to load subject grade projection."
          );
        }
      })
      .finally(() => {
        if (reqId === projectionRequestRef.current) {
          setProjectionLoading(false);
        }
      });
  }, [capInput, interventionId, linkedOriginalIds, persistedActivities, plan.grade_treatment, plan.score_adjustment_cap, selectedActivityIds]);

  useEffect(() => {
    if (
      !plan.grade_treatment ||
      plan.grade_treatment === "PRACTICE_ONLY" ||
      plan.grade_treatment === "EXAMINATION"
    ) {
      setProjectionResponse(null);
      setProjectionError(null);
      setProjectionLoading(false);
      lastRequestedKey.current = "";
      return;
    }

    const currentCapError = validateCap(capInput);
    const parsedCap = Number(capInput);
    const effectiveCap = !currentCapError && Number.isFinite(parsedCap) ? parsedCap : (plan.score_adjustment_cap ?? 75);

    const ids = selectedActivityIds.filter((id) => !linkedOriginalIds.has(id));
    const persistedKey = persistedActivities
      .map((item) => `${item.assignment_id}:${item.submission_status ?? ""}:${item.grade ?? ""}`)
      .join("|");
    const reqKey = `${interventionId}:${plan.grade_treatment}:${effectiveCap}:${ids.slice().sort().join(",")}:${persistedKey}`;
    if (reqKey === lastRequestedKey.current) {
      return;
    }
    fetchProjection();
  }, [capInput, fetchProjection, interventionId, linkedOriginalIds, persistedActivities, plan.grade_treatment, plan.score_adjustment_cap, selectedActivityIds]);

  useEffect(() => {
    if (
      !plan.grade_treatment ||
      plan.grade_treatment === "PRACTICE_ONLY" ||
      treatmentActivities.length === 0
    ) {
      setScorePreviews([]);
      setRecommendationPreviewReady(false);
      return;
    }
    const err = validateCap(capInput);
    if (err) {
      setRecommendationPreviewReady(false);
      return;
    }
    const parsedCap = parseFloat(capInput);
    if (!Number.isFinite(parsedCap)) {
      setRecommendationPreviewReady(false);
      return;
    }

    const previewItems = treatmentActivities
      .map((activity) => {
        const assignmentId = canonicalAssignmentId(activity, originalExams);
        if (assignmentId == null) return null;
        return {
          assignment_id: assignmentId,
          original_score: activity.score,
          max_points: activity.possible_score,
          title: activity.title,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (previewItems.length === 0) {
      setScorePreviews([]);
      setRecommendationPreviewReady(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setRecommendationPreviewReady(false);
    previewScoreAdjustment(interventionId, {
      target_assignment_ids: previewItems.map((item) => item.assignment_id),
      score_adjustment_cap: parsedCap,
      items: previewItems,
    })
      .then((res) => {
        if (!cancelled) {
          setScorePreviews(res?.previews ?? []);
          setRecommendationPreviewReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setScorePreviews([]);
          setRecommendationPreviewReady(false);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [capInput, interventionId, originalExams, plan.grade_treatment, treatmentActivities]);
  const persistedAssigned: NonNullable<RemediationProgress["assigned_remediation"]> =
    progress?.assigned_remediation ??
    progress?.completed_remediation.map((item) => ({
      ...item,
      component: null,
      is_graded: true,
      submission_status: "graded",
    })) ??
    [];
  const assigned: NonNullable<RemediationProgress["assigned_remediation"]> =
    savedAssessment && generatedDraft && !persistedAssigned.some(
      (item) => item.classwork_id === savedAssessment.classwork_id
    )
      ? [
        ...persistedAssigned,
        {
          title: generatedDraft.title,
          assignment_id: savedAssessment.classwork_assignment_id,
          classwork_id: savedAssessment.classwork_id,
          classwork_type: generatedDraft.draft_format === "QUIZ"
            ? "QUIZ"
            : generatedDraft.target_component === "PERFORMANCE_TASK"
              ? "ACTIVITY"
              : "ASSIGNMENT",
          is_published: false,
          component: generatedDraft.target_component,
          is_graded: generatedDraft.grade_treatment !== "PRACTICE_ONLY",
          submission_status: "draft",
          grade: null,
          total_points: generatedDraft.total_points,
          original_assignment_id:
            (plan.grade_treatment === "EXAMINATION" ? plan.original_exam_assignment_id : null) ??
            selectedActivityIds[0] ??
            null,
          original_title:
            chosenActivities[0]?.title ??
            originalExams.find((item) => item.assignment_id === plan.original_exam_assignment_id)?.title ??
            null,
        },
      ]
      : persistedAssigned;
  const hasSubmittedAwaitingGrading = assigned.some(
    (item) =>
      item.is_published !== false &&
      (item.submission_status === "submitted" || item.submission_status === "late") &&
      item.grade == null
  );
  const hasPublishedAwaitingSubmission = assigned.some(
    (item) =>
      item.is_published !== false &&
      item.submission_status !== "graded" &&
      item.submission_status !== "submitted" &&
      item.submission_status !== "late"
  );
  const effectiveRemediationStatus =
    progress?.remediation_status ??
    (assigned.length === 0
      ? "NOT_ASSIGNED"
      : !assigned.some((item) => item.is_published !== false)
        ? "DRAFT"
        : hasSubmittedAwaitingGrading
          ? "SUBMITTED"
          : hasPublishedAwaitingSubmission
            ? "ASSIGNED"
            : "GRADED");
  const phase =
    effectiveRemediationStatus === "GRADED"
      ? "Graded"
      : effectiveRemediationStatus === "SUBMITTED"
        ? "Awaiting Grading"
        : effectiveRemediationStatus === "ASSIGNED"
          ? "Assigned"
          : effectiveRemediationStatus === "DRAFT"
            ? "Draft Prepared"
            : plan.teacher_choice
              ? "Preparing Support"
              : "Needs Support";

  const formatScoreValue = (value: number) =>
    Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/\.?0+$/, "");

  const remediationScoreStatusText = (
    item: NonNullable<RemediationProgress["assigned_remediation"]>[number]
  ) => {
    if (item.is_published === false || item.submission_status === "draft") {
      return "Draft (Unpublished)";
    }
    if (item.submission_status === "graded" && item.grade != null) {
      return `${formatScoreValue(item.grade)} / ${item.total_points != null ? formatScoreValue(item.total_points) : "—"}`;
    }
    if (item.submission_status === "submitted" || item.submission_status === "late") {
      return "Submitted · Awaiting grading";
    }
    return "Awaiting submission";
  };

  const formatPredictedValue = (value: number | null | undefined) =>
    value != null && Number.isFinite(value) ? value.toFixed(2) : "Unavailable";

  const outcomeStatusMessage = (() => {
    if (effectiveRemediationStatus === "DRAFT") {
      return (
        progress?.status_reason ||
        "Remediation draft is prepared and not yet published to the student."
      );
    }
    if (effectiveRemediationStatus === "SUBMITTED") {
      return (
        progress?.status_reason ||
        "Student submitted the remediation activity. Grade the submission to update the AI prediction."
      );
    }
    if (effectiveRemediationStatus === "ASSIGNED") {
      return (
        progress?.status_reason ||
        "Remediation activity is published and awaiting student submission. The AI prediction will update after grading."
      );
    }
    if (effectiveRemediationStatus === "GRADED") {
      const reason = progress?.status_reason ?? "";
      return `${reason ? `${reason} ` : ""}Completion alone does not resolve the Intervention.`;
    }
    return progress?.status_reason ?? "";
  })();

  const liveWhatIf =
    projectionResponse?.ai_midterm_what_if?.status === "AVAILABLE"
      ? projectionResponse.ai_midterm_what_if
      : null;
  const liveWhatIfAfter = liveWhatIf?.target_estimates.at(-1)?.hypothetical_predicted_term_grade ?? null;
  const displayedCurrentPrediction =
    hasSavedAssessment
      ? (predictionImpact?.current_predicted_grade ?? progress?.latest_projection ?? null)
      : (liveWhatIf?.baseline_predicted_term_grade ?? predictionImpact?.current_predicted_grade ?? progress?.latest_projection ?? null);
  const displayedMaxScorePrediction =
    hasSavedAssessment
      ? (predictionImpact?.status === "AVAILABLE" ? predictionImpact.max_remediation_predicted_grade : null)
      : (liveWhatIfAfter ?? (predictionImpact?.status === "AVAILABLE" ? predictionImpact.max_remediation_predicted_grade : null));
  const displayedPredictionDelta =
    displayedCurrentPrediction != null && displayedMaxScorePrediction != null
      ? displayedMaxScorePrediction - displayedCurrentPrediction
      : null;
  const primaryImpactTarget = predictionImpact?.targets[0] ?? null;

  const primaryAssignedAssessment = assigned[0] ?? null;
  const allRemediationGraded =
    persistedActivities.length > 0 && persistedActivities.every(
      (item) => item.submission_status === "graded" && item.grade != null,
    );
  useEffect(() => {
    let active = true;
    if (!allRemediationGraded || !isGraded(plan.teacher_choice)) {
      setActualOutcome(null);
      setActualOutcomeLoading(false);
      return () => { active = false; };
    }
    setActualOutcomeLoading(true);
    projectSubjectGrade(interventionId, { target_assignment_ids: [] })
      .then((result) => { if (active) setActualOutcome(result); })
      .catch(() => { if (active) setActualOutcome(null); })
      .finally(() => { if (active) setActualOutcomeLoading(false); });
    return () => { active = false; };
  }, [allRemediationGraded, interventionId, plan.teacher_choice, persistedActivities.length]);
  const canAddAnother = Boolean(
    allRemediationGraded &&
    !actualOutcomeLoading &&
    detail.status === "ACTIVE" &&
    actualOutcome?.status !== "FINALIZED" &&
    !(actualOutcome?.status === "AVAILABLE" && actualOutcome.current_reaches_passing_threshold === true) &&
    actualOutcome?.additional_eligible_targets_have_positive_improvement
  );
  const remediationState = remediationProgressState({
    interventionStatus: detail.status,
    activities: persistedActivities,
    outcome: actualOutcome,
    outcomeLoading: actualOutcomeLoading,
  });
  const positiveEligibleTargetIds = useMemo(
    () =>
      new Set(
        (actualOutcome?.eligible_target_gains ?? [])
          .filter((item) => item.possible_score_gain > 0)
          .map((item) => item.assignment_id)
      ),
    [actualOutcome?.eligible_target_gains]
  );
  const eligibleTreatmentActivities = useMemo(
    () =>
      treatmentActivities.filter((activity) => {
        const targetId = canonicalAssignmentId(activity, originalExams);
        const isUnlinked = targetId == null || !linkedOriginalIds.has(targetId);
        const hasPositiveProgressiveGain =
          !allRemediationGraded ||
          (targetId != null && positiveEligibleTargetIds.has(targetId));
        return isUnlinked && hasPositiveProgressiveGain;
      }),
    [allRemediationGraded, linkedOriginalIds, originalExams, positiveEligibleTargetIds, treatmentActivities]
  );
  const activeUnlinkedTargetId = useMemo(
    () =>
      selectedActivityIds.find(
        (id) =>
          !linkedOriginalIds.has(id) &&
          (!allRemediationGraded ||
            positiveEligibleTargetIds.size === 0 ||
            positiveEligibleTargetIds.has(id))
      ) ?? null,
    [allRemediationGraded, linkedOriginalIds, positiveEligibleTargetIds, selectedActivityIds]
  );
  const hasConfirmedAdditionalTarget = Boolean(
    canAddAnother &&
    panel !== "classworks" &&
    activeUnlinkedTargetId != null &&
    chosenActivities.length === 1
  );
  const requiresCurrentTarget = !hasSavedAssessment || canAddAnother;
  const openTargetSelectionModal = () => {
    preModalSelectedIdsRef.current = selectedActivityIds;
    setPanel("classworks");
  };
  const openAdditionalTargetSelection = () => {
    preModalSelectedIdsRef.current = selectedActivityIds;
    const currentTargetId = selectedActivityIds[0];
    const hasValidCurrentTarget =
      currentTargetId != null &&
      !linkedOriginalIds.has(currentTargetId) &&
      (!allRemediationGraded ||
        positiveEligibleTargetIds.size === 0 ||
        positiveEligibleTargetIds.has(currentTargetId));
    if (!hasValidCurrentTarget) {
      const recommended = actualOutcome?.recommended_target_assignment_id;
      const activity =
        (recommended != null
          ? eligibleTreatmentActivities.find(
            (item) => canonicalAssignmentId(item, originalExams) === recommended,
          )
          : undefined) ?? eligibleTreatmentActivities[0];
      if (activity) toggleActivitySelection(activity);
    }
    setPanel("classworks");
  };
  const cancelTargetSelection = () => {
    const previousTargetId =
      preModalSelectedIdsRef.current.find((id) => !linkedOriginalIds.has(id)) ?? null;
    setSelectedActivityIds(previousTargetId != null ? [previousTargetId] : []);
    setPlan((current) => ({
      ...current,
      target_assignment_ids: reconcileTargetAssignmentIds(
        current.target_assignment_ids,
        linkedOriginalIds,
        previousTargetId
      ),
      original_exam_assignment_id:
        current.grade_treatment === "EXAMINATION"
          ? previousTargetId ?? (linkedOriginalIds.size > 0 ? current.original_exam_assignment_id ?? null : null)
          : null,
    }));
    setPanel("");
  };
  const refreshTargetScopedWorkspace = useCallback(
    async (targetId: number | null) => {
      const reqId = ++targetScopeRequestRef.current;
      try {
        const workspace = await getRemediationWorkspace(interventionId, targetId);
        if (reqId !== targetScopeRequestRef.current) return;
        setFocus(workspace.focus);
        setResources(workspace.resources);
        setGenerationEligibility(workspace.generation_eligibility);
        latestEligibilityRef.current = workspace.generation_eligibility;
        if (workspace.recipient_scopes !== undefined) {
          setRecipientScopes(workspace.recipient_scopes ?? null);
        }
      } catch {
        // Keep current workspace state if a transient target-scope refresh fails.
      }
    },
    [interventionId],
  );
  const autoSelectedSingleTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      loading ||
      hasSavedAssessment ||
      !plan.grade_treatment ||
      plan.grade_treatment === "PRACTICE_ONLY" ||
      selectedActivityIds.length > 0 ||
      eligibleTreatmentActivities.length !== 1
    ) {
      return;
    }
    const soleActivity = eligibleTreatmentActivities[0];
    const soleId = canonicalAssignmentId(soleActivity, originalExams);
    if (soleId == null || linkedOriginalIds.has(soleId)) return;
    const autoKey = `${interventionId}:${plan.grade_treatment}:${soleId}`;
    if (autoSelectedSingleTargetRef.current === autoKey) return;
    autoSelectedSingleTargetRef.current = autoKey;

    const matchingExam = originalExams.find((e) => e.assignment_id === soleId);
    const examTargetId = matchingExam?.assignment_id ?? soleId;
    setSelectedActivityIds([soleId]);
    setPlan((current) => ({
      ...current,
      target_assignment_ids: reconcileTargetAssignmentIds(
        current.target_assignment_ids,
        linkedOriginalIds,
        soleId,
      ),
      original_exam_assignment_id:
        current.grade_treatment === "EXAMINATION" ? examTargetId : null,
    }));
    preModalSelectedIdsRef.current = [soleId];
    void refreshTargetScopedWorkspace(soleId);
  }, [
    loading,
    hasSavedAssessment,
    plan.grade_treatment,
    selectedActivityIds.length,
    eligibleTreatmentActivities,
    originalExams,
    linkedOriginalIds,
    interventionId,
    refreshTargetScopedWorkspace,
  ]);

  const confirmTargetSelection = () => {
    const candidateId =
      selectedActivityIds.find((id) => !linkedOriginalIds.has(id)) ??
      (actualOutcome?.recommended_target_assignment_id != null &&
        !linkedOriginalIds.has(actualOutcome.recommended_target_assignment_id)
        ? actualOutcome.recommended_target_assignment_id
        : null);
    const matchedActivity =
      candidateId != null
        ? eligibleTreatmentActivities.find(
          (item) => canonicalAssignmentId(item, originalExams) === candidateId
        ) ??
        treatmentActivities.find(
          (item) => canonicalAssignmentId(item, originalExams) === candidateId
        )
        : undefined;
    const confirmedId =
      matchedActivity != null
        ? canonicalAssignmentId(matchedActivity, originalExams)
        : candidateId;

    if (confirmedId != null && !linkedOriginalIds.has(confirmedId)) {
      const matchingExam = originalExams.find((e) => e.assignment_id === confirmedId);
      const examTargetId = matchingExam?.assignment_id ?? confirmedId;
      setSelectedActivityIds([confirmedId]);
      setPlan((current) => ({
        ...current,
        target_assignment_ids: reconcileTargetAssignmentIds(
          current.target_assignment_ids,
          linkedOriginalIds,
          confirmedId
        ),
        original_exam_assignment_id:
          current.grade_treatment === "EXAMINATION" ? examTargetId : null,
      }));
      resetDraftCreationState();
      setWizardError(null);
      preModalSelectedIdsRef.current = [confirmedId];
      void refreshTargetScopedWorkspace(confirmedId);
    }
    setPanel("");
  };
  const activeGradeTreatment: GradeTreatment | null =
    plan.grade_treatment ??
    (primaryAssignedAssessment?.is_graded === false
      ? "PRACTICE_ONLY"
      : (primaryAssignedAssessment?.component as GradeTreatment | null));
  const focusName = focus?.component
    ? componentLabel(focus.component)
    : "Component unavailable";

  const sourceName =
    focus?.exam_subtype
      ? focus.exam_subtype === "TERM_EXAM"
        ? "Quarterly examination"
        : label(focus.exam_subtype)
      : null;

  const strongestEvidenceText =
    focus?.evidence_level === "QUESTION_SCORE"
      ? "Scored question-level competency evidence"
      : focus?.evidence_level === "SCORED_COMPETENCY"
        ? "Scored whole-activity competency evidence"
        : focus?.evidence_level === "ACTIVITY_COVERAGE"
          ? "Assessment coverage only"
          : "Component-level evidence only";

  const scoredCompetencySummary =
    focus?.evidence_level === "QUESTION_SCORE" ||
      focus?.evidence_level === "SCORED_COMPETENCY"
      ? focus.competencies
        .map((item) => item.label.trim())
        .filter(Boolean)
        .join("; ")
      : "";

  const hasSupportingResources = selectedResources.length > 0;
  const hasRemediationActivity = assigned.length > 0;
  const hasConfiguredSupport = Boolean(hasSupportingResources && hasRemediationActivity);

  const action = async (run: () => Promise<void>) => {
    setWorking(true);
    try {
      await run();
    } catch (cause) {
      toast.error({
        title: "Unable to save changes",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setWorking(false);
    }
  };

  function planValues(
    value: RemediationPlan,
    targets: number[],
    cap: string,
    availableResources: RemediationResource[],
    scope: ResourceRecipientScope = "THIS_STUDENT",
  ) {
    const reconciled = reconcileSelectedResources(value.selected_resources, availableResources);
    return {
      teacher_choice: value.teacher_choice,
      grade_treatment: value.grade_treatment ?? null,
      selected_resources: unorderedValues(reconciled),
      resource_recipient_scope: reconciled.length > 0 ? scope : "THIS_STUDENT",
      original_exam_assignment_id: value.grade_treatment === "EXAMINATION" ? value.original_exam_assignment_id ?? targets[0] ?? null : null,
      targets: value.grade_treatment && value.grade_treatment !== "PRACTICE_ONLY" ? unorderedValues(targets) : [],
      cap: value.grade_treatment && value.grade_treatment !== "PRACTICE_ONLY" ? Number(cap) : null,
    };
  }
  const changes = useEditFormChanges({
    initialValues: savedPlanValues,
    values: planValues(plan, selectedActivityIds, capInput, resources, resourceRecipientScope),
    resetKey: interventionId,
  });
  useEffect(() => {
    onChangesChange?.(!loading && !workspaceError && changes.hasChanges);
  }, [loading, workspaceError, changes.hasChanges, onChangesChange]);
  const saveAdjustments = async (options?: SaveAdjustmentsOptions): Promise<boolean> => {
    const reconciledSelectedResources = reconcileSelectedResources(plan.selected_resources, resources);
    const shouldIncludeRecipientScope = reconciledSelectedResources.length > 0;
    if (options?.readingsOnly) {
      const persisted = persistedPlanRef.current;
      if (!persisted) return true;
      const persistedResources = reconcileSelectedResources(persisted.selected_resources, resources);
      const resourcesUnchanged =
        JSON.stringify(unorderedValues(reconciledSelectedResources)) ===
        JSON.stringify(unorderedValues(persistedResources));
      const scopeUnchanged =
        !shouldIncludeRecipientScope || resourceRecipientScope === "THIS_STUDENT";
      if (resourcesUnchanged && scopeUnchanged) return true;

      setWorking(true);
      try {
        const persistedTreatment = persisted.grade_treatment ?? (hasSavedAssessment ? activeGradeTreatment : null);
        const persistedTargets =
          persistedTreatment && persistedTreatment !== "PRACTICE_ONLY"
            ? persisted.target_assignment_ids ?? []
            : undefined;
        const result = await saveRemediationPlan(interventionId, {
          teacher_choice: persisted.teacher_choice,
          grade_treatment: persistedTreatment ?? null,
          selected_resources: reconciledSelectedResources,
          ...(shouldIncludeRecipientScope
            ? { resource_recipient_scope: resourceRecipientScope }
            : {}),
          ...(persistedTreatment === "EXAMINATION"
            ? {
              original_exam_assignment_id:
                persisted.original_exam_assignment_id ?? (persistedTargets?.[0] ?? null),
            }
            : {}),
          ...(persistedTargets !== undefined
            ? {
              target_assignment_ids: persistedTargets,
              score_adjustment_cap: persisted.score_adjustment_cap ?? 75,
            }
            : {}),
        });
        if (!result.plan.ai_suggestion) {
          advisoryAttemptedRef.current.delete(interventionId);
        }
        const savedTargets = result.plan.target_assignment_ids ?? persistedTargets ?? [];
        const savedUnlinked = savedTargets.filter((id) => !linkedOriginalIds.has(id));
        const activeUnlinked = savedUnlinked.at(-1) ?? null;
        const normalizedPersistedPlan: RemediationPlan = {
          ...result.plan,
          target_assignment_ids: reconcileTargetAssignmentIds(
            savedTargets,
            linkedOriginalIds,
            activeUnlinked
          ),
          original_exam_assignment_id:
            result.plan.grade_treatment === "EXAMINATION"
              ? result.plan.original_exam_assignment_id ?? (savedTargets[0] ?? null)
              : null,
        };
        persistedPlanRef.current = normalizedPersistedPlan;
        setPlan((current) => ({
          ...current,
          selected_resources: normalizedPersistedPlan.selected_resources,
          ai_suggestion: normalizedPersistedPlan.ai_suggestion,
        }));
        setResourceRecipientScope("THIS_STUDENT");
        setSavedPlanValues(planValues(
          normalizedPersistedPlan,
          activeUnlinked == null ? [] : [activeUnlinked],
          String(result.plan.score_adjustment_cap ?? persisted.score_adjustment_cap ?? 75),
          result.resources,
          "THIS_STUDENT",
        ));
        const updatedSavedReadings = (result.plan.selected_resources || [])
          .filter((r) => r.kind === "CLASSWORK")
          .map((r) => r.id);
        setSavedReadingIds(updatedSavedReadings);
        setFocus(result.focus);
        setGenerationEligibility(result.generation_eligibility);
        latestEligibilityRef.current = result.generation_eligibility;
        if (result.progress) setProgress(result.progress);
        if (result.prediction_impact !== undefined) {
          setPredictionImpact(result.prediction_impact ?? null);
        }
        setResources(result.resources);
        if (result.recipient_scopes !== undefined) {
          setRecipientScopes(result.recipient_scopes ?? null);
        }
        toast.success({ title: "Adjustments saved successfully." });
        return true;
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : "Unable to save adjustments.";
        toast.error({ title: "Unable to save adjustments", description: msg });
        return false;
      } finally {
        setWorking(false);
      }
    }

    // Generation and assignment also call this to persist prerequisites. An
    // unchanged prerequisite is already saved and needs no request or toast.
    if (options?.silentIfUnchanged) {
      if (!changes.hasChanges) return true;
    } else if (!changes.guardChanges()) {
      return true;
    }
    if (
      isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" &&
          !plan.original_exam_assignment_id &&
          selectedActivityIds.length === 0) ||
        (!hasSavedAssessment &&
          (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") &&
          selectedActivityIds.length !== 1))
    ) {
      const msg =
        plan.grade_treatment === "EXAMINATION"
          ? "Choose a grade treatment and original Examination before continuing."
          : "Choose a grade treatment and select one original classwork before continuing.";
      toast.error({ title: "Incomplete adjustment", description: msg });
      return false;
    }

    const treatmentToUse = plan.grade_treatment ?? (hasSavedAssessment ? activeGradeTreatment : null);
    let parsedCap: number | undefined = undefined;
    if (treatmentToUse && treatmentToUse !== "PRACTICE_ONLY") {
      const err = validateCap(capInput);
      if (err) {
        setCapError(err);
        toast.error({ title: "Invalid target-score ceiling", description: err });
        return false;
      }
      parsedCap = parseFloat(capInput);
    }

    setWorking(true);
    try {
      const nextTargetAssignmentIds =
        treatmentToUse && treatmentToUse !== "PRACTICE_ONLY"
          ? reconcileTargetAssignmentIds(
            plan.target_assignment_ids,
            linkedOriginalIds,
            selectedActivityIds[0] ?? null
          )
          : undefined;
      const result = await saveRemediationPlan(interventionId, {
        teacher_choice: plan.teacher_choice,
        grade_treatment: treatmentToUse ?? null,
        selected_resources: reconciledSelectedResources,
        ...(shouldIncludeRecipientScope
          ? { resource_recipient_scope: resourceRecipientScope }
          : {}),
        ...(treatmentToUse === "EXAMINATION"
          ? {
            original_exam_assignment_id:
              plan.original_exam_assignment_id ??
              (selectedActivityIds.length > 0 ? selectedActivityIds[0] : null),
          }
          : {}),
        ...(nextTargetAssignmentIds !== undefined
          ? {
            target_assignment_ids: nextTargetAssignmentIds,
            score_adjustment_cap:
              parsedCap !== undefined && Number.isFinite(parsedCap) ? parsedCap : 75,
          }
          : {}),
      });
      if (!result.plan.ai_suggestion) {
        advisoryAttemptedRef.current.delete(interventionId);
      }
      const savedTargets = result.plan.target_assignment_ids ?? nextTargetAssignmentIds ?? [];
      const savedUnlinked = savedTargets.filter((id) => !linkedOriginalIds.has(id));
      const activeUnlinked = savedUnlinked.at(-1) ?? null;
      const nextSelectedIds = activeUnlinked == null ? [] : [activeUnlinked];
      const normalizedSavedPlan: RemediationPlan = {
        ...result.plan,
        target_assignment_ids: reconcileTargetAssignmentIds(
          savedTargets,
          linkedOriginalIds,
          activeUnlinked
        ),
        original_exam_assignment_id:
          result.plan.grade_treatment === "EXAMINATION"
            ? result.plan.original_exam_assignment_id ?? (savedTargets[0] ?? null)
            : null,
      };
      persistedPlanRef.current = normalizedSavedPlan;
      setSelectedActivityIds(nextSelectedIds);
      setPlan(normalizedSavedPlan);
      setResourceRecipientScope("THIS_STUDENT");
      setSavedPlanValues(planValues(
        normalizedSavedPlan,
        nextSelectedIds,
        String(result.plan.score_adjustment_cap ?? capInput),
        result.resources,
        "THIS_STUDENT",
      ));
      const updatedSavedReadings = (result.plan.selected_resources || [])
        .filter((r) => r.kind === "CLASSWORK")
        .map((r) => r.id);
      setSavedReadingIds(updatedSavedReadings);
      setResources(result.resources);
      setFocus(result.focus);
      setGenerationEligibility(result.generation_eligibility);
      latestEligibilityRef.current = result.generation_eligibility;
      if (result.recipient_scopes !== undefined) {
        setRecipientScopes(result.recipient_scopes ?? null);
      }
      if (result.progress) setProgress(result.progress);
      if (result.prediction_impact !== undefined) {
        setPredictionImpact(result.prediction_impact ?? null);
      }
      if (result.plan.score_adjustment_cap !== undefined) {
        setCapInput(String(result.plan.score_adjustment_cap));
        setCapError(null);
      }
      fetchProjection(nextSelectedIds, true);
      toast.success({ title: "Adjustments saved successfully." });
      return true;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Unable to save adjustments.";
      toast.error({ title: "Unable to save adjustments", description: msg });
      return false;
    } finally {
      setWorking(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      saveAdjustments,
      validateStep: (step: number) => {
        const message = loading || working
          ? "Wait for the current operation to finish."
          : workspaceError
            ? "Retry loading the support workspace before continuing."
            : step === 3 && isGraded(plan.teacher_choice) && !plan.grade_treatment
              ? "Select a grade treatment."
              : step === 3 && isGraded(plan.teacher_choice) && !hasSavedAssessment &&
                (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") &&
                selectedActivityIds.length !== 1
                ? "Select exactly one original classwork for this remediation activity."
                : step === 3 && isGraded(plan.teacher_choice) && plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id
                  ? "Select the original exam."
                  : step === 3 && isGraded(plan.teacher_choice) && plan.grade_treatment !== "PRACTICE_ONLY"
                    ? validateCap(capInput)
                    : null;
        setWizardError(message);
        return message == null;
      },
    })
  );

  const handleGenerateWithAI = async () => {
    if (!plan.teacher_choice || (plan.teacher_choice !== "QUIZ" && plan.teacher_choice !== "CLASSWORK")) {
      return;
    }

    if (
      isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" &&
          !plan.original_exam_assignment_id &&
          selectedActivityIds.length === 0) ||
        (requiresCurrentTarget &&
          (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") &&
          selectedActivityIds.length !== 1))
    ) {
      toast.error({
        title: "Incomplete adjustment",
        description:
          plan.grade_treatment === "EXAMINATION"
            ? "Choose a grade treatment and original Examination before generating."
            : "Choose a grade treatment and at least one target classwork before generating.",
      });
      return;
    }

    const saved = await saveAdjustments({ silentIfUnchanged: true });
    if (!saved) return;

    const effectiveEligibility = latestEligibilityRef.current ?? generationEligibility;
    const eligibleLessonIds = eligibleRemediationLessonIds(effectiveEligibility);
    if (eligibleLessonIds.length === 0) {
      if (plan.teacher_choice === "QUIZ") {
        toast.error({
          title: "No eligible lessons for AI generation",
          description:
            "No lesson in this intervention is verified as taught at the active remediation evidence cutoff. Refresh the evidence after confirming lesson delivery, or continue with manual authoring.",
        });
        return;
      }
      setGeneratedDraft(null);
      setIsEditingDraft(false);
      setGenerationError("No lesson in this intervention is verified as taught at the active remediation evidence cutoff. Refresh the evidence after confirming lesson delivery, or continue with manual authoring.");
      setShowDraftPreview(true);
      return;
    }

    if (plan.teacher_choice === "QUIZ") {
      setIsRemediationQuizAiModalOpen(true);
      return;
    }

    setGeneratingDraft(true);
    setGenerationError(null);
    setGeneratedDraft(null);
    setIsEditingDraft(false);
    setDraftSaveState("idle");
    setDraftSaveError(null);
    setSavedAssessment(null);
    draftRequestIdRef.current = newRemediationRequestId();
    setShowDraftPreview(true);

    let targetComponent: "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION";
    if (plan.grade_treatment === "EXAMINATION") {
      targetComponent = "EXAMINATION";
    } else if (plan.grade_treatment === "PERFORMANCE_TASK") {
      targetComponent = "PERFORMANCE_TASK";
    } else if (plan.grade_treatment === "WRITTEN_WORK") {
      targetComponent = "WRITTEN_WORK";
    } else {
      targetComponent = (focus?.component ?? "PERFORMANCE_TASK") as "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION";
    }

    const selectedTargetForGeneration =
      plan.grade_treatment === "EXAMINATION"
        ? plan.original_exam_assignment_id ?? selectedActivityIds[0] ?? undefined
        : plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK"
          ? activeUnlinkedTargetId ?? selectedActivityIds[0] ?? undefined
          : undefined;

    const selectedExam =
      targetComponent === "EXAMINATION" && selectedTargetForGeneration != null
        ? originalExams.find((exam) => exam.assignment_id === selectedTargetForGeneration)
        : undefined;
    const examSubtype =
      targetComponent === "EXAMINATION"
        ? (selectedExam?.subtype ?? focus?.exam_subtype ?? "SUMMATIVE_1")
        : undefined;

    const readingIds = reconcileSelectedResources(plan.selected_resources, resources)
      .filter((r) => r.kind === "CLASSWORK")
      .map((r) => r.id);

    try {
      const draft = await generateRemediationDraft(interventionId, {
        draft_format: plan.teacher_choice,
        target_component: targetComponent,
        grade_treatment: plan.grade_treatment ?? "PRACTICE_ONLY",
        exam_subtype: examSubtype,
        target_assignment_id: selectedTargetForGeneration,
        item_count: 5,
        total_points: selectedTargetMaximum,
        activity_mode: "ONLINE",
        selected_lesson_ids: eligibleLessonIds,
        selected_reading_ids: readingIds.length ? readingIds : undefined,
      });
      setGeneratedDraft(draft);
    } catch (cause: unknown) {
      const status = cause instanceof InterventionApiError
        ? cause.status
        : typeof cause === "object" && cause !== null && "status" in cause
          ? Number((cause as { status?: unknown }).status)
          : undefined;
      let msg = cause instanceof Error ? cause.message : "AI remediation draft generation failed.";
      if (status === 429) {
        msg = "AI generation rate limit reached (Groq free tier). Please wait a moment before trying again.";
      } else if (status === 502) {
        msg = `AI generation service error: ${msg}`;
      } else if (status === 504 || status === 503) {
        msg = "AI provider timed out or is temporarily unavailable. Please retry shortly.";
      }
      setGenerationError(msg);
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleRefreshRemediationEvidence = async () => {
    setRefreshingEvidence(true);
    try {
      const refreshed = await refreshRemediationEvidence(interventionId);
      const currentTargetId =
        plan.grade_treatment === "EXAMINATION"
          ? plan.original_exam_assignment_id ?? selectedActivityIds[0] ?? null
          : activeUnlinkedTargetId ?? selectedActivityIds[0] ?? null;
      const workspace = await getRemediationWorkspace(interventionId, currentTargetId);
      setFocus(workspace.focus);
      setResources(workspace.resources);
      setGenerationEligibility(workspace.generation_eligibility);
      latestEligibilityRef.current = workspace.generation_eligibility;
      setProgress(workspace.progress);
      setPredictionImpact(workspace.prediction_impact ?? null);
      setGenerationError(null);
      toast.success({
        title: refreshed.created ? "Remediation evidence refreshed" : "Remediation evidence is already current",
        description: refreshed.created
          ? `${refreshed.newly_eligible_lesson_ids?.length ?? 0} lesson(s) became eligible for AI generation.`
          : undefined,
      });
    } catch (cause) {
      setGenerationError(cause instanceof Error ? cause.message : "Unable to refresh remediation evidence.");
    } finally {
      setRefreshingEvidence(false);
    }
  };

  const targetAssignmentSummary = useMemo(() => {
    if (plan.grade_treatment === "EXAMINATION") {
      const exam = originalExams.find(
        (e) =>
          e.assignment_id === plan.original_exam_assignment_id ||
          selectedActivityIds.includes(e.assignment_id)
      );
      return exam ? `${exam.title} (${exam.total_points} pts)` : "Original Examination";
    }
    if (selectedScorePreviews.length > 0) {
      return selectedScorePreviews
        .map((p) => `${p.title ?? "Classwork"} (${p.max_points} pts)`)
        .join(", ");
    }
    const acts = treatmentActivities.filter((a) => {
      const targetId = canonicalAssignmentId(a, originalExams);
      return targetId != null && selectedActivityIds.includes(targetId);
    });
    if (acts.length > 0) {
      return acts.map((a) => `${a.title} (${a.possible_score} pts)`).join(", ");
    }
    return "None selected";
  }, [
    plan.grade_treatment,
    plan.original_exam_assignment_id,
    originalExams,
    selectedScorePreviews,
    treatmentActivities,
    selectedActivityIds,
  ]);

  const draftValidation = useMemo(
    () => validateDraftCompleteness(generatedDraft),
    [generatedDraft]
  );

  const handleSaveAssessmentDraft = async () => {
    if (!generatedDraft || !draftValidation.isValid) {
      setDraftSaveState("error");
      setDraftSaveError(
        draftValidation.issues[0] ?? "Complete the required draft fields before saving."
      );
      return;
    }
    if (draftSaveState === "validating" || draftSaveState === "saving" || draftSaveState === "saved") {
      return;
    }

    const requestId = draftRequestIdRef.current ?? newRemediationRequestId();
    draftRequestIdRef.current = requestId;
    const targetIdForSave =
      plan.grade_treatment === "EXAMINATION"
        ? plan.original_exam_assignment_id ?? selectedActivityIds[0] ?? null
        : activeUnlinkedTargetId ?? selectedActivityIds[0] ?? null;
    setDraftSaveError(null);
    setDraftSaveState("validating");
    try {
      await preflightRemediationDraft(interventionId, targetIdForSave, generatedDraft);
      setDraftSaveState("saving");
      const saved = await createRemediationAssessment(
        interventionId,
        requestId,
        targetIdForSave,
        generatedDraft
      );
      if (saved.is_published !== false) {
        throw new Error("The assessment was not returned as an unpublished draft.");
      }
      setSavedAssessment(saved);
      setDraftSaveState("saved");
      setIsEditingDraft(false);
      toast.success({ title: "Assessment draft saved" });
      await load();
    } catch (cause) {
      setDraftSaveState("error");
      setDraftSaveError(
        cause instanceof Error ? cause.message : "Unable to save the assessment draft."
      );
    }
  };

  const handleUpdateQuizQuestion = (
    qIndex: number,
    updates: Partial<RemediationQuizQuestionDraft>
  ) => {
    if (generatedDraft?.draft_format !== "QUIZ") return;
    const newQuestions = [...generatedDraft.questions];
    newQuestions[qIndex] = { ...newQuestions[qIndex], ...updates };
    const newTotal = newQuestions.reduce(
      (sum, q) => sum + (Number(q.points) || 0),
      0
    );
    setGeneratedDraft({
      ...generatedDraft,
      questions: newQuestions,
      total_points: newTotal,
    });
  };

  const handleUpdateQuizOption = (
    qIndex: number,
    optIndex: number,
    option_text: string
  ) => {
    if (generatedDraft?.draft_format !== "QUIZ") return;
    const newQuestions = [...generatedDraft.questions];
    const newOptions = [...newQuestions[qIndex].options];
    newOptions[optIndex] = { ...newOptions[optIndex], option_text };
    newQuestions[qIndex] = { ...newQuestions[qIndex], options: newOptions };
    setGeneratedDraft({
      ...generatedDraft,
      questions: newQuestions,
    });
  };

  const handleUpdateQuizAnswerKey = (
    qIndex: number,
    updates: Partial<RemediationTeacherAnswerKey>
  ) => {
    if (generatedDraft?.draft_format !== "QUIZ") return;
    const newQuestions = [...generatedDraft.questions];
    newQuestions[qIndex] = {
      ...newQuestions[qIndex],
      teacher_answer_key: {
        ...newQuestions[qIndex].teacher_answer_key,
        ...updates,
      },
    };
    setGeneratedDraft({
      ...generatedDraft,
      questions: newQuestions,
    });
  };

  const handleUpdateClassworkTask = (
    tIndex: number,
    updates: Partial<RemediationTaskDraft>
  ) => {
    if (generatedDraft?.draft_format !== "CLASSWORK") return;
    const newTasks = [...generatedDraft.tasks];
    newTasks[tIndex] = { ...newTasks[tIndex], ...updates };
    setGeneratedDraft({
      ...generatedDraft,
      tasks: newTasks,
    });
  };

  const handleUpdateClassworkDeliverable = (
    dIndex: number,
    updates: Partial<RemediationDeliverableDraft>
  ) => {
    if (generatedDraft?.draft_format !== "CLASSWORK") return;
    const newDeliverables = [...generatedDraft.deliverables];
    newDeliverables[dIndex] = { ...newDeliverables[dIndex], ...updates };
    setGeneratedDraft({
      ...generatedDraft,
      deliverables: newDeliverables,
    });
  };

  const selectedTargetHasInheritedRubric = useMemo(() => {
    if (
      plan.grade_treatment !== "WRITTEN_WORK" &&
      plan.grade_treatment !== "PERFORMANCE_TASK"
    ) {
      return false;
    }
    const activeTargetId = activeUnlinkedTargetId ?? selectedActivityIds[0] ?? null;
    if (activeTargetId == null) return false;
    const preview = scorePreviews.find((p) => p.assignment_id === activeTargetId);
    return Boolean(preview?.rubric_levels && preview.rubric_levels.length > 0);
  }, [activeUnlinkedTargetId, plan.grade_treatment, scorePreviews, selectedActivityIds]);

  const handleUpdateClassworkRubricLevel = (
    rIndex: number,
    updates: Partial<RemediationRubricLevelDraft>
  ) => {
    if (selectedTargetHasInheritedRubric) return;
    if (generatedDraft?.draft_format !== "CLASSWORK") return;
    const newLevels = [...generatedDraft.rubric_levels];
    newLevels[rIndex] = { ...newLevels[rIndex], ...updates };
    const maxRubric = newLevels.reduce(
      (max, r) => Math.max(max, Number(r.points) || 0),
      0
    );
    setGeneratedDraft({
      ...generatedDraft,
      rubric_levels: newLevels,
      total_points: maxRubric > 0 ? maxRubric : generatedDraft.total_points,
    });
  };

  const handleUpdateClassworkTeacherGuide = (
    updates: Partial<RemediationTeacherClassworkGuide>
  ) => {
    if (generatedDraft?.draft_format !== "CLASSWORK") return;
    setGeneratedDraft({
      ...generatedDraft,
      teacher_guide: {
        ...generatedDraft.teacher_guide,
        ...updates,
      },
    });
  };

  const activeTargetAssignmentId = useMemo(() => {
    if (plan.grade_treatment === "EXAMINATION") {
      return plan.original_exam_assignment_id ?? selectedActivityIds[0] ?? null;
    }
    if (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") {
      return activeUnlinkedTargetId ?? selectedActivityIds[0] ?? null;
    }
    return null;
  }, [activeUnlinkedTargetId, plan.grade_treatment, plan.original_exam_assignment_id, selectedActivityIds]);

  const selectedTargetSupportingActivity = useMemo(() => {
    if (activeTargetAssignmentId == null) return null;
    return (
      (detail.diagnosis_snapshot.supporting_activities ?? []).find(
        (a) =>
          (a.classwork_assignment_id != null
            ? a.classwork_assignment_id === activeTargetAssignmentId
            : a.classwork_id === activeTargetAssignmentId) ||
          a.classwork_id === activeTargetAssignmentId
      ) ?? null
    );
  }, [activeTargetAssignmentId, detail.diagnosis_snapshot.supporting_activities]);

  const openTool = async (
    modeOrEvent?: "manual" | "reuse" | "ai" | unknown,
    aiDraft?: RemediationQuizDraft,
  ) => {
    const quizMode =
      modeOrEvent === "manual" || modeOrEvent === "reuse" || modeOrEvent === "ai"
        ? modeOrEvent
        : undefined;
    if (!plan.teacher_choice || plan.teacher_choice === "EXISTING_MATERIAL_ONLY") return;
    if (
      isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id) ||
        (requiresCurrentTarget &&
          (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") &&
          selectedActivityIds.length !== 1))
    ) {
      toast.error({
        title: "Incomplete adjustment",
        description:
          plan.grade_treatment === "EXAMINATION"
            ? "Choose a grade treatment and original Examination before continuing."
            : "Choose a grade treatment and at least one target classwork before continuing.",
      });
      return;
    }
    if (quizMode === "reuse" && (!plan.grade_treatment || plan.grade_treatment === "PRACTICE_ONLY" || activeTargetAssignmentId == null)) {
      toast.error({
        title: "No original target quiz selected",
        description: "Choose a graded original target quiz before reusing quiz questions.",
      });
      return;
    }
    const saved = await saveAdjustments({ silentIfUnchanged: true });
    if (!saved) return;
    const params = new URLSearchParams({
      remediation: plan.teacher_choice,
      subject_id: String(subjectId),
      intervention_id: String(interventionId),
    });
    if (plan.teacher_choice === "QUIZ" && (quizMode === "reuse" || quizMode === "ai")) {
      params.set("quiz_mode", quizMode);
    }
    if (plan.grade_treatment === "EXAMINATION" && plan.original_exam_assignment_id) {
      params.set(
        "original_exam_assignment_id",
        String(plan.original_exam_assignment_id)
      );
    } else if (
      (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") &&
      (activeUnlinkedTargetId ?? selectedActivityIds[0]) != null
    ) {
      const initialTarget = activeUnlinkedTargetId ?? selectedActivityIds[0];
      params.set("original_classwork_assignment_id", String(initialTarget));
    }
    if (quizMode === "reuse" && selectedTargetSupportingActivity?.classwork_id != null) {
      params.set(
        "original_classwork_id",
        String(selectedTargetSupportingActivity.classwork_id)
      );
    }
    params.set(
      "title",
      aiDraft?.title?.trim()
        ? aiDraft.title.trim()
        : plan.teacher_choice === "TOS"
          ? `${subjectName} remediation blueprint`
          : plan.teacher_choice === "QUIZ"
            ? `${subjectName} focused practice`
            : `${subjectName} remediation task`
    );
    if (isGraded(plan.teacher_choice)) {
      params.set(
        "instructions",
        aiDraft?.instructions?.trim()
          ? aiDraft.instructions.trim()
          : plan.teacher_choice === "QUIZ"
            ? "Please review the referenced study materials and complete this practice quiz to reinforce your understanding and recover points."
            : "Please review the referenced reading materials and complete the tasks described in this activity to demonstrate your understanding."
      );
    }
    navigate(
      `${plan.teacher_choice === "TOS" ? "/teacher/tos" : "/teacher/classworks"}?${params.toString()}`,
      aiDraft ? { state: { aiRemediationDraft: aiDraft } } : undefined,
    );
  };

  const createReviewer = () =>
    void action(async () => {
      const made = await createSupportMaterial(interventionId, "STUDENT_REVIEWER");
      setMaterials((items) => [...items, made]);
      setReviewerDraft(made.current_content as ReviewerDraft);
      setNotice("Reviewer draft created.");
    });

  const generateReviewer = (materialId: SupportMaterial["material_id"]) =>
    void action(async () => {
      const made = await generateStudentReviewer(interventionId, materialId);
      setMaterials((items) =>
        items.map((item) => (item.material_id === made.material_id ? made : item))
      );
      setReviewerDraft(made.current_content as ReviewerDraft);
      setNotice("Reviewer generated.");
    });

  const saveReviewer = (
    materialId: SupportMaterial["material_id"],
    draft: ReviewerDraft
  ) =>
    void action(async () => {
      const saved = await saveSupportMaterial(interventionId, materialId, draft);
      setMaterials((items) =>
        items.map((item) => (item.material_id === saved.material_id ? saved : item))
      );
      setNotice("Reviewer draft saved.");
    });

  const sendReviewer = (materialId: SupportMaterial["material_id"]) =>
    void action(async () => {
      const sent = await sendStudentReviewer(interventionId, materialId);
      setMaterials((items) =>
        items.map((item) => (item.material_id === sent.material_id ? sent : item))
      );
      setNotice("Reviewer sent to this student.");
    });

  const toggleResource = (item: RemediationResource) => {
    setPlan((current) => {
      const hasResource = current.selected_resources.some(
        (ref) => ref.kind === item.kind && ref.id === item.id
      );
      const next = hasResource
        ? current.selected_resources.filter(
          (ref) => !(ref.kind === item.kind && ref.id === item.id)
        )
        : [...current.selected_resources, { kind: item.kind, id: item.id }];
      return { ...current, selected_resources: next };
    });
  };

  const continueDisabled =
    working ||
    (isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" &&
          !plan.original_exam_assignment_id &&
          selectedActivityIds.length === 0) ||
        (requiresCurrentTarget &&
          (plan.grade_treatment === "WRITTEN_WORK" || plan.grade_treatment === "PERFORMANCE_TASK") &&
          selectedActivityIds.length !== 1)));

  const reuseQuizDisabled =
    continueDisabled ||
    working ||
    generatingDraft ||
    !plan.grade_treatment ||
    plan.grade_treatment === "PRACTICE_ONLY" ||
    activeTargetAssignmentId == null ||
    (selectedTargetSupportingActivity?.classwork_type != null &&
      selectedTargetSupportingActivity.classwork_type.toUpperCase() !== "QUIZ");


  const resourceOption = (item: RemediationResource) => {
    const checked = selected.has(`${item.kind}:${item.id}`);
    const scopeLabel = formatResourceScopeBadgeLabel(item.current_recipient_scope);
    return (
      <ClassworkItemLine
        key={`${item.kind}:${item.id}`}
        size="sm"
        className={`w-full rounded! border-2! shadow-none! ${checked ? "bg-primary!" : ""}`}
        item={{ classwork_id: item.id, title: item.title, classwork_type: item.classwork_type ?? item.kind }}
        showPublicationStatus={false}
        showCategory={false}
        showType={false}
        onClick={() => !working && toggleResource(item)}
        rightContent={
          <div className="flex flex-wrap items-center gap-2">
            {item.added_by_teacher ? (
              <Badge variant="surface" size="sm">Added by teacher</Badge>
            ) : item.recommended ? (
              <Badge variant="solid" size="sm">Recommended</Badge>
            ) : null}
            {scopeLabel && <Badge variant="surface" size="sm">{scopeLabel}</Badge>}
            <Badge variant="outline" size="sm">{formatToTitleCase(item.classwork_type ?? item.kind)}</Badge>
            <Checkbox
              checked={checked}
              disabled={working}
              variant="solid"
              aria-label={`Select ${item.title}`}
              className={`border-black ${checked ? "bg-black text-white" : "bg-white text-black"}`}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => toggleResource(item)}
            />
          </div>
        }
      />
    );
  };
  const inlineResourcePicker = (
    <Card className="flex w-full flex-col gap-4 rounded! shadow-none!">
      <InterventionResourceRecipientSelector
        value={resourceRecipientScope}
        onChange={setResourceRecipientScope}
        scopes={recipientScopes}
        fallbackStudentName={detail.student_name}
        fallbackClassName={detail.class_name}
        fallbackSubjectName={subjectName}
        disabled={working}
        selectedCount={selectedResources.length}
      />
      <Field label="Lesson">
        <Select value={lessonFilter} onValueChange={setLessonFilter}>
          <Select.Trigger className="w-full"><Select.Value placeholder="All Lessons" /></Select.Trigger>
          <Select.Content>
            <Select.Item value="ALL">All Lessons</Select.Item>
            {lessonOptions.map((lesson) => (
              <Select.Item key={lesson} value={lesson}>{lesson === NO_LESSON ? "No linked lesson" : lesson}</Select.Item>
            ))}
          </Select.Content>
        </Select>
      </Field>
      {visibleRecommended.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-semibold">Recommended Materials</h4>
          <p className="text-sm text-muted-foreground">Suggested from the student's performance and diagnostic evidence.</p>
          {visibleRecommended.map(resourceOption)}
        </div>
      )}
      <Accordion defaultValue={["other-resources"]} className="w-full">
        <Accordion.Item value="other-resources" className="overflow-hidden rounded! border-2 border-border">
          <Accordion.Header className="px-4 py-3 font-semibold">Browse Other Resources</Accordion.Header>
          <Accordion.Content className="flex flex-col gap-3 p-4">
            <Input aria-label="Search other resources" placeholder="Search readings..." value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} />
            {visibleRemaining.filter((item) => item.title.toLowerCase().includes(resourceSearch.trim().toLowerCase())).map(resourceOption)}
            {!visibleRemaining.some((item) => item.title.toLowerCase().includes(resourceSearch.trim().toLowerCase())) && (
              <TeacherEmptyState compact className="shadow-none!" icon={<BookOpen />} title="No matching readings" description="Try another lesson or search term." />
            )}
          </Accordion.Content>
        </Accordion.Item>
      </Accordion>
      {visible.length === 0 && (
        <TeacherEmptyState compact className="shadow-none!" icon={<BookOpen />} title="No supporting readings available" description="Readings added for this teaching scope will appear here." />
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setIsCreatingReading(true)}><Plus />Add Additional Resources</Button>
      </div>
    </Card>
  );

  return (
    <section className="flex flex-col gap-3" aria-label="Intervention workflow">
      {wizardError && <FormMessage aria-live="assertive">{wizardError}</FormMessage>}
      <NoChangesMessage message={changes.noChangesMessage} />
      <div className="flex flex-col gap-2">
        <Card className="w-full space-y-2 border-2 p-3 border-black bg-primary">
          <div className="flex items-start gap-4">
            <div className="flex flex-col mt-3 items-center h-full">
              <Avatar variant="student" className="size-14  shrink-0">
                <Avatar.Image
                  src="/avatars/student-avatars/1.svg"
                  alt={detail.student_name}
                />
                <Avatar.Fallback>
                  {(detail.student_name || "?").charAt(0).toUpperCase()}
                </Avatar.Fallback>
              </Avatar>
            </div>

            <div className="flex flex-col gap-1 w-full">
              <div className="flex flex-row justify-between w-full items-end">
                <h2 className="text-xl font-black -mb-1">{detail.student_name}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="solid" size="sm">
                    Active
                  </Badge>
                  <Badge variant="outline" size="sm">
                    {phase}
                  </Badge>
                </div>
              </div>

              <div className="mt- grid grid-cols-2 gap-1 text-sm">
                <p className="text-sm">
                  Subject: <span className="text-base font-semibold">{subjectName}</span>
                </p>
                <p className="text-sm">
                  Class: <span className="text-base font-semibold">{detail.class_name}</span>
                </p>
                <div className="col-span-2 mt-1">
                  Current Prediction: <InterventionPredictionHistory item={detail} />
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {navigation}

      {previousResolved && (
        <Card className="space-y-2 w-full border-2 border-border">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base">Current support cycle</h3>
            <Badge variant="surface" size="sm">Active</Badge>
          </div>
          <p className="text-sm">
            A new below-threshold prediction opened this cycle after
            the previous Intervention resolved on{" "}
            <strong>
              {previousResolved.resolved_at
                ? date(previousResolved.resolved_at)
                : "a previous date"}
            </strong>
            . That resolution is past history.
          </p>
        </Card>
      )}

      {loading ? (
        <p>Loading Intervention workflow...</p>
      ) : workspaceError ? (
        <Alert status="error">
          <Alert.Title>Unable to load support workspace</Alert.Title>
          <Alert.Description className="flex flex-col items-start gap-3">
            <span>{workspaceError}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
            >
              <RefreshCw className="size-3.5 mr-1.5" />
              Retry
            </Button>
          </Alert.Description>
        </Alert>
      ) : (
        <>

          {wizardStep == null && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="font-black">Academic Diagnosis</h3>
                <Card className="flex flex-col gap-2 w-full">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <p className="text-base">
                      Support focus: <strong>{focusName}</strong>
                      {sourceName && (
                        <span className="text-sm text-muted-foreground ml-1">
                          ({sourceName})
                        </span>
                      )}
                    </p>
                    <p className="text-base">
                      Strongest available evidence:{" "}
                      <strong>{strongestEvidenceText}</strong>
                    </p>
                  </div>

                  {scoredCompetencySummary && (
                    <p className="text-base">
                      Scored competency focus: {scoredCompetencySummary}
                    </p>
                  )}
                </Card>
                {focus?.evidence_level === "COMPONENT_ONLY" && (
                  <p className="text-sm text-muted-foreground px-1">
                    No specific lesson or competency weakness can be identified from the
                    available scored evidence.
                  </p>
                )}
              </div>

              {/* Prepared Support Plan */}
              <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-2">
                  <h4 className="font-bold text-lg">Prepared Support Plan</h4>
                  <div className="flex items-center">
                    {hasConfiguredSupport ? (
                      <Badge variant="solid" size="sm">Configured</Badge>
                    ) : hasSupportingResources || hasRemediationActivity ? (
                      <Badge variant="surface" size="sm">Partially Configured</Badge>
                    ) : (
                      <Badge variant="outline" size="sm">Needs Setup</Badge>
                    )}
                  </div>
                </div>

                <Card className="flex flex-col gap-2">
                  <Card className="w-full p-1 flex flex-col gap-3">
                    {assigned.length > 0 ? (
                      <div className="space-y-3 text-sm text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
                        {assigned.map((item, idx) => {
                          const methodLabel = item.classwork_type
                            ? item.classwork_type === "QUIZ"
                              ? "Quiz"
                              : item.classwork_type === "ASSIGNMENT"
                                ? "Assignment"
                                : label(item.classwork_type)
                            : methods.find((m) => m.value === plan.teacher_choice)?.label ?? "Classwork";

                          const treatmentLabel = item.is_graded
                            ? item.component
                              ? `${componentLabel(item.component)}`
                              : "Graded"
                            : "Practice only · No official grade impact";

                          const classworkId = item.classwork_id ?? item.assignment_id;

                          return (
                            <div key={item.assignment_id ?? idx} className="flex flex-col gap-2">
                              <ClassworkItemLine
                                className="border-2! shadow-none! cursor-pointer transition-colors"
                                size="sm"
                                item={{
                                  classwork_id: classworkId,
                                  title: item.title,
                                  classwork_type: item.classwork_type ?? (plan.teacher_choice === "QUIZ" ? "QUIZ" : "ASSIGNMENT"),
                                }}
                                showPublicationStatus={false}
                                showCategory={false}
                                showType={false}
                                onClick={() => {
                                  if (classworkId) {
                                    void handleOpenEditClasswork(classworkId);
                                  }
                                }}
                                rightContent={
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant="solid" size="sm">
                                      {methodLabel}
                                    </Badge>
                                    <Badge variant="outline" size="sm">
                                      {treatmentLabel}
                                    </Badge>
                                  </div>
                                }
                              />
                            </div>
                          );
                        })}

                        <h4 className="font-normal text-foreground text-base flex gap-2 items-center w-full justify-between">
                          Official Academic Outcome
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" size="sm">{phase}</Badge>
                          </div>
                        </h4>

                        <Card className="-mt-1.5 border-2! w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-3 text-sm bg-primary border-2 border-border">
                          {assigned
                            .filter((item) => item.original_assignment_id)
                            .map((item) => {
                              const targetImpact = predictionImpact?.targets.find(
                                (t) => t.assignment_id === item.original_assignment_id
                              );
                              const targetPreview = scorePreviews.find(
                                (p) => p.assignment_id === item.original_assignment_id
                              );
                              const ceilingPct =
                                targetImpact?.cap_percentage ??
                                targetPreview?.cap_percentage ??
                                (item.exam_subtype ? 100 : (plan.score_adjustment_cap ?? 75));
                              const effectiveMax =
                                targetImpact?.effective_max_score ??
                                targetPreview?.max_adjusted_score ??
                                null;
                              const maxPts =
                                targetImpact?.max_points ??
                                targetPreview?.max_points ??
                                item.total_points ??
                                null;
                              return (
                                <Fragment key={item.assignment_id}>
                                  <div className="text-foreground">
                                    <span>
                                      Remedial:{" "}
                                      <strong>{remediationScoreStatusText(item)}</strong>
                                    </span>
                                  </div>
                                  <div className="text-foreground">
                                    <span>
                                      Effective:{" "}
                                      <strong>
                                        {item.effective_grade != null
                                          ? `${formatScoreValue(item.effective_grade)} / ${maxPts != null ? formatScoreValue(maxPts) : "—"}`
                                          : "—"}
                                      </strong>
                                    </span>
                                  </div>
                                  <div className="text-foreground">
                                    <span>
                                      Target Ceiling:{" "}
                                      <strong>
                                        {ceilingPct}%
                                        {effectiveMax != null && maxPts != null
                                          ? ` (${formatScoreValue(effectiveMax)}/${formatScoreValue(maxPts)} max)`
                                          : ""}
                                      </strong>
                                    </span>
                                  </div>
                                </Fragment>
                              );
                            })}
                          <p className="text-foreground">
                            Current AI-predicted grade:{" "}
                            <strong>{formatPredictedValue(displayedCurrentPrediction)}</strong>
                          </p>
                          <p className="text-foreground">
                            AI-predicted grade at max score:{" "}
                            <strong>
                              {formatPredictedValue(displayedMaxScorePrediction)}
                              {displayedPredictionDelta != null && (
                                <span className="ml-1 text-xs font-semibold">
                                  ({displayedPredictionDelta >= 0 ? "+" : ""}
                                  {displayedPredictionDelta.toFixed(2)})
                                </span>
                              )}
                            </strong>
                          </p>

                        </Card>
                        <p className="text-sm text-muted-foreground col-span-full px-1 -mt-1">
                          {outcomeStatusMessage}
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <p className="text-sm text-muted-foreground px-1">
                          No support method has been chosen yet. Click Add Intervention Activity below to plan one.
                        </p>
                        <TeacherEmptyState
                          compact
                          className="w-full border-2 rounded! border-border bg-background shadow-none hover:shadow-none"
                          icon={<Activity />}
                          title="No intervention activity yet"
                          description="Choose how remediation will be delivered and configure its grade treatment."
                          action={onAddInterventionActivity ? {
                            label: "Add Intervention Activity",
                            onClick: onAddInterventionActivity,
                            icon: <Plus className="size-3.5 mr-1.5" />,
                          } : undefined}
                        />
                      </div>
                    )}
                  </Card>

                  <div className="flex flex-col text-base gap-2">
                    <span>Supporting Resources:</span>
                    {selectedResources.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {selectedResources.map((item) => (
                          <ClassworkItemLine
                            size="sm"
                            className="border-2! shadow-none!"
                            key={`${item.kind}:${item.id}`}
                            item={{
                              classwork_id: item.id,
                              title: item.title,
                              classwork_type: item.classwork_type ?? item.kind,
                            }}
                            showPublicationStatus={false}
                            showCategory={false}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground px-1">No optional supporting resources selected.</p>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          )}

          {wizardStep != null && (
            <div className="flex flex-col w-full gap-3">
              <div className={wizardStep != null && wizardStep !== 1 ? "hidden" : "flex flex-col gap-1"}>
                {wizardStep == null && <h3 className="font-black">Supporting Resources</h3>}
                {wizardStep === 1 ? inlineResourcePicker : (
                  <Card className="w-full space-y-2.5">
                    {/* <p>
                  <strong>Student Reviewer</strong> · Optional study support ·{" "}
                  {reviewer?.status === "SENT"
                    ? "Sent to student"
                    : reviewer
                      ? "Private draft"
                      : "Not prepared"}
                </p>
                <p className="text-xs text-gray-600">
                  Grounded from: {focusName} component evidence. Specific competency
                  evidence: {focus?.competency_ids.length ? "Available" : "Unavailable"}.
                  The reviewer is not a grade or proof of improvement.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPanel("reviewer")}
                >
                  Open reviewer
                </Button> */}

                    <div className="flex flex-col gap-1">
                      <p className="text-base font-semibold">Supporting Readings</p>
                      {selectedResources.length ? (
                        <>
                          <div className="flex flex-col gap-2">
                            {selectedResources.map((item) => (
                              <ClassworkItemLine
                                key={`supporting:${item.kind}:${item.id}`}
                                className="border-2! shadow-none!"
                                size="sm"
                                item={{
                                  classwork_id: item.id,
                                  title: item.title,
                                  classwork_type: item.classwork_type ?? item.kind,
                                }}
                                showPublicationStatus={false}
                                showCategory={false}
                                rightContent={
                                  <div className="flex items-center gap-1.5">
                                    {item.added_by_teacher ? (
                                      <Badge variant="surface" size="sm">
                                        Added by teacher
                                      </Badge>
                                    ) : item.recommended ? (
                                      <Badge variant="solid" size="sm">
                                        Recommended
                                      </Badge>
                                    ) : null}
                                  </div>
                                }
                              />
                            ))}
                          </div>
                          <p className="text-sm text-muted-foreground px-1">
                            {linkedReadingLessons.length > 0
                              ? `Readings are linked to ${linkedReadingLessons.join(", ")} lesson/s`
                              : "Readings are not linked to any lesson/s"}
                          </p>
                        </>
                      ) : (
                        <TeacherEmptyState
                          compact
                          icon={<BookOpen />}
                          title={materialPool.length > 0 ? "No supporting readings selected" : "No supporting readings"}
                          description={
                            materialPool.length > 0
                              ? "Click Select resources below to add readings for student review."
                              : "No eligible Reading is available in this teaching scope."
                          }
                        />
                      )}
                    </div>

                    <div className="flex w-full justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => setPanel("materials")}
                      >
                        Select resources
                      </Button>
                    </div>
                  </Card>
                )}
              </div>
              <Dialog
                open={panel === "reviewer"}
                onOpenChange={(open) => setPanel(open ? "reviewer" : "")}
              >
                <Dialog.Content size="md" className="max-h-[85vh]">
                  <Dialog.Header>
                    <div className="flex items-center gap-2">
                      <Dialog.Title className="text-lg font-bold">
                        Student Reviewer
                      </Dialog.Title>
                      {reviewer && (
                        <Badge
                          variant={reviewer.status === "SENT" ? "success" : "secondary"}
                          size="sm"
                        >
                          {reviewer.status === "SENT" ? "Sent" : "Draft"}
                        </Badge>
                      )}
                    </div>
                  </Dialog.Header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    {!reviewer && (
                      <p className="text-sm text-muted-foreground">
                        No reviewer draft has been created yet.
                      </p>
                    )}
                    {reviewer && reviewerDraft && (
                      <>
                        {reviewer.status === "SENT" ? (
                          <div className="space-y-2">
                            <strong className="text-base font-bold">{reviewerDraft.title}</strong>
                            <p className="text-sm">{reviewerDraft.introduction}</p>
                            <div className="rounded border-2 border-border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap">
                              {reviewerDraft.body}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-sm font-bold">Title</Label>
                              <Input
                                className="w-full"
                                value={reviewerDraft.title}
                                onChange={(event) =>
                                  setReviewerDraft({
                                    ...reviewerDraft,
                                    title: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-sm font-bold">Introduction</Label>
                              <textarea
                                className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none"
                                value={reviewerDraft.introduction}
                                onChange={(event) =>
                                  setReviewerDraft({
                                    ...reviewerDraft,
                                    introduction: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-sm font-bold">Review content</Label>
                              <textarea
                                rows={7}
                                className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none"
                                value={reviewerDraft.body}
                                onChange={(event) =>
                                  setReviewerDraft({
                                    ...reviewerDraft,
                                    body: event.target.value,
                                  })
                                }
                              />
                              <p className="text-xs text-muted-foreground">
                                Optional study support. The reviewer is not a grade or proof of
                                improvement.
                              </p>
                            </div>
                          </div>
                        )}

                        {reviewer.status === "DRAFT" && !reviewer.generated_content && (
                          <div className="flex justify-end w-full pt-2">
                            <Button
                              size="sm"
                              disabled={working}
                              variant="outline"
                              autoIcon={false}
                              onClick={() => generateReviewer(reviewer.material_id)}
                            >
                              Generate Reviewer
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button variant="outline" onClick={() => setPanel("")}>
                      Close
                    </Button>
                    {!reviewer && (
                      <Button disabled={working} onClick={createReviewer}>
                        Create reviewer draft
                      </Button>
                    )}
                    {reviewer && reviewerDraft && reviewer.status !== "SENT" && (
                      <>
                        <Button
                          variant="outline"
                          disabled={working}
                          onClick={() =>
                            saveReviewer(reviewer.material_id, reviewerDraft)
                          }
                        >
                          Save draft
                        </Button>
                        <Button
                          disabled={
                            working ||
                            JSON.stringify(reviewerDraft) !==
                            JSON.stringify(reviewer.current_content) ||
                            !reviewerDraft.title.trim() ||
                            !reviewerDraft.introduction.trim() ||
                            !reviewerDraft.body.trim()
                          }
                          onClick={() => sendReviewer(reviewer.material_id)}
                        >
                          Approve &amp; Send
                        </Button>
                      </>
                    )}
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>

              <Dialog
                open={panel === "materials"}
                onOpenChange={(open) => setPanel(open ? "materials" : "")}
              >
                <Dialog.Content size="xl" className="max-h-[85vh]">
                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-bold">
                      Add Supporting Resources
                    </Dialog.Title>
                  </Dialog.Header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-4 pr-3">
                    <InterventionResourceRecipientSelector
                      value={resourceRecipientScope}
                      onChange={setResourceRecipientScope}
                      scopes={recipientScopes}
                      fallbackStudentName={detail.student_name}
                      fallbackClassName={detail.class_name}
                      fallbackSubjectName={subjectName}
                      disabled={working}
                      selectedCount={selectedResources.length}
                    />
                    <Field label="">
                      <Select value={lessonFilter} onValueChange={(val) => setLessonFilter(val)}>
                        <Select.Trigger className="w-full h-10">
                          <Select.Value placeholder="Filter by linked lesson" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="ALL">All Lessons</Select.Item>
                          {lessonOptions.map((lesson) => (
                            <Select.Item key={lesson} value={lesson}>
                              {lesson === NO_LESSON ? "No linked lesson" : lesson}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Field>
                    {visible.length ? (
                      <div className="flex flex-col gap-4">
                        {visibleRecommended.length > 0 && (
                          <div className="flex flex-col gap-2 mb-2">
                            <p className="text-base font-semibold">Recommended Materials</p>
                            {visibleRecommended.map((item) => {
                              const isChecked = selected.has(`${item.kind}:${item.id}`);
                              return (
                                <ClassworkItemLine
                                  key={`rec-item:${item.kind}:${item.id}`}
                                  size="sm"
                                  className={`border-2! shadow-none! ${isChecked ? "bg-primary!" : ""}`}
                                  item={{
                                    classwork_id: item.id,
                                    title: item.title,
                                    classwork_type: item.classwork_type ?? item.kind,
                                  }}
                                  showPublicationStatus={false}
                                  showCategory={false}
                                  showType={false}
                                  onClick={() => !working && toggleResource(item)}
                                  rightContent={
                                    <div className="flex items-center gap-2">
                                      <Badge variant="solid" size="sm">
                                        Recommended
                                      </Badge>
                                      <Badge variant={isChecked ? "solid" : "surface"} size="sm">
                                        {formatToTitleCase(item.classwork_type ?? item.kind)}
                                      </Badge>
                                      <Checkbox
                                        checked={isChecked}
                                        disabled={working}
                                        variant="solid"
                                        className={`border-black transition-colors ${isChecked ? "bg-black text-white" : "bg-white text-black"}`}
                                        onClick={(e) => e.stopPropagation()}
                                        onCheckedChange={() => toggleResource(item)}
                                      />
                                    </div>
                                  }
                                />
                              );
                            })}

                            <div className="w-full flex flex-row justify-between gap-8 mt-1">
                              <p className="text-sm text-muted-foreground -mt-1.5">
                                Suggested materials based on student performance data and diagnostic evidence.
                              </p>
                              <Button
                                className="justify-end whitespace-nowrap h-fit w-fit"
                                variant="default"
                                size="sm"
                                onClick={() => setIsCreatingReading(true)}
                              >
                                Add Additional Resources
                              </Button>
                            </div>
                          </div>
                        )}


                        {visibleRecommended.length === 0 && (
                          <div className="flex justify-end mb-2">
                            <Button
                              className="justify-end whitespace-nowrap h-fit w-fit"
                              variant="default"
                              size="sm"
                              onClick={() => setIsCreatingReading(true)}
                            >
                              Add Additional Resources
                            </Button>
                          </div>
                        )}

                        {groupedRemaining.map(([lesson, items]) => (
                          <div key={lesson} className="flex flex-col gap-2">
                            <p className="text-sm font-bold">
                              {lesson === NO_LESSON ? "No linked lesson" : lesson}
                            </p>
                            {items.map((item) => {
                              const isChecked = selected.has(`${item.kind}:${item.id}`);
                              return (
                                <ClassworkItemLine
                                  key={`${item.kind}:${item.id}`}
                                  size="sm"
                                  className={`border-2! shadow-none! ${isChecked ? "bg-primary!" : ""}`}
                                  item={{
                                    classwork_id: item.id,
                                    title: item.title,
                                    classwork_type: item.classwork_type ?? item.kind,
                                  }}
                                  showPublicationStatus={false}
                                  showCategory={false}
                                  showType={false}
                                  onClick={() => !working && toggleResource(item)}
                                  rightContent={
                                    <div className="flex items-center gap-2">
                                      <Badge variant={`${isChecked ? "solid" : "surface"}`} size="sm">
                                        {formatToTitleCase(item.classwork_type ?? item.kind)}
                                      </Badge>

                                      <Checkbox
                                        checked={isChecked}
                                        disabled={working}
                                        variant="solid"
                                        className={`border-black transition-colors ${isChecked ? "bg-black text-white" : "bg-white text-black"}`}
                                        onClick={(e) => e.stopPropagation()}
                                        onCheckedChange={() => toggleResource(item)}
                                      />
                                    </div>
                                  }
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty className="py-6 rounded!">
                        <Empty.Content>
                          <Empty.Description className="max-w-md text-sm">
                            No eligible reading materials match this filter.
                          </Empty.Description>
                          <Button
                            className="mt-2"
                            variant="default"
                            size="sm"
                            onClick={() => setIsCreatingReading(true)}
                          >
                            Add Additional Resources
                          </Button>
                        </Empty.Content>
                      </Empty>
                    )}
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button onClick={() => setPanel("")}>Done</Button>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>

              <Dialog
                open={isCreatingReading}
                onOpenChange={(open) => !open && setIsCreatingReading(false)}
              >
                {isCreatingReading && (
                  <CreateClassworkModal
                    nested
                    selectedType="READING"
                    subjects={teacherSubjects}
                    loads={effectiveLoads}
                    initialSubjectId={String(detail.subject_id)}
                    initialClassId={detail.class_id}
                    interventionResourceContext={{
                      interventionId: detail.intervention_id,
                      studentId: detail.student_id,
                      studentName: detail.student_name,
                      classId: detail.class_id,
                      className: detail.class_name,
                      subjectId: detail.subject_id,
                      subjectName,
                      academicPeriodId: detail.academic_period_id,
                      recipientScopes,
                    }}
                    onClose={() => setIsCreatingReading(false)}
                    onBack={() => setIsCreatingReading(false)}
                    onSuccess={handleReadingCreated}
                  />
                )}
              </Dialog>

              <Dialog
                open={panel === "classworks"}
                onOpenChange={(open) => {
                  if (open) {
                    openTargetSelectionModal();
                  } else {
                    cancelTargetSelection();
                  }
                }}
              >
                <Dialog.Content
                  size="md"
                  className="z-[1001]! max-h-[85vh]"
                  overlay={{ forceRender: true, className: "z-[1000]!" }}
                >
                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-bold">
                      Select Targeted Classwork
                    </Dialog.Title>
                  </Dialog.Header>
                  <div className="flex flex-col gap-4 overflow-y-auto p-4 pr-3">
                    <div className="flex flex-col gap-1 mb-2">
                      <p className="text-base font-semibold">Eligible Student Classworks</p>

                      {eligibleTreatmentActivities.length > 0 ? (
                        <div className="flex flex-col gap-2 mt-1">
                          {eligibleTreatmentActivities.map((activity) => {
                            const resource = resources.find(
                              (r) =>
                                r.kind === "CLASSWORK" &&
                                (r.id === activity.classwork_id || r.title === activity.title)
                            );
                            const matchingExam = originalExams.find(
                              (e) =>
                                e.title === activity.title ||
                                e.assignment_id === activity.classwork_id
                            );
                            const targetAssignmentId = canonicalAssignmentId(
                              activity,
                              originalExams
                            );
                            const isRecommended =
                              targetAssignmentId != null &&
                              targetAssignmentId === recommendedAssignmentId;
                            const isSelected =
                              (targetAssignmentId != null && selectedActivityIds.includes(targetAssignmentId)) ||
                              (plan.grade_treatment === "EXAMINATION" &&
                                matchingExam != null &&
                                plan.original_exam_assignment_id === matchingExam.assignment_id);

                            return (
                              <ClassworkItemLine
                                key={`modal-cw-${activity.classwork_id}-${activity.title}`}
                                className={`border-2! shadow-none! transition-all cursor-pointer ${isSelected
                                  ? "bg-primary!"
                                  : ""
                                  }`}
                                iconClassName={isSelected ? "bg-white" : undefined}
                                size="sm"
                                onClick={() => toggleActivitySelection(activity)}
                                item={{
                                  classwork_id: activity.classwork_id,
                                  title: activity.title,
                                  classwork_type:
                                    resource?.classwork_type ??
                                    (activity.component === "EXAMINATION" ? "QUIZ" : "ASSIGNMENT"),
                                }}
                                showPublicationStatus={false}
                                showCategory={false}
                                showType={false}
                                rightContent={
                                  <div className="flex items-center gap-2 shrink-0">
                                    {isRecommended && (
                                      <Badge variant="secondary" size="sm">
                                        Recommended
                                      </Badge>
                                    )}
                                    {plan.grade_treatment === "PRACTICE_ONLY" && (
                                      <Badge variant="outline" size="sm">
                                        {componentLabel(activity.component)}
                                      </Badge>
                                    )}
                                    <span className="text-xs font-bold">
                                      {activity.score}
                                      <span className="font-medium text-muted-foreground text-xs">
                                        {" "}
                                        / {activity.possible_score}
                                      </span>
                                    </span>
                                    <Badge
                                      variant={
                                        activity.percent >= 80
                                          ? "success"
                                          : activity.percent >= 75
                                            ? "surface"
                                            : "destructive"
                                      }
                                      size="sm"
                                    >
                                      {activity.percent.toFixed(1)}%
                                    </Badge>

                                    <Checkbox
                                      checked={isSelected}
                                      aria-label={`Select ${activity.title} as the remediation target`}
                                      variant="solid"
                                      className={`border-black transition-colors ${isSelected ? "bg-black text-white" : "bg-white text-black"}`}
                                      onClick={(e) => e.stopPropagation()}
                                      onCheckedChange={() => toggleActivitySelection(activity)}
                                    />
                                  </div>
                                }
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                          <Empty.Content>
                            <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                              <Activity className="size-8" />
                            </Empty.Icon>
                            <Empty.Title className="text-sm font-bold">
                              No classworks available
                            </Empty.Title>
                            <Empty.Description className="text-xs text-muted-foreground">
                              No scored{" "}
                              {plan.grade_treatment === "PRACTICE_ONLY"
                                ? "diagnostic"
                                : componentLabel(plan.grade_treatment).toLowerCase()}{" "}
                              classworks were found for this student.
                            </Empty.Description>
                          </Empty.Content>
                        </Empty>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Choose one original classwork for this remediation.
                      </p>
                    </div>

                    <SubjectGradeProjectionCard
                      projection={projectionResponse}
                      loading={projectionLoading}
                      error={projectionError}
                      selectedTargetIds={selectedActivityIds}
                      capPercentage={
                        projectionResponse?.target_projections?.[0]?.cap_percentage ??
                        projectionResponse?.eligible_target_gains?.[0]?.cap_percentage ??
                        plan.score_adjustment_cap ??
                        75
                      }
                      rawPreviews={selectedScorePreviews}
                      gradeTreatment={plan.grade_treatment}
                      onRetry={() => fetchProjection(undefined, true)}
                    />

                    {plan.grade_treatment && plan.grade_treatment !== "PRACTICE_ONLY" && (
                      <Card className="flex flex-col gap-2 p-3 rounded border-2 border-border bg-card">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="score-adjustment-cap" className="text-base font-bold">
                            Target-Score Ceiling
                          </Label>

                          <div className="flex flex-row gap-1">
                            <Input
                              id="score-adjustment-cap"
                              type="number"
                              min={0}
                              disabled={hasSavedAssessment}
                              max={99}
                              value={capInput}
                              onChange={(e) => {
                                if (hasSavedAssessment) return;
                                const val = e.target.value;
                                setCapInput(val);
                                setCapError(validateCap(val));
                              }}
                              placeholder="75"
                              className="w-24 h-8! border-2"
                            />
                            <span className="text-sm font-semibold mt-2">%</span>
                          </div>

                        </div>
                        <div className="flex items-center gap-2 justify-between">
                          <span className="text-xs text-muted-foreground">
                            Sets the highest score the classwork can reach after remediation.
                          </span>
                          <div className="flex items-center gap-1.5">
                            {[75, 80, 85].map((preset) => {
                              const isPreset = capInput === String(preset);
                              return (
                                <button
                                  key={preset}
                                  type="button"
                                  disabled={hasSavedAssessment}
                                  onClick={() => {
                                    if (hasSavedAssessment) return;
                                    setCapInput(String(preset));
                                    setCapError(null);
                                  }}
                                  className={`px-2 py-0.5 text-xs font-bold rounded! border-2 transition-all ${isPreset
                                    ? "bg-primary text-primary-foreground border-black"
                                    : "bg-background text-foreground border-border hover:border-black"
                                    } ${hasSavedAssessment ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                  {preset}%
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </Card>
                    )}
                    {capError ? (
                      <p className="text-xs text-destructive font-medium" role="alert">
                        {capError}
                      </p>
                    ) : Number.isFinite(parseFloat(capInput)) &&
                      parseFloat(capInput) !==
                      Number(
                        projectionResponse?.target_projections?.[0]?.cap_percentage ??
                        projectionResponse?.eligible_target_gains?.[0]?.cap_percentage ??
                        plan.score_adjustment_cap ??
                        75
                      ) ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Save the {capInput}% cap to update the preview. Current preview: {" "}
                        {projectionResponse?.target_projections?.[0]?.cap_percentage ??
                          projectionResponse?.eligible_target_gains?.[0]?.cap_percentage ??
                          plan.score_adjustment_cap ??
                          75}
                        % ceiling until adjustments are saved.
                      </p>
                    ) : null}

                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button onClick={confirmTargetSelection}>
                      Done
                    </Button>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>

              <AiRemediationDraftModal
                open={showDraftPreview}
                onOpenChange={(open) => {
                  if (generatingDraft && !open) return;
                  setShowDraftPreview(open);
                }}
                generatingDraft={generatingDraft}
                generationError={generationError}
                generatedDraft={generatedDraft}
                setGeneratedDraft={setGeneratedDraft}
                draftSaveState={draftSaveState}
                draftSaveError={draftSaveError}
                savedAssessment={savedAssessment}
                isEditingDraft={isEditingDraft}
                setIsEditingDraft={setIsEditingDraft}
                draftValidation={draftValidation}
                capInput={capInput}
                plan={plan}
                targetAssignmentSummary={targetAssignmentSummary}
                rubricLocked={selectedTargetHasInheritedRubric}
                onGenerateWithAI={handleGenerateWithAI}
                retryDisabled={!generationEligibility?.eligible_taught_lessons.length}
                onSaveAssessmentDraft={handleSaveAssessmentDraft}
                onContinueToQuizBuilder={(draft) => {
                  setShowDraftPreview(false);
                  void openTool("ai", draft);
                }}
                onUpdateQuizQuestion={handleUpdateQuizQuestion}
                onUpdateQuizOption={handleUpdateQuizOption}
                onUpdateQuizAnswerKey={handleUpdateQuizAnswerKey}
                onUpdateClassworkTask={handleUpdateClassworkTask}
                onUpdateClassworkDeliverable={handleUpdateClassworkDeliverable}
                onUpdateClassworkRubricLevel={handleUpdateClassworkRubricLevel}
                onUpdateClassworkTeacherGuide={handleUpdateClassworkTeacherGuide}
              />

              {isRemediationQuizAiModalOpen && (
                <AIQuizGeneratorModal
                  isOpen={isRemediationQuizAiModalOpen}
                  onClose={() => setIsRemediationQuizAiModalOpen(false)}
                  subjectId={subjectId}
                  subjectName={subjectName}
                  remediationFocus={focus}
                  remediationConfig={(() => {
                    const effectiveEligibility =
                      latestEligibilityRef.current ?? generationEligibility;
                    const gradeTreatment: "WRITTEN_WORK" | "EXAMINATION" | "PRACTICE_ONLY" =
                      plan.grade_treatment === "EXAMINATION"
                        ? "EXAMINATION"
                        : plan.grade_treatment === "WRITTEN_WORK"
                          ? "WRITTEN_WORK"
                          : "PRACTICE_ONLY";
                    const targetComponent: "WRITTEN_WORK" | "EXAMINATION" =
                      gradeTreatment === "EXAMINATION"
                        ? "EXAMINATION"
                        : gradeTreatment === "WRITTEN_WORK"
                          ? "WRITTEN_WORK"
                          : focus?.component === "EXAMINATION"
                            ? "EXAMINATION"
                            : "WRITTEN_WORK";
                    const selectedTargetId =
                      gradeTreatment === "EXAMINATION"
                        ? plan.original_exam_assignment_id ?? selectedActivityIds[0] ?? null
                        : gradeTreatment === "WRITTEN_WORK"
                          ? activeUnlinkedTargetId ?? selectedActivityIds[0] ?? null
                          : null;
                    const selectedExam =
                      targetComponent === "EXAMINATION" && selectedTargetId != null
                        ? originalExams.find((exam) => exam.assignment_id === selectedTargetId)
                        : undefined;
                    const examSubtype =
                      targetComponent === "EXAMINATION"
                        ? (selectedExam?.subtype ?? focus?.exam_subtype ?? "SUMMATIVE_1")
                        : null;
                    const readingIds = reconcileSelectedResources(
                      plan.selected_resources,
                      resources,
                    )
                      .filter((r) => r.kind === "CLASSWORK")
                      .map((r) => r.id);
                    const parsedCap = Number(capInput);
                    const effectiveCap = Number.isFinite(parsedCap)
                      ? parsedCap
                      : (plan.score_adjustment_cap ?? 75);
                    const config: RemediationQuizGeneratorConfig = {
                      interventionId,
                      targetComponent,
                      gradeTreatment,
                      examSubtype,
                      targetAssignmentId: selectedTargetId,
                      targetAssignmentTitle: targetAssignmentSummary,
                      lockedTotalPoints:
                        gradeTreatment === "PRACTICE_ONLY"
                          ? null
                          : selectedTargetMaximum,
                      scoreAdjustmentCap:
                        gradeTreatment === "PRACTICE_ONLY" ? null : effectiveCap,
                      eligibleLessons:
                        effectiveEligibility?.eligible_taught_lessons.map((l) => ({
                          lesson_id: l.lesson_id,
                          title: l.title,
                        })) ?? [],
                      competencyLabels:
                        focus?.competencies?.map((c) => c.label) ?? [],
                      selectedReadingIds: readingIds,
                      onRemediationGenerated: (draft) => {
                        setIsRemediationQuizAiModalOpen(false);
                        void openTool("ai", draft);
                      },
                    };
                    return config;
                  })()}
                />
              )}

              {/* Practice Assessment Section */}
              <div className={wizardStep !== 2 ? "hidden" : "flex flex-col gap-2"}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black">Practice Assessment</h3>
                    <Badge variant="outline" size="sm">Optional · Ungraded</Badge>
                  </div>
                  {wizardStep === 2 && (
                    <span className="text-xs text-muted-foreground">
                      Skip directly to Step 3 if independent practice is not needed.
                    </span>
                  )}
                </div>

                <Card className="flex flex-col gap-3 p-4">
                  {practiceAssessmentLoading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
                      <RefreshCw className="size-4 animate-spin" />
                      Loading Practice Assessment...
                    </div>
                  ) : practiceAssessmentError ? (
                    <Alert status="error">
                      <Alert.Title>Unable to load Practice Assessment</Alert.Title>
                      <Alert.Description className="flex flex-col items-start gap-3">
                        <span>{practiceAssessmentError}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void loadPracticeAssessment()}
                        >
                          <RefreshCw className="size-3.5 mr-1.5" />
                          Retry
                        </Button>
                      </Alert.Description>
                    </Alert>
                  ) : practiceAssessment ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-base">{practiceAssessment.title}</h4>
                            <Badge
                              variant={
                                practiceAssessment.status === "PUBLISHED"
                                  ? "solid"
                                  : practiceAssessment.status === "ARCHIVED"
                                    ? "outline"
                                    : "solid"
                              }
                              size="sm"
                            >
                              {formatToTitleCase(practiceAssessment.status)}
                            </Badge>
                            <Badge variant="outline" size="sm">
                              {practiceAssessment.gatekeeper_policy === "REQUIRE_PASS"
                                ? "Require Passing Score"
                                : practiceAssessment.gatekeeper_policy === "REQUIRE_ATTEMPT"
                                  ? "Allow Progress Below Passing"
                                  : "Optional Practice"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {practiceAssessment.questions.length} questions · {practiceAssessment.passing_percentage}% passing score
                          </p>
                        </div>
                        <div className="flex items-center gap-2">

                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => setIsPracticeModalOpen(true)}
                          >
                            Edit Practice Assessment
                          </Button>
                        </div>
                      </div>

                      {/* Attempts Summary */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-black">
                            Student Attempts ({practiceAttempts.length})
                          </span>
                          {practiceAttempts.some((attempt) => attempt.is_passed) && (
                            <Badge variant="success" size="sm">Passed</Badge>
                          )}
                        </div>

                        {practiceAttempts.length === 0 ? (
                          <TeacherEmptyState
                            compact
                            icon={<BookOpen />}
                            title="No student attempts yet"
                            description="Once published, the student can attempt this practice assessment."
                            className="w-full rounded! border-2 border-border shadow-none!"
                          />
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {practiceAttempts.slice(0, 5).map((att) => (
                              <div
                                key={att.attempt_id}
                                className="flex flex-wrap items-center gap-2 rounded! border-2 border-border bg-card p-3 text-sm"
                              >
                                <span className="font-medium">Attempt #{att.attempt_number}:</span>
                                <span className="font-bold">
                                  {att.total_score}/{att.max_score} ({att.score_percentage != null ? `${att.score_percentage}%` : "In progress"})
                                </span>
                                <Badge
                                  variant={att.is_passed ? "solid" : att.status === "SUBMITTED" ? "default" : "outline"}
                                  size="sm"
                                >
                                  {att.is_passed ? "Passed" : att.status === "SUBMITTED" ? "Below Passing" : att.status}
                                </Badge>
                              </div>
                            ))}
                            {practiceAttempts.length > 5 && (
                              <Button
                                size="sm"
                                variant="link"
                                className="text-xs p-0 h-auto"
                                onClick={() => setIsPracticeModalOpen(true)}
                              >
                                +{practiceAttempts.length - 5} more
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-1">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Independent practice to prepare the student for remediation
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Author questions manually, import a quiz file, or generate with AI grounded in selected readings.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => setIsPracticeModalOpen(true)}
                        className="shrink-0"
                      >
                        <Plus className="size-3.5 mr-1.5" />
                        Add Practice Assessment
                      </Button>
                    </div>
                  )}
                </Card>
              </div>

              <div className={wizardStep != null && wizardStep !== 3 ? "hidden" : "flex flex-col gap-1"}>
                {wizardStep == null && <h3 className="font-black">Remediation Activity</h3>}

                <Card className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <p className="font-bold text-base">
                      How do you want to deliver remediation?
                    </p>
                  </div>
                  <div
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                    role="radiogroup"
                    aria-label="Remediation activity method"
                  >
                    {methods.map((method) => {
                      const isSelected = plan.teacher_choice === method.value;
                      const isAiRecommended =
                        method.aiRecommendable &&
                        plan.ai_suggestion?.recommended_format === method.value;
                      const selectMethod = () => {
                        if (working || hasSavedAssessment) return;
                        choiceOrigin.current = "manual";
                        resetDraftCreationState();
                        setPlan((current) => ({
                          ...current,
                          teacher_choice: method.value,
                          grade_treatment: isGraded(method.value)
                            ? (current.grade_treatment ?? (wizardStep != null ? (focus?.component ?? "PRACTICE_ONLY") : "PRACTICE_ONLY"))
                            : null,
                        }));
                      };
                      return (
                        <Card
                          key={method.value}
                          role="radio"
                          aria-checked={isSelected}
                          aria-disabled={hasSavedAssessment}
                          tabIndex={working || hasSavedAssessment ? -1 : 0}
                          className={`p-3 border-2! transition-all ${hasSavedAssessment
                            ? isSelected
                              ? "border-primary bg-primary cursor-default"
                              : "opacity-50 cursor-not-allowed pointer-events-none bg-muted/20"
                            : isSelected
                              ? "border-primary bg-primary cursor-pointer"
                              : "hover:bg-retro cursor-pointer"
                            }`}
                          onClick={selectMethod}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              selectMethod();
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-base">{method.label}</span>
                            <div className="flex items-center gap-1.5">
                              {hasSavedAssessment && isSelected && (
                                <Badge variant="solid" size="sm">
                                  Locked
                                </Badge>
                              )}
                              {!hasSavedAssessment && isAiRecommended && (
                                <Badge variant="solid" size="sm">Recommended</Badge>
                              )}
                            </div>
                          </div>
                          <p className={`text-sm mt-1 ${isSelected
                            ? "text-foreground"
                            : "text-muted-foreground"
                            }`}>
                            {method.detail}
                          </p>
                        </Card>
                      );
                    })}
                  </div>

                  {plan.ai_suggestion && (
                    <div className="px-1 text-sm text-muted-foreground">
                      <p>{plan.ai_suggestion.reason}</p>
                    </div>
                  )}
                  {advisoryError && (
                    <p className="text-sm text-muted-foreground px-1" role="status">
                      {advisoryError}
                    </p>
                  )}

                  {isGraded(plan.teacher_choice) && (wizardStep == null || wizardStep === 3) && (
                    <Card className="flex w-full flex-col gap-2 border-0 p-0 shadow-none!">
                      <div className="flex w-full flex-col gap-3">
                        {hasSavedAssessment ? (
                          (!activeGradeTreatment || activeGradeTreatment === "PRACTICE_ONLY") && (
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <Label className="font-semibold text-base cursor-default">
                                    Saved Grade Treatment
                                  </Label>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="surface" size="sm">
                                    Locked
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-bold">Grade Treatment:</span>
                              <Badge variant="solid" size="sm">
                                {plan.grade_treatment === "PRACTICE_ONLY"
                                  ? "Ungraded Activity"
                                  : plan.grade_treatment === "EXAMINATION"
                                    ? "Remedial Exam"
                                    : plan.grade_treatment
                                      ? componentLabel(plan.grade_treatment)
                                      : "Unavailable"}
                              </Badge>
                            </div>
                            {focus?.component == null && (
                              <Alert status="warning">
                                No single verified weakest grading component is available.
                                Graded remediation is unavailable; use Ungraded Activity.
                              </Alert>
                            )}
                            {plan.grade_treatment && (
                              <p className="text-sm text-muted-foreground">
                                {{
                                  PRACTICE_ONLY:
                                    "Ungraded Activity stores completion without changing grades.",
                                  WRITTEN_WORK:
                                    "Written Work adds a portion of the score to a classwork under the category.",
                                  PERFORMANCE_TASK:
                                    "Performance Task adds a portion of the score to a performance task under the category.",
                                  EXAMINATION:
                                    "Remedial Exam replaces the original assessment's effective score only when higher.",
                                }[plan.grade_treatment]}
                              </p>
                            )}
                          </div>
                        )}

                        {focus?.component === "EXAMINATION" && originalExams.length === 0 && (
                          <p className="text-sm text-destructive px-1">
                            No scored original Examination is available for this student and
                            period.
                          </p>
                        )}

                        {activeGradeTreatment && activeGradeTreatment !== "PRACTICE_ONLY" && (
                          <div className="space-y-3 pt-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <Label className="text-base font-bold">
                                  Current Targeted {componentLabel(activeGradeTreatment)} Classwork
                                </Label>
                                {hasSavedAssessment && (
                                  <Badge variant="solid" size="sm">
                                    Locked
                                  </Badge>
                                )}
                              </div>
                              {(!hasSavedAssessment || canAddAnother) && chosenActivities.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={openTargetSelectionModal}
                                >
                                  {eligibleTreatmentActivities.length > 1
                                    ? "Change Target & Ceiling"
                                    : "Adjust Score Ceiling"}
                                </Button>
                              )}
                            </div>
                            {chosenActivities.length > 0 ? (
                              <div className="flex flex-col gap-2">
                                {chosenActivities.map((chosenActivity) => {
                                  const assignmentId = canonicalAssignmentId(chosenActivity, originalExams);
                                  const preview = scorePreviews.find(
                                    (p) =>
                                      (assignmentId != null && p.assignment_id === assignmentId) ||
                                      p.assignment_id === chosenActivity.classwork_id ||
                                      (p.title != null && p.title === chosenActivity.title)
                                  );
                                  return (
                                    <Card
                                      key={`chosen-cw-${chosenActivity.classwork_id}-${chosenActivity.title}`}
                                      className="flex w-full flex-col gap-3 rounded! border-2! border-border bg-card p-4 shadow-none!"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                          <span className="text-sm font-semibold break-words">{chosenActivity.title}</span>
                                        </div>

                                      </div>
                                      <div className="grid grid-cols-1 gap-3 rounded! border-2 border-border bg-card p-3 sm:grid-cols-3">
                                        <div className="flex flex-col gap-0.5">
                                          <p className="text-sm text-muted-foreground">Original</p>
                                          <p className="text-base font-bold">
                                            {preview
                                              ? `${preview.original_score}/${preview.max_points}`
                                              : `${chosenActivity.score}/${chosenActivity.possible_score}`}
                                          </p>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          <p className="text-sm text-muted-foreground">Maximum Adjusted</p>
                                          <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                                            {preview
                                              ? `${preview.max_adjusted_score}/${preview.max_points}`
                                              : (previewLoading ? "Calculating..." : "Unavailable")}
                                          </p>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          <p className="text-sm text-muted-foreground">Possible Gain</p>
                                          <p className="text-base font-bold">
                                            {preview
                                              ? `+${preview.possible_gain > 0 ? preview.possible_gain : 0}`
                                              : (previewLoading ? "..." : "—")}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 gap-3 rounded! border-2 border-border bg-background p-3 sm:grid-cols-2">
                                        <div className="flex flex-col gap-0.5">
                                          <p className="text-xs text-muted-foreground font-medium">Current AI-Predicted Grade</p>
                                          <p className="text-base font-bold">
                                            {formatPredictedValue(displayedCurrentPrediction)}
                                          </p>
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                          <p className="text-xs text-muted-foreground font-medium">AI-Predicted Grade at Max Remediation Score</p>
                                          <p className="text-base font-bold">
                                            {projectionLoading && !hasSavedAssessment
                                              ? "Calculating..."
                                              : formatPredictedValue(displayedMaxScorePrediction)}
                                            {displayedPredictionDelta != null && !(projectionLoading && !hasSavedAssessment) && (
                                              <span className="ml-1 text-xs font-semibold text-muted-foreground">
                                                ({displayedPredictionDelta >= 0 ? "+" : ""}
                                                {displayedPredictionDelta.toFixed(2)})
                                              </span>
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                      <p className="text-sm text-muted-foreground">
                                        {hasSavedAssessment
                                          ? `Original max: ${preview?.max_points ?? chosenActivity.possible_score} pts · Target-score ceiling: ${primaryImpactTarget?.cap_percentage ?? plan.score_adjustment_cap ?? 75}% · Effective max target score: ${preview ? `${preview.max_adjusted_score}/${preview.max_points}` : (primaryImpactTarget ? `${formatScoreValue(primaryImpactTarget.effective_max_score)}/${formatScoreValue(primaryImpactTarget.max_points)}` : "Unavailable")}`
                                          : "The actual adjustment will use this student's remediation score."}
                                      </p>
                                    </Card>
                                  );
                                })}
                              </div>
                            ) : hasSavedAssessment ? (
                              <Card className="flex w-full flex-col gap-3 rounded! border-2! border-border bg-card p-4 shadow-none!">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="text-base font-bold">
                                      {primaryImpactTarget?.title ?? primaryAssignedAssessment?.original_title ?? targetAssignmentSummary}
                                    </span>
                                  </div>
                                  <Badge variant="surface" size="sm">
                                    {componentLabel(activeGradeTreatment)}
                                  </Badge>
                                </div>
                                <div className="grid grid-cols-1 gap-3 rounded! border-2 border-border bg-retro p-3 sm:grid-cols-3">
                                  <div className="flex flex-col text-center items-center gap-1">
                                    <p className="text-xs font-medium">Original</p>
                                    <Badge variant="destructive" size="md" className="h-6 min-w-18 items-center justify-center text-center">
                                      {primaryImpactTarget
                                        ? `${formatScoreValue(primaryImpactTarget.original_score)}/${formatScoreValue(primaryImpactTarget.max_points)}`
                                        : primaryAssignedAssessment?.original_grade != null && primaryAssignedAssessment?.total_points != null
                                          ? `${primaryAssignedAssessment.original_grade}/${primaryAssignedAssessment.total_points}`
                                          : "Recorded Score"}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-col text-center items-center gap-1">
                                    <p className="text-xs  font-medium">Target-Score Ceiling</p>
                                    <Badge variant="surface" size="md" className="h-6 min-w-18 items-center justify-center text-center">
                                      {primaryImpactTarget?.cap_percentage ?? (activeGradeTreatment === "EXAMINATION" ? 100 : (plan.score_adjustment_cap ?? 75))}%
                                    </Badge>
                                  </div>
                                  <div className="flex flex-col text-center items-center gap-1">
                                    <p className="text-xs font-medium">Effective Max Target Score</p>
                                    <Badge variant="success" size="md" className="h-6 min-w-18 items-center justify-center text-center">
                                      {primaryImpactTarget
                                        ? `${formatScoreValue(primaryImpactTarget.effective_max_score)}/${formatScoreValue(primaryImpactTarget.max_points)}`
                                        : "Unavailable"}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <div className="flex flex-row items-center gap-2">
                                    <p className="text-sm text-foreground font-medium">Current AI-Predicted Grade: </p>
                                    <Badge variant="destructive" size="md" className="h-6 items-center justify-center text-center">
                                      {formatPredictedValue(displayedCurrentPrediction)}
                                    </Badge>
                                  </div>
                                  <div className="flex flex-row items-center gap-2 col-span-2">
                                    <p className="text-sm text-foreground font-medium">AI-Predicted Grade at Max Remediation Score: </p>
                                    <Badge variant="success" size="md" className="h-6 min-w-18 items-center justify-center text-center">
                                      {formatPredictedValue(displayedMaxScorePrediction)}
                                    </Badge>
                                    {displayedPredictionDelta != null && (
                                      <span className="text-xs font-semibold text-foreground">
                                        ({displayedPredictionDelta >= 0 ? "+" : ""}
                                        {displayedPredictionDelta.toFixed(2)})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Original target maximum points: {primaryImpactTarget ? `${formatScoreValue(primaryImpactTarget.max_points)} points` : (primaryAssignedAssessment?.total_points != null ? `${primaryAssignedAssessment.total_points} points` : "Preserved")}
                                  {" · "}AI prediction impact is advisory and depends on the student's actual remediation score.
                                </p>
                              </Card>
                            ) : (
                              <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                                <Empty.Content>
                                  <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                                    <IconContainer className="bg-primary" size={"sm"}>
                                      <Activity className="size-8" />
                                    </IconContainer>
                                  </Empty.Icon>
                                  <Empty.Title className="text-xl! font-bold">
                                    No classwork selected
                                  </Empty.Title>
                                  <Empty.Description className="text-sm whitespace-nowrap text-muted-foreground">
                                    {treatmentActivities.length > 0
                                      ? `Select classwork from ${componentLabel(activeGradeTreatment)} to add score to`
                                      : `No scored ${componentLabel(activeGradeTreatment).toLowerCase()} classworks available for this student`}
                                  </Empty.Description>
                                  {treatmentActivities.length > 0 && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={openTargetSelectionModal}
                                      className="mt-1"
                                    >
                                      <Plus className="size-3.5 mr-1.5" />
                                      Select Classwork
                                    </Button>
                                  )}
                                </Empty.Content>
                              </Empty>
                            )}
                            {hasSavedAssessment && (
                              <p className="text-sm text-muted-foreground px-1 flex items-center gap-1">
                                Grade treatment, targeted classwork, and target-score ceiling are locked because a remediation activity already exists.
                              </p>
                            )}
                          </div>
                        )}

                        {!plan.grade_treatment && (
                          <Alert status="warning">
                            Choose practice only or an official grade component before
                            continuing.
                          </Alert>
                        )}
                      </div>
                    </Card>
                  )}

                  <div className="flex flex-col gap-3 mt-2">
                    <Label className="font-bold text-base">
                      Curated Classwork Activity
                    </Label>
                    {assigned.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {assigned.map((item) => {
                          const classworkId = item.classwork_id ?? item.assignment_id;
                          const isPublished = item.is_published === true;
                          return (
                            <Card key={item.assignment_id} className="flex flex-col gap-3 border-2 p-0 shadow-none">
                              <ClassworkItemLine
                                className="shadow-none! border-2! cursor-pointer hover:bg-muted/40 transition-colors"
                                size="sm"
                                item={{
                                  classwork_id: classworkId,
                                  title: item.title,
                                  classwork_type:
                                    item.classwork_type ??
                                    (plan.teacher_choice === "QUIZ" ? "QUIZ" : "ASSIGNMENT"),
                                  classwork_category: item.component,
                                  total_points: item.total_points,
                                  is_published: isPublished,
                                }}
                                onClick={() => {
                                  if (classworkId) {
                                    void handleOpenEditClasswork(classworkId);
                                  }
                                }}
                                showPublicationStatus
                                showCategory={false}
                                showType={false}
                                rightContent={item.total_points != null ? (
                                  <span className="text-xs font-bold whitespace-nowrap">
                                    {item.total_points} points
                                  </span>
                                ) : undefined}
                              />
                              <div className="flex flex-row gap-2 self-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => navigate(`/teacher/classworks/${classworkId}`)}
                                  className="gap-1.5"
                                >
                                  View Assessment
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (classworkId) {
                                      void handleOpenEditClasswork(classworkId);
                                    }
                                  }}
                                  className="gap-1.5"
                                >
                                  <Pencil className="size-4" />
                                  Edit Assessment
                                </Button>
                              </div>
                              <Label className="mt-2 text-base font-bold font-sans -mb-1">
                                Student's Submission
                              </Label>
                              <Card className="grid gap-2 shadow-none border-2! px-3 pb-3 pt-2 text-sm sm:grid-cols-4">
                                <div>
                                  <span className="text-muted-foreground">Original score</span>
                                  <strong className="block">
                                    {item.original_grade != null
                                      ? `${item.original_grade}${item.total_points != null ? `/${item.total_points}` : ""}`
                                      : "—"}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Actual outcome</span>
                                  <strong className="block">
                                    {(item.effective_grade ?? item.grade) != null
                                      ? `${item.effective_grade ?? item.grade}${item.total_points != null ? `/${item.total_points}` : ""}`
                                      : "—"}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Attempts</span>
                                  <strong className="block">
                                    {item.attempt_count ?? 0}/{item.max_attempts ?? 3}
                                  </strong>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Status</span>
                                  <div className="mt-0.5">
                                    <Badge
                                      variant={
                                        item.needs_teacher_review
                                          ? "destructive"
                                          : item.is_passed
                                            ? "success"
                                            : item.submission_status === "graded" || (item.grade != null && item.submission_status !== "draft")
                                              ? "solid"
                                              : item.submission_status === "submitted" || item.submission_status === "late"
                                                ? "surface"
                                                : "default"
                                      }
                                      size="sm"
                                    >
                                      {item.needs_teacher_review
                                        ? "Needs Teacher Review"
                                        : item.is_passed
                                          ? "Passed"
                                          : item.submission_status === "graded" || (item.grade != null && item.submission_status !== "draft")
                                            ? "Completed"
                                            : item.submission_status === "submitted" || item.submission_status === "late"
                                              ? "Submitted"
                                              : "Pending"}
                                    </Badge>
                                  </div>
                                </div>
                              </Card>
                              {item.attempt_history && item.attempt_history.length > 1 && (
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground px-1">
                                  <span className="font-semibold text-foreground">Attempt History:</span>
                                  {item.attempt_history.map((att) => (
                                    <Badge key={att.submission_id} variant="outline" size="sm">
                                      Attempt {att.attempt_count}:{" "}
                                      {att.grade != null && item.total_points != null
                                        ? `${att.grade}/${item.total_points}`
                                        : att.status}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </Card>
                          );
                        })}
                      </div>
                    ) : (
                      <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                        <Empty.Content>
                          <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                            <IconContainer className="bg-primary" size="sm">
                              <Activity className="size-8" />
                            </IconContainer>
                          </Empty.Icon>
                          <Empty.Title className="text-xl! font-bold">
                            No activity created yet
                          </Empty.Title>
                          <Empty.Description className="text-sm whitespace-nowrap text-muted-foreground">
                            Configure your support method and continue to create the activity
                          </Empty.Description>
                        </Empty.Content>
                      </Empty>
                    )}

                    {assigned.length === 0 &&
                      (plan.teacher_choice === "QUIZ" || plan.teacher_choice === "CLASSWORK") &&
                      generationEligibility &&
                      generationEligibility.eligible_taught_lessons.length === 0 && (
                        <TeacherEmptyState
                          compact
                          className="rounded! bg-card shadow-none hover:shadow-none"
                          icon={<BookOpen />}
                          title="No lessons eligible for AI generation"
                          description={`The intervention was frozen ${date(generationEligibility.original_evidence_cutoff_at)}. A lesson marked Completed now is eligible only after an explicit evidence refresh; manual authoring remains available.`}
                          action={generationEligibility.refresh_available ? {
                            label: refreshingEvidence ? "Refreshing..." : "Refresh Remediation Evidence",
                            onClick: handleRefreshRemediationEvidence,
                            icon: <RefreshCw className={refreshingEvidence ? "size-4 animate-spin" : "size-4"} />,
                            disabled: refreshingEvidence,
                          } : undefined}
                        />
                      )}

                    {assigned.length === 0 && plan.teacher_choice !== "EXISTING_MATERIAL_ONLY" && (
                      <div className="flex flex-row flex-wrap w-full justify-end items-center gap-2 mt-2">
                        {plan.teacher_choice === "QUIZ" && (
                          <Button
                            disabled={reuseQuizDisabled}
                            onClick={() => void openTool("reuse")}
                            size="sm"
                            variant="outline"
                            className="gap-2"
                          >
                            <RefreshCw className="size-4" />
                            Reuse Quiz Questions
                          </Button>
                        )}
                        <Button
                          disabled={continueDisabled || working || generatingDraft}
                          onClick={() => void openTool("manual")}
                          size="sm"
                          variant={
                            (plan.teacher_choice === "QUIZ" || plan.teacher_choice === "CLASSWORK") &&
                            Boolean(generationEligibility?.eligible_taught_lessons.length)
                              ? "outline"
                              : "default"
                          }
                          className="gap-2"
                        >
                          {plan.teacher_choice === "QUIZ"
                            ? "Create Manually"
                            : plan.teacher_choice === "CLASSWORK"
                              ? "Create Manually"
                              : "Continue to TOS Generator"}
                        </Button>
                        {(plan.teacher_choice === "QUIZ" || plan.teacher_choice === "CLASSWORK") && (
                          <Button
                            disabled={continueDisabled || working || generatingDraft || !generationEligibility?.eligible_taught_lessons.length}
                            onClick={handleGenerateWithAI}
                            size="sm"
                            variant="default"
                            className="gap-2"
                          >
                            <Sparkles className="size-4" />
                            Generate with AI
                          </Button>
                        )}
                      </div>
                    )}

                    {hasConfirmedAdditionalTarget && chosenActivities[0] && (
                      <Card
                        aria-label="New Remediation Activity"
                        className="flex w-full flex-col gap-3 rounded! border-2! border-border bg-card p-4 shadow-none!"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h4 className="text-base font-bold">New Remediation Activity</h4>
                            <Badge variant="solid" size="sm">
                              {plan.teacher_choice ? label(plan.teacher_choice) : "Remediation"}
                            </Badge>
                          </div>
                          <Badge variant="surface" size="sm">
                            {componentLabel(activeGradeTreatment)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Target original classwork:{" "}
                          <strong className="font-semibold text-foreground">
                            {chosenActivities[0].title}
                          </strong>{" "}
                          ({chosenActivities[0].score}/{chosenActivities[0].possible_score} pts ·{" "}
                          {capInput || plan.score_adjustment_cap || 75}% target-score ceiling)
                        </p>

                        {(plan.teacher_choice === "QUIZ" || plan.teacher_choice === "CLASSWORK") &&
                          generationEligibility &&
                          generationEligibility.eligible_taught_lessons.length === 0 && (
                            <TeacherEmptyState
                              compact
                              className="rounded! bg-card shadow-none hover:shadow-none"
                              icon={<BookOpen />}
                              title="No lessons eligible for AI generation"
                              description={`The intervention was frozen ${date(generationEligibility.original_evidence_cutoff_at)}. A lesson marked Completed now is eligible only after an explicit evidence refresh; manual authoring remains available.`}
                              action={generationEligibility.refresh_available ? {
                                label: refreshingEvidence ? "Refreshing..." : "Refresh Remediation Evidence",
                                onClick: handleRefreshRemediationEvidence,
                                icon: <RefreshCw className={refreshingEvidence ? "size-4 animate-spin" : "size-4"} />,
                                disabled: refreshingEvidence,
                              } : undefined}
                            />
                          )}

                        {plan.teacher_choice !== "EXISTING_MATERIAL_ONLY" && (
                          <div className="flex flex-row flex-wrap w-full justify-end items-center gap-2">
                            {plan.teacher_choice === "QUIZ" && (
                              <Button
                                disabled={reuseQuizDisabled}
                                onClick={() => void openTool("reuse")}
                                size="sm"
                                variant="outline"
                                className="gap-2"
                              >
                                <RefreshCw className="size-4" />
                                Reuse Quiz Questions
                              </Button>
                            )}
                            <Button
                              disabled={continueDisabled || working || generatingDraft}
                              onClick={() => void openTool("manual")}
                              size="sm"
                              variant={
                                (plan.teacher_choice === "QUIZ" || plan.teacher_choice === "CLASSWORK") &&
                                Boolean(generationEligibility?.eligible_taught_lessons.length)
                                  ? "outline"
                                  : "default"
                              }
                              className="gap-2"
                            >
                              {plan.teacher_choice === "QUIZ"
                                ? "Create Manually"
                                : plan.teacher_choice === "CLASSWORK"
                                  ? "Create Manually"
                                  : "Continue to TOS Generator"}
                            </Button>
                            {(plan.teacher_choice === "QUIZ" || plan.teacher_choice === "CLASSWORK") && (
                              <Button
                                disabled={continueDisabled || working || generatingDraft || !generationEligibility?.eligible_taught_lessons.length}
                                onClick={handleGenerateWithAI}
                                size="sm"
                                variant="default"
                                className="gap-2"
                              >
                                <Sparkles className="size-4" />
                                Generate with AI
                              </Button>
                            )}
                          </div>
                        )}
                      </Card>
                    )}
                  </div>
                </Card>

                <RemediationProgressNotice
                  state={remediationState}
                  onAddAnother={openAdditionalTargetSelection}
                />
              </div>

              {wizardStep == null && hasOldDraft && oldDraft && (
                <Accordion className="w-full">
                  <Accordion.Item
                    value="legacy-draft"
                    className="overflow-hidden rounded border-2 border-border bg-card shadow-sm"
                  >
                    <Accordion.Header className="items-center px-4 py-3 bg-card font-bold text-sm">
                      Previous / legacy support draft
                    </Accordion.Header>
                    <Accordion.Content className="space-y-3 p-4 border-t-2 border-border bg-background">
                      <p className="text-xs text-muted-foreground">
                        Preserved for reference. Use the existing authoring tool for new
                        support.
                      </p>
                      {oldDraft.title.trim() && (
                        <p className="font-bold text-sm">{oldDraft.title}</p>
                      )}
                      {oldDraft.instructions.trim() && (
                        <p className="text-sm">{oldDraft.instructions}</p>
                      )}
                      <Badge variant="outline" size="sm">
                        {oldDraft.questions.length} saved questions
                      </Badge>
                      <div className="space-y-2 pt-1">
                        {oldDraft.questions.map((question, index) => (
                          <Card key={index} className="space-y-1.5 p-3 text-sm">
                            <strong className="block text-sm">
                              {question.question_text || `Question ${index + 1}`}
                            </strong>
                            <div className="space-y-1 pl-2">
                              {question.options.map((option, optionIndex) => (
                                <div key={optionIndex} className="flex items-center gap-1.5 text-xs">
                                  <span>{option.option_text}</span>
                                  {option.is_correct && (
                                    <Badge variant="success" size="sm">
                                      Correct
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                            {question.explanation && (
                              <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                                Explanation: {question.explanation}
                              </p>
                            )}
                          </Card>
                        ))}
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                </Accordion>
              )}
            </div>
          )}
        </>
      )}

      <PracticeAssessmentModal
        isOpen={isPracticeModalOpen}
        onClose={() => setIsPracticeModalOpen(false)}
        interventionId={interventionId}
        studentName={detail.student_name}
        selectedReadingIds={selectedReadingIds}
        savedReadingIds={savedReadingIds}
        onAssessmentUpdated={handlePracticeAssessmentUpdated}
        onPublished={() => {
          onNavigateToStep?.(2);
        }}
      />

      {editingClasswork && (
        <EditClassworkModal
          classwork={editingClasswork}
          isOpen={Boolean(editingClasswork)}
          onClose={() => setEditingClasswork(null)}
          onSuccess={() => {
            setEditingClasswork(null);
            void load();
          }}
        />
      )}
    </section>
  );
});

export default InterventionSupportMaterials;
