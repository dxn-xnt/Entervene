

"use client";

import { DatePicker } from "@/components/retroui/DatePicker";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/teacher/button";
import { buttonVariants } from "@/components/retroui/Button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { useToast } from "@/components/retroui/Toast";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { DialogueSelect } from "@/components/dialogue-select";
import { Select } from "@/components/retroui/Select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/retroui/Input";
import { FormMessage } from "@/components/retroui/FormMessage";
import { ClassworkSettingRow } from "@/components/classwork-setting-row";
import { Checkbox } from "@/components/retroui/Checkbox";
import Field from "@/components/admin/classes/fields/Field";
import { Card } from "@/components/retroui/Card";
import { Alert } from "@/components/retroui/Alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { apiFetch } from "@/lib/api";
import { emptyClassworkDraft } from "@/lib/classwork-utils";
import type {
  ClassworkKind,
  CreateDraft,
  TeacherClassLoad,
  TeacherLesson,
} from "@/types/classwork";
import type {
  QuizImportPreview,
  QuizQuestionDraft,
  QuizQuestionType,
  QuizSettingsDraft,
} from "../classworks/quiz-builder-types";
import {
  createEmptyQuizQuestion,
  defaultQuizSettings,
  interventionQuizCreationDefaults,
} from "../classworks/quiz-builder-utils";
import {
  applyBulkQuestionLessonAssignment,
  areQuestionMappingControlsDisabled,
  clearQuestionMappingsForLesson,
  getQuizLessonMappingState,
  hasLinkedLessonMapping,
  isUnkeyed,
  normalizeIncomingQuestions,
  reconcileQuestionLessonMappings,
  sanitizeQuestionLessonId,
  selectUnmappedQuestionIds,
  switchQuestionType,
} from "../classworks/quiz-question-rules";
import { exportQuizPdf, exportQuizDocx } from "@/lib/quiz-export";
import AIQuizGeneratorModal from "./ai-quiz-generator-modal";
import type {
  TeacherInterventionDetail,
  RemediationFocus,
  RemediationResource,
  OriginalExamination,
  RemediationClassworkTarget,
  RemediationQuizDraft,
} from "@/lib/teacher-interventions-api";
import { Badge } from "@/components/retroui/Badge";
import { categoryFromFocus, focusGuidance } from "@/lib/remediation-authoring";
import { RemediationTeacherGuidanceBanner } from "./remediation-teacher-guidance-banner";
import {
  validateReferenceLinks,
  type ReferenceLinkDraft,
} from "@/lib/classwork-reference-links";
import { cn } from "@/lib/utils";
import {
  legacyQuizReleaseSettings,
  quizResultsReleasePolicyFromLegacy,
  type QuizResultsReleasePolicy,
} from "../classworks/quiz-results-release";

interface CreateClassworkQuizModalProps {
  draftOnly?: boolean;
  selectedType: ClassworkKind;
  subjects: Array<{ id: number; name: string }>;
  loads: TeacherClassLoad[];
  initialSubjectId?: string;
  initialClassId?: number;
  initialLessonId?: number;
  initialTitle?: string;
  initialInstructions?: string;
  initialQuizMode?: "manual" | "reuse" | "ai";
  initialOriginalClassworkId?: number | null;
  initialAiRemediationDraft?: RemediationQuizDraft | null;
  remediationDraft?: boolean;
  remediationTarget?: TeacherInterventionDetail | null;
  remediationFocus?: RemediationFocus | null;
  remediationGradeTreatment?:
  | "PRACTICE_ONLY"
  | "WRITTEN_WORK"
  | "PERFORMANCE_TASK"
  | "EXAMINATION"
  | null;
  remediationOriginalExam?: OriginalExamination | null;
  remediationOriginalTargets?: RemediationClassworkTarget[];
  initialTargetAssignmentId?: number | null;
  remediationReferences?: RemediationResource[];
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

const convertAiRemediationQuestions = (
  aiDraft: RemediationQuizDraft,
  fallbackLessonId?: number | null,
): QuizQuestionDraft[] =>
  [...aiDraft.questions]
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .map((q, index) => {
      const effectiveType: QuizQuestionType =
        q.question_type === "TRUE_FALSE" ? "MULTIPLE_CHOICE" : q.question_type;
      const qDraft = createEmptyQuizQuestion(index + 1, effectiveType);
      const correctText = (q.teacher_answer_key?.correct_answer || "").trim();
      const sortedOptions = [...(q.options || [])].sort(
        (a, b) => (a.option_order || 0) - (b.option_order || 0),
      );
      let options =
        q.question_type === "IDENTIFICATION"
          ? [
              {
                option_text: correctText,
                is_correct: true,
                option_order: 1,
              },
            ]
          : q.question_type === "SHORT_ANSWER"
            ? []
            : sortedOptions.map((opt, optIdx) => ({
                option_text: opt.option_text,
                is_correct:
                  opt.option_text.trim().toLowerCase() ===
                  correctText.toLowerCase(),
                option_order: opt.option_order || optIdx + 1,
              }));
      if (
        effectiveType === "MULTIPLE_CHOICE" &&
        options.length > 0 &&
        !options.some((opt) => opt.is_correct) &&
        correctText
      ) {
        const letterMatch = correctText.match(
          /^(?:option\s+)?([A-Z])(?:\s*[.):-]\s*(.*))?$/i,
        );
        if (letterMatch) {
          const letterIdx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
          if (letterIdx >= 0 && letterIdx < options.length) {
            options = options.map((opt, idx) => ({
              ...opt,
              is_correct: idx === letterIdx,
            }));
          }
        }
      }
      return {
        ...qDraft,
        question_text: q.question_text,
        question_type: effectiveType,
        points:
          q.points !== undefined && q.points !== null ? String(q.points) : "1",
        display_order: index + 1,
        difficulty_level: q.difficulty_level || "MEDIUM",
        explanation: q.teacher_answer_key?.explanation || "",
        lesson_id: q.targeted_lesson_id ?? fallbackLessonId ?? null,
        is_ai_generated: true,
        options,
      };
    });

