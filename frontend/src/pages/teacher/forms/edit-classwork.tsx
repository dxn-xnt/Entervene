"use client";

import { DatePicker } from "@/components/retroui/DatePicker";
import { useState, useEffect, useMemo, useRef } from "react";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { unorderedValues, optionalNumber } from "@/lib/form-changes";
import { FormMessage, NoChangesMessage } from "@/components/retroui/FormMessage";
import {
  getMinFutureDeadlineInput,
  validateFutureDeadline,
} from "@/lib/deadline-validation";
import {
  Check,
  CheckCheck,
  FileText,
  Plus,
  Trash2,
  UserCheck,
  Video,
} from "lucide-react";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/teacher/button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Button as RetroButton } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { ClassworkSettingRow } from "@/components/classwork-setting-row";
import {
  StoredVideoPreviewButton,
  VideoFilePreview,
} from "@/components/video-file-preview";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/retroui/Tooltip";
import { useToast } from "@/components/retroui/Toast";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  API_URL,
  apiFetch,
  apiUpload,
  formatUploadErrorResponse,
  isUploadCancelledError,
} from "@/lib/api";
import {
  classworkToEditDraft,
  formatFileSize,
  isVideoFile,
  isQuizType,
  isReadingType,
  validateAttachmentSelection,
} from "@/lib/classwork-utils";
import type {
  ActivityRubricLevel,
  ClassworkAttachment,
  EditDraft,
  TeacherClassLoad,
  TeacherClasswork,
  TeacherLesson,
} from "@/types/classwork";
import { ActivityRubricEditor } from "@/components/activity-rubric-editor";
import {
  activityRubricMaximum,
  defaultActivityRubric,
  validateActivityRubric,
} from "@/lib/classwork-utils";
import { ReferenceLinkEditor } from "@/components/classwork-reference-links";
import {
  validateReferenceLinks,
  type ReferenceLinkDraft,
} from "@/lib/classwork-reference-links";
import { toDateTimeLocal } from "@/lib/classwork-utils";
import type {
  InterventionRecipientScopes,
  ResourceRecipientScope,
} from "@/lib/teacher-interventions-api";
import { InterventionResourceRecipientSelector } from "./intervention-resource-recipient-selector";
import {
  legacyQuizReleaseSettings,
  quizResultsReleasePolicyFromLegacy,
  type LegacyQuizReleaseMode,
  type QuizResultsReleasePolicy,
} from "../classworks/quiz-results-release";

type QuizReleaseMode = LegacyQuizReleaseMode;

type QuizResultsDraft = {
  loaded: boolean;
  /** null means the quiz currently has mixed legacy visibility (scores != answers). */
  show_quiz_results: boolean | null;
  legacy_show_scores: boolean;
  legacy_show_correct_answers: boolean;
  summary_release_mode: QuizReleaseMode;
  summary_release_at: string;
};

type QuizConfigurationDraft = {
  loaded: boolean;
  has_attempts: boolean;
  duration_minutes: string;
  is_shuffle_questions: boolean;
  is_shuffle_options: boolean;
  enable_per_question_scoring: boolean;
  enable_per_question_time_limits: boolean;
  max_attempts: string;
};

const defaultQuizConfigurationDraft = (
  maxAttempts: string,
): QuizConfigurationDraft => ({
  loaded: false,
  has_attempts: false,
  duration_minutes: "",
  is_shuffle_questions: false,
  is_shuffle_options: false,
  enable_per_question_scoring: true,
  enable_per_question_time_limits: false,
  max_attempts: maxAttempts,
});

const quizConfigurationComparable = (draft: QuizConfigurationDraft) => ({
  duration_minutes: draft.duration_minutes,
  is_shuffle_questions: draft.is_shuffle_questions,
  is_shuffle_options: draft.is_shuffle_options,
  enable_per_question_scoring: draft.enable_per_question_scoring,
  enable_per_question_time_limits: draft.enable_per_question_time_limits,
  max_attempts: draft.max_attempts,
});

const defaultQuizResultsDraft = (showScores = true): QuizResultsDraft => ({
  loaded: false,
  show_quiz_results: showScores,
  legacy_show_scores: showScores,
  legacy_show_correct_answers: showScores,
  summary_release_mode: "IMMEDIATE",
  summary_release_at: "",
});

const quizResultsComparable = (draft: QuizResultsDraft) => ({
  show_quiz_results: draft.show_quiz_results,
  summary_release_mode: draft.summary_release_mode,
  summary_release_at:
    draft.summary_release_mode === "SCHEDULED" ? draft.summary_release_at : "",
});

const editReferenceLinks = (
  classwork: TeacherClasswork,
): ReferenceLinkDraft[] =>
  (classwork.reference_links ?? []).map((link) => ({
    url: link.url,
    title: link.title ?? "",
  }));

export interface EditClassworkModalProps {
  draftOnly?: boolean;
  classwork: TeacherClasswork;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: TeacherClasswork) => void;
}