export default function CreateClassworkQuizModal({
  draftOnly = false,
  selectedType,
  subjects,
  loads,
  initialSubjectId,
  initialClassId,
  initialLessonId,
  initialTitle,
  initialInstructions,
  initialQuizMode,
  initialOriginalClassworkId = null,
  initialAiRemediationDraft = null,
  remediationDraft = false,
  remediationTarget,
  remediationFocus = null,
  remediationGradeTreatment = null,
  remediationOriginalExam = null,
  remediationOriginalTargets = [],
  initialTargetAssignmentId = null,
  remediationReferences = [],
  onClose,
  onSuccess,
  onBack,
}: CreateClassworkQuizModalProps) {
  const toast = useToast();
  const creationDefaults = interventionQuizCreationDefaults(
    Boolean(remediationTarget),
    remediationGradeTreatment,
  );
  const quizFileInputRef = useRef<HTMLInputElement>(null);
  const [createStep, setCreateStep] = useState<
    "quiz-source" | "details" | "quiz" | "assign"
  >(() => (initialQuizMode || remediationDraft ? "details" : "quiz-source"));
  const [referenceLinks] = useState<ReferenceLinkDraft[]>([]);

  const isSubjectLocked =
    Boolean(initialSubjectId) || Boolean(remediationTarget);
  const isLessonLocked = Boolean(initialLessonId);
  const [contextLesson, setContextLesson] = useState<TeacherLesson | null>(
    null,
  );

  useEffect(() => {
    if (!initialLessonId) {
      setContextLesson(null);
      return;
    }
    let active = true;
    apiFetch(`/api/v1/lessons/${initialLessonId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setContextLesson(data);
        }
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, [initialLessonId]);

  const isGradedWWPT =
    remediationDraft &&
    (remediationGradeTreatment === "WRITTEN_WORK" ||
      remediationGradeTreatment === "PERFORMANCE_TASK");

  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(
    () => {
      if (initialTargetAssignmentId) return initialTargetAssignmentId;
      return null;
    },
  );

  const selectedOriginalTarget = useMemo(() => {
    if (!remediationOriginalTargets || remediationOriginalTargets.length === 0)
      return null;
    return (
      remediationOriginalTargets.find(
        (t) => t.assignment_id === selectedTargetId,
      ) || null
    );
  }, [remediationOriginalTargets, selectedTargetId]);

  const [draft, setDraft] = useState<CreateDraft>(() => {
    const preferredId =
      initialSubjectId &&
        subjects.some((s) => String(s.id) === String(initialSubjectId))
        ? String(initialSubjectId)
        : subjects[0]
          ? String(subjects[0].id)
          : "";
    const defaultTotalPoints = remediationOriginalExam
      ? String(remediationOriginalExam.total_points)
      : isGradedWWPT && selectedOriginalTarget
        ? String(selectedOriginalTarget.max_points)
        : initialQuizMode === "ai" && initialAiRemediationDraft?.total_points
          ? String(initialAiRemediationDraft.total_points)
          : emptyClassworkDraft.total_points;
    const defaultAttempts = creationDefaults.maxAttempts;

    return {
      ...emptyClassworkDraft,
      title: initialTitle || initialAiRemediationDraft?.title || "",
      instructions:
        initialInstructions || initialAiRemediationDraft?.instructions || "",
      is_published:
        remediationDraft || draftOnly
          ? false
          : emptyClassworkDraft.is_published,
      classwork_category: remediationDraft
        ? remediationGradeTreatment === "PRACTICE_ONLY"
          ? ""
          : remediationGradeTreatment === "EXAMINATION"
            ? "QUARTERLY_ASSESSMENT"
            : remediationGradeTreatment || ""
        : categoryFromFocus(null),
      exam_subtype: remediationOriginalExam?.subtype ?? "",
      total_points: defaultTotalPoints,
      max_attempts: defaultAttempts,
      show_scores: creationDefaults.showScores,
      auto_ai_feedback_enabled: false,
      subject_id: preferredId,
    };
  });
  useEffect(() => {
    if (
      initialSubjectId &&
      subjects.some(
        (subject) => String(subject.id) === String(initialSubjectId),
      )
    ) {
      setDraft((current) =>
        current.subject_id === String(initialSubjectId)
          ? current
          : { ...current, subject_id: String(initialSubjectId) },
      );
    }
  }, [initialSubjectId, subjects]);
  useEffect(() => {
    if (draftOnly) {
      setDraft((current) => ({ ...current, is_published: false }));
    }
  }, [draftOnly]);

  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionDraft[]>(
    () => {
      if (
        initialQuizMode === "ai" &&
        initialAiRemediationDraft &&
        initialAiRemediationDraft.questions.length > 0
      ) {
        return convertAiRemediationQuestions(
          initialAiRemediationDraft,
          initialLessonId || null,
        );
      }
      return [
        {
          ...createEmptyQuizQuestion(1),
          lesson_id: initialLessonId || null,
        },
      ];
    },
  );
  const [isLoadingReusedQuiz, setIsLoadingReusedQuiz] = useState(false);
  const [reuseQuizError, setReuseQuizError] = useState("");
  const [quizSettings, setQuizSettings] = useState<QuizSettingsDraft>(() => ({
    ...defaultQuizSettings,
    duration_minutes:
      initialQuizMode === "ai" && initialAiRemediationDraft?.duration_minutes
        ? String(initialAiRemediationDraft.duration_minutes)
        : defaultQuizSettings.duration_minutes,
    max_attempts: creationDefaults.maxAttempts,
    show_correct_answers: creationDefaults.showScores,
  }));
  const [quizImportWarnings, setQuizImportWarnings] = useState<string[]>([]);
  const [quizImportNotices, setQuizImportNotices] = useState<
    NonNullable<QuizImportPreview["notices"]>
  >([]);
  const [quizImportSummary, setQuizImportSummary] = useState<
    QuizImportPreview["summary"] | null
  >(null);
  const [isImportingQuiz, setIsImportingQuiz] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [aiPromptScope, setAiPromptScope] = useState<string | undefined>(
    undefined,
  );
  const [aiLinkedSubjectName, setAiLinkedSubjectName] = useState<
    string | undefined
  >(undefined);
  const [aiLinkedLessonTitles, setAiLinkedLessonTitles] = useState<string[]>(
    [],
  );

  const [isExporting, setIsExporting] = useState<"pdf" | "docx" | null>(null);
  const [includeExportAnswerKey, setIncludeExportAnswerKey] = useState(false);

  const [selectedClassIds, setSelectedClassIds] = useState<number[]>(() => {
    if (remediationTarget) return [remediationTarget.class_id];
    if (initialClassId) return [initialClassId];
    return [];
  });
  const [remediationRequestId] = useState(() => crypto.randomUUID());
  const [availableLessons, setAvailableLessons] = useState<TeacherLesson[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>(() => {
    if (
      initialQuizMode === "ai" &&
      initialAiRemediationDraft &&
      initialAiRemediationDraft.questions.length > 0
    ) {
      const lessonIds = Array.from(
        new Set(
          initialAiRemediationDraft.questions
            .map((q) => q.targeted_lesson_id)
            .filter((id): id is number => typeof id === "number" && id > 0),
        ),
      );
      if (lessonIds.length > 0) return lessonIds;
    }
    return initialLessonId ? [initialLessonId] : [];
  });

  const reuseSourceClassworkId = useMemo(
    () =>
      selectedOriginalTarget?.classwork_id ??
      remediationOriginalExam?.classwork_id ??
      initialOriginalClassworkId ??
      null,
    [
      selectedOriginalTarget?.classwork_id,
      remediationOriginalExam?.classwork_id,
      initialOriginalClassworkId,
    ],
  );
  const loadedReuseClassworkIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (initialQuizMode !== "reuse") {
      loadedReuseClassworkIdRef.current = null;
      setIsLoadingReusedQuiz(false);
      setReuseQuizError("");
      return;
    }
    if (!reuseSourceClassworkId) {
      loadedReuseClassworkIdRef.current = null;
      setIsLoadingReusedQuiz(false);
      setReuseQuizError(
        "Unable to identify the original target quiz classwork to reuse questions from.",
      );
      return;
    }
    if (loadedReuseClassworkIdRef.current === reuseSourceClassworkId) {
      return;
    }

    let active = true;
    setIsLoadingReusedQuiz(true);
    setReuseQuizError("");

    apiFetch(`/api/v1/quizzes/classwork/${reuseSourceClassworkId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const detail =
            typeof body?.detail === "string"
              ? body.detail
              : "Original target classwork does not have reusable quiz questions.";
          throw new Error(detail);
        }
        return (await res.json()) as {
          questions?: Array<{
            question_text: string;
            question_type: QuizQuestionType;
            points: number;
            display_order: number;
            difficulty_level?: "EASY" | "MEDIUM" | "HARD" | null;
            explanation?: string | null;
            lesson_id?: number | null;
            options?: Array<{
              option_text: string;
              is_correct: boolean;
              option_order: number;
            }>;
          }>;
        };
      })
      .then((quizData) => {
        if (!active) return;
        const rawQuestions = [...(quizData.questions || [])].sort(
          (a, b) => (a.display_order || 0) - (b.display_order || 0),
        );
        if (rawQuestions.length === 0) {
          setReuseQuizError(
            "The original target quiz has no questions to reuse.",
          );
          return;
        }
        const normalized = normalizeIncomingQuestions(rawQuestions);
        const mappedQuestions: QuizQuestionDraft[] = normalized.map(
          (question, index) => {
            const qDraft = createEmptyQuizQuestion(
              index + 1,
              question.question_type,
            );
            const sortedOptions = [...(question.options || [])].sort(
              (a, b) => (a.option_order || 0) - (b.option_order || 0),
            );
            return {
              ...qDraft,
              question_text: question.question_text,
              question_type: question.question_type,
              points:
                question.points !== undefined && question.points !== null
                  ? String(question.points)
                  : "1",
              display_order: index + 1,
              difficulty_level: question.difficulty_level || "MEDIUM",
              explanation: question.explanation || "",
              lesson_id: question.lesson_id ?? qDraft.lesson_id,
              is_ai_generated: false,
              options: sortedOptions.map((option, optionIndex) => ({
                option_text: option.option_text,
                is_correct: Boolean(option.is_correct),
                option_order: option.option_order || optionIndex + 1,
              })),
            };
          },
        );
        const questionLessonIds = Array.from(
          new Set(
            mappedQuestions
              .map((q) => q.lesson_id)
              .filter((id): id is number => typeof id === "number" && id > 0),
          ),
        );
        if (questionLessonIds.length > 0) {
          setSelectedLessonIds((current) =>
            Array.from(new Set([...current, ...questionLessonIds])),
          );
        }
        loadedReuseClassworkIdRef.current = reuseSourceClassworkId;
        setQuizQuestions(mappedQuestions);
      })
      .catch((err) => {
        if (!active) return;
        setReuseQuizError(
          err instanceof Error
            ? err.message
            : "Unable to load questions from the original target quiz.",
        );
      })
      .finally(() => {
        if (active) setIsLoadingReusedQuiz(false);
      });

    return () => {
      active = false;
    };
  }, [initialQuizMode, reuseSourceClassworkId]);

  useEffect(() => {
    if (initialLessonId) {
      setSelectedLessonIds([initialLessonId]);
      setQuizQuestions((qs) =>
        qs.map((q) => (q.lesson_id ? q : { ...q, lesson_id: initialLessonId })),
      );
    }
  }, [initialLessonId]);

  useEffect(() => {
    if (initialClassId) {
      setSelectedClassIds([initialClassId]);
    }
  }, [initialClassId]);
  const [isLessonLoading, setIsLessonLoading] = useState(false);
  // Bulk-selection state for question-level mapping
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkLessonId, setBulkLessonId] = useState<string>("");
  const [pendingLessonRemoval, setPendingLessonRemoval] = useState<{
    lessonId: number;
    lessonTitle: string;
    mappedQuestionCount: number;
  } | null>(null);
  const [coverageMappingNotice, setCoverageMappingNotice] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const unkeyedIdCount = useMemo(
    () =>
      quizQuestions.filter(
        (q) => q.question_type === "IDENTIFICATION" && isUnkeyed(q),
      ).length,
    [quizQuestions],
  );
  const lessonMappingState = useMemo(
    () =>
      getQuizLessonMappingState(
        quizQuestions,
        selectedLessonIds,
        selectedQuestionIds,
      ),
    [quizQuestions, selectedLessonIds, selectedQuestionIds],
  );
  const quizResultsReleasePolicy = quizResultsReleasePolicyFromLegacy(
    draft.show_scores,
    quizSettings.show_correct_answers,
    quizSettings.summary_release_mode,
    quizSettings.summary_release_at,
  );
  const setQuizResultsReleasePolicy = (policy: QuizResultsReleasePolicy) => {
    const next = legacyQuizReleaseSettings(
      policy,
      quizSettings.summary_release_at,
    );
    setDraft((current) => ({
      ...current,
      show_scores: next.showResults,
    }));
    setQuizSettings((current) => ({
      ...current,
      show_correct_answers: next.showResults,
      summary_release_mode: next.mode,
      summary_release_at: next.scheduledAt,
    }));
  };
  const actionableImportNotices = useMemo(
    () => quizImportNotices.filter((notice) => notice.severity !== "info"),
    [quizImportNotices],
  );

  useEffect(() => {
    setQuizQuestions((questions) => {
      return reconcileQuestionLessonMappings(questions, selectedLessonIds);
    });
    setSelectedQuestionIds(new Set());
    setBulkLessonId("");
  }, [selectedLessonIds]);

  const selectedSubjectLoads = useMemo(() => {
    const filtered = loads.filter(
      (load) =>
        draft.subject_id && load.subject_id === Number(draft.subject_id),
    );
    const seen = new Set<number>();
    const unique: TeacherClassLoad[] = [];
    for (const load of filtered) {
      if (!seen.has(load.class_id)) {
        seen.add(load.class_id);
        unique.push(load);
      }
    }
    return unique.sort((a, b) => a.section_name.localeCompare(b.section_name));
  }, [draft.subject_id, loads]);

  const quizPointTotal = useMemo(
    () =>
      quizQuestions.reduce((total, question) => {
        const points = Number(question.points);
        return total + (Number.isFinite(points) ? points : 0);
      }, 0),
    [quizQuestions],
  );

  const useManualQuizBuilder = () => {
    setCreateError("");
    setQuizImportWarnings([]);
    setQuizImportNotices([]);
    setQuizImportSummary(null);
    setCreateStep("details");
  };

  const importQuizFile = async (file: File | null) => {
    if (!file) return;
    setIsImportingQuiz(true);
    setCreateError("");
    setQuizImportWarnings([]);
    setQuizImportNotices([]);
    setQuizImportSummary(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await apiFetch("/api/v1/quizzes/import-preview", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to import quiz file.");
      }
      const preview = (await response.json()) as QuizImportPreview;
      const normalizedQuestions = normalizeIncomingQuestions(
        preview.questions || [],
      );
      const importedQuestions = normalizedQuestions.map((question, index) => {
        const qDraft = createEmptyQuizQuestion(
          index + 1,
          question.question_type,
        );
        return {
          ...qDraft,
          question_text: question.question_text,
          question_type: question.question_type,
          points: String(question.points || 1),
          display_order: index + 1,
          difficulty_level: question.difficulty_level || "MEDIUM",
          explanation: question.explanation || "",
          options: question.options.map((option, optionIndex) => ({
            option_text: option.option_text,
            is_correct: option.is_correct,
            option_order: optionIndex + 1,
          })),
        };
      });

      setQuizQuestions(reconcileQuestionLessonMappings(
        importedQuestions.length > 0
          ? importedQuestions
          : [createEmptyQuizQuestion(1)],
        selectedLessonIds,
      ));
      setQuizImportWarnings(preview.warnings);
      setQuizImportNotices(preview.notices || []);
      setQuizImportSummary(preview.summary || null);
      setDraft((current) => ({
        ...current,
        title: current.title || preview.title || "",
        instructions: current.instructions,
        total_points: remediationOriginalExam
          ? String(remediationOriginalExam.total_points)
          : isGradedWWPT && selectedOriginalTarget
            ? String(selectedOriginalTarget.max_points)
            : String(
              importedQuestions.reduce(
                (sum, q) => sum + Number(q.points || 0),
                0,
              ) || current.total_points,
            ),
      }));
      setCreateStep("details");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to import quiz file.";
      setCreateError(message);
      toast.error({
        title: "Unable to import quiz file",
        description: message,
      });
    } finally {
      setIsImportingQuiz(false);
    }
  };

  const updateQuizQuestion = (
    id: string,
    patch: Partial<QuizQuestionDraft>,
  ) => {
    setQuizQuestions((current) =>
      current.map((question) => {
        if (question.id !== id) return question;
        const next = { ...question, ...patch };
        if (
          patch.question_type &&
          patch.question_type !== question.question_type
        ) {
          next.options =
            patch.question_type === "MULTIPLE_CHOICE"
              ? [
                { option_text: "", is_correct: true, option_order: 1 },
                { option_text: "", is_correct: false, option_order: 2 },
              ]
              : [];
        }
        return next;
      }),
    );
  };

  const addQuizQuestion = (questionType: QuizQuestionType) => {
    setQuizQuestions((current) => [
      ...current,
      {
        ...createEmptyQuizQuestion(current.length + 1, questionType),
        lesson_id:
          initialLessonId ||
          (selectedLessonIds.length === 1 ? selectedLessonIds[0] : null),
      },
    ]);
  };

  const removeQuizQuestion = (id: string) => {
    setQuizQuestions((current) =>
      current.length === 1
        ? current
        : current
          .filter((question) => question.id !== id)
          .map((question, index) => ({
            ...question,
            display_order: index + 1,
          })),
    );
  };

  const updateQuizOption = (
    questionId: string,
    optionIndex: number,
    optionText: string,
  ) => {
    setQuizQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? {
            ...question,
            options: question.options.map((option, index) =>
              index === optionIndex
                ? { ...option, option_text: optionText }
                : option,
            ),
          }
          : question,
      ),
    );
  };

  const markCorrectOption = (questionId: string, optionIndex: number) => {
    setQuizQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? {
            ...question,
            options: question.options.map((option, index) => ({
              ...option,
              is_correct: index === optionIndex,
            })),
          }
          : question,
      ),
    );
  };

  const addQuizOption = (questionId: string, isCorrect = false) => {
    setQuizQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? {
            ...question,
            options: [
              ...question.options,
              {
                option_text: "",
                is_correct:
                  question.question_type === "SHORT_ANSWER"
                    ? true
                    : isCorrect,
                option_order: question.options.length + 1,
              },
            ],
          }
          : question,
      ),
    );
  };

  const removeQuizOption = (questionId: string, optionIndex: number) => {
    setQuizQuestions((current) =>
      current.map((question) => {
        if (question.id !== questionId) return question;
        if (
          question.question_type === "MULTIPLE_CHOICE" &&
          question.options.length <= 2
        ) {
          return question;
        }
        const nextOptions = question.options
          .filter((_, index) => index !== optionIndex)
          .map((option, index) => ({ ...option, option_order: index + 1 }));
        if (
          question.question_type === "MULTIPLE_CHOICE" &&
          !nextOptions.some((option) => option.is_correct) &&
          nextOptions.length > 0
        ) {
          nextOptions[0] = { ...nextOptions[0], is_correct: true };
        }
        return { ...question, options: nextOptions };
      }),
    );
  };

  const toggleClass = (classId: number) => {
    if (remediationTarget) return;
    if (createError === "Select at least one section to assign this quiz.")
      setCreateError("");
    setSelectedClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const toggleLesson = (lessonId: number) => {
    if (isLessonLocked) return;
    if (createError === "Select the lesson where this quiz should appear.")
      setCreateError("");
    if (selectedLessonIds.includes(lessonId)) {
      const mappedQuestionCount = quizQuestions.filter(
        (question) => question.lesson_id === lessonId,
      ).length;
      if (mappedQuestionCount > 0) {
        const lessonTitle =
          availableLessons.find((lesson) => lesson.lesson_id === lessonId)
            ?.title || "this lesson";
        setPendingLessonRemoval({
          lessonId,
          lessonTitle,
          mappedQuestionCount,
        });
        return;
      }
      setSelectedLessonIds((current) =>
        current.filter((id) => id !== lessonId),
      );
      return;
    }
    setSelectedLessonIds((current) => [...current, lessonId]);
  };

  const confirmLessonRemoval = () => {
    if (!pendingLessonRemoval) return;
    const lessonId = pendingLessonRemoval.lessonId;
    setSelectedLessonIds((current) =>
      current.filter((id) => id !== lessonId),
    );
    setQuizQuestions((questions) =>
      clearQuestionMappingsForLesson(questions, lessonId),
    );
    setSelectedQuestionIds(new Set());
    setBulkLessonId("");
    setPendingLessonRemoval(null);
  };

  const validateDetails = () => {
    const linksError = validateReferenceLinks(referenceLinks);
    if (linksError) return linksError;
    if (!draft.subject_id) return "Choose a subject.";
    if (selectedLessonIds.length === 0) {
      return "Select the lesson where this quiz should appear.";
    }
    if (!draft.title.trim()) return "Topic title is required.";
    if (
      (draft.classwork_category === "QUARTERLY_ASSESSMENT" ||
        draft.classwork_category === "EXAMS") &&
      !draft.exam_subtype
    )
      return "Choose an Examination sub-type explicitly.";
    if (
      remediationGradeTreatment === "EXAMINATION" &&
      (!remediationOriginalExam ||
        draft.exam_subtype !== remediationOriginalExam.subtype ||
        Number(draft.total_points) !== remediationOriginalExam.total_points ||
        Number(draft.max_attempts) !== 1)
    )
      return "Remedial Examination must match the original subtype and maximum points, with one quiz attempt.";
    if (isGradedWWPT) {
      if (!selectedOriginalTarget)
        return "Select the original classwork to link this remediation activity.";
      if (Number(draft.total_points) !== selectedOriginalTarget.max_points) {
        return `Remedial quiz points (${Number(draft.total_points)}) must equal the original classwork maximum points (${selectedOriginalTarget.max_points}).`;
      }
    }
    const points = Number(draft.total_points);
    if (!Number.isFinite(points) || points <= 0) {
      return "Total points must be greater than zero.";
    }
    const attempts = Number(draft.max_attempts);
    if (!Number.isInteger(attempts) || attempts <= 0) {
      return "Allowed attempts must be a positive whole number.";
    }
    return "";
  };

  const validateQuizBuilder = () => {
    if (quizQuestions.length === 0) return "Add at least one quiz question.";

    const totalPoints = Number(draft.total_points);
    if (!Number.isFinite(totalPoints) || totalPoints <= 0) {
      return "Quiz total points must be greater than zero.";
    }
    if (Math.abs(quizPointTotal - totalPoints) > 0.001) {
      return `Question points must total ${totalPoints} points. Current total is ${quizPointTotal}.`;
    }

    const duration = quizSettings.duration_minutes
      ? Number(quizSettings.duration_minutes)
      : null;
    if (duration !== null && (!Number.isInteger(duration) || duration <= 0)) {
      return "Quiz duration must be a positive whole number.";
    }

    const attempts = Number(quizSettings.max_attempts || draft.max_attempts);
    if (!Number.isInteger(attempts) || attempts <= 0) {
      return "Allowed quiz attempts must be a positive whole number.";
    }

    for (const [index, question] of quizQuestions.entries()) {
      const questionNumber = index + 1;
      if (!question.question_text.trim()) {
        return `Question ${questionNumber} text is required.`;
      }
      const points = Number(question.points);
      if (!Number.isFinite(points) || points <= 0) {
        return `Question ${questionNumber} points must be greater than zero.`;
      }
      if (question.question_type === "MULTIPLE_CHOICE") {
        const filledOptions = question.options.filter((option) =>
          option.option_text.trim(),
        );
        const correctOptions = question.options.filter(
          (option) => option.is_correct,
        );
        if (question.options.length < 2 || filledOptions.length < 2) {
          return `Question ${questionNumber} needs at least two answer choices.`;
        }
        if (correctOptions.length !== 1) {
          return `Question ${questionNumber} needs exactly one correct answer.`;
        }
      }
    }

    if (draft.is_published) {
      const unkeyedIdQuestions = quizQuestions.filter(
        (q) => q.question_type === "IDENTIFICATION" && isUnkeyed(q),
      );
      if (unkeyedIdQuestions.length > 0) {
        return `Cannot publish: ${unkeyedIdQuestions.length} Identification question(s) have no answer key. Add at least one acceptable answer before publishing, or save as draft.`;
      }
    }

    return "";
  };

  const goToAssignStep = () => {
    const detailsValError = validateDetails();
    if (detailsValError) {
      setCreateError(detailsValError);
      toast.error({ title: detailsValError });
      setCreateStep("details");
      return;
    }
    const quizValError = validateQuizBuilder();
    if (quizValError) {
      setCreateError(quizValError);
      toast.error({ title: quizValError });
      setCreateStep("quiz");
      return;
    }
    setSelectedClassIds((current) => {
      const validIds = new Set(
        selectedSubjectLoads.map((load) => load.class_id),
      );
      return current.filter((id) => validIds.has(id));
    });
    setSelectedQuestionIds(new Set());
    setBulkLessonId("");
    setCreateError("");
    setCreateStep("assign");
  };

  const handleExportQuiz = async (format: "pdf" | "docx") => {
    if (quizQuestions.length === 0) return;
    setIsExporting(format);
    try {
      const activeSubjectName =
        subjects.find((s) => String(s.id) === String(draft.subject_id))?.name ||
        aiLinkedSubjectName ||
        "Subject";
      if (format === "pdf") {
        const result = await exportQuizPdf(
          quizQuestions,
          draft.title || "Quiz",
          activeSubjectName,
          includeExportAnswerKey,
        );
        if (result?.warnings?.length) {
          const notice = `Export notice: ${result.warnings.join(" ")}`;
          setCreateError(notice);
          toast.warning({ title: notice });
        }
      } else {
        await exportQuizDocx(
          quizQuestions,
          draft.title || "Quiz",
          activeSubjectName,
          includeExportAnswerKey,
        );
      }
    } catch (err) {
      console.error("Export error:", err);
      const message =
        err instanceof Error ? err.message : "Failed to export questionnaire.";
      setCreateError(message);
      toast.error({
        title: "Failed to export questionnaire",
        description: message,
      });
    } finally {
      setIsExporting(null);
    }
  };

  useEffect(() => {
    if (!draft.subject_id) {
      setAvailableLessons([]);
      setSelectedLessonIds([]);
      return;
    }

    let isActive = true;
    setIsLessonLoading(true);

    const loadSubjectLessons = async () => {
      try {
        const subjectIdNum = Number(draft.subject_id);
        const relatedLoads = loads.filter(
          (load) => load.subject_id === subjectIdNum,
        );

        const fetchPromises: Promise<TeacherLesson[]>[] = [
          apiFetch("/api/v1/lessons/my-lessons")
            .then(async (res) =>
              res.ok ? ((await res.json()) as TeacherLesson[]) : [],
            )
            .then((list) =>
              list.filter(
                (l) => Number(l.subject_id) === subjectIdNum && !l.is_archived,
              ),
            )
            .catch(() => []),
          ...relatedLoads.map(async (load) => {
            try {
              const res = await apiFetch(
                `/api/v1/lessons/my-class/${load.class_id}/subject/${draft.subject_id}`,
              );
              return res.ok ? ((await res.json()) as TeacherLesson[]) : [];
            } catch {
              return [];
            }
          }),
        ];

        const results = await Promise.all(fetchPromises);
        if (!isActive) return;

        const uniqueLessons = new Map<number, TeacherLesson>();
        if (
          contextLesson &&
          !contextLesson.is_archived &&
          Number(contextLesson.subject_id) === subjectIdNum
        ) {
          uniqueLessons.set(contextLesson.lesson_id, contextLesson);
        }
        results.flat().forEach((lesson) => {
          if (lesson && !lesson.is_archived) {
            uniqueLessons.set(lesson.lesson_id, lesson);
          }
        });

        const lessons = [...uniqueLessons.values()].sort(
          (a, b) =>
            (a.order_index ?? 0) - (b.order_index ?? 0) ||
            a.title.localeCompare(b.title),
        );

        setAvailableLessons(lessons);
        setSelectedLessonIds((current) => {
          let next = remediationFocus
            ? Array.from(
                new Set([...current, ...remediationFocus.lesson_ids]),
              ).filter((id) => uniqueLessons.has(id))
            : current.filter((id) => uniqueLessons.has(id));
          if (
            next.length === 0 &&
            initialLessonId &&
            uniqueLessons.has(initialLessonId)
          ) {
            next = [initialLessonId];
          }
          const nextSet = new Set(next);
          setQuizQuestions((questions) => {
            const affectedCount = questions.filter(
              (question) =>
                question.lesson_id !== null && !nextSet.has(question.lesson_id),
            ).length;
            if (affectedCount > 0) {
              setCoverageMappingNotice(
                `${affectedCount} question mapping${affectedCount === 1 ? " was" : "s were"} cleared because the lesson is not available in every selected section.`,
              );
            }
            return questions.map((question) =>
              question.lesson_id !== null && !nextSet.has(question.lesson_id)
                ? { ...question, lesson_id: null }
                : question,
            );
          });
          return next;
        });
        setCreateError("");
      } catch (err) {
        if (!isActive) return;
        setAvailableLessons([]);
        setSelectedLessonIds([]);
        setCreateError(
          err instanceof Error
            ? err.message
            : "Unable to load lessons for selected subject.",
        );
      } finally {
        if (isActive) {
          setIsLessonLoading(false);
        }
      }
    };

    void loadSubjectLessons();
    return () => {
      isActive = false;
    };
  }, [
    draft.subject_id,
    loads,
    contextLesson,
    initialLessonId,
    remediationFocus,
  ]);

  const buildQuizPayload = () => {
    const releaseSettings = legacyQuizReleaseSettings(
      quizResultsReleasePolicy,
      quizSettings.summary_release_at,
    );
    return {
      duration_minutes: quizSettings.duration_minutes
        ? Number(quizSettings.duration_minutes)
        : null,
      status: draft.is_published ? "PUBLISHED" : "DRAFT",
      settings: {
        is_shuffle_questions: quizSettings.is_shuffle_questions,
        is_shuffle_options: quizSettings.is_shuffle_options,
        enable_per_question_scoring: quizSettings.enable_per_question_scoring,
        enable_per_question_time_limits:
          quizSettings.enable_per_question_time_limits,
        max_attempts: Number(quizSettings.max_attempts || draft.max_attempts),
        show_correct_answers: releaseSettings.showResults,
        summary_release_mode: releaseSettings.mode,
        summary_release_at:
          quizResultsReleasePolicy === "SCHEDULED" &&
            releaseSettings.scheduledAt
            ? new Date(releaseSettings.scheduledAt).toISOString()
            : null,
      },
      questions: quizQuestions.map((question, index) => ({
        question_text: question.question_text.trim(),
        question_type: question.question_type,
        points: Number(question.points),
        display_order: index + 1,
        difficulty_level: question.difficulty_level,
        explanation: question.explanation.trim() || null,
        lesson_id: sanitizeQuestionLessonId(
          question.lesson_id,
          selectedLessonIds,
        ),
        is_ai_generated: Boolean(question.is_ai_generated),
        options:
          question.question_type === "MULTIPLE_CHOICE"
            ? question.options.map((option, optionIndex) => ({
              option_text: option.option_text.trim(),
              is_correct: option.is_correct,
              option_order: optionIndex + 1,
            }))
            : question.question_type === "IDENTIFICATION"
              ? question.options
                .filter((opt) => opt.option_text.trim().length > 0)
                .map((option, optionIndex) => ({
                  option_text: option.option_text.trim(),
                  is_correct: true,
                  option_order: optionIndex + 1,
                }))
              : [],
      })),
    };
  };

  const handleCreateQuiz = async () => {
    const detailsValError = validateDetails();
    if (detailsValError) {
      setCreateError(detailsValError);
      toast.error({ title: detailsValError });
      setCreateStep("details");
      return;
    }
    const quizValError = validateQuizBuilder();
    if (quizValError) {
      setCreateError(quizValError);
      toast.error({ title: quizValError });
      setCreateStep("quiz");
      return;
    }
    if (selectedClassIds.length === 0) {
      const msg = "Select at least one section to assign this quiz.";
      setCreateError(msg);
      toast.error({ title: msg });
      return;
    }
    if (selectedLessonIds.length === 0) {
      const msg = "Select the lesson where this quiz should appear.";
      setCreateError(msg);
      toast.error({ title: msg });
      return;
    }
    if (draft.is_published && lessonMappingState.unmappedCount > 0) {
      const count = lessonMappingState.unmappedCount;
      const msg = `${count} question${count === 1 ? " still needs" : "s still need"} lesson mapping.`;
      setCreateError(msg);
      toast.error({ title: msg });
      return;
    }
    if (
      remediationTarget &&
      Number(quizSettings.max_attempts || draft.max_attempts) > 3
    ) {
      const msg = "Study Support quizzes allow up to 3 attempts.";
      setCreateError(msg);
      toast.error({ title: msg });
      return;
    }
    if (remediationTarget && !draft.due_date) {
      const msg = "A due date is required for a Study Support quiz.";
      setCreateError(msg);
      toast.error({ title: msg });
      return;
    }
    if (
      quizResultsReleasePolicy === "SCHEDULED" &&
      !quizSettings.summary_release_at
    ) {
      const msg = "Select a quiz results release date and time.";
      setCreateError(msg);
      return;
    }
    if (
      quizResultsReleasePolicy === "AFTER_DUE_DATE" &&
      !draft.due_date
    ) {
      const msg =
        "A due date is required when Quiz Results Release is set to 'After the due date'. Please specify a due date below.";
      setCreateError(msg);
      toast.error({ title: msg });
      return;
    }

    setIsCreating(true);
    setCreateError("");
    try {
      const releaseSettings = legacyQuizReleaseSettings(
        quizResultsReleasePolicy,
        quizSettings.summary_release_at,
      );
      const formData = new FormData();
      formData.append("title", draft.title.trim());
      formData.append("description", draft.description.trim());
      formData.append("instructions", draft.instructions.trim());
      formData.append("classwork_type", selectedType);
      if (draft.classwork_category) {
        formData.append("classwork_category", draft.classwork_category);
      }
      if (draft.exam_subtype) {
        formData.append("exam_subtype", draft.exam_subtype);
      }
      formData.append("total_points", String(Number(draft.total_points)));
      formData.append(
        "is_published",
        String(draftOnly ? false : draft.is_published),
      );
      formData.append("subject_id", String(draft.subject_id));
      formData.append("show_scores", String(releaseSettings.showResults));
      formData.append(
        "auto_ai_feedback_enabled",
        String(!remediationTarget && draft.auto_ai_feedback_enabled),
      );
      formData.append("class_ids", JSON.stringify(selectedClassIds));
      if (remediationTarget) {
        formData.append(
          "intervention_id",
          String(remediationTarget.intervention_id),
        );
        formData.append("remediation_request_id", remediationRequestId);
        if (
          remediationOriginalExam &&
          remediationGradeTreatment === "EXAMINATION"
        )
          formData.append(
            "original_exam_assignment_id",
            String(remediationOriginalExam.assignment_id),
          );
        if (selectedOriginalTarget && isGradedWWPT) {
          formData.append(
            "original_classwork_assignment_id",
            String(selectedOriginalTarget.assignment_id),
          );
        }
      }
      formData.append("lesson_ids", JSON.stringify(selectedLessonIds));
      if (draft.due_date) {
        formData.append("due_date", new Date(draft.due_date).toISOString());
      }
      formData.append(
        "allow_late_submissions",
        String(draft.allow_late_submissions),
      );
      if (draft.lock_date) {
        formData.append("lock_date", new Date(draft.lock_date).toISOString());
      }
      formData.append("max_attempts", String(Number(draft.max_attempts)));
      formData.append("quiz_payload", JSON.stringify(buildQuizPayload()));
      formData.append(
        "reference_links",
        JSON.stringify(
          referenceLinks.map((link) => ({
            url: link.url.trim(),
            title: link.title.trim() || null,
          })),
        ),
      );

      const selectedLoad = loads.find(
        (l) =>
          l.subject_id === Number(draft.subject_id) &&
          selectedClassIds.includes(l.class_id),
      );
      if (selectedLoad?.academic_period_id) {
        formData.append(
          "academic_period_id",
          String(selectedLoad.academic_period_id),
        );
      }

      const createResponse = await apiFetch(
        "/api/v1/classwork-assignments/with-assignments",
        {
          method: "POST",
          body: formData,
        },
      );

      if (!createResponse.ok) {
        const body = await createResponse.json().catch(() => ({}));
        // FastAPI 422 returns { detail: [{loc, msg, type}] }
        const detail = body.detail;
        if (Array.isArray(detail)) {
          const msgs = detail
            .map(
              (e: { loc?: string[]; msg?: string }) =>
                `${(e.loc || []).slice(1).join(".")}: ${e.msg}`,
            )
            .join("; ");
          throw new Error(msgs || "Validation error");
        }
        throw new Error(
          typeof detail === "string" ? detail : "Unable to create quiz.",
        );
      }

      await createResponse.json();

      toast.success({ title: "Quiz created successfully." });
      onSuccess();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to create quiz.";
      setCreateError(message);
      toast.error({ title: "Unable to create quiz", description: message });
    } finally {
      setIsCreating(false);
    }
  };

  const createStepNumber =
    createStep === "details" ? 1 : createStep === "quiz" ? 2 : 3;
  const createStepTotal = 3;

  return (
    <>
      {!isAIModalOpen && (
        <Dialog.Content size={createStep === "details" ? "lg" : "2xl"}>
          <Dialog.Header position="fixed" asChild>
            <div className="flex w-full items-center justify-between gap-3">
              <Text as="h5" className="min-w-0 font-sans text-xl font-bold">
                {createStep === "quiz-source"
                  ? "Choose Quiz Creation Method"
                  : "Create Quiz"}
              </Text>
              <div className="flex items-center gap-2">
                {createStep !== "quiz-source" && (
                  <p className="shrink-0 whitespace-nowrap text-sm font-semibold sm:text-base">
                    Step {createStepNumber} of {createStepTotal}
                  </p>
                )}
              </div>
            </div>
          </Dialog.Header>

          <section className="flex flex-col gap-4 p-5">
            {createStep === "quiz-source" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <DialogueSelect
                  className="shadow-none hover:shadow-none"
                  title="Create manually"
                  description="Build multiple-choice and short-answer questions yourself."
                  icon={Pencil}
                  disabled={isCreating || isImportingQuiz}
                  onClick={useManualQuizBuilder}
                />

                <DialogueSelect
                  className="shadow-none hover:shadow-none"
                  title="Generate with AI"
                  description="Generate structured questions from lessons and reading materials automatically with AI."
                  icon={Sparkles}
                  disabled={isCreating || isImportingQuiz}
                  onClick={() => {
                    setQuizImportWarnings([]);
                    setQuizImportNotices([]);
                    setQuizImportSummary(null);
                    setIsAIModalOpen(true);
                  }}
                />

                <DialogueSelect
                  className="shadow-none hover:shadow-none"
                  title={
                    isImportingQuiz ? "Importing quiz..." : "Import from file"
                  }
                  description="Upload a structured quiz file (TXT, CSV, MD, PDF, DOCX) to review and edit."
                  icon={FileText}
                  disabled={isCreating || isImportingQuiz}
                  onClick={() => quizFileInputRef.current?.click()}
                />
                <input
                  ref={quizFileInputRef}
                  type="file"
                  accept=".txt,.md,.csv,.pdf,.doc,.docx"
                  disabled={isCreating || isImportingQuiz}
                  className="hidden"
                  onChange={(event) => {
                    void importQuizFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </div>
            )}

            {createStep === "details" && (
              <div className="space-y-4">
                {isLoadingReusedQuiz && (
                  <div className="flex items-center gap-2 rounded border-2 border-border bg-muted/30 p-3 text-sm text-muted-foreground" role="status">
                    <Loader2 className="size-4 animate-spin" />
                    Loading original target quiz questions...
                  </div>
                )}
                {!isLoadingReusedQuiz && reuseQuizError && (
                  <Alert status="error" className="p-3 text-xs">
                    <Alert.Title className="font-bold">
                      Unable to reuse original quiz questions
                    </Alert.Title>
                    <Alert.Description className="mt-1 text-inherit">
                      {reuseQuizError}
                    </Alert.Description>
                  </Alert>
                )}
                {(aiLinkedSubjectName ||
                  (aiLinkedLessonTitles && aiLinkedLessonTitles.length > 0) ||
                  aiPromptScope) && (
                    <div className="rounded border-2 border-black bg-[#F6E9B2] p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-black">
                          <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                          <span>AI Generation & Curriculum Context</span>
                        </div>
                        <span className="text-[10px] font-extrabold uppercase bg-black text-white px-2 py-0.5">
                          Auto-Linked
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="flex items-start gap-1.5 bg-white/80 border border-black/20 p-2">
                          <span className="font-bold text-black/70 shrink-0">
                            Subject:
                          </span>
                          <span className="font-extrabold text-black truncate">
                            {aiLinkedSubjectName ||
                              subjects.find(
                                (s) => String(s.id) === String(draft.subject_id),
                              )?.name ||
                              "Subject"}
                          </span>
                        </div>
                        <div className="flex items-start gap-1.5 bg-white/80 border border-black/20 p-2">
                          <span className="font-bold text-black/70 shrink-0">
                            Linked Lessons:
                          </span>
                          <span className="font-extrabold text-black">
                            {aiLinkedLessonTitles &&
                              aiLinkedLessonTitles.length > 0
                              ? aiLinkedLessonTitles.join(", ")
                              : `${selectedLessonIds.length} lesson(s) selected`}
                          </span>
                        </div>
                      </div>
                      {aiPromptScope && (
                        <div className="text-xs bg-white/80 border border-black/20 p-2 flex items-start gap-1.5">
                          <span className="font-bold text-black/70 shrink-0">
                            Custom Scope:
                          </span>
                          <span className="font-semibold text-black/90">
                            "{aiPromptScope}"
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                {remediationDraft && remediationTarget && (
                  <RemediationTeacherGuidanceBanner
                    remediationTarget={remediationTarget}
                    remediationFocus={remediationFocus}
                    remediationGradeTreatment={remediationGradeTreatment}
                    remediationOriginalExam={remediationOriginalExam}
                    selectedOriginalTarget={selectedOriginalTarget}
                    remediationReferences={remediationReferences}
                    className="mb-1"
                  />
                )}
                <Field label="Subject" isRequired>
                  <Select
                    value={draft.subject_id}
                    onValueChange={(val) => {
                      setDraft((current) => ({
                        ...current,
                        subject_id: val,
                      }));
                      if (val && createError === "Choose a subject.")
                        setCreateError("");
                      setSelectedClassIds([]);
                      setSelectedLessonIds([]);
                    }}
                    disabled={isCreating || isSubjectLocked}
                  >
                    <Select.Trigger
                      id="quiz-subject"
                      aria-invalid={createError === "Choose a subject."}
                      aria-describedby={
                        createError === "Choose a subject."
                          ? "quiz-subject-error"
                          : undefined
                      }
                      className="w-full shadow-none aria-[invalid=true]:border-destructive"
                    >
                      <Select.Value placeholder="Choose subject" />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black rounded bg-white shadow-none">
                      <Select.Group>
                        {subjects.map((subject) => (
                          <Select.Item
                            key={subject.id}
                            value={String(subject.id)}
                          >
                            {subject.name}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                  {createError === "Choose a subject." && (
                    <FormMessage id="quiz-subject-error">
                      {createError}
                    </FormMessage>
                  )}
                </Field>

                <Field label="Link under lesson (Coverage)" isRequired>
                  <p className="text-xs text-gray-500 -mt-0.5 mb-1.5 font-normal">
                    Links this quiz to the lesson and its associated reading
                    materials for student coverage.
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        id="quiz-lesson-select"
                        disabled={
                          isCreating ||
                          !draft.subject_id ||
                          isLessonLoading ||
                          availableLessons.length === 0 ||
                          isLessonLocked
                        }
                        aria-invalid={
                          createError ===
                          "Select the lesson where this quiz should appear."
                        }
                        aria-describedby={
                          createError ===
                            "Select the lesson where this quiz should appear."
                            ? "quiz-lesson-error"
                            : undefined
                        }
                        className={cn(
                          "flex h-10 w-full items-center justify-between rounded! border-2 border-black bg-white px-3 py-2 text-left font-sans text-sm text-foreground shadow-none outline-none focus:border-black disabled:cursor-not-allowed disabled:opacity-50",
                          createError ===
                          "Select the lesson where this quiz should appear." &&
                          "border-destructive",
                        )}
                      >
                        <span className="truncate">
                          {!draft.subject_id
                            ? "Select a subject first"
                            : isLessonLoading
                              ? "Loading lessons..."
                              : availableLessons.length === 0
                                ? "No lessons found for this subject"
                                : selectedLessonIds.length === 0
                                  ? "Choose lesson(s)"
                                  : selectedLessonIds.length === 1
                                    ? availableLessons.find(
                                      (l) =>
                                        l.lesson_id === selectedLessonIds[0],
                                    )?.title || "1 lesson selected"
                                    : `${selectedLessonIds.length} lessons selected`}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="z-[1000] w-[var(--radix-dropdown-menu-trigger-width)] max-h-60 overflow-y-auto rounded border-2 border-black bg-white p-1 shadow-none"
                    >
                      {availableLessons.length > 1 && (
                        <div className="flex items-center justify-between border-b border-gray-200 px-2 py-1 text-xs">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (!isLessonLocked) {
                                setSelectedLessonIds(
                                  availableLessons.map((l) => l.lesson_id),
                                );
                                setCreateError("");
                              }
                            }}
                            className="font-bold text-primary hover:underline cursor-pointer"
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (!isLessonLocked) setSelectedLessonIds([]);
                            }}
                            className="font-bold text-muted-foreground hover:underline cursor-pointer"
                          >
                            Clear All
                          </button>
                        </div>
                      )}
                      {availableLessons.map((lesson) => {
                        const isSelected = selectedLessonIds.includes(
                          lesson.lesson_id,
                        );
                        return (
                          <DropdownMenuCheckboxItem
                            key={lesson.lesson_id}
                            checked={isSelected}
                            onSelect={(event) => {
                              event.preventDefault();
                              toggleLesson(lesson.lesson_id);
                            }}
                            className="flex cursor-pointer items-center justify-between gap-2 rounded px-3 py-2 text-sm font-medium hover:bg-muted focus:bg-muted"
                          >
                            <span className="truncate">{lesson.title}</span>
                            {!lesson.is_published && (
                              <span className="ml-1 text-[10px] text-muted-foreground font-normal">
                                (Draft)
                              </span>
                            )}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {selectedLessonIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {selectedLessonIds.map((id) => {
                        const lesson = availableLessons.find(
                          (l) => l.lesson_id === id,
                        );
                        if (!lesson) return null;
                        return (
                          <Badge
                            key={id}
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1.5 border-2 border-black bg-muted/40 px-2 py-0.5 text-xs font-bold"
                          >
                            <span className="max-w-[220px] truncate">
                              {lesson.title}
                            </span>
                            {!isLessonLocked && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleLesson(id);
                                }}
                                className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 cursor-pointer"
                                aria-label={`Remove ${lesson.title}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  )}

                  {(() => {
                    const selectedLessonsWithCompetency =
                      availableLessons.filter(
                        (l) =>
                          selectedLessonIds.includes(l.lesson_id) &&
                          (l.competency_statement || l.competency_code),
                      );
                    if (selectedLessonsWithCompetency.length === 0) return null;
                    return (
                      <div className="flex flex-col gap-1 pt-1">
                        <span className="text-sm font-regular text-foreground">
                          Learning Competenc
                          {selectedLessonsWithCompetency.length > 1
                            ? "ies"
                            : "y"}
                        </span>
                        {selectedLessonsWithCompetency.map((lesson) => (
                          <div
                            key={lesson.lesson_id}
                            className="w-full rounded! border-2 border-black bg-muted/40 px-3 py-2 text-xs text-foreground"
                          >
                            {selectedLessonsWithCompetency.length > 1 && (
                              <span className="mr-1.5 font-bold">
                                {lesson.title}:
                              </span>
                            )}
                            {lesson.competency_statement}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {pendingLessonRemoval && (
                    <Alert status="warning" className="mt-3 p-3 text-xs">
                      <Alert.Title className="font-bold">
                        Remove {pendingLessonRemoval.lessonTitle} from coverage?
                      </Alert.Title>
                      <Alert.Description className="mt-1 text-inherit">
                        {pendingLessonRemoval.mappedQuestionCount} question
                        {pendingLessonRemoval.mappedQuestionCount === 1
                          ? " is"
                          : "s are"}{" "}
                        mapped to this lesson. Removing it will{" "}
                        {selectedLessonIds.length === 2
                          ? "move those questions to the one remaining linked lesson"
                          : "clear only those mappings"}
                        ; other lesson mappings will be kept.
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setPendingLessonRemoval(null)}
                          >
                            Keep lesson
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={confirmLessonRemoval}
                          >
                            Remove and unmap
                          </Button>
                        </div>
                      </Alert.Description>
                    </Alert>
                  )}

                  {createError ===
                    "Select the lesson where this quiz should appear." && (
                      <FormMessage id="quiz-lesson-error">
                        {createError}
                      </FormMessage>
                    )}
                </Field>

                <Field label="Topic Title" isRequired={true}>
                  <Input
                    value={draft.title}
                    onChange={(event) => {
                      if (
                        event.target.value.trim() &&
                        createError === "Topic title is required."
                      )
                        setCreateError("");
                      setDraft((current) => ({
                        ...current,
                        title: event.target.value,
                      }));
                    }}
                    aria-invalid={createError === "Topic title is required."}
                    aria-describedby={
                      createError === "Topic title is required."
                        ? "quiz-topic-title-error"
                        : undefined
                    }
                    disabled={isCreating}
                    placeholder="Introduction to Programming Quiz"
                    className="w-full shadow-none"
                  />
                  {createError === "Topic title is required." && (
                    <FormMessage id="quiz-topic-title-error">
                      {createError}
                    </FormMessage>
                  )}
                </Field>

                {contextLesson && (
                  <>
                    <Field label="Lesson">
                      <div className="w-full rounded border-2 border-black bg-muted/40 px-3 py-2 text-sm font-bold text-foreground">
                        {contextLesson.title}
                      </div>
                    </Field>
                    {(contextLesson.competency_statement ||
                      contextLesson.competency_code) && (
                        <Field label="Learning Competency">
                          <div className="w-full rounded border-2 border-black bg-muted/40 px-3 py-2 text-sm text-foreground">
                            {contextLesson.competency_code
                              ? `[${contextLesson.competency_code}] `
                              : ""}
                            {contextLesson.competency_statement}
                          </div>
                        </Field>
                      )}
                  </>
                )}

                <Field label="Instructions">
                  {remediationDraft && (
                    <p className="text-xs text-muted-foreground -mt-1 mb-1">
                      Student Instructions (Visible to student): Provide
                      guidance or instructions for{" "}
                      {remediationTarget?.student_name ?? "the student"}.
                    </p>
                  )}
                  <textarea
                    value={draft.instructions}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        instructions: event.target.value,
                      }))
                    }
                    disabled={isCreating}
                    placeholder="What students need to read, answer, or submit"
                    className="px-4 py-2 w-full rounded! border-2 border-black bg-white shadow-none transition focus:outline-hidden focus:shadow-none min-h-20 text-sm"
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-3">
                  {remediationDraft &&
                    remediationGradeTreatment === "PRACTICE_ONLY" ? (
                    <p className="rounded border border-green-700 bg-green-50 p-3 text-sm font-semibold">
                      Practice only · No official grading component. Score and
                      completion remain visible in Intervention progress.
                    </p>
                  ) : (
                    <Field label="Grading Component">
                      <Select
                        value={draft.classwork_category}
                        onValueChange={(val) =>
                          setDraft((current) => ({
                            ...current,
                            classwork_category: val,
                          }))
                        }
                        disabled={isCreating || remediationDraft}
                      >
                        <Select.Trigger className="w-full shadow-none">
                          <Select.Value placeholder="Select Category" />
                        </Select.Trigger>
                        <Select.Content className="border-2 border-black rounded bg-white shadow-none">
                          <Select.Group>
                            <Select.Item value="WRITTEN_WORK">
                              Written Works
                            </Select.Item>
                            <Select.Item value="PERFORMANCE_TASK">
                              Performance Task
                            </Select.Item>
                            {(!remediationDraft ||
                              remediationGradeTreatment === "EXAMINATION") && (
                                <Select.Item value="QUARTERLY_ASSESSMENT">
                                  Exams
                                </Select.Item>
                              )}
                          </Select.Group>
                        </Select.Content>
                      </Select>
                    </Field>
                  )}

                  {(draft.classwork_category === "QUARTERLY_ASSESSMENT" ||
                    draft.classwork_category === "EXAMS") && (
                      <Field label="Exam Sub-type" isRequired>
                        <Select
                          value={draft.exam_subtype}
                          onValueChange={(val) => {
                            if (
                              val &&
                              createError ===
                              "Choose an Examination sub-type explicitly."
                            )
                              setCreateError("");
                            setDraft((current) => ({
                              ...current,
                              exam_subtype: val,
                            }));
                          }}
                          disabled={
                            isCreating ||
                            remediationGradeTreatment === "EXAMINATION"
                          }
                        >
                          <Select.Trigger
                            id="quiz-exam-subtype"
                            aria-invalid={
                              createError ===
                              "Choose an Examination sub-type explicitly."
                            }
                            aria-describedby={
                              createError ===
                                "Choose an Examination sub-type explicitly."
                                ? "quiz-exam-subtype-error"
                                : undefined
                            }
                            className="w-full shadow-none aria-[invalid=true]:border-destructive"
                          >
                            <Select.Value placeholder="Select Sub-type" />
                          </Select.Trigger>
                          <Select.Content className="border-2 border-black rounded bg-white shadow-none">
                            <Select.Group>
                              <Select.Item value="SUMMATIVE_1">
                                Summative 1 (30%)
                              </Select.Item>
                              <Select.Item value="SUMMATIVE_2">
                                Summative 2 (30%)
                              </Select.Item>
                              <Select.Item value="TERM_EXAM">
                                Term Exam (40%)
                              </Select.Item>
                            </Select.Group>
                          </Select.Content>
                        </Select>
                        {createError ===
                          "Choose an Examination sub-type explicitly." && (
                            <FormMessage id="quiz-exam-subtype-error">
                              {createError}
                            </FormMessage>
                          )}
                      </Field>
                    )}

                  {isGradedWWPT && (
                    <Field
                      label="Targeted Original Classwork"
                      isRequired={true}
                    >
                      {remediationOriginalTargets &&
                        remediationOriginalTargets.length > 1 ? (
                        <Select
                          value={
                            selectedTargetId ? String(selectedTargetId) : ""
                          }
                          onValueChange={(val) => {
                            const nextId = Number(val);
                            setSelectedTargetId(nextId);
                            const target = remediationOriginalTargets.find(
                              (t) => t.assignment_id === nextId,
                            );
                            if (target) {
                              setDraft((cur) => ({
                                ...cur,
                                total_points: String(target.max_points),
                              }));
                            }
                            setCreateError("");
                          }}
                          disabled={isCreating}
                        >
                          <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                            <Select.Value placeholder="Select target classwork assignment" />
                          </Select.Trigger>
                          <Select.Content className="border-2 border-black rounded bg-white">
                            <Select.Group>
                              {remediationOriginalTargets.map((target) => (
                                <Select.Item
                                  key={target.assignment_id}
                                  value={String(target.assignment_id)}
                                >
                                  {target.title} ({target.original_score ?? 0}/
                                  {target.max_points} pts)
                                  {target.is_recommended
                                    ? " — Recommended"
                                    : ""}
                                </Select.Item>
                              ))}
                            </Select.Group>
                          </Select.Content>
                        </Select>
                      ) : null}
                      {selectedOriginalTarget ? (
                        <div className="flex items-center justify-between p-3 bg-muted/40 rounded border-2 border-border mt-1">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold">
                                {selectedOriginalTarget.title}
                              </span>
                              {selectedOriginalTarget.is_recommended && (
                                <Badge variant="secondary" size="sm">
                                  Recommended
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Original score:{" "}
                              {selectedOriginalTarget.original_score ?? 0} /{" "}
                              {selectedOriginalTarget.max_points} points ·
                              Required maximum:{" "}
                              {selectedOriginalTarget.max_points} points
                            </span>
                          </div>
                          <Badge variant="surface" size="sm">
                            {selectedOriginalTarget.component === "WRITTEN_WORK"
                              ? "Written Work"
                              : "Performance Task"}
                          </Badge>
                        </div>
                      ) : (
                        <p
                          className="text-xs text-destructive font-medium"
                          role="alert"
                        >
                          Please select a target original classwork assignment.
                        </p>
                      )}
                    </Field>
                  )}

                  <Field label="Total points" isRequired>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      value={draft.total_points}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => {
                        if (
                          Number(event.target.value) > 0 &&
                          createError ===
                          "Total points must be greater than zero."
                        )
                          setCreateError("");
                        setDraft((current) => ({
                          ...current,
                          total_points: event.target.value,
                        }));
                      }}
                      aria-invalid={
                        createError ===
                        "Total points must be greater than zero."
                      }
                      aria-describedby={
                        createError ===
                          "Total points must be greater than zero."
                          ? "quiz-total-points-error"
                          : undefined
                      }
                      disabled={
                        isCreating ||
                        remediationGradeTreatment === "EXAMINATION" ||
                        isGradedWWPT
                      }
                      className="w-full shadow-none"
                    />
                    {createError ===
                      "Total points must be greater than zero." && (
                        <FormMessage id="quiz-total-points-error">
                          {createError}
                        </FormMessage>
                      )}
                  </Field>
                </div>

                {remediationFocus && (
                  <p className="rounded border p-3 text-sm">
                    Evidence focus: {focusGuidance(remediationFocus)}
                    {remediationGradeTreatment === "EXAMINATION" &&
                      remediationOriginalExam
                      ? ` Original ${remediationOriginalExam.title}: ${remediationOriginalExam.score}/${remediationOriginalExam.total_points}. The higher result will count.`
                      : ""}
                    {isGradedWWPT && selectedOriginalTarget
                      ? ` Linked to ${selectedOriginalTarget.title} (${selectedOriginalTarget.original_score ?? 0}/${selectedOriginalTarget.max_points} pts). Effective score will be adjusted.`
                      : ""}
                    {remediationDraft &&
                      remediationGradeTreatment === "PRACTICE_ONLY" &&
                      " Practice only: completion and score do not affect official grades or predictions."}
                  </p>
                )}
                {remediationReferences.length > 0 && (
                  <p className="rounded border p-3 text-sm">
                    Selected evidence-matched references (metadata only):{" "}
                    {remediationReferences.map((item) => item.title).join("; ")}
                    . Review these materials yourself; their file contents were
                    not analyzed.
                  </p>
                )}
              </div>
            )}

            {createStep === "quiz" && (
              <div className="space-y-4">
                {(aiLinkedSubjectName ||
                  (aiLinkedLessonTitles && aiLinkedLessonTitles.length > 0) ||
                  aiPromptScope) && (
                    <div className="rounded border-2 border-black bg-[#F6E9B2] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-black">
                          <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                          <span>AI Generation & Curriculum Context</span>
                        </div>
                        <span className="text-[10px] font-extrabold uppercase bg-black text-white px-2 py-0.5">
                          Auto-Linked
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="flex items-start gap-1.5 bg-white/80 border border-black/20 p-2">
                          <span className="font-bold text-black/70 shrink-0">
                            Subject:
                          </span>
                          <span className="font-extrabold text-black truncate">
                            {aiLinkedSubjectName ||
                              subjects.find(
                                (s) => String(s.id) === String(draft.subject_id),
                              )?.name ||
                              "Subject"}
                          </span>
                        </div>
                        <div className="flex items-start gap-1.5 bg-white/80 border border-black/20 p-2">
                          <span className="font-bold text-black/70 shrink-0">
                            Linked Lessons:
                          </span>
                          <span className="font-extrabold text-black">
                            {aiLinkedLessonTitles &&
                              aiLinkedLessonTitles.length > 0
                              ? aiLinkedLessonTitles.join(", ")
                              : `${selectedLessonIds.length} lesson(s) selected`}
                          </span>
                        </div>
                      </div>
                      {aiPromptScope && (
                        <div className="text-xs bg-white/80 border border-black/20 p-2 flex items-start gap-1.5">
                          <span className="font-bold text-black/70 shrink-0">
                            Custom Scope:
                          </span>
                          <span className="font-semibold text-black/90">
                            "{aiPromptScope}"
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                <Card className="block w-full rounded! p-4 shadow-none hover:shadow-none space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">
                        Quiz question builder
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Review, edit, and organize questions for "
                        {draft.title || "Quiz"}".
                      </p>
                    </div>
                    <Badge size="sm" variant="outline">
                      {quizPointTotal}/{draft.total_points || 0} pts
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 border-t border-border pt-3">
                    <ClassworkSettingRow
                      label="Shuffle questions"
                      tooltip="Randomizes question order for each student during the quiz attempt."
                      checked={quizSettings.is_shuffle_questions}
                      onCheckedChange={(checked) =>
                        setQuizSettings((current) => ({
                          ...current,
                          is_shuffle_questions: checked,
                        }))
                      }
                      disabled={isCreating}
                    />
                    <ClassworkSettingRow
                      label="Shuffle answer choices"
                      tooltip="Randomizes multiple-choice answer options for each student during the quiz attempt."
                      checked={quizSettings.is_shuffle_options}
                      onCheckedChange={(checked) =>
                        setQuizSettings((current) => ({
                          ...current,
                          is_shuffle_options: checked,
                        }))
                      }
                      disabled={isCreating}
                    />
                  </div>
                </Card>

                <div className="space-y-4">
                  {quizImportSummary && (
                    <Alert
                      status={
                        actionableImportNotices.some(
                          (notice) => notice.severity === "error",
                        )
                          ? "error"
                          : actionableImportNotices.length > 0
                            ? "warning"
                            : "success"
                      }
                      className="p-3 text-xs"
                    >
                      <Alert.Title className="font-bold">
                        Import complete
                      </Alert.Title>
                      <Alert.Description className="mt-1 text-inherit">
                        {quizImportSummary.question_count} question
                        {quizImportSummary.question_count === 1 ? "" : "s"}{" "}
                        imported · {quizImportSummary.keyed_question_count}{" "}
                        answer key
                        {quizImportSummary.keyed_question_count === 1
                          ? ""
                          : "s"}{" "}
                        found
                        {quizImportSummary.preserved_explanation_count > 0
                          ? ` · ${quizImportSummary.preserved_explanation_count} explanation${quizImportSummary.preserved_explanation_count === 1 ? "" : "s"} preserved`
                          : ""}
                        {actionableImportNotices.length === 0
                          ? " · No issues need attention."
                          : ` · ${actionableImportNotices.length} item${actionableImportNotices.length === 1 ? "" : "s"} need review.`}
                        {actionableImportNotices.length > 0 && (
                          <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold">
                            {actionableImportNotices.map((notice, index) => (
                              <li key={`${notice.code}-${notice.question_number ?? index}-${index}`}>
                                {notice.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </Alert.Description>
                    </Alert>
                  )}
                  {!quizImportSummary && quizImportWarnings.length > 0 && (
                    <Alert status="warning" className="p-3 text-xs">
                      <Alert.Title className="font-bold">
                        Generation needs review
                      </Alert.Title>
                      <Alert.Description className="mt-1 text-inherit">
                        <ul className="list-disc space-y-1 pl-5 font-semibold">
                          {quizImportWarnings.map((warning, index) => (
                            <li key={`${warning}-${index}`}>{warning}</li>
                          ))}
                        </ul>
                      </Alert.Description>
                    </Alert>
                  )}
                  {quizQuestions.map((question, questionIndex) => {
                    const unkeyed = isUnkeyed(question);
                    return (
                      <Card
                        key={question.id}
                        className="block w-full min-w-0 rounded! p-4 shadow-none hover:shadow-none"
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold">
                              Question {questionIndex + 1}
                            </h3>
                            {unkeyed && (
                              <span className="rounded border-2 border-amber-600 bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900 shadow-xs">
                                ⚠️ Needs answer key
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeQuizQuestion(question.id)}
                            disabled={isCreating || quizQuestions.length === 1}
                            className="gap-2 text-destructive"
                          >
                            Remove
                          </Button>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="sm:col-span-2">
                            <Field label="Question text" isRequired={true}>
                              <textarea
                                value={question.question_text}
                                onChange={(event) =>
                                  updateQuizQuestion(question.id, {
                                    question_text: event.target.value,
                                  })
                                }
                                disabled={isCreating}
                                placeholder="Which of the following is the primary function of a CPU?"
                                className="px-4 py-2 w-full rounded! border-2 border-border bg-background shadow-none transition focus:outline-hidden focus:shadow-none min-h-20 text-sm"
                              />
                            </Field>
                          </div>
                          <div className="grid gap-3">
                            <Field label="Type">
                              <Select
                                value={question.question_type}
                                onValueChange={(val) => {
                                  const nextType = val as QuizQuestionType;
                                  const switched = switchQuestionType(
                                    question,
                                    nextType,
                                    {
                                      confirmOverwrite: () =>
                                        window.confirm(
                                          "This question already has a sample answer / rubric. Overwrite it with the primary answer key?",
                                        ),
                                    },
                                  );
                                  setQuizQuestions((current) =>
                                    current.map((q) =>
                                      q.id === question.id ? switched : q,
                                    ),
                                  );
                                }}
                                disabled={isCreating}
                              >
                                <Select.Trigger className="w-full shadow-none">
                                  <Select.Value />
                                </Select.Trigger>
                                <Select.Content className="border-2 border-border rounded! bg-background">
                                  <Select.Group>
                                    <Select.Item value="MULTIPLE_CHOICE">
                                      Multiple Choice
                                    </Select.Item>
                                    <Select.Item value="IDENTIFICATION">
                                      Identification
                                    </Select.Item>
                                    <Select.Item value="SHORT_ANSWER">
                                      Short Answer (Essay)
                                    </Select.Item>
                                  </Select.Group>
                                </Select.Content>
                              </Select>
                            </Field>

                            <Field label="Points" isRequired={true}>
                              <Input
                                type="number"
                                min="0.01"
                                step="1"
                                inputMode="decimal"
                                value={question.points}
                                onFocus={(event) => event.target.select()}
                                onChange={(event) =>
                                  updateQuizQuestion(question.id, {
                                    points: event.target.value,
                                  })
                                }
                                disabled={isCreating}
                                className="w-full bg-background border-2 border-border rounded! shadow-none"
                              />
                            </Field>
                          </div>
                        </div>

                        {question.question_type === "MULTIPLE_CHOICE" ? (
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-foreground">
                                Choices
                              </p>
                              {unkeyed && (
                                <span className="text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-400 rounded px-2 py-0.5">
                                  Select the correct choice below
                                </span>
                              )}
                            </div>
                            {question.options.map((option, optionIndex) => (
                              <div
                                key={`${question.id}-${option.option_order}`}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  checked={option.is_correct}
                                  onCheckedChange={(checked) => {
                                    if (checked === true)
                                      markCorrectOption(
                                        question.id,
                                        optionIndex,
                                      );
                                  }}
                                  disabled={isCreating}
                                  className="shrink-0 cursor-pointer border-border"
                                  aria-label={`Mark choice ${optionIndex + 1} correct`}
                                />
                                <Input
                                  value={option.option_text}
                                  onChange={(event) =>
                                    updateQuizOption(
                                      question.id,
                                      optionIndex,
                                      event.target.value,
                                    )
                                  }
                                  disabled={isCreating}
                                  placeholder={`Choice ${optionIndex + 1}`}
                                  className="min-w-0 flex-1 bg-background border-2 border-border rounded! shadow-none"
                                />
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="inline-flex">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            removeQuizOption(
                                              question.id,
                                              optionIndex,
                                            )
                                          }
                                          disabled={
                                            isCreating ||
                                            question.options.length <= 2
                                          }
                                          className="rounded! border-2 border-border p-2 text-xs font-bold bg-white cursor-pointer hover:bg-gray-100 disabled:opacity-40 transition"
                                          aria-label={`Remove choice ${optionIndex + 1}`}
                                        >
                                          <X size={14} />
                                        </button>
                                      </span>
                                    }
                                  />
                                  <TooltipContent>
                                    {question.options.length <= 2
                                      ? "Keep at least two choices"
                                      : "Remove choice"}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="default"
                              size="sm"
                              onClick={() => addQuizOption(question.id)}
                              disabled={isCreating}
                              className="gap-2"
                            >
                              Add choice
                            </Button>
                          </div>
                        ) : question.question_type === "IDENTIFICATION" ? (
                          <div className="mt-4 space-y-2">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between">
                                <p className="text-xs font-bold text-gray-700">
                                  Acceptable Correct Answer(s) / Key
                                </p>
                                <span className="text-[10px] text-gray-500 font-medium">
                                  Auto-grades student submission if spelling
                                  matches
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-600">
                                One correct concept only. Add alternates only
                                for spelling variants or synonyms.
                              </p>
                            </div>

                            {question.options.map((option, optionIndex) => (
                              <div
                                key={`${question.id}-${option.option_order}`}
                                className="flex items-center gap-2"
                              >
                                <div className="flex h-8 w-8 items-center justify-center rounded! border-2 border-border bg-primary text-xs font-black text-black shrink-0">
                                  ✓
                                </div>
                                <Input
                                  value={option.option_text}
                                  onChange={(event) =>
                                    updateQuizOption(
                                      question.id,
                                      optionIndex,
                                      event.target.value,
                                    )
                                  }
                                  disabled={isCreating}
                                  placeholder={
                                    optionIndex === 0
                                      ? "e.g. Isaac Newton (primary correct answer)"
                                      : `Alternative spelling / synonym ${optionIndex + 1}`
                                  }
                                  className="min-w-0 flex-1 bg-background border-2 border-border rounded! shadow-none"
                                />
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <span className="inline-flex">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            removeQuizOption(
                                              question.id,
                                              optionIndex,
                                            )
                                          }
                                          disabled={
                                            isCreating ||
                                            question.options.length <= 1
                                          }
                                          className="rounded! border-2 border-border p-2 text-xs font-bold bg-white cursor-pointer hover:bg-gray-100 disabled:opacity-40 transition"
                                          aria-label="Remove alternative answer"
                                        >
                                          <X size={14} />
                                        </button>
                                      </span>
                                    }
                                  />
                                  <TooltipContent>Remove answer</TooltipContent>
                                </Tooltip>
                              </div>
                            ))}

                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => addQuizOption(question.id, true)}
                                disabled={isCreating}
                                className="gap-2"
                              >
                                + Add alternate answer / spelling
                              </Button>
                            </div>

                            {unkeyed && (
                              <p className="rounded border border-amber-300 bg-amber-50/70 p-2.5 text-[11px] font-medium text-amber-900">
                                ⚠️ No answer key specified. Add at least one
                                acceptable answer before publishing.
                              </p>
                            )}
                          </div>
                        ) : (
                          /* SHORT_ANSWER (Essay) */
                          <div className="mt-4">
                            <Field label="Sample answer / rubric (optional)">
                              <p className="text-[11px] text-gray-500 font-medium -mt-0.5 mb-1">
                                Graded manually. Visible to teachers only during
                                grading; not shown to students.
                              </p>
                              <textarea
                                value={question.explanation}
                                onChange={(event) =>
                                  updateQuizQuestion(question.id, {
                                    explanation: event.target.value,
                                  })
                                }
                                disabled={isCreating}
                                placeholder="Optional sample answer, scoring criteria, or rubric for grading student responses..."
                                className="px-4 py-2 w-full rounded! border-2 border-border bg-background shadow-none transition focus:outline-hidden focus:shadow-none min-h-20 text-sm"
                              />
                            </Field>
                          </div>
                        )}

                        {question.question_type !== "SHORT_ANSWER" && (
                          <div className="mt-3">
                            <Field label="Explanation or answer guide (optional)">
                              <textarea
                                value={question.explanation}
                                onChange={(event) =>
                                  updateQuizQuestion(question.id, {
                                    explanation: event.target.value,
                                  })
                                }
                                disabled={isCreating}
                                placeholder="Optional guidance for review or grading"
                                className="px-4 py-2 w-full rounded! border-2 border-border bg-background shadow-none transition focus:outline-hidden focus:shadow-none min-h-16 text-sm"
                              />
                            </Field>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    onClick={() => addQuizQuestion("MULTIPLE_CHOICE")}
                    disabled={isCreating}
                    className="gap-2"
                  >
                    Add multiple choice
                  </Button>
                  <Button
                    type="button"
                    onClick={() => addQuizQuestion("IDENTIFICATION")}
                    disabled={isCreating}
                    className="gap-2"
                  >
                    Add identification
                  </Button>
                  <Button
                    type="button"
                    onClick={() => addQuizQuestion("SHORT_ANSWER")}
                    disabled={isCreating}
                    variant="outline"
                    className="gap-2"
                  >
                    Add short answer (essay)
                  </Button>
                </div>

                {/* ── Export Questionnaire Card (Post-Review Snapshot) ── */}
                <div className="rounded! border-2 border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex flex-wrap items-center justify-between gap-3 mt-4">
                  <div>
                    <div className="flex items-center gap-1.5 font-black text-sm text-black">
                      <FileDown className="w-4 h-4 text-black" />
                      <span>Export Finalized Questionnaire</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Export a snapshot of your reviewed and edited questions
                      (Legal size 8.5×13in) for paper exams.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold">
                      <Checkbox
                        size="sm"
                        checked={includeExportAnswerKey}
                        onCheckedChange={(checked) =>
                          setIncludeExportAnswerKey(Boolean(checked))
                        }
                      />
                      <span>Include Answer Key</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleExportQuiz("pdf")}
                        disabled={
                          isExporting !== null || quizQuestions.length === 0
                        }
                        className="gap-1.5 border-2 border-black font-bold text-xs cursor-pointer hover:bg-neutral-100 shadow-xs"
                      >
                        {isExporting === "pdf" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileDown className="w-3.5 h-3.5" />
                        )}
                        Download PDF
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleExportQuiz("docx")}
                        disabled={
                          isExporting !== null || quizQuestions.length === 0
                        }
                        className="gap-1.5 border-2 border-black font-bold text-xs cursor-pointer hover:bg-neutral-100 shadow-xs"
                      >
                        {isExporting === "docx" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        Download Word (.docx)
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {createStep === "assign" && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Duration (minutes)">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={quizSettings.duration_minutes}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) =>
                          setQuizSettings((current) => ({
                            ...current,
                            duration_minutes: event.target.value,
                          }))
                        }
                        disabled={isCreating}
                        placeholder="No time limit"
                        className="w-full bg-white border-2 border-black rounded shadow-none"
                      />
                    </div>
                  </Field>

                  <Field label="Attempts" isRequired>
                    <Input
                      type="number"
                      min="1"
                      max={remediationTarget ? "3" : undefined}
                      step="1"
                      value={quizSettings.max_attempts}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => {
                        setQuizSettings((current) => ({
                          ...current,
                          max_attempts: event.target.value,
                        }));
                        setDraft((current) => ({
                          ...current,
                          max_attempts: event.target.value,
                        }));
                      }}
                      disabled={
                        isCreating ||
                        remediationGradeTreatment === "EXAMINATION"
                      }
                      className="w-full bg-white border-2 border-black rounded shadow-none"
                    />
                  </Field>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Quiz Results Release">
                    <Select
                      value={quizResultsReleasePolicy}
                      onValueChange={(val) =>
                        setQuizResultsReleasePolicy(
                          val as QuizResultsReleasePolicy,
                        )
                      }
                      disabled={isCreating}
                    >
                      <Select.Trigger className="w-full shadow-none">
                        <Select.Value placeholder="Choose result release" />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black rounded bg-white">
                        <Select.Group>
                          <Select.Item value="HIDDEN">
                            Keep results hidden
                          </Select.Item>
                          <Select.Item value="IMMEDIATE">
                            Immediately after submission
                          </Select.Item>
                          <Select.Item value="AFTER_DUE_DATE">
                            After the due date
                          </Select.Item>
                          <Select.Item value="SCHEDULED">
                            On a specific date and time
                          </Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                    <p className="mt-1 text-xs text-gray-600">
                      Choose when students can view their quiz scores and answer feedback.
                    </p>
                  </Field>

                  <Field label="Locked Until">
                    <DatePicker
                      includeTime
                      value={draft.lock_date}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          lock_date: value,
                        }))
                      }
                      disabled={isCreating || !draft.is_published}
                      className="w-full rounded shadow-none disabled:bg-gray-100 disabled:opacity-55"
                    />
                  </Field>

                  {quizResultsReleasePolicy === "SCHEDULED" && (
                    <Field label="Release Date & Time" isRequired className="sm:col-span-2">
                      <DatePicker
                        includeTime
                        value={quizSettings.summary_release_at}
                        onValueChange={(value) =>
                          setQuizSettings((current) => ({
                            ...current,
                            summary_release_at: value,
                          }))
                        }
                        disabled={isCreating}
                        className="w-full bg-white border-2 border-black rounded shadow-none"
                      />
                    </Field>
                  )}
                  {quizResultsReleasePolicy === "AFTER_DUE_DATE" &&
                    !draft.due_date && (
                      <p className="text-xs text-amber-600 font-medium sm:col-span-2">
                        Set a due date below to use this release option.
                      </p>
                    )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Due Date"
                    isRequired={
                      Boolean(remediationTarget) ||
                      quizSettings.summary_release_mode === "AFTER_DUE_DATE"
                    }
                  >
                    <DatePicker
                      includeTime
                      value={draft.due_date}
                      onValueChange={(value) => {
                        if (
                          value &&
                          createError.startsWith("A due date is required")
                        )
                          setCreateError("");
                        setDraft((current) => ({
                          ...current,
                          due_date: value,
                        }));
                      }}
                      disabled={isCreating}
                      aria-invalid={createError.startsWith(
                        "A due date is required",
                      )}
                      aria-describedby={
                        createError.startsWith("A due date is required")
                          ? "quiz-due-date-error"
                          : undefined
                      }
                      className="w-full shadow-none"
                    />
                    {createError.startsWith("A due date is required") && (
                      <FormMessage id="quiz-due-date-error">
                        {createError}
                      </FormMessage>
                    )}
                  </Field>

                  <Field label="Publish Status">
                    <Select
                      value={draft.is_published ? "published" : "draft"}
                      onValueChange={(val) =>
                        setDraft((current) => ({
                          ...current,
                          is_published: val === "published",
                        }))
                      }
                      disabled={isCreating || draftOnly}
                    >
                      <Select.Trigger className="w-full">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black rounded bg-white">
                        <Select.Group>
                          <Select.Item value="published">
                            Publish now
                          </Select.Item>
                          <Select.Item value="draft">
                            Keep hidden from students
                          </Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                    {draftOnly && (
                      <p className="mt-2 text-xs font-semibold text-muted-foreground">
                        Future-term planning is saved as an unpublished draft.
                      </p>
                    )}
                    {draft.is_published && unkeyedIdCount > 0 && (
                      <div className="mt-2 rounded border-2 border-amber-500 bg-amber-50 p-2.5 text-xs text-amber-900 font-semibold shadow-xs">
                        ⚠️ <strong>Cannot publish:</strong> {unkeyedIdCount}{" "}
                        Identification question(s) have no answer key. Add at
                        least one answer key or select &quot;Keep hidden from
                        students&quot; to save as draft.
                      </div>
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-x-5 gap-y-1 mt-2">
                  <ClassworkSettingRow
                    label="Shuffle questions"
                    tooltip="Randomizes question order for each student during the quiz attempt."
                    checked={quizSettings.is_shuffle_questions}
                    onCheckedChange={(checked) =>
                      setQuizSettings((current) => ({
                        ...current,
                        is_shuffle_questions: checked,
                      }))
                    }
                    disabled={isCreating}
                  />
                  <ClassworkSettingRow
                    label="Shuffle answer choices"
                    tooltip="Randomizes multiple-choice answer options for each student during the quiz attempt."
                    checked={quizSettings.is_shuffle_options}
                    onCheckedChange={(checked) =>
                      setQuizSettings((current) => ({
                        ...current,
                        is_shuffle_options: checked,
                      }))
                    }
                    disabled={isCreating}
                  />
                  <ClassworkSettingRow
                    label="Enable per-question scoring"
                    tooltip="Allows setting custom point values individually for each question."
                    checked={quizSettings.enable_per_question_scoring}
                    onCheckedChange={(checked) =>
                      setQuizSettings((current) => ({
                        ...current,
                        enable_per_question_scoring: checked,
                      }))
                    }
                    disabled={isCreating}
                  />
                  <ClassworkSettingRow
                    label="Enable individual question time limits"
                    tooltip="Allows setting custom time limits individually for each question."
                    checked={quizSettings.enable_per_question_time_limits}
                    onCheckedChange={(checked) =>
                      setQuizSettings((current) => ({
                        ...current,
                        enable_per_question_time_limits: checked,
                      }))
                    }
                    disabled={isCreating}
                  />
                  {!remediationDraft && !remediationTarget && (
                    <ClassworkSettingRow
                      label="Automatic AI Feedback"
                      tooltip="Automatically prepares a private AI feedback draft after grading. Teachers review and approve feedback before it is posted; student visibility still waits for Quiz Results Release and retake protections."
                      checked={draft.auto_ai_feedback_enabled}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          auto_ai_feedback_enabled: checked,
                        }))
                      }
                      disabled={isCreating}
                    />
                  )}
                </div>

                {draft.due_date && (
                  <div className="mt-4">
                    <label className="inline-flex items-start gap-3 rounded border-2 border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold shadow-md cursor-pointer select-none">
                      <Checkbox
                        size="sm"
                        checked={draft.allow_late_submissions}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            allow_late_submissions: Boolean(checked),
                          }))
                        }
                        disabled={isCreating}
                        className="mt-0.5"
                      />
                      <span>
                        Allow late submissions
                        <span className="block font-medium text-gray-700 text-[10px]">
                          Accepted work after due date is marked late.
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                <Field label="Assign to sections" isRequired>
                  {selectedSubjectLoads.length > 0 && (
                    <div className="flex items-center justify-end -mt-8 mb-2">
                      <Button
                        size="sm"
                        className="shadow-none -mt-1"
                        autoIcon={false}
                        onClick={() => {
                          if (
                            createError ===
                            "Select at least one section to assign this quiz."
                          ) {
                            setCreateError("");
                          }
                          setSelectedClassIds(
                            selectedSubjectLoads.map((load) => load.class_id),
                          );
                        }}
                        disabled={isCreating || isSubjectLocked}
                      >
                        <CheckCheck className="size-4 mr-2" />
                        Select All
                      </Button>
                    </div>
                  )}
                  {remediationTarget ? (
                    <div className="mb-3 rounded border-2 border-black bg-muted/30 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold">
                          Single-Student Remedial Assignment
                        </span>
                        <Badge variant="solid" size="sm">
                          Individual Recipient
                        </Badge>
                      </div>
                      <p className="text-xs text-foreground">
                        This quiz is exclusively assigned to{" "}
                        <strong>{remediationTarget.student_name}</strong> in
                        section <strong>{remediationTarget.class_name}</strong>.
                        Other students will not receive or see this quiz.
                      </p>
                    </div>
                  ) : (
                    <div className="mb-2 flex items-center justify-end">
                      {/* <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setCreateError("");
                                                    setSelectedClassIds(
                                                        selectedSubjectLoads.map((load) => load.class_id),
                                                    );
                                                }}
                                                disabled={isCreating || selectedSubjectLoads.length === 0}
                                                className="px-2 py-1 text-xs border border-black rounded shadow-xs"
                                            >
                                                Select all
                                            </Button> */}
                    </div>
                  )}

                  {selectedSubjectLoads.length > 0 ? (
                    <Card className="-mt-1 grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                      {selectedSubjectLoads.map((load) => {
                        const isSelected = selectedClassIds.includes(
                          load.class_id,
                        );
                        return (
                          <button
                            key={load.subject_load_id}
                            type="button"
                            onClick={() => toggleClass(load.class_id)}
                            disabled={isCreating || isSubjectLocked}
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
                                  className={`flex size-5 shrink-0 items-center justify-center rounded-md border-2 border-black transition-colors ${isSelected
                                    ? "bg-primary text-black"
                                    : "bg-white text-transparent"
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
                                    {load.student_count}{" "}
                                    {load.student_count === 1
                                      ? "student"
                                      : "students"}
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
                  {remediationTarget && (
                    <p className="mt-2 rounded border p-2 text-xs">
                      Remedial assignment for{" "}
                      <strong>{remediationTarget.student_name}</strong> in{" "}
                      {remediationTarget.class_name}. Only this student will
                      receive this quiz.
                    </p>
                  )}
                  {remediationFocus && (
                    <p className="mt-2 rounded border p-2 text-xs">
                      Evidence focus: {focusGuidance(remediationFocus)}
                      {remediationGradeTreatment === "EXAMINATION" &&
                        remediationOriginalExam
                        ? ` Original ${remediationOriginalExam.title} fixes the subtype and ${remediationOriginalExam.total_points} possible points.`
                        : ""}
                    </p>
                  )}
                  {createError ===
                    "Select at least one section to assign this quiz." && (
                      <FormMessage>{createError}</FormMessage>
                    )}
                </Field>

                {coverageMappingNotice && (
                  <Alert
                    status="info"
                    className="p-3 text-xs"
                    onClose={() => setCoverageMappingNotice("")}
                  >
                    <Alert.Description className="text-inherit">
                      {coverageMappingNotice}
                    </Alert.Description>
                  </Alert>
                )}

                {selectedLessonIds.length > 0 &&
                  (() => {
                    const linkedLessons = availableLessons.filter((l) =>
                      selectedLessonIds.includes(l.lesson_id),
                    );
                    const mappingState = lessonMappingState;
                    const {
                      mappedCount,
                      unmappedCount,
                      totalCount,
                      selectedCount,
                      allSelected,
                      someSelected,
                      showSelectUnmapped,
                    } = mappingState;
                    const unmappedQuestionIds = selectUnmappedQuestionIds(
                      quizQuestions,
                      selectedLessonIds,
                    );
                    const selectedUnmappedCount = [...unmappedQuestionIds].filter(
                      (questionId) => selectedQuestionIds.has(questionId),
                    ).length;
                    const allUnmappedSelected =
                      unmappedCount > 0 &&
                      selectedUnmappedCount === unmappedCount;
                    const someUnmappedSelected =
                      selectedUnmappedCount > 0 && !allUnmappedSelected;
                    const mappingControlsDisabled =
                      areQuestionMappingControlsDisabled(
                        isCreating,
                        isLessonLocked,
                        unmappedCount,
                      );
                    const selectionControlClass = cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                      "h-8 gap-1.5 px-3 py-1 text-xs font-semibold text-gray-700",
                      mappingControlsDisabled &&
                      "cursor-not-allowed opacity-50",
                    );

                    const toggleSelectAll = () => {
                      if (allSelected) {
                        setSelectedQuestionIds(new Set());
                      } else {
                        setSelectedQuestionIds(
                          new Set(quizQuestions.map((q) => q.id)),
                        );
                      }
                    };

                    const toggleSelectUnmapped = () => {
                      if (allUnmappedSelected) {
                        setSelectedQuestionIds((current) => {
                          const next = new Set(current);
                          unmappedQuestionIds.forEach((questionId) =>
                            next.delete(questionId),
                          );
                          return next;
                        });
                      } else {
                        setSelectedQuestionIds(unmappedQuestionIds);
                      }
                    };

                    const applyBulkLesson = () => {
                      if (!bulkLessonId || selectedCount === 0) return;
                      const result = applyBulkQuestionLessonAssignment(
                        quizQuestions,
                        selectedQuestionIds,
                        Number(bulkLessonId),
                      );
                      setQuizQuestions(result.questions);
                      setSelectedQuestionIds(result.selectedQuestionIds);
                      setBulkLessonId("");
                    };

                    return (
                      <div className="space-y-3 rounded-lg border-2 border-black bg-white p-4">
                        {/* Header row with title and progress counter */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-bold">
                            Question-level lesson mapping
                          </h3>
                          <Badge
                            size="sm"
                            variant={
                              mappedCount === totalCount
                                ? "success"
                                : mappedCount === 0
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {mappedCount} / {totalCount} mapped
                            {unmappedCount > 0
                              ? ` · ${unmappedCount} unmapped`
                              : ""}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600">
                          Choose the lesson each question actually assesses. Its
                          linked competency is used only when that student's
                          answer has a score.
                        </p>
                        {unmappedCount > 0 && (
                          <p className="text-xs font-semibold text-amber-800">
                            {unmappedCount} question
                            {unmappedCount === 1 ? " still needs" : "s still need"}{" "}
                            lesson mapping.
                          </p>
                        )}

                        {/* Bulk action toolbar */}
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2">
                          <label className={selectionControlClass}>
                            <Checkbox
                              id="question-mapping-select-all"
                              size="sm"
                              checked={
                                someSelected ? "indeterminate" : allSelected
                              }
                              onCheckedChange={toggleSelectAll}
                              disabled={mappingControlsDisabled}
                              className="cursor-pointer"
                            />
                            Select all
                          </label>
                          {showSelectUnmapped && (
                            <label className={selectionControlClass}>
                              <Checkbox
                                id="question-mapping-select-unmapped"
                                size="sm"
                                checked={
                                  someUnmappedSelected
                                    ? "indeterminate"
                                    : allUnmappedSelected
                                }
                                onCheckedChange={toggleSelectUnmapped}
                                disabled={mappingControlsDisabled}
                                className="cursor-pointer"
                              />
                              Select unmapped ({unmappedCount})
                            </label>
                          )}
                          <span className="text-xs font-semibold text-gray-700">
                            {selectedCount} selected
                          </span>

                          {selectedCount > 0 && (
                            <>
                              <span className="text-gray-400 text-xs">—</span>
                              <div className="w-56">
                                <Select
                                  value={bulkLessonId}
                                  onValueChange={(val) => setBulkLessonId(val)}
                                  disabled={mappingControlsDisabled}
                                >
                                  <Select.Trigger className="w-full bg-white border-2 border-black rounded px-2 py-1 h-8">
                                    <Select.Value placeholder="Assign lesson…" />
                                  </Select.Trigger>
                                  <Select.Content className="border-2 border-black rounded bg-white">
                                    <Select.Group>
                                      {linkedLessons.map((lesson) => (
                                        <Select.Item
                                          key={lesson.lesson_id}
                                          value={String(lesson.lesson_id)}
                                        >
                                          {lesson.title}
                                        </Select.Item>
                                      ))}
                                      <Select.Item value="__clear__">
                                        — Remove mapping
                                      </Select.Item>
                                    </Select.Group>
                                  </Select.Content>
                                </Select>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                autoIcon={false}
                                onClick={() => {
                                  if (bulkLessonId === "__clear__") {
                                    const result =
                                      applyBulkQuestionLessonAssignment(
                                        quizQuestions,
                                        selectedQuestionIds,
                                        null,
                                      );
                                    setQuizQuestions(result.questions);
                                    setSelectedQuestionIds(
                                      result.selectedQuestionIds,
                                    );
                                    setBulkLessonId("");
                                  } else {
                                    applyBulkLesson();
                                  }
                                }}
                                disabled={isCreating || !bulkLessonId}
                                className="h-8 rounded-md border-2 border-black bg-primary px-3 py-1 text-xs font-bold text-black hover:bg-primary/80 disabled:opacity-50"
                              >
                                Apply
                              </Button>
                            </>
                          )}
                        </div>

                        {/* Per-question rows */}
                        <div className="space-y-2">
                          {quizQuestions.map((question, index) => {
                            const isChecked = selectedQuestionIds.has(
                              question.id,
                            );
                            const currentVal =
                              hasLinkedLessonMapping(
                                question,
                                selectedLessonIds,
                              ) && question.lesson_id !== null
                                ? String(question.lesson_id)
                                : "";
                            const isUnmapped = !currentVal;
                            return (
                              <div
                                key={question.id}
                                className={`rounded-lg border px-3 py-2 transition ${isChecked
                                  ? "border-black bg-yellow-50"
                                  : "border-gray-200 bg-white"
                                  }`}
                              >
                                <div className="mb-2 flex min-w-0 items-center gap-2">
                                  <Checkbox
                                    aria-label={`Select Question ${index + 1}`}
                                    size="sm"
                                    checked={isChecked}
                                    onCheckedChange={() => {
                                      setSelectedQuestionIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(question.id))
                                          next.delete(question.id);
                                        else next.add(question.id);
                                        return next;
                                      });
                                    }}
                                    disabled={mappingControlsDisabled}
                                    className="shrink-0 cursor-pointer"
                                  />
                                  <span className="truncate text-sm font-bold">
                                    Q{index + 1}: {question.question_text}
                                  </span>
                                  {isUnmapped && (
                                    <Badge size="sm" variant="default">
                                      Unmapped
                                    </Badge>
                                  )}
                                </div>
                                <div className="w-full min-w-0">
                                  <Select
                                    value={currentVal || "__none__"}
                                    onValueChange={(val) =>
                                      updateQuizQuestion(question.id, {
                                        lesson_id:
                                          val && val !== "__none__"
                                            ? Number(val)
                                            : null,
                                      })
                                    }
                                    disabled={isCreating || isLessonLocked}
                                  >
                                    <Select.Trigger className="w-full rounded-md border-2 border-black bg-white px-2 py-1">
                                      <Select.Value placeholder="Not mapped" />
                                    </Select.Trigger>
                                    <Select.Content className="rounded-md border-2 border-black bg-white">
                                      <Select.Group>
                                        <Select.Item value="__none__">
                                          Not mapped
                                        </Select.Item>
                                        {linkedLessons.map((lesson) => (
                                          <Select.Item
                                            key={lesson.lesson_id}
                                            value={String(lesson.lesson_id)}
                                          >
                                            {lesson.title}
                                          </Select.Item>
                                        ))}
                                      </Select.Group>
                                    </Select.Content>
                                  </Select>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                {/* ── Export Questionnaire Card in Step 4 ── */}
                <div className="rounded! border-2 border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] flex flex-wrap items-center justify-between gap-3 mt-4">
                  <div>
                    <div className="flex items-center gap-1.5 font-black text-sm text-black">
                      <FileDown className="w-4 h-4 text-black" />
                      <span>Export Questionnaire</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Download a printable questionnaire (Legal size) of this
                      finalized quiz.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold">
                      <Checkbox
                        size="sm"
                        checked={includeExportAnswerKey}
                        onCheckedChange={(checked) =>
                          setIncludeExportAnswerKey(Boolean(checked))
                        }
                      />
                      <span>Include Answer Key</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleExportQuiz("pdf")}
                        disabled={
                          isExporting !== null || quizQuestions.length === 0
                        }
                        className="gap-1.5 border-2 border-black font-bold text-xs cursor-pointer hover:bg-neutral-100 shadow-xs"
                      >
                        {isExporting === "pdf" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileDown className="w-3.5 h-3.5" />
                        )}
                        Download PDF
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleExportQuiz("docx")}
                        disabled={
                          isExporting !== null || quizQuestions.length === 0
                        }
                        className="gap-1.5 border-2 border-black font-bold text-xs cursor-pointer hover:bg-neutral-100 shadow-xs"
                      >
                        {isExporting === "docx" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileText className="w-3.5 h-3.5" />
                        )}
                        Download Word (.docx)
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <Dialog.Footer position="fixed">
            {createStep === "quiz-source" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                autoIcon={false}
                onClick={onBack}
                disabled={isCreating}
              >
                Cancel
              </Button>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  autoIcon={false}
                  onClick={onClose}
                  disabled={isCreating}
                  className="gap-2"
                >
                  <X className="size-4" />
                  Close
                </Button>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    autoIcon={false}
                    onClick={() => {
                      setCreateError("");
                      if (createStep === "details") {
                        if (remediationDraft || initialQuizMode) {
                          onBack();
                        } else {
                          setCreateStep("quiz-source");
                        }
                      } else if (createStep === "quiz") {
                        setCreateStep("details");
                      } else {
                        setCreateStep("quiz");
                      }
                    }}
                    disabled={isCreating}
                    className="gap-2"
                  >
                    <ArrowLeft className="size-4" />
                    Previous
                  </Button>

                  {createStep === "details" ? (
                    <Button
                      type="button"
                      size="sm"
                      autoIcon={false}
                      onClick={() => {
                        const validationError = validateDetails();
                        if (validationError) {
                          setCreateError(validationError);
                          toast.error({ title: validationError });
                        } else {
                          setCreateError("");
                          setCreateStep("quiz");
                        }
                      }}
                      disabled={
                        isCreating ||
                        isLoadingReusedQuiz ||
                        (initialQuizMode === "reuse" && Boolean(reuseQuizError))
                      }
                      className="gap-2"
                    >
                      Next
                      <ArrowRight className="size-4" />
                    </Button>
                  ) : createStep === "quiz" ? (
                    <Button
                      type="button"
                      size="sm"
                      autoIcon={false}
                      onClick={goToAssignStep}
                      disabled={isCreating}
                      className="gap-2"
                    >
                      Next
                      <ArrowRight className="size-4" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      autoIcon={false}
                      onClick={handleCreateQuiz}
                      disabled={
                        isCreating ||
                        (draft.is_published &&
                          (unkeyedIdCount > 0 ||
                            lessonMappingState.unmappedCount > 0))
                      }
                      title={
                        draft.is_published && unkeyedIdCount > 0
                          ? `Cannot publish: ${unkeyedIdCount} Identification question(s) have no answer key. Add keys or save as draft.`
                          : draft.is_published &&
                            lessonMappingState.unmappedCount > 0
                            ? `Cannot assign: ${lessonMappingState.unmappedCount} question(s) still need lesson mapping.`
                            : undefined
                      }
                      className="gap-2 disabled:opacity-50"
                    >
                      {isCreating ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      {isCreating
                        ? "Creating..."
                        : draft.is_published
                          ? "Assign"
                          : "Save Draft"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Dialog.Footer>
        </Dialog.Content>
      )}

      {isAIModalOpen && (
        <AIQuizGeneratorModal
          isOpen={isAIModalOpen}
          onClose={() => setIsAIModalOpen(false)}
          subjectId={Number(draft.subject_id) || (subjects[0]?.id ?? 0)}
          subjectName={
            subjects.find((s) => s.id === Number(draft.subject_id))?.name ||
            subjects[0]?.name ||
            "Subject"
          }
          subjects={subjects}
          remediationFocus={remediationFocus}
          onGenerated={(
            questions,
            warnings,
            chosenSubjectId,
            synthesizedTitle,
            associatedLessonIds,
            additionalCoverageScope,
            associatedLessonTitles,
          ) => {
            const nextLessonIds = associatedLessonIds?.length
              ? associatedLessonIds
              : selectedLessonIds;
            setQuizQuestions(reconcileQuestionLessonMappings(
              questions.length > 0 ? questions : [createEmptyQuizQuestion(1)],
              nextLessonIds,
            ));
            setQuizImportWarnings(warnings || []);
            setQuizImportNotices([]);
            setQuizImportSummary(null);
            setAiPromptScope(additionalCoverageScope);
            setAiLinkedLessonTitles(associatedLessonTitles || []);
            const subjName = subjects.find(
              (s) => s.id === chosenSubjectId,
            )?.name;
            setAiLinkedSubjectName(subjName);
            setDraft((current) => ({
              ...current,
              title: current.title?.trim()
                ? current.title
                : synthesizedTitle || current.title,
              subject_id: chosenSubjectId
                ? String(chosenSubjectId)
                : current.subject_id,
              total_points: remediationOriginalExam
                ? String(remediationOriginalExam.total_points)
                : isGradedWWPT && selectedOriginalTarget
                  ? String(selectedOriginalTarget.max_points)
                  : String(
                    questions.reduce(
                      (sum, q) => sum + Number(q.points || 0),
                      0,
                    ) || current.total_points,
                  ),
            }));
            if (associatedLessonIds && associatedLessonIds.length > 0) {
              setSelectedLessonIds(nextLessonIds);
            }
            // Transition to Step 1 (Details) for inspection before question editor
            setCreateStep("details");
          }}
        />
      )}
    </>
  );
}