export default function EditClassworkModal({
  draftOnly = false,
  classwork,
  isOpen,
  onClose,
  onSuccess,
}: EditClassworkModalProps) {
  const [currentClasswork, setCurrentClasswork] =
    useState<TeacherClasswork>(classwork);
  const [editDraft, setEditDraft] = useState<EditDraft>(() =>
    classworkToEditDraft(classwork),
  );
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [rubricConfirmation, setRubricConfirmation] = useState<
    "submitted" | null
  >(null);
  const [editMaterials, setEditMaterials] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadNotice, setUploadNotice] = useState("");
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
    };
  }, []);
  const [referenceLinks, setReferenceLinks] = useState<ReferenceLinkDraft[]>(
    () => editReferenceLinks(classwork),
  );
  const [removingAttachmentId, setRemovingAttachmentId] = useState<
    number | null
  >(null);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>(
    () => classwork.assignments?.map((assignment) => assignment.class_id) ?? [],
  );
  const [availableLessons, setAvailableLessons] = useState<TeacherLesson[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>(
    () => classwork.linked_lessons?.map((lesson) => lesson.lesson_id) ?? [],
  );
  const [isLessonLoading, setIsLessonLoading] = useState(false);
  const [rubricLevels, setRubricLevels] = useState<ActivityRubricLevel[]>(() =>
    classwork.rubric_levels?.length
      ? classwork.rubric_levels.map((level) => ({ ...level }))
      : defaultActivityRubric.map((level) => ({ ...level })),
  );
  const [initialQuizResults, setInitialQuizResults] =
    useState<QuizResultsDraft>(() =>
      defaultQuizResultsDraft(classwork.show_scores ?? true),
    );
  const [quizResultsDraft, setQuizResultsDraft] = useState<QuizResultsDraft>(
    () => defaultQuizResultsDraft(classwork.show_scores ?? true),
  );
  const [initialQuizConfiguration, setInitialQuizConfiguration] =
    useState<QuizConfigurationDraft>(() =>
      defaultQuizConfigurationDraft(
        classworkToEditDraft(classwork).max_attempts,
      ),
    );
  const [quizConfigurationDraft, setQuizConfigurationDraft] =
    useState<QuizConfigurationDraft>(() =>
      defaultQuizConfigurationDraft(
        classworkToEditDraft(classwork).max_attempts,
      ),
    );
  const [quizRevealConfirmation, setQuizRevealConfirmation] = useState(false);
  const quizResultsReleasePolicy = quizResultsReleasePolicyFromLegacy(
    quizResultsDraft.show_quiz_results === null
      ? quizResultsDraft.legacy_show_scores
      : quizResultsDraft.show_quiz_results,
    quizResultsDraft.show_quiz_results === null
      ? quizResultsDraft.legacy_show_correct_answers
      : quizResultsDraft.show_quiz_results,
    quizResultsDraft.summary_release_mode,
    quizResultsDraft.summary_release_at,
  );
  const setQuizResultsReleasePolicy = (policy: QuizResultsReleasePolicy) => {
    const next = legacyQuizReleaseSettings(
      policy,
      quizResultsDraft.summary_release_at,
    );
    setQuizResultsDraft((current) => ({
      ...current,
      show_quiz_results: next.showResults,
      summary_release_mode: next.mode,
      summary_release_at: next.scheduledAt,
    }));
  };
  const [recipientScope, setRecipientScope] =
    useState<ResourceRecipientScope | null>(null);
  const [initialRecipientScope, setInitialRecipientScope] =
    useState<ResourceRecipientScope | null>(null);
  const [recipientScopes, setRecipientScopes] =
    useState<InterventionRecipientScopes | null>(null);
  const [recipientScopeError, setRecipientScopeError] = useState<string | null>(
    null,
  );
  const toast = useToast();
  const targetedAssignment = useMemo(
    () =>
      currentClasswork.assignments?.find(
        (assignment) =>
          assignment.recipient_student_id && assignment.source_intervention_id,
      ) ?? null,
    [currentClasswork.assignments],
  );
  const isRemediationActivity = Boolean(targetedAssignment);
  const isLinkedOriginalForRemediation = Boolean(
    currentClasswork.is_linked_original_for_remediation,
  );
  const isGradingComponentLocked =
    isRemediationActivity || isLinkedOriginalForRemediation;
  const isPracticeOnlyRemediation =
    isRemediationActivity && currentClasswork.is_graded === false;
  const gradingComponentLockReason = isPracticeOnlyRemediation
    ? "Read-only: locked to practice-only remediation (no official grading component)."
    : isRemediationActivity
      ? "Read-only: locked to match the targeted original classwork's grading component."
      : isLinkedOriginalForRemediation
        ? "Read-only: locked because a linked remediation activity uses this grading component."
        : null;
  const isInterventionCreatedReading = Boolean(
    currentClasswork.intervention_resource_origin_id &&
      isReadingType(currentClasswork.classwork_type),
  );
  const hideRemediationReferenceMaterials =
    isRemediationActivity && !isReadingType(currentClasswork.classwork_type);

  const autoAiSupported = useMemo(() => {
    if (targetedAssignment) return false;
    const type = editDraft.classwork_type?.toUpperCase();
    if (type === "QUIZ" || type === "ASSIGNMENT") return true;
    if (
      type === "ACTIVITY" &&
      (currentClasswork.activity_mode || "ONLINE").toUpperCase() === "ONLINE"
    )
      return true;
    return false;
  }, [
    targetedAssignment,
    editDraft.classwork_type,
    currentClasswork.activity_mode,
  ]);

  const [dueDateError, setDueDateError] = useState("");
  const setFormError = (msg: string) => {
    toast.error({ title: msg });
  };

  useEffect(() => {
    if (!isOpen) return;
    if (targetedAssignment || isInterventionCreatedReading) {
      setLoads([]);
      return;
    }
    apiFetch("/api/v1/classwork-assignments/teacher/classes")
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as TeacherClassLoad[];
          setLoads(data);
        }
      })
      .catch(() => { });
  }, [isInterventionCreatedReading, isOpen, targetedAssignment]);

  useEffect(() => {
    const originId = currentClasswork.intervention_resource_origin_id;
    if (!isOpen || !isInterventionCreatedReading || !originId) {
      setRecipientScope(null);
      setInitialRecipientScope(null);
      setRecipientScopes(null);
      setRecipientScopeError(null);
      return;
    }

    let active = true;
    setRecipientScopeError(null);
    void apiFetch(
      `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/intervention-resource-recipient-context`,
    )
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(
            typeof body.detail === "string"
              ? body.detail
              : "Unable to load recipient settings.",
          );
        }
        return (await response.json()) as {
          current_scope: string;
          recipient_scopes: InterventionRecipientScopes;
        };
      })
      .then((context) => {
        if (!active) return;
        const scope = context.current_scope;
        if (
          scope !== "THIS_STUDENT" &&
          scope !== "ENTIRE_CLASS" &&
          scope !== "ALL_SUBJECT_STUDENTS"
        ) {
          throw new Error("The saved recipient scope could not be resolved.");
        }
        setRecipientScopes(context.recipient_scopes);
        setRecipientScope(scope);
        setInitialRecipientScope(scope);
      })
      .catch((cause) => {
        if (!active) return;
        setRecipientScopeError(
          cause instanceof Error
            ? cause.message
            : "Unable to load recipient settings.",
        );
      });
    return () => {
      active = false;
    };
  }, [
    currentClasswork.classwork_id,
    currentClasswork.intervention_resource_origin_id,
    isInterventionCreatedReading,
    isOpen,
  ]);

  useEffect(() => {
    setCurrentClasswork(classwork);
    setEditDraft(classworkToEditDraft(classwork));
    setSelectedClassIds(
      classwork.assignments?.map((assignment) => assignment.class_id) ?? [],
    );
    setSelectedLessonIds(
      classwork.linked_lessons?.map((lesson) => lesson.lesson_id) ?? [],
    );
    setEditMaterials([]);
    setReferenceLinks(editReferenceLinks(classwork));
    setRubricConfirmation(null);
    setQuizRevealConfirmation(false);
    setRubricLevels(
      classwork.rubric_levels?.length
        ? classwork.rubric_levels.map((level) => ({ ...level }))
        : defaultActivityRubric.map((level) => ({ ...level })),
    );
    const fallbackQuizResults = defaultQuizResultsDraft(
      classwork.show_scores ?? true,
    );
    setInitialQuizResults(fallbackQuizResults);
    setQuizResultsDraft(fallbackQuizResults);
    const fallbackQuizConfiguration = defaultQuizConfigurationDraft(
      classworkToEditDraft(classwork).max_attempts,
    );
    setInitialQuizConfiguration(fallbackQuizConfiguration);
    setQuizConfigurationDraft(fallbackQuizConfiguration);
  }, [classwork, isOpen]);

  useEffect(() => {
    if (!isOpen || !isQuizType(classwork.classwork_type)) return;
    let isActive = true;
    const showScores = classwork.show_scores ?? true;
    apiFetch(`/api/v1/quizzes/classwork/${classwork.classwork_id}`)
      .then(async (res) => {
        if (!isActive) return;
        if (!res.ok) {
          // If quiz builder row does not exist yet (e.g. draft quiz without questions), allow editing defaults
          const loadedResults: QuizResultsDraft = {
            loaded: true,
            show_quiz_results: showScores,
            legacy_show_scores: showScores,
            legacy_show_correct_answers: showScores,
            summary_release_mode: "IMMEDIATE",
            summary_release_at: "",
          };
          setInitialQuizResults(loadedResults);
          setQuizResultsDraft(loadedResults);
          const loadedConfig: QuizConfigurationDraft = {
            loaded: true,
            has_attempts: false,
            duration_minutes: "",
            is_shuffle_questions: false,
            is_shuffle_options: false,
            enable_per_question_scoring: true,
            enable_per_question_time_limits: false,
            max_attempts: classworkToEditDraft(classwork).max_attempts,
          };
          setInitialQuizConfiguration(loadedConfig);
          setQuizConfigurationDraft(loadedConfig);
          return;
        }
        const body = (await res.json()) as {
          duration_minutes?: number | null;
          has_attempts?: boolean;
          settings?: {
            is_shuffle_questions?: boolean;
            is_shuffle_options?: boolean;
            enable_per_question_scoring?: boolean;
            enable_per_question_time_limits?: boolean;
            max_attempts?: number | null;
            show_correct_answers?: boolean;
            summary_release_mode?: QuizReleaseMode;
            summary_release_at?: string | null;
          };
        };
        if (!isActive) return;
        const settings = body.settings;
        const showCorrectAnswers = settings
          ? Boolean(settings.show_correct_answers)
          : showScores;
        const mode = (settings?.summary_release_mode ||
          "IMMEDIATE") as QuizReleaseMode;
        const loaded: QuizResultsDraft = {
          loaded: true,
          show_quiz_results:
            showScores === showCorrectAnswers ? showScores : null,
          legacy_show_scores: showScores,
          legacy_show_correct_answers: showCorrectAnswers,
          summary_release_mode: mode,
          summary_release_at:
            mode === "SCHEDULED"
              ? toDateTimeLocal(settings?.summary_release_at)
              : "",
        };
        setInitialQuizResults(loaded);
        setQuizResultsDraft(loaded);
        const configuration: QuizConfigurationDraft = {
          loaded: true,
          has_attempts: Boolean(body.has_attempts),
          duration_minutes:
            body.duration_minutes == null ? "" : String(body.duration_minutes),
          is_shuffle_questions: Boolean(settings?.is_shuffle_questions),
          is_shuffle_options: Boolean(settings?.is_shuffle_options),
          enable_per_question_scoring:
            settings?.enable_per_question_scoring !== false,
          enable_per_question_time_limits: Boolean(
            settings?.enable_per_question_time_limits,
          ),
          max_attempts: String(
            settings?.max_attempts ??
            classworkToEditDraft(classwork).max_attempts,
          ),
        };
        setInitialQuizConfiguration(configuration);
        setQuizConfigurationDraft(configuration);
        setEditDraft((current) => ({
          ...current,
          max_attempts: configuration.max_attempts,
        }));
      })
      .catch(() => {
        if (!isActive) return;
        setInitialQuizResults((current) => ({ ...current, loaded: true }));
        setQuizResultsDraft((current) => ({ ...current, loaded: true }));
        setInitialQuizConfiguration((current) => ({
          ...current,
          loaded: true,
        }));
        setQuizConfigurationDraft((current) => ({ ...current, loaded: true }));
      });
    return () => {
      isActive = false;
    };
  }, [classwork, isOpen]);
  useEffect(() => {
    if (draftOnly) {
      setEditDraft((current) => ({ ...current, is_published: false }));
    }
  }, [draftOnly]);

  useEffect(() => {
    if (!isOpen || !currentClasswork.subject_id) {
      setAvailableLessons([]);
      return;
    }

    let isActive = true;
    setIsLessonLoading(true);

    const loadSubjectLessons = async () => {
      try {
        const subjectIdNum = Number(currentClasswork.subject_id);
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
                `/api/v1/lessons/my-class/${load.class_id}/subject/${subjectIdNum}`,
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
      } catch (err) {
        if (!isActive) return;
        setAvailableLessons([]);
        setFormError(
          err instanceof Error
            ? err.message
            : "Unable to load lessons for this subject.",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentClasswork.subject_id, loads]);

  const selectedSubjectLoads = useMemo<TeacherClassLoad[]>(() => {
    const subjectId = currentClasswork.subject_id;
    const filtered = subjectId
      ? loads.filter((load) => load.subject_id === subjectId)
      : [];
    if (filtered.length > 0) {
      const seen = new Set<number>();
      const unique: TeacherClassLoad[] = [];
      for (const load of filtered) {
        if (!seen.has(load.class_id)) {
          seen.add(load.class_id);
          unique.push(load);
        }
      }
      return unique.sort((a, b) =>
        a.section_name.localeCompare(b.section_name),
      );
    }
    const seen = new Set<number>();
    const fallback: TeacherClassLoad[] = [];
    for (const asgn of currentClasswork.assignments ?? []) {
      if (!seen.has(asgn.class_id)) {
        seen.add(asgn.class_id);
        fallback.push({
          subject_load_id: asgn.classwork_assignment_id,
          class_id: asgn.class_id,
          section_name: asgn.title || `Section ${asgn.class_id}`,
          grade_level: "Active Section",
          subject_id: subjectId,
          subject_name: currentClasswork.subject_name || "",
        });
      }
    }
    return fallback;
  }, [currentClasswork, loads]);

  const toggleClass = (classId: number) => {
    setSelectedClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const addEditMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    setEditMaterials((current) => {
      const existing = new Set(
        current.map((file) => `${file.name}-${file.size}`),
      );
      const next = [
        ...current,
        ...selectedFiles.filter(
          (file) => !existing.has(`${file.name}-${file.size}`),
        ),
      ];
      const savedAttachments = currentClasswork?.attachments ?? [];
      const invalid = validateAttachmentSelection(
        next,
        savedAttachments.length,
        savedAttachments.reduce((total, attachment) => total + Number(attachment.file_size || 0), 0),
      );
      if (invalid) {
        setFormError(invalid);
        return current;
      }
      setFormError("");
      return next;
    });
  };

  const removeEditMaterial = (index: number) => {
    setEditMaterials((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const removeSelectedAttachment = async (attachmentId: number) => {
    if (!currentClasswork) return;

    setRemovingAttachmentId(attachmentId);
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to remove classwork material.");
      }

      const updated = {
        ...currentClasswork,
        attachments: currentClasswork.attachments.filter(
          (attachment) => attachment.classwork_attachment_id !== attachmentId,
        ),
      };
      setCurrentClasswork(updated);
      onSuccess(updated);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "Unable to remove classwork material.",
      );
    } finally {
      setRemovingAttachmentId(null);
    }
  };

  const draftValues = (draft: EditDraft, levels: ActivityRubricLevel[]) => {
    const hasRubric =
      draft.classwork_type === "ACTIVITY" ||
      draft.classwork_type === "ASSIGNMENT";
    return {
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      instructions: draft.instructions.trim(),
      total_points: hasRubric
        ? activityRubricMaximum(levels)
        : isReadingType(draft.classwork_type)
          ? null
          : optionalNumber(draft.total_points),
      max_attempts: isQuizType(draft.classwork_type)
        ? Number(draft.max_attempts)
        : null,
      show_scores: isQuizType(draft.classwork_type) ? null : draft.show_scores,
      rubric: hasRubric ? levels : null,
    };
  };
  const changes = useEditFormChanges({
    resetKey: `${isOpen}:${classwork.classwork_id}:${initialQuizResults.loaded}:${initialQuizConfiguration.loaded}:${initialRecipientScope ?? "none"}`,
    initialValues: {
      draft: draftValues(
        classworkToEditDraft(classwork),
        classwork.rubric_levels?.length
          ? classwork.rubric_levels
          : defaultActivityRubric,
      ),
      quizResults: isQuizType(classwork.classwork_type)
        ? quizResultsComparable(initialQuizResults)
        : null,
      quizConfiguration: isQuizType(classwork.classwork_type)
        ? quizConfigurationComparable(initialQuizConfiguration)
        : null,
      classes: unorderedValues([
        ...new Set(classwork.assignments?.map((item) => item.class_id) ?? []),
      ]),
      lessons: unorderedValues(
        classwork.linked_lessons?.map((item) => item.lesson_id) ?? [],
      ),
      files: [],
      referenceLinks: editReferenceLinks(classwork),
      recipientScope: initialRecipientScope,
    },
    values: {
      draft: draftValues(editDraft, rubricLevels),
      quizResults: isQuizType(editDraft.classwork_type)
        ? quizResultsComparable(quizResultsDraft)
        : null,
      quizConfiguration: isQuizType(editDraft.classwork_type)
        ? quizConfigurationComparable({
          ...quizConfigurationDraft,
          max_attempts: editDraft.max_attempts,
        })
        : null,
      classes: unorderedValues([...new Set(selectedClassIds)]),
      lessons: unorderedValues(selectedLessonIds),
      files: editMaterials.map((file) => [
        file.name,
        file.size,
        file.lastModified,
        file.type,
      ]),
      referenceLinks,
      recipientScope,
    },
  });
  const saveClassworkEdit = async (
    options: { rubricConfirmed?: boolean; quizRevealConfirmed?: boolean } = {},
  ) => {
    const { rubricConfirmed = false, quizRevealConfirmed = false } = options;
    if (!currentClasswork || !editDraft) return;
    if (!changes.guardChanges()) return;

    const isReading = isReadingType(editDraft.classwork_type);
    const isQuiz = isQuizType(editDraft.classwork_type);
    const hasRubric =
      editDraft.classwork_type === "ACTIVITY" ||
      editDraft.classwork_type === "ASSIGNMENT";
    const totalPoints = hasRubric
      ? activityRubricMaximum(rubricLevels)
      : !isReading && editDraft.total_points
        ? Number(editDraft.total_points)
        : null;
    if (!editDraft.title.trim()) {
      setFormError("Classwork title is required.");
      return;
    }
    if (!hideRemediationReferenceMaterials) {
      const linksError = validateReferenceLinks(referenceLinks);
      if (linksError) {
        setFormError(linksError);
        return;
      }
    }
    if (
      totalPoints !== null &&
      (!Number.isFinite(totalPoints) || totalPoints <= 0)
    ) {
      setFormError("Total points must be greater than zero.");
      return;
    }
    if (hasRubric) {
      const rubricError = validateActivityRubric(rubricLevels);
      if (rubricError) {
        setFormError(rubricError);
        return;
      }
    }
    const attempts = Number(editDraft.max_attempts);
    if (isQuiz && (!Number.isInteger(attempts) || attempts <= 0)) {
      setFormError("Allowed attempts must be a positive whole number.");
      return;
    }
    const quizResultsChanged =
      isQuiz &&
      quizResultsDraft.loaded &&
      JSON.stringify(quizResultsComparable(quizResultsDraft)) !==
      JSON.stringify(quizResultsComparable(initialQuizResults));
    const quizConfigurationChanged =
      isQuiz &&
      quizConfigurationDraft.loaded &&
      JSON.stringify(
        quizConfigurationComparable({
          ...quizConfigurationDraft,
          max_attempts: editDraft.max_attempts,
        }),
      ) !==
      JSON.stringify(quizConfigurationComparable(initialQuizConfiguration));
    const lockedQuizFieldsChanged =
      isQuiz &&
      quizConfigurationDraft.loaded &&
      (quizConfigurationDraft.duration_minutes !==
        initialQuizConfiguration.duration_minutes ||
        quizConfigurationDraft.is_shuffle_questions !==
        initialQuizConfiguration.is_shuffle_questions ||
        quizConfigurationDraft.enable_per_question_scoring !==
        initialQuizConfiguration.enable_per_question_scoring ||
        quizConfigurationDraft.enable_per_question_time_limits !==
        initialQuizConfiguration.enable_per_question_time_limits);
    if (lockedQuizFieldsChanged && quizConfigurationDraft.has_attempts) {
      setFormError(
        "Quiz duration and question behavior cannot be changed after an attempt has started.",
      );
      return;
    }
    const duration =
      quizConfigurationDraft.duration_minutes.trim() === ""
        ? null
        : Number(quizConfigurationDraft.duration_minutes);
    if (
      isQuiz &&
      duration !== null &&
      (!Number.isInteger(duration) || duration <= 0)
    ) {
      setFormError("Quiz duration must be a positive whole number.");
      return;
    }
    if (quizResultsChanged) {
      if (
        quizResultsReleasePolicy === "SCHEDULED" &&
        !quizResultsDraft.summary_release_at
      ) {
        setFormError("Select a quiz results release date and time.");
        return;
      }
      if (
        quizResultsReleasePolicy === "AFTER_DUE_DATE" &&
        !editDraft.due_date
      ) {
        setFormError(
          "Set a quiz due date before releasing results after the due date.",
        );
        return;
      }
      const releaseChanged =
        quizResultsDraft.summary_release_mode !==
        initialQuizResults.summary_release_mode ||
        (quizResultsDraft.summary_release_mode === "SCHEDULED" &&
          quizResultsDraft.summary_release_at !==
          initialQuizResults.summary_release_at);
      const visibilityTurnedOn =
        quizResultsDraft.show_quiz_results === true &&
        initialQuizResults.show_quiz_results !== true;
      const answersWillBeEnabled =
        quizResultsDraft.show_quiz_results === true ||
        (quizResultsDraft.show_quiz_results === null &&
          initialQuizResults.legacy_show_correct_answers);
      const couldRevealAnswers =
        visibilityTurnedOn ||
        (releaseChanged &&
          quizResultsDraft.summary_release_mode !== "NEVER" &&
          answersWillBeEnabled);
      if (couldRevealAnswers && !quizRevealConfirmed) {
        setQuizRevealConfirmation(true);
        return;
      }
    }
    if (isInterventionCreatedReading && recipientScope == null) {
      setFormError(
        recipientScopeError || "Wait for recipient settings to finish loading.",
      );
      return;
    }
    if (!isInterventionCreatedReading && selectedClassIds.length === 0) {
      setFormError("Select at least one section to assign.");
      return;
    }
    const isInterventionQuiz = isQuiz && classwork.assignments?.some(
      (assignment) => assignment.source_intervention_id != null,
    );
    if (isInterventionQuiz && attempts > 3) {
      setFormError("Study Support quizzes allow up to 3 attempts.");
      return;
    }
    if (isInterventionQuiz && !editDraft.due_date) {
      setFormError("A due date is required for a Study Support quiz.");
      return;
    }

    const isLinkedRemediationRubricLocked = Boolean(
      classwork.is_graded !== false &&
      classwork.rubric_levels?.length &&
      classwork.assignments?.some(
        (assignment) => assignment.source_intervention_id != null,
      ),
    );
    const originalRubric = classwork.rubric_levels ?? [];
    const rubricChanged =
      hasRubric &&
      !isLinkedRemediationRubricLocked &&
      JSON.stringify(rubricLevels) !== JSON.stringify(originalRubric);
    if (rubricChanged && currentClasswork.has_graded_submissions) {
      setFormError(
        "The rubric and maximum score cannot be changed after a submission has been graded.",
      );
      return;
    }
    if (rubricChanged && currentClasswork.has_submissions) {
      if (!rubricConfirmed) {
        setRubricConfirmation("submitted");
        return;
      }
    }

    const publishValue = draftOnly ? false : editDraft.is_published;
    const initialDraft = classworkToEditDraft(currentClasswork);
    const initialTotalPoints = hasRubric
      ? activityRubricMaximum(
          currentClasswork.rubric_levels?.length
            ? currentClasswork.rubric_levels
            : defaultActivityRubric,
        )
      : !isReading && initialDraft.total_points
        ? Number(initialDraft.total_points)
        : null;
    const initialLessonIds =
      currentClasswork.linked_lessons?.map((lesson) => lesson.lesson_id) ?? [];
    const initialClassIds = [
      ...new Set(
        currentClasswork.assignments?.map((item) => item.class_id) ?? [],
      ),
    ];
    const dueDateChanged = editDraft.due_date !== initialDraft.due_date;
    const hasNewSections = selectedClassIds.some(
      (id) => !initialClassIds.includes(id),
    );
    if (!isReading && editDraft.due_date && (dueDateChanged || hasNewSections)) {
      const deadlineError = validateFutureDeadline(editDraft.due_date);
      if (deadlineError) {
        setDueDateError(deadlineError);
        return;
      }
    }
    setDueDateError("");
    const classworkDetailsChanged =
      editDraft.title.trim() !== initialDraft.title.trim() ||
      editDraft.description.trim() !== initialDraft.description.trim() ||
      editDraft.instructions.trim() !== initialDraft.instructions.trim() ||
      editDraft.classwork_type !== initialDraft.classwork_type ||
      (editDraft.classwork_category || null) !==
        (initialDraft.classwork_category || null) ||
      (editDraft.exam_subtype || null) !==
        (initialDraft.exam_subtype || null) ||
      totalPoints !== initialTotalPoints ||
      rubricChanged ||
      publishValue !== (draftOnly ? false : initialDraft.is_published) ||
      (!isQuiz && editDraft.show_scores !== initialDraft.show_scores) ||
      (autoAiSupported ? editDraft.auto_ai_feedback_enabled : false) !==
        (autoAiSupported ? initialDraft.auto_ai_feedback_enabled : false) ||
      JSON.stringify(unorderedValues(selectedLessonIds)) !==
        JSON.stringify(unorderedValues(initialLessonIds)) ||
      JSON.stringify(referenceLinks) !==
        JSON.stringify(editReferenceLinks(currentClasswork)) ||
      (isInterventionCreatedReading && recipientScope !== initialRecipientScope);
    const assignmentSettingsChanged =
      !isInterventionCreatedReading &&
      selectedClassIds.length > 0 &&
      (JSON.stringify(unorderedValues([...new Set(selectedClassIds)])) !==
        JSON.stringify(unorderedValues(initialClassIds)) ||
        editDraft.due_date !== initialDraft.due_date ||
        editDraft.lock_date !== initialDraft.lock_date ||
        editDraft.allow_late_submissions !==
          initialDraft.allow_late_submissions ||
        publishValue !== (draftOnly ? false : initialDraft.is_published));
    const shouldRunClassworkUpdate =
      classworkDetailsChanged ||
      (!assignmentSettingsChanged &&
        !quizConfigurationChanged &&
        !quizResultsChanged &&
        editMaterials.length === 0);

    setIsSavingEdit(true);
    const preUploadAttachmentIds = new Set(
      (currentClasswork.attachments ?? []).map((att) => att.classwork_attachment_id),
    );
    try {
      let updated: TeacherClasswork = currentClasswork;
      if (shouldRunClassworkUpdate) {
        const response = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: editDraft.title.trim(),
              description: editDraft.description.trim() || null,
              instructions: editDraft.instructions.trim() || null,
              classwork_type: isGradingComponentLocked
                ? currentClasswork.classwork_type
                : editDraft.classwork_type,
              classwork_category: isGradingComponentLocked
                ? currentClasswork.classwork_category || null
                : editDraft.classwork_category || null,
              exam_subtype: isGradingComponentLocked
                ? currentClasswork.exam_subtype || null
                : editDraft.exam_subtype || null,
              total_points:
                isGradingComponentLocked && !isPracticeOnlyRemediation
                  ? (currentClasswork.total_points ?? totalPoints)
                  : totalPoints,
              rubric_levels:
                hasRubric && rubricChanged ? rubricLevels : undefined,
              confirm_rubric_change:
                rubricChanged && Boolean(currentClasswork.has_submissions),
              is_published: publishValue,
              show_scores: isQuiz ? undefined : editDraft.show_scores,
              auto_ai_feedback_enabled: autoAiSupported
                ? editDraft.auto_ai_feedback_enabled
                : false,
              lesson_ids: selectedLessonIds,
              reference_links:
                hideRemediationReferenceMaterials ||
                JSON.stringify(referenceLinks) ===
                  JSON.stringify(editReferenceLinks(currentClasswork))
                  ? undefined
                  : referenceLinks.map((link) => ({
                    url: link.url.trim(),
                    title: link.title.trim() || null,
                  })),
              recipient_scope: isInterventionCreatedReading
                ? recipientScope
                : undefined,
            }),
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const detail = body.detail;
          if (Array.isArray(detail)) {
            const msgs = detail
              .map((e: { loc?: (string | number)[]; msg?: string }) => {
                const field = (e.loc || []).filter((x) => x !== "body").join(".");
                return field ? `${field}: ${e.msg}` : e.msg || "Validation error";
              })
              .join("; ");
            throw new Error(msgs || "Validation error");
          }
          if (detail && typeof detail === "object") {
            const message =
              typeof detail.message === "string"
                ? detail.message
                : "Unable to update classwork.";
            const readinessErrors = Array.isArray(detail.readiness_errors)
              ? detail.readiness_errors.filter(
                  (item: unknown): item is string =>
                    typeof item === "string" && item.trim().length > 0,
                )
              : [];
            throw new Error(
              readinessErrors.length > 0
                ? `${message} ${readinessErrors.join(" ")}`
                : message,
            );
          }
          throw new Error(
            typeof detail === "string" ? detail : "Unable to update classwork.",
          );
        }

        updated = (await response.json()) as TeacherClasswork;
      }
      if (assignmentSettingsChanged) {
        const assignResponse = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/assign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              class_ids: selectedClassIds,
              due_date: !dueDateChanged
                ? (currentClasswork.assignments?.[0]?.due_date ?? null)
                : editDraft.due_date
                  ? new Date(editDraft.due_date).toISOString()
                  : null,
              lock_date: editDraft.lock_date
                ? new Date(editDraft.lock_date).toISOString()
                : null,
              allow_late_submissions: editDraft.allow_late_submissions,
              max_attempts: isQuiz
                ? attempts
                : null,
              is_published: publishValue,
            }),
          },
        );
        if (!assignResponse.ok) {
          const body = await assignResponse.json().catch(() => ({}));
          const detail = body.detail;
          if (Array.isArray(detail)) {
            const msgs = detail
              .map((e: { loc?: (string | number)[]; msg?: string }) => {
                const field = (e.loc || [])
                  .filter((x) => x !== "body")
                  .join(".");
                return field
                  ? `${field}: ${e.msg}`
                  : e.msg || "Validation error";
              })
              .join("; ");
            throw new Error(msgs || "Validation error");
          }
          if (detail && typeof detail === "object") {
            const message =
              typeof detail.message === "string"
                ? detail.message
                : "Unable to update assignment settings.";
            const readinessErrors = Array.isArray(detail.readiness_errors)
              ? detail.readiness_errors.filter(
                  (item: unknown): item is string =>
                    typeof item === "string" && item.trim().length > 0,
                )
              : [];
            throw new Error(
              readinessErrors.length > 0
                ? `${message} ${readinessErrors.join(" ")}`
                : message,
            );
          }
          throw new Error(
            typeof detail === "string"
              ? detail
              : "Unable to update assignment settings.",
          );
        }
      }

      if (quizConfigurationChanged) {
        const configurationResponse = await apiFetch(
          `/api/v1/quizzes/classwork/${currentClasswork.classwork_id}/configuration`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              duration_minutes: duration,
              is_shuffle_questions: quizConfigurationDraft.is_shuffle_questions,
              is_shuffle_options: quizConfigurationDraft.is_shuffle_options,
              enable_per_question_scoring:
                quizConfigurationDraft.enable_per_question_scoring,
              enable_per_question_time_limits:
                quizConfigurationDraft.enable_per_question_time_limits,
              max_attempts: attempts,
            }),
          },
        );
        if (!configurationResponse.ok) {
          const body = await configurationResponse.json().catch(() => ({}));
          const detail = body.detail;
          throw new Error(
            typeof detail === "string"
              ? detail
              : detail && typeof detail.message === "string"
                ? detail.message
                : "Unable to update quiz configuration.",
          );
        }
      }

      if (quizResultsChanged) {
        const quizResultsResponse = await apiFetch(
          `/api/v1/quizzes/classwork/${currentClasswork.classwork_id}/results-settings`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              release_policy: quizResultsReleasePolicy,
              summary_release_at:
                quizResultsReleasePolicy === "SCHEDULED" &&
                  quizResultsDraft.summary_release_at
                  ? new Date(quizResultsDraft.summary_release_at).toISOString()
                  : null,
              confirm_answer_reveal: quizRevealConfirmed,
            }),
          },
        );
        if (!quizResultsResponse.ok) {
          const body = await quizResultsResponse.json().catch(() => ({}));
          const detail = body.detail;
          if (
            detail &&
            typeof detail === "object" &&
            detail.code === "QUIZ_RESULTS_REVEAL_CONFIRMATION_REQUIRED"
          ) {
            setQuizRevealConfirmation(true);
            return;
          }
          const message =
            typeof detail === "string"
              ? detail
              : detail &&
                typeof detail === "object" &&
                typeof detail.message === "string"
                ? detail.message
                : "Unable to update quiz results visibility.";
          throw new Error(message);
        }
        const savedResults = (await quizResultsResponse.json()) as {
          show_scores: boolean;
          show_correct_answers: boolean;
          summary_release_mode: QuizReleaseMode;
          summary_release_at?: string | null;
        };
        updated = { ...updated, show_scores: savedResults.show_scores };
      }

      // If there are pending materials to upload, upload them
      if (editMaterials.length > 0) {
        setUploadNotice("");
        setUploadProgress(0);
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        const uploadedAttachments: ClassworkAttachment[] = [];
        for (let i = 0; i < editMaterials.length; i++) {
          const material = editMaterials[i];
          const formData = new FormData();
          formData.append("file", material);
          const uploadResponse = await apiUpload(
            `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/attachments`,
            formData,
            {
              onProgress: (percent) =>
                setUploadProgress(Math.round(((i + percent / 100) / editMaterials.length) * 100)),
              signal: controller.signal,
            },
          );
          if (!uploadResponse.ok) {
            const uploadErrMsg = await formatUploadErrorResponse(
              uploadResponse,
              `Unable to upload ${material.name}.`,
            );

            const partialAttachments = [
              ...(updated.attachments ?? []),
              ...uploadedAttachments,
            ];
            const partiallyUpdated = {
              ...updated,
              attachments: partialAttachments,
            };
            setCurrentClasswork(partiallyUpdated);
            onSuccess(partiallyUpdated);

            setEditMaterials((prev) => prev.slice(uploadedAttachments.length));
            setFormError(
              `Classwork details were saved, but failed to upload "${material.name}": ${uploadErrMsg}`,
            );
            return;
          }
          const uploadedAtt =
            (await uploadResponse.json()) as ClassworkAttachment;
          uploadedAttachments.push(uploadedAtt);
        }
        setEditMaterials([]);
        setUploadProgress(null);
      }

      const refreshed = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}`,
      );
      if (refreshed.ok) {
        updated = (await refreshed.json()) as TeacherClasswork;
      }
      setCurrentClasswork(updated);
      onSuccess(updated);
      toast.success({ title: "Classwork updated successfully." });
      onClose();
    } catch (err) {
      if (isUploadCancelledError(err)) {
        // Reconcile server state so ONLY newly persisted attachments (not pre-existing
        // attachments with matching names/sizes) are removed from the pending queue.
        let latestAttachments = currentClasswork.attachments;
        try {
          const refreshed = await apiFetch(
            `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}`,
          );
          if (refreshed.ok) {
            const latest = (await refreshed.json()) as TeacherClasswork;
            latestAttachments = latest.attachments ?? [];
            setCurrentClasswork(latest);
            onSuccess(latest);
          }
        } catch {
          // Keep current view state if reconciliation fetch fails.
        }
        const newlySavedCounts = new Map<string, number>();
        for (const att of latestAttachments) {
          if (preUploadAttachmentIds.has(att.classwork_attachment_id)) continue;
          const key = `${att.file_name}:${Number(att.file_size || 0)}`;
          newlySavedCounts.set(key, (newlySavedCounts.get(key) ?? 0) + 1);
        }
        setEditMaterials((prev) =>
          prev.filter((file) => {
            const key = `${file.name}:${file.size}`;
            const remaining = newlySavedCounts.get(key) ?? 0;
            if (remaining > 0) {
              newlySavedCounts.set(key, remaining - 1);
              return false;
            }
            return true;
          }),
        );
        setUploadNotice(
          "Upload cancelled. Remaining files were kept for retry, and saved attachments were synced with the server.",
        );
      } else {
        setFormError(
          err instanceof Error ? err.message : "Unable to update classwork.",
        );
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadProgress(null);
      setIsSavingEdit(false);
    }
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && !isSavingEdit) {
            onClose();
          }
        }}
      >
        {isOpen && (
          <Dialog.Content size="lg">
            <Dialog.Header position="fixed">
              <Text as="h5" className="font-sans text-xl font-bold">
                Edit Classwork
              </Text>
            </Dialog.Header>

            <section
              data-testid="edit-classwork-modal-body"
              className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-4 pr-3"
            >
              <div className="contents">
                <section
                  aria-labelledby="edit-classwork-basic-information"
                  className="order-0 grid gap-3"
                >
                  <h3
                    id="edit-classwork-basic-information"
                    className="text-lg font-bold"
                  >
                    Basic Information
                  </h3>
                  <Field label="Link Lesson">
                    <Select
                      value={
                        selectedLessonIds[0] ? String(selectedLessonIds[0]) : ""
                      }
                      onValueChange={(val) => {
                        setSelectedLessonIds(val ? [Number(val)] : []);
                      }}
                      disabled={
                        isSavingEdit ||
                        !currentClasswork.subject_id ||
                        isLessonLoading ||
                        availableLessons.length === 0
                      }
                    >
                      <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                        <Select.Value
                          className="text-muted-foreground"
                          placeholder={
                            !currentClasswork.subject_id
                              ? "Select a subject first"
                              : isLessonLoading
                                ? "Loading lessons..."
                                : availableLessons.length === 0
                                  ? "No lessons found for this subject"
                                  : "Choose lesson"
                          }
                        />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black rounded bg-white">
                        <Select.Group>
                          {availableLessons.map((lesson) => (
                            <Select.Item
                              key={lesson.lesson_id}
                              value={String(lesson.lesson_id)}
                            >
                              {lesson.title}
                              {!lesson.is_published ? " (Draft)" : ""}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </Field>

                  <Field label="Topic Title" isRequired={true}>
                    <Input
                      value={editDraft.title}
                      onChange={(event) =>
                        setEditDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      disabled={isSavingEdit}
                      placeholder="Classwork title"
                      className="w-full bg-white border-2 border-black rounded shadow-md"
                    />
                  </Field>

                  <Field label="Type">
                    <Select
                      value={editDraft.classwork_type}
                      onValueChange={(v) => {
                        if (isGradingComponentLocked) return;
                        setEditDraft((current) => ({
                          ...current,
                          classwork_type: v,
                        }));
                      }}
                      disabled={isSavingEdit || isGradingComponentLocked}
                    >
                      <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                        <Select.Value />
                      </Select.Trigger>
                      <Select.Content className="border-2 border-black rounded bg-white">
                        <Select.Group>
                          <Select.Item value="READING">Reading</Select.Item>
                          <Select.Item value="ACTIVITY">Activity</Select.Item>
                          <Select.Item value="ASSIGNMENT">
                            Assignment
                          </Select.Item>
                          <Select.Item value="QUIZ">Quiz</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </Field>

                  <Field label="Instructions">
                    <textarea
                      value={editDraft.instructions}
                      onChange={(event) =>
                        setEditDraft((current) => ({
                          ...current,
                          instructions: event.target.value,
                        }))
                      }
                      disabled={isSavingEdit}
                      placeholder="What students need to read, answer, or submit"
                      className="px-4 py-2 w-full rounded! border-2 border-black bg-white shadow-md transition focus:outline-hidden focus:shadow-xs min-h-20 text-sm"
                    />
                  </Field>

                  {!isReadingType(editDraft.classwork_type) && (
                    <div
                      className={`grid gap-4 ${editDraft.classwork_category ===
                          "QUARTERLY_ASSESSMENT" ||
                          editDraft.classwork_category === "EXAMS" ||
                          (editDraft.classwork_type !== "ACTIVITY" &&
                            editDraft.classwork_type !== "ASSIGNMENT")
                          ? "sm:grid-cols-2"
                          : ""
                        }`}
                    >
                      <Field label="Grading Component">
                        {isPracticeOnlyRemediation ? (
                          <Input
                            value="Practice Only (No Grading Component)"
                            readOnly
                            disabled
                            className="w-full bg-muted/40 border-2 border-black rounded shadow-md"
                          />
                        ) : (
                          <Select
                            value={editDraft.classwork_category || "NONE"}
                            onValueChange={(val) => {
                              if (isGradingComponentLocked) return;
                              setEditDraft((current) => ({
                                ...current,
                                classwork_category: val === "NONE" ? "" : val,
                              }));
                            }}
                            disabled={isSavingEdit || isGradingComponentLocked}
                          >
                            <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                              <Select.Value placeholder="Select Category" />
                            </Select.Trigger>
                            <Select.Content className="border-2 border-black rounded bg-white">
                              <Select.Group>
                                <Select.Item value="NONE">None</Select.Item>
                                <Select.Item value="WRITTEN_WORK">
                                  Written Works
                                </Select.Item>
                                <Select.Item value="PERFORMANCE_TASK">
                                  Performance Task
                                </Select.Item>
                                <Select.Item value="QUARTERLY_ASSESSMENT">
                                  Exams
                                </Select.Item>
                              </Select.Group>
                            </Select.Content>
                          </Select>
                        )}
                        {gradingComponentLockReason && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {gradingComponentLockReason}
                          </p>
                        )}
                      </Field>

                      {(editDraft.classwork_category ===
                        "QUARTERLY_ASSESSMENT" ||
                        editDraft.classwork_category === "EXAMS") && (
                          <Field label="Exam Sub-type">
                            <Select
                              value={editDraft.exam_subtype || "SUMMATIVE_1"}
                              onValueChange={(val) => {
                                if (isGradingComponentLocked) return;
                                setEditDraft((current) => ({
                                  ...current,
                                  exam_subtype: val,
                                }));
                              }}
                              disabled={isSavingEdit || isGradingComponentLocked}
                            >
                              <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                                <Select.Value placeholder="Select Sub-type" />
                              </Select.Trigger>
                              <Select.Content className="border-2 border-black rounded bg-white">
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
                            {isGradingComponentLocked && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Read-only: locked to match the linked examination.
                              </p>
                            )}
                          </Field>
                        )}

                      {editDraft.classwork_type !== "ACTIVITY" &&
                        editDraft.classwork_type !== "ASSIGNMENT" && (
                          <Field label="Total points">
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              inputMode="decimal"
                              value={editDraft.total_points}
                              onChange={(event) => {
                                if (
                                  isGradingComponentLocked &&
                                  !isPracticeOnlyRemediation
                                ) {
                                  return;
                                }
                                setEditDraft((current) => ({
                                  ...current,
                                  total_points: event.target.value,
                                }));
                              }}
                              disabled={
                                isSavingEdit ||
                                (isGradingComponentLocked &&
                                  !isPracticeOnlyRemediation)
                              }
                              className="w-full bg-white border-2 border-black rounded shadow-md"
                            />
                            {isGradingComponentLocked &&
                              !isPracticeOnlyRemediation && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Read-only: locked to match the linked
                                  classwork&apos;s maximum points.
                                </p>
                              )}
                          </Field>
                        )}
                    </div>
                  )}
                </section>

                {!hideRemediationReferenceMaterials && (
                <section
                  aria-labelledby="edit-classwork-reference-materials"
                  className={`${isInterventionCreatedReading ? "order-3" : "order-2"} space-y-3 pt-2`}
                >
                  <h3
                    id="edit-classwork-reference-materials"
                    className="text-lg font-bold"
                  >
                    Reference Links / Materials
                  </h3>

                  <ReferenceLinkEditor
                    links={referenceLinks}
                    onChange={setReferenceLinks}
                    disabled={isSavingEdit}
                  />

                  <Field label="Upload Material">
                    {currentClasswork.attachments.length === 0 &&
                      editMaterials.length === 0 ? (
                      <Empty className="shadow-md hover:shadow-none transition-shadow rounded!">
                        <EmptyHeader>
                          <EmptyTitle>No Materials Added</EmptyTitle>
                          <EmptyDescription className="flex flex-col -gap-3 text-center whitespace-nowrap">
                            <span className="font-semibold">Up to 10 files · 200 MB combined</span>
                            <span>Documents: 10 MB · videos: 100 MB</span>
                            <span>(pdf, docx, pptx, jpg, png, mp4, webm & mov)</span>
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button
                            asChild
                            size="sm"
                            variant="default"
                            className="cursor-pointer rounded!"
                            disabled={isSavingEdit}
                          >
                            <label>
                              <Plus size={14} className="mr-1" />
                              Add Materials
                              <input
                                type="file"
                                multiple
                                accept=".pdf,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
                                onChange={(event) => {
                                  addEditMaterials(event.target.files);
                                  event.target.value = "";
                                }}
                                disabled={isSavingEdit}
                                className="hidden"
                              />
                            </label>
                          </Button>
                        </EmptyContent>
                      </Empty>
                    ) : (
                      <div className="w-full flex flex-wrap gap-3">
                        {currentClasswork.attachments.map((attachment) => {
                          const video = isVideoFile({
                            name: attachment.file_name,
                            type: attachment.file_type ?? "",
                          });
                          return (
                            <div
                              key={attachment.classwork_attachment_id}
                              className="flex w-full flex-col justify-between gap-2 rounded border-2 border-border bg-card p-2.5 shadow-none sm:w-44"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant="outline" size="sm" className="gap-1 px-1.5 py-0 text-[10px] uppercase tracking-wide">
                                  {video ? <Video size={11} aria-hidden="true" /> : <FileText size={11} aria-hidden="true" />}
                                  {video ? "Video" : "File"}
                                </Badge>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <button
                                        type="button"
                                        onClick={() =>
                                          removeSelectedAttachment(
                                            attachment.classwork_attachment_id,
                                          )
                                        }
                                        disabled={
                                          isSavingEdit ||
                                          removingAttachmentId ===
                                          attachment.classwork_attachment_id
                                        }
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black bg-white text-black hover:bg-destructive hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                                        aria-label={`Remove ${attachment.file_name}`}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    }
                                  />
                                  <TooltipContent>Remove file</TooltipContent>
                                </Tooltip>
                              </div>
                              <div className="min-w-0 text-left">
                                <p className="truncate text-xs font-semibold" title={attachment.file_name}>
                                  {attachment.file_name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {attachment.file_size != null
                                    ? formatFileSize(Number(attachment.file_size))
                                    : "Attached"}
                                </p>
                              </div>
                              {video && (
                                <StoredVideoPreviewButton
                                  fileName={attachment.file_name}
                                  downloadPath={`${API_URL}/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/attachments/${attachment.classwork_attachment_id}/download`}
                                  disabled={
                                    isSavingEdit ||
                                    removingAttachmentId === attachment.classwork_attachment_id
                                  }
                                />
                              )}
                            </div>
                          );
                        })}

                        {editMaterials.map((material, index) => {
                          const video = isVideoFile(material);
                          return (
                            <div
                              key={`${material.name}-${material.size}`}
                              className="flex w-full flex-col justify-between gap-2 rounded border-2 border-border bg-card p-2.5 shadow-none sm:w-44"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Badge variant="outline" size="sm" className="gap-1 px-1.5 py-0 text-[10px] uppercase tracking-wide">
                                  {video ? <Video size={11} aria-hidden="true" /> : <FileText size={11} aria-hidden="true" />}
                                  {video ? "Video" : "File"}
                                </Badge>
                                <Tooltip>
                                  <TooltipTrigger
                                    render={
                                      <button
                                        type="button"
                                        onClick={() => removeEditMaterial(index)}
                                        disabled={isSavingEdit}
                                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black bg-white text-black hover:bg-destructive hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                                        aria-label={`Remove ${material.name}`}
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    }
                                  />
                                  <TooltipContent>Remove file</TooltipContent>
                                </Tooltip>
                              </div>
                              <div className="min-w-0 text-left">
                                <p className="truncate text-xs font-semibold" title={material.name}>
                                  {material.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(material.size)}
                                </p>
                              </div>
                              {video && (
                                <VideoFilePreview file={material} disabled={isSavingEdit} />
                              )}
                            </div>
                          );
                        })}

                        <label className="flex min-h-[7rem] w-full cursor-pointer items-center justify-center gap-1.5 border-2 border-dashed border-black bg-[#F6E9B2] text-sm font-bold shadow-md hover:bg-[#7ABA78] hover:shadow-none transition-all sm:w-44">
                          <Plus size={18} />
                          <span>Add file</span>
                          <input
                            type="file"
                            multiple
                            accept=".pdf,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
                            onChange={(event) => {
                              addEditMaterials(event.target.files);
                              event.target.value = "";
                            }}
                            disabled={
                              isSavingEdit || removingAttachmentId !== null
                            }
                            className="hidden"
                          />
                        </label>
                      </div>
                    )}
                    {uploadNotice && (
                      <Alert status="warning" className="mt-3">
                        <Alert.Description>{uploadNotice}</Alert.Description>
                      </Alert>
                    )}
                    {uploadProgress !== null && (
                      <div className="mt-3 space-y-2 rounded border-2 border-border bg-card p-3" role="status" aria-live="polite">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                          <span>
                            {uploadProgress >= 100
                              ? "Processing upload on server..."
                              : `Uploading materials... ${uploadProgress}%`}
                          </span>
                          <RetroButton
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs shadow-none"
                            onClick={() => uploadAbortRef.current?.abort()}
                          >
                            Cancel upload
                          </RetroButton>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full border border-black bg-white">
                          <div
                            className={`h-full transition-[width] ${uploadProgress >= 100 ? "animate-pulse bg-[#7ABA78]" : "bg-[#7ABA78]"}`}
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </Field>
                </section>
                )}

                {(editDraft.classwork_type === "ACTIVITY" ||
                  editDraft.classwork_type === "ASSIGNMENT") && (
                    <section
                      aria-label="Scoring Rubric"
                      className="order-3 space-y-3"
                    >
                      <ActivityRubricEditor
                        levels={rubricLevels}
                        onChange={setRubricLevels}
                        disabled={
                          isSavingEdit ||
                          Boolean(currentClasswork.has_graded_submissions)
                        }
                        disabledReason={
                          currentClasswork.has_graded_submissions
                            ? "This rubric is locked because a submission has already been graded. Existing scores keep their original denominator."
                            : undefined
                        }
                        readOnly={Boolean(
                          classwork.is_graded !== false &&
                          classwork.rubric_levels?.length &&
                          classwork.assignments?.some(
                            (assignment) =>
                              assignment.source_intervention_id != null,
                          ),
                        )}
                        readOnlyMessage="Inherited from the linked original classwork. Instructions and tasks can be edited, while scoring standards remain aligned with the original classwork."
                      />
                    </section>
                  )}
              </div>

              <div className="contents">
                <section
                  aria-labelledby="edit-classwork-editable-settings"
                  className="order-1 space-y-4"
                >
                  <h3
                    id="edit-classwork-editable-settings"
                    className="text-lg font-bold"
                  >
                    Editable Settings
                  </h3>
                  {isQuizType(editDraft.classwork_type) &&
                    quizConfigurationDraft.has_attempts && (
                      <Alert status="warning" className="p-3">
                        <Alert.Title className="text-sm font-bold text-yellow-900">
                          Quiz settings locked
                        </Alert.Title>
                        <Alert.Description className="mt-1 text-sm leading-relaxed text-yellow-900">
                          A student has already started this quiz, so duration
                          and question behavior can no longer be changed.
                          Attempt limits and result-release settings remain
                          editable.
                        </Alert.Description>
                      </Alert>
                    )}
                  <div
                    className={`grid gap-4 ${isReadingType(editDraft.classwork_type)
                        ? ""
                        : isQuizType(editDraft.classwork_type)
                          ? "sm:grid-cols-2"
                          : "sm:grid-cols-2"
                      }`}
                  >
                    {!isReadingType(editDraft.classwork_type) && (
                      <Field
                        label="Due Date"
                        isRequired={
                          Boolean(targetedAssignment) &&
                          isQuizType(editDraft.classwork_type)
                        }
                      >
                        <DatePicker
                          includeTime
                          min={getMinFutureDeadlineInput()}
                          value={editDraft.due_date}
                          onValueChange={(value) => {
                            const initialDueDate =
                              classworkToEditDraft(currentClasswork).due_date;
                            const nextDeadlineError =
                              value && value !== initialDueDate
                                ? validateFutureDeadline(value)
                                : "";
                            setDueDateError(nextDeadlineError);
                            setEditDraft((current) => ({
                              ...current,
                              due_date: value,
                            }));
                          }}
                          disabled={isSavingEdit}
                          aria-invalid={Boolean(dueDateError)}
                          aria-describedby={
                            dueDateError
                              ? "edit-classwork-due-date-error"
                              : undefined
                          }
                          className="w-full bg-white border-2 border-black rounded shadow-none"
                        />
                        {dueDateError && (
                          <FormMessage id="edit-classwork-due-date-error">
                            {dueDateError}
                          </FormMessage>
                        )}
                      </Field>
                    )}

                    <Field label="Locked Until">
                      <DatePicker
                        includeTime
                        value={editDraft.lock_date}
                        onValueChange={(value) =>
                          setEditDraft((current) => ({
                            ...current,
                            lock_date: value,
                          }))
                        }
                        disabled={isSavingEdit || !editDraft.is_published}
                        className="w-full bg-white border-2 border-black rounded shadow-none"
                      />
                    </Field>

                    <Field label="Publish Status">
                      <Select
                        value={editDraft.is_published ? "published" : "draft"}
                        onValueChange={(val) =>
                          setEditDraft((current) => ({
                            ...current,
                            is_published: val === "published",
                          }))
                        }
                        disabled={isSavingEdit || draftOnly}
                      >
                        <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content className="border-2 border-black rounded bg-white">
                          <Select.Group>
                            <Select.Item value="draft">
                              Save as Draft
                            </Select.Item>
                            <Select.Item value="published">
                              Publish Now
                            </Select.Item>
                          </Select.Group>
                        </Select.Content>
                      </Select>
                      {draftOnly && (
                        <p className="mt-2 text-xs font-semibold text-muted-foreground">
                          Future-term planning remains unpublished until the
                          term is active.
                        </p>
                      )}
                    </Field>

                    {isQuizType(editDraft.classwork_type) && (
                      <div>
                        <Field label="Allowed Attempts">
                          <Input
                            type="number"
                            min="1"
                            max={targetedAssignment ? "3" : undefined}
                            step="1"
                            value={editDraft.max_attempts}
                            onChange={(event) =>
                              setEditDraft((current) => ({
                                ...current,
                                max_attempts: event.target.value,
                              }))
                            }
                            disabled={
                              isSavingEdit || !quizConfigurationDraft.loaded
                            }
                            className="w-full bg-white border-2 border-black rounded shadow-md"
                          />
                        </Field>
                      </div>
                    )}
                  </div>

                  {isQuizType(editDraft.classwork_type) && (
                    <div className="space-y-3">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Field label="Duration (minutes)">
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              value={quizConfigurationDraft.duration_minutes}
                              onChange={(event) =>
                                setQuizConfigurationDraft((current) => ({
                                  ...current,
                                  duration_minutes: event.target.value,
                                }))
                              }
                              disabled={
                                isSavingEdit ||
                                !quizConfigurationDraft.loaded ||
                                quizConfigurationDraft.has_attempts
                              }
                              placeholder="No time limit"
                              className="w-full bg-white border-2 border-black rounded shadow-md"
                            />
                          </Field>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <ClassworkSettingRow
                          label="Shuffle questions"
                          tooltip="Shows quiz questions in a different order for each attempt."
                          checked={quizConfigurationDraft.is_shuffle_questions}
                          onCheckedChange={(checked) =>
                            setQuizConfigurationDraft((current) => ({
                              ...current,
                              is_shuffle_questions: checked,
                            }))
                          }
                          disabled={
                            isSavingEdit ||
                            !quizConfigurationDraft.loaded ||
                            quizConfigurationDraft.has_attempts
                          }
                        />
                        <ClassworkSettingRow
                          label="Shuffle answer choices"
                          tooltip="Randomizes multiple-choice answer options for each student during the quiz attempt."
                          checked={quizConfigurationDraft.is_shuffle_options}
                          onCheckedChange={(checked) =>
                            setQuizConfigurationDraft((current) => ({
                              ...current,
                              is_shuffle_options: checked,
                            }))
                          }
                          disabled={
                            isSavingEdit ||
                            !quizConfigurationDraft.loaded ||
                            quizConfigurationDraft.has_attempts
                          }
                        />
                        <ClassworkSettingRow
                          label="Per-question scoring"
                          tooltip="Keeps each quiz question's configured point value."
                          checked={
                            quizConfigurationDraft.enable_per_question_scoring
                          }
                          onCheckedChange={(checked) =>
                            setQuizConfigurationDraft((current) => ({
                              ...current,
                              enable_per_question_scoring: checked,
                            }))
                          }
                          disabled={
                            isSavingEdit ||
                            !quizConfigurationDraft.loaded ||
                            quizConfigurationDraft.has_attempts
                          }
                        />
                        <ClassworkSettingRow
                          label="Per-question time limits"
                          tooltip="Uses the quiz's existing per-question timing behavior."
                          checked={
                            quizConfigurationDraft.enable_per_question_time_limits
                          }
                          onCheckedChange={(checked) =>
                            setQuizConfigurationDraft((current) => ({
                              ...current,
                              enable_per_question_time_limits: checked,
                            }))
                          }
                          disabled={
                            isSavingEdit ||
                            !quizConfigurationDraft.loaded ||
                            quizConfigurationDraft.has_attempts
                          }
                        />
                      </div>
                    </div>
                  )}

                  {isQuizType(editDraft.classwork_type) && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Quiz Results Release">
                        <Select
                          value={quizResultsReleasePolicy}
                          onValueChange={(val) =>
                            setQuizResultsReleasePolicy(
                              val as QuizResultsReleasePolicy,
                            )
                          }
                          disabled={isSavingEdit || !quizResultsDraft.loaded}
                        >
                          <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
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
                        {quizResultsDraft.show_quiz_results === null && (
                          <p className="mt-1 text-xs font-semibold text-amber-700">
                            This legacy quiz has mixed visibility settings and is treated as hidden. Choosing a release option will safely unify them.
                          </p>
                        )}
                      </Field>

                      {quizResultsReleasePolicy === "SCHEDULED" ? (
                        <Field label="Release Date & Time" isRequired>
                          <DatePicker
                            includeTime
                            aria-label="Release Date & Time"
                            value={quizResultsDraft.summary_release_at}
                            onValueChange={(value) =>
                              setQuizResultsDraft((current) => ({
                                ...current,
                                summary_release_at: value,
                              }))
                            }
                            disabled={isSavingEdit || !quizResultsDraft.loaded}
                            className="w-full bg-white border-2 border-black rounded shadow-md"
                          />
                        </Field>
                      ) : (
                        <div className="flex flex-col justify-end">
                          <div className="rounded! border-2 border-dashed bg-[#FFFBEE] px-3 py-2 text-xs text-gray-600 flex items-center min-h-[42px]">
                            {quizResultsReleasePolicy === "AFTER_DUE_DATE"
                              ? "Results unlock automatically after the due date."
                              : quizResultsReleasePolicy === "HIDDEN"
                                ? "Scores and answer feedback remain hidden from students."
                                : "Students can view results right after submitting."}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex flex-col gap-3">
                    {!isQuizType(editDraft.classwork_type) &&
                    !isReadingType(editDraft.classwork_type) ? (
                      <ClassworkSettingRow
                        label="Show scores to students"
                        tooltip="When enabled, students can view their score and teacher-published feedback on their submission view once graded. When disabled, approved feedback and scores remain hidden from students."
                        checked={editDraft.show_scores}
                        onCheckedChange={(checked) =>
                          setEditDraft((current) => ({
                            ...current,
                            show_scores: checked,
                          }))
                        }
                        disabled={isSavingEdit}
                      />
                    ) : null}

                    {autoAiSupported && (
                      <ClassworkSettingRow
                        label="Automatic AI Feedback"
                        tooltip={
                          isQuizType(editDraft.classwork_type)
                            ? "Automatically prepares a private AI feedback draft after grading. Teachers review and approve feedback before it is posted; student visibility still waits for Quiz Results Release and retake protections."
                            : "Automatically prepares a feedback draft after grading. When contextual AI is authorized and feedback focus points are selected, AI can use those evaluation points. Otherwise, a score-based template is prepared. Submitted files and links are not read by AI. Teachers must review and approve feedback before students can see it."
                        }
                        checked={editDraft.auto_ai_feedback_enabled}
                        onCheckedChange={(checked) =>
                          setEditDraft((current) => ({
                            ...current,
                            auto_ai_feedback_enabled: checked,
                          }))
                        }
                        disabled={isSavingEdit}
                      />
                    )}

                    {editDraft.due_date &&
                      !isReadingType(editDraft.classwork_type) && (
                        <ClassworkSettingRow
                          label="Allow late submissions"
                          checked={editDraft.allow_late_submissions}
                          onCheckedChange={(checked) =>
                            setEditDraft((current) => ({
                              ...current,
                              allow_late_submissions: checked,
                            }))
                          }
                          disabled={isSavingEdit}
                        />
                      )}
                  </div>
                </section>

                <section
                  aria-label={
                    isInterventionCreatedReading
                      ? "Resource recipients"
                      : targetedAssignment
                      ? "Assigned student"
                      : "Assign to Sections"
                  }
                  className={
                    isInterventionCreatedReading ? "order-2" : "order-4"
                  }
                >
                  {isInterventionCreatedReading ? (
                    recipientScopeError ? (
                      <Alert status="error">
                        <Alert.Title className="font-bold">
                          Recipient settings unavailable
                        </Alert.Title>
                        <Alert.Description className="text-inherit">
                          {recipientScopeError}
                        </Alert.Description>
                      </Alert>
                    ) : recipientScope && recipientScopes ? (
                      <InterventionResourceRecipientSelector
                        value={recipientScope}
                        onChange={setRecipientScope}
                        scopes={recipientScopes}
                        fallbackStudentName="Study Support student"
                        fallbackClassName="original class"
                        fallbackSubjectName={
                          currentClasswork.subject_name || "this subject"
                        }
                        disabled={isSavingEdit}
                        label="Share reading with"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Loading recipient settings...
                      </p>
                    )
                  ) : targetedAssignment ? (
                    <Field
                      label="Assigned student"
                      className="gap-2 [&>span]:text-lg [&>span]:font-bold"
                    >
                      <Card className="flex items-center gap-3 border-2 border-primary bg-primary/10 p-3 shadow-none">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded border-2 border-black bg-primary">
                          <UserCheck className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold">
                            {targetedAssignment.recipient_student_name ||
                              "Intervention student"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Automatically assigned only to this student through
                            Intervention #
                            {targetedAssignment.source_intervention_id}.
                          </p>
                        </div>
                      </Card>
                    </Field>
                  ) : (
                    <Field
                      label="Assign to Sections"
                      className="gap-2 [&>span]:text-lg [&>span]:font-bold"
                    >
                      {selectedSubjectLoads.length > 0 && (
                        <div className="flex items-center justify-end -mt-8 mb-2">
                          <Button
                            size="sm"
                            className="shadow-none -mt-1"
                            autoIcon={false}
                            onClick={() =>
                              setSelectedClassIds(
                                selectedSubjectLoads.map(
                                  (load) => load.class_id,
                                ),
                              )
                            }
                            disabled={isSavingEdit}
                          >
                            <CheckCheck className="size-4 mr-2" />
                            Select All
                          </Button>
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
                                disabled={isSavingEdit}
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
                                      className={`flex size-5 shrink-0 items-center justify-center rounded border-2 border-black transition-colors ${isSelected
                                          ? "bg-black text-white"
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
                    </Field>
                  )}
                </section>
              </div>
            </section>

            <Dialog.Footer position="fixed">
              <NoChangesMessage message={changes.noChangesMessage} />
              <div className="flex w-full justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={isSavingEdit}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={() => void saveClassworkEdit()}
                  disabled={
                    isSavingEdit ||
                    removingAttachmentId !== null ||
                    !changes.hasChanges
                  }
                  className="cursor-pointer"
                >
                  <Check size={16} />
                  {isSavingEdit
                    ? uploadProgress !== null && uploadProgress >= 100
                      ? "Processing..."
                      : "Saving..."
                    : "Save Changes"}
                </Button>
              </div>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>
      <Dialog
        open={rubricConfirmation !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingEdit) setRubricConfirmation(null);
        }}
      >
        {rubricConfirmation && (
          <Dialog.Content className="max-w-md">
            <Dialog.Header>
              <Text as="h5" className="font-sans text-xl font-bold">
                Update Rubric?
              </Text>
            </Dialog.Header>
            <div className="px-5 py-5 text-sm text-foreground">
              This classwork already has student submissions. Rubric changes
              will apply when these submissions are graded.
            </div>
            <Dialog.Footer className="mt-0">
              <RetroButton
                variant="outline"
                onClick={() => setRubricConfirmation(null)}
                disabled={isSavingEdit}
              >
                Cancel
              </RetroButton>
              <RetroButton
                onClick={() => {
                  setRubricConfirmation(null);
                  void saveClassworkEdit({ rubricConfirmed: true });
                }}
                disabled={isSavingEdit}
              >
                Save Changes
              </RetroButton>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>
      <Dialog
        open={quizRevealConfirmation}
        onOpenChange={(open) => {
          if (!open && !isSavingEdit) setQuizRevealConfirmation(false);
        }}
      >
        {quizRevealConfirmation && (
          <Dialog.Content className="max-w-md">
            <Dialog.Header>
              <Text as="h5" className="font-sans text-xl font-bold">
                Reveal Quiz Results?
              </Text>
            </Dialog.Header>
            <div className="px-5 py-5 text-sm text-foreground">
              This setting enables both student scores and correct answers
              according to the selected release schedule. Confirm if you want
              students to see these quiz results.
            </div>
            <Dialog.Footer className="mt-0">
              <RetroButton
                variant="outline"
                onClick={() => setQuizRevealConfirmation(false)}
                disabled={isSavingEdit}
              >
                Cancel
              </RetroButton>
              <RetroButton
                onClick={() => {
                  setQuizRevealConfirmation(false);
                  void saveClassworkEdit({ quizRevealConfirmed: true });
                }}
                disabled={isSavingEdit}
              >
                Confirm &amp; Save
              </RetroButton>
            </Dialog.Footer>
          </Dialog.Content>
        )}
      </Dialog>
    </>
  );
}
