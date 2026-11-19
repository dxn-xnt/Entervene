"use client";

import { DatePicker } from "@/components/retroui/DatePicker";
import { useState, useEffect, useMemo } from "react";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { unorderedValues, optionalNumber } from "@/lib/form-changes";
import { NoChangesMessage } from "@/components/retroui/FormMessage";
import { Check, CheckCheck, FileText, Plus, Trash2, UserCheck } from "lucide-react";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/teacher/button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Button as RetroButton } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Alert } from "@/components/retroui/Alert";
import { ClassworkSettingRow } from "@/components/classwork-setting-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { useToast } from "@/components/retroui/Toast";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { apiFetch } from "@/lib/api";
import {
  allowedClassworkMaterialExtensions,
  classworkToEditDraft,
  fileExtension,
  formatFileSize,
  isQuizType,
  isReadingType,
  maxClassworkMaterialSize,
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
import { activityRubricMaximum, defaultActivityRubric, validateActivityRubric } from "@/lib/classwork-utils";
import { ReferenceLinkEditor } from "@/components/classwork-reference-links";
import { validateReferenceLinks, type ReferenceLinkDraft } from "@/lib/classwork-reference-links";
import { toDateTimeLocal } from "@/lib/classwork-utils";

type QuizReleaseMode = "IMMEDIATE" | "SCHEDULED" | "AFTER_DUE_DATE" | "NEVER";

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
  enable_per_question_scoring: boolean;
  enable_per_question_time_limits: boolean;
  max_attempts: string;
};

const defaultQuizConfigurationDraft = (maxAttempts: string): QuizConfigurationDraft => ({
  loaded: false,
  has_attempts: false,
  duration_minutes: "",
  is_shuffle_questions: false,
  enable_per_question_scoring: true,
  enable_per_question_time_limits: false,
  max_attempts: maxAttempts,
});

const quizConfigurationComparable = (draft: QuizConfigurationDraft) => ({
  duration_minutes: draft.duration_minutes,
  is_shuffle_questions: draft.is_shuffle_questions,
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
  summary_release_at: draft.summary_release_mode === "SCHEDULED" ? draft.summary_release_at : "",
});

const editReferenceLinks = (classwork: TeacherClasswork): ReferenceLinkDraft[] =>
  (classwork.reference_links ?? []).map((link) => ({ url: link.url, title: link.title ?? "" }));

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
  const [currentClasswork, setCurrentClasswork] = useState<TeacherClasswork>(classwork);
  const [editDraft, setEditDraft] = useState<EditDraft>(() =>
    classworkToEditDraft(classwork),
  );
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [rubricConfirmation, setRubricConfirmation] = useState<"submitted" | null>(null);
  const [editMaterials, setEditMaterials] = useState<File[]>([]);
  const [referenceLinks, setReferenceLinks] = useState<ReferenceLinkDraft[]>(() => editReferenceLinks(classwork));
  const [removingAttachmentId, setRemovingAttachmentId] = useState<number | null>(null);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>(() =>
    classwork.assignments?.map((assignment) => assignment.class_id) ?? [],
  );
  const [availableLessons, setAvailableLessons] = useState<TeacherLesson[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>(() =>
    classwork.linked_lessons?.map((lesson) => lesson.lesson_id) ?? [],
  );
  const [isLessonLoading, setIsLessonLoading] = useState(false);
  const [rubricLevels, setRubricLevels] = useState<ActivityRubricLevel[]>(() =>
    classwork.rubric_levels?.length
      ? classwork.rubric_levels.map((level) => ({ ...level }))
      : defaultActivityRubric.map((level) => ({ ...level })),
  );
  const [initialQuizResults, setInitialQuizResults] = useState<QuizResultsDraft>(() =>
    defaultQuizResultsDraft(classwork.show_scores ?? true),
  );
  const [quizResultsDraft, setQuizResultsDraft] = useState<QuizResultsDraft>(() =>
    defaultQuizResultsDraft(classwork.show_scores ?? true),
  );
  const [initialQuizConfiguration, setInitialQuizConfiguration] = useState<QuizConfigurationDraft>(() =>
    defaultQuizConfigurationDraft(classworkToEditDraft(classwork).max_attempts),
  );
  const [quizConfigurationDraft, setQuizConfigurationDraft] = useState<QuizConfigurationDraft>(() =>
    defaultQuizConfigurationDraft(classworkToEditDraft(classwork).max_attempts),
  );
  const [quizRevealConfirmation, setQuizRevealConfirmation] = useState(false);
  const toast = useToast();
  const targetedAssignment = useMemo(
    () => currentClasswork.assignments?.find(
      (assignment) => assignment.recipient_student_id && assignment.source_intervention_id,
    ) ?? null,
    [currentClasswork.assignments],
  );

  const autoAiSupported = useMemo(() => {
    if (targetedAssignment) return false;
    const type = editDraft.classwork_type?.toUpperCase();
    if (type === "QUIZ" || type === "ASSIGNMENT") return true;
    if (type === "ACTIVITY" && (currentClasswork.activity_mode || "ONLINE").toUpperCase() === "ONLINE") return true;
    return false;
  }, [targetedAssignment, editDraft.classwork_type, currentClasswork.activity_mode]);

  const setFormError = (msg: string) => {
    toast.error({ title: msg });
  };

  useEffect(() => {
    if (!isOpen) return;
    if (targetedAssignment) {
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
  }, [isOpen, targetedAssignment]);

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
    const fallbackQuizResults = defaultQuizResultsDraft(classwork.show_scores ?? true);
    setInitialQuizResults(fallbackQuizResults);
    setQuizResultsDraft(fallbackQuizResults);
    const fallbackQuizConfiguration = defaultQuizConfigurationDraft(classworkToEditDraft(classwork).max_attempts);
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
        const showCorrectAnswers = settings ? Boolean(settings.show_correct_answers) : showScores;
        const mode = (settings?.summary_release_mode || "IMMEDIATE") as QuizReleaseMode;
        const loaded: QuizResultsDraft = {
          loaded: true,
          show_quiz_results: showScores === showCorrectAnswers ? showScores : null,
          legacy_show_scores: showScores,
          legacy_show_correct_answers: showCorrectAnswers,
          summary_release_mode: mode,
          summary_release_at: mode === "SCHEDULED" ? toDateTimeLocal(settings?.summary_release_at) : "",
        };
        setInitialQuizResults(loaded);
        setQuizResultsDraft(loaded);
        const configuration: QuizConfigurationDraft = {
          loaded: true,
          has_attempts: Boolean(body.has_attempts),
          duration_minutes: body.duration_minutes == null ? "" : String(body.duration_minutes),
          is_shuffle_questions: Boolean(settings?.is_shuffle_questions),
          enable_per_question_scoring: settings?.enable_per_question_scoring !== false,
          enable_per_question_time_limits: Boolean(settings?.enable_per_question_time_limits),
          max_attempts: String(settings?.max_attempts ?? classworkToEditDraft(classwork).max_attempts),
        };
        setInitialQuizConfiguration(configuration);
        setQuizConfigurationDraft(configuration);
        setEditDraft((current) => ({ ...current, max_attempts: configuration.max_attempts }));
      })
      .catch(() => {
        if (!isActive) return;
        setInitialQuizResults((current) => ({ ...current, loaded: true }));
        setQuizResultsDraft((current) => ({ ...current, loaded: true }));
        setInitialQuizConfiguration((current) => ({ ...current, loaded: true }));
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
                (l) =>
                  Number(l.subject_id) === subjectIdNum && !l.is_archived,
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
    const invalid = selectedFiles.find(
      (file) =>
        !allowedClassworkMaterialExtensions.includes(fileExtension(file.name)),
    );
    if (invalid) {
      setFormError(
        `${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`,
      );
      return;
    }
    const oversized = selectedFiles.find(
      (file) => file.size > maxClassworkMaterialSize,
    );
    if (oversized) {
      setFormError(`${oversized.name} is larger than the 10 MB limit.`);
      return;
    }
    setEditMaterials((current) => {
      const existing = new Set(
        current.map((file) => `${file.name}-${file.size}`),
      );
      return [
        ...current,
        ...selectedFiles.filter(
          (file) => !existing.has(`${file.name}-${file.size}`),
        ),
      ];
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
    const hasRubric = draft.classwork_type === "ACTIVITY" || draft.classwork_type === "ASSIGNMENT";
    return {
      ...draft,
      title: draft.title.trim(), description: draft.description.trim(),
      instructions: draft.instructions.trim(),
      total_points: hasRubric ? activityRubricMaximum(levels) : isReadingType(draft.classwork_type) ? null : optionalNumber(draft.total_points),
      max_attempts: isQuizType(draft.classwork_type) ? Number(draft.max_attempts) : null,
      show_scores: isQuizType(draft.classwork_type) ? null : draft.show_scores,
      rubric: hasRubric ? levels : null,
    };
  };
  const changes = useEditFormChanges({
    resetKey: `${isOpen}:${classwork.classwork_id}:${initialQuizResults.loaded}:${initialQuizConfiguration.loaded}`,
    initialValues: {
      draft: draftValues(classworkToEditDraft(classwork), classwork.rubric_levels?.length ? classwork.rubric_levels : defaultActivityRubric),
      quizResults: isQuizType(classwork.classwork_type) ? quizResultsComparable(initialQuizResults) : null,
      quizConfiguration: isQuizType(classwork.classwork_type) ? quizConfigurationComparable(initialQuizConfiguration) : null,
      classes: unorderedValues([...new Set(classwork.assignments?.map(item => item.class_id) ?? [])]),
      lessons: unorderedValues(classwork.linked_lessons?.map(item => item.lesson_id) ?? []),
      files: [],
      referenceLinks: editReferenceLinks(classwork),
    },
    values: {
      draft: draftValues(editDraft, rubricLevels),
      quizResults: isQuizType(editDraft.classwork_type) ? quizResultsComparable(quizResultsDraft) : null,
      quizConfiguration: isQuizType(editDraft.classwork_type) ? quizConfigurationComparable({ ...quizConfigurationDraft, max_attempts: editDraft.max_attempts }) : null,
      classes: unorderedValues([...new Set(selectedClassIds)]),
      lessons: unorderedValues(selectedLessonIds),
      files: editMaterials.map(file => [file.name, file.size, file.lastModified, file.type]),
      referenceLinks,
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
    const linksError = validateReferenceLinks(referenceLinks);
    if (linksError) {
      setFormError(linksError);
      return;
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
    if (
      isQuiz &&
      (!Number.isInteger(attempts) || attempts <= 0)
    ) {
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
      JSON.stringify(quizConfigurationComparable({ ...quizConfigurationDraft, max_attempts: editDraft.max_attempts })) !==
      JSON.stringify(quizConfigurationComparable(initialQuizConfiguration));
    if (quizConfigurationChanged && quizConfigurationDraft.has_attempts) {
      setFormError("Quiz duration, attempt limits, and question behavior cannot be changed after an attempt has started.");
      return;
    }
    const duration = quizConfigurationDraft.duration_minutes.trim() === ""
      ? null
      : Number(quizConfigurationDraft.duration_minutes);
    if (isQuiz && (duration !== null && (!Number.isInteger(duration) || duration <= 0))) {
      setFormError("Quiz duration must be a positive whole number.");
      return;
    }
    if (quizResultsChanged) {
      if (
        quizResultsDraft.summary_release_mode === "SCHEDULED" &&
        !quizResultsDraft.summary_release_at
      ) {
        setFormError("Select a quiz results release date and time.");
        return;
      }
      if (
        quizResultsDraft.summary_release_mode === "AFTER_DUE_DATE" &&
        !editDraft.due_date
      ) {
        setFormError("Set a quiz due date before releasing results after the due date.");
        return;
      }
      const releaseChanged =
        quizResultsDraft.summary_release_mode !== initialQuizResults.summary_release_mode ||
        (quizResultsDraft.summary_release_mode === "SCHEDULED" &&
          quizResultsDraft.summary_release_at !== initialQuizResults.summary_release_at);
      const visibilityTurnedOn =
        quizResultsDraft.show_quiz_results === true &&
        initialQuizResults.show_quiz_results !== true;
      const answersWillBeEnabled =
        quizResultsDraft.show_quiz_results === true ||
        (quizResultsDraft.show_quiz_results === null && initialQuizResults.legacy_show_correct_answers);
      const couldRevealAnswers =
        visibilityTurnedOn ||
        (releaseChanged && quizResultsDraft.summary_release_mode !== "NEVER" && answersWillBeEnabled);
      if (couldRevealAnswers && !quizRevealConfirmed) {
        setQuizRevealConfirmation(true);
        return;
      }
    }
    if (selectedClassIds.length === 0) {
      setFormError("Select at least one section to assign.");
      return;
    }

    const isLinkedRemediationRubricLocked = Boolean(
      classwork.is_graded !== false &&
      classwork.rubric_levels?.length &&
      classwork.assignments?.some((assignment) => assignment.source_intervention_id != null),
    );
    const originalRubric = classwork.rubric_levels ?? [];
    const rubricChanged =
      hasRubric &&
      !isLinkedRemediationRubricLocked &&
      JSON.stringify(rubricLevels) !== JSON.stringify(originalRubric);
    if (rubricChanged && currentClasswork.has_graded_submissions) {
      setFormError("The rubric and maximum score cannot be changed after a submission has been graded.");
      return;
    }
    if (
      rubricChanged &&
      currentClasswork.has_submissions
    ) {
      if (!rubricConfirmed) {
        setRubricConfirmation("submitted");
        return;
      }
    }

    const publishValue = draftOnly ? false : editDraft.is_published;
    setIsSavingEdit(true);
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editDraft.title.trim(),
            description: editDraft.description.trim() || null,
            instructions: editDraft.instructions.trim() || null,
            classwork_type: editDraft.classwork_type,
            classwork_category: editDraft.classwork_category || null,
            exam_subtype: editDraft.exam_subtype || null,
            total_points: totalPoints,
            rubric_levels: hasRubric && rubricChanged ? rubricLevels : undefined,
            confirm_rubric_change:
              rubricChanged && Boolean(currentClasswork.has_submissions),
            is_published: publishValue,
            show_scores: isQuiz ? undefined : editDraft.show_scores,
            auto_ai_feedback_enabled: autoAiSupported ? editDraft.auto_ai_feedback_enabled : false,
            lesson_ids: selectedLessonIds,
            reference_links: JSON.stringify(referenceLinks) === JSON.stringify(editReferenceLinks(currentClasswork))
                ? undefined
                : referenceLinks.map((link) => ({ url: link.url.trim(), title: link.title.trim() || null })),
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
              return field ? `${field}: ${e.msg}` : (e.msg || "Validation error");
            })
            .join("; ");
          throw new Error(msgs || "Validation error");
        }
        throw new Error(
          typeof detail === "string"
            ? detail
            : detail && typeof detail === "object" && typeof detail.message === "string"
              ? detail.message
              : "Unable to update classwork.",
        );
      }

      let updated = (await response.json()) as TeacherClasswork;
      if (selectedClassIds.length > 0) {
        const assignResponse = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/assign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              class_ids: selectedClassIds,
              due_date: editDraft.due_date
                ? new Date(editDraft.due_date).toISOString()
                : null,
              lock_date: editDraft.lock_date
                ? new Date(editDraft.lock_date).toISOString()
                : null,
              allow_late_submissions: editDraft.allow_late_submissions,
              max_attempts: isQuiz
                ? Number(initialQuizConfiguration.max_attempts || attempts)
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
                const field = (e.loc || []).filter((x) => x !== "body").join(".");
                return field ? `${field}: ${e.msg}` : (e.msg || "Validation error");
              })
              .join("; ");
            throw new Error(msgs || "Validation error");
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
              enable_per_question_scoring: quizConfigurationDraft.enable_per_question_scoring,
              enable_per_question_time_limits: quizConfigurationDraft.enable_per_question_time_limits,
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
              show_quiz_results: quizResultsDraft.show_quiz_results,
              summary_release_mode: quizResultsDraft.summary_release_mode,
              summary_release_at:
                quizResultsDraft.summary_release_mode === "SCHEDULED" &&
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
          if (detail && typeof detail === "object" && detail.code === "QUIZ_RESULTS_REVEAL_CONFIRMATION_REQUIRED") {
            setQuizRevealConfirmation(true);
            return;
          }
          const message =
            typeof detail === "string"
              ? detail
              : detail && typeof detail === "object" && typeof detail.message === "string"
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
        const uploadedAttachments: ClassworkAttachment[] = [];
        for (let i = 0; i < editMaterials.length; i++) {
          const material = editMaterials[i];
          const formData = new FormData();
          formData.append("file", material);
          const uploadResponse = await apiFetch(
            `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/attachments`,
            { method: "POST", body: formData },
          );
          if (!uploadResponse.ok) {
            const body = await uploadResponse.json().catch(() => ({}));
            const uploadErrMsg =
              body.detail || `Unable to upload ${material.name}.`;

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
          const uploadedAtt = (await uploadResponse.json()) as ClassworkAttachment;
          uploadedAttachments.push(uploadedAtt);
        }
        setEditMaterials([]);
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
      setFormError(
        err instanceof Error ? err.message : "Unable to update classwork.",
      );
    } finally {
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
                <section aria-labelledby="edit-classwork-basic-information" className="order-0 grid gap-3">
                  <h3
                    id="edit-classwork-basic-information"
                    className="border-b-2 border-border pb-2 text-base font-bold"
                  >
                    Basic Information
                  </h3>
                <Field label="Link Lesson">
                  <Select
                    value={selectedLessonIds[0] ? String(selectedLessonIds[0]) : ""}
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
                    onValueChange={(v) =>
                      setEditDraft((current) => ({
                        ...current,
                        classwork_type: v,
                      }))
                    }
                    disabled={isSavingEdit}
                  >
                    <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black rounded bg-white">
                      <Select.Group>
                        <Select.Item value="READING">Reading</Select.Item>
                        <Select.Item value="ACTIVITY">Activity</Select.Item>
                        <Select.Item value="ASSIGNMENT">Assignment</Select.Item>
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
                    className={`grid gap-4 ${editDraft.classwork_category === "QUARTERLY_ASSESSMENT" ||
                      editDraft.classwork_category === "EXAMS" ||
                      (editDraft.classwork_type !== "ACTIVITY" &&
                        editDraft.classwork_type !== "ASSIGNMENT")
                      ? "sm:grid-cols-2"
                      : ""
                      }`}
                  >
                    <Field label="Grading Component">
                      <Select
                        value={editDraft.classwork_category || "NONE"}
                        onValueChange={(val) =>
                          setEditDraft((current) => ({
                            ...current,
                            classwork_category: val === "NONE" ? "" : val,
                          }))
                        }
                        disabled={isSavingEdit}
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
                    </Field>

                    {(editDraft.classwork_category === "QUARTERLY_ASSESSMENT" ||
                      editDraft.classwork_category === "EXAMS") && (
                        <Field label="Exam Sub-type">
                          <Select
                            value={editDraft.exam_subtype || "SUMMATIVE_1"}
                            onValueChange={(val) =>
                              setEditDraft((current) => ({
                                ...current,
                                exam_subtype: val,
                              }))
                            }
                            disabled={isSavingEdit}
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
                            onChange={(event) =>
                              setEditDraft((current) => ({
                                ...current,
                                total_points: event.target.value,
                              }))
                            }
                            disabled={isSavingEdit}
                            className="w-full bg-white border-2 border-black rounded shadow-md"
                          />
                        </Field>
                      )}
                  </div>
                )}

                </section>

                <section
                  aria-labelledby="edit-classwork-reference-materials"
                  className="order-2 space-y-3 border-t-2 border-border pt-4"
                >
                  <h3
                    id="edit-classwork-reference-materials"
                    className="text-base font-bold"
                  >
                    Reference Links / Materials
                  </h3>

                  <ReferenceLinkEditor links={referenceLinks} onChange={setReferenceLinks} disabled={isSavingEdit} />

                <Field label="Upload Material">
                  {currentClasswork.attachments.length === 0 &&
                    editMaterials.length === 0 ? (
                    <Empty className="shadow-md hover:shadow-none transition-shadow rounded!">
                      <EmptyHeader>
                        <EmptyTitle>No Materials Added</EmptyTitle>
                        <EmptyDescription className="flex flex-col -gap-3 text-center whitespace-nowrap">
                          <span className="font-semibold">Max 10mb</span>
                          <span>(pdf, docx, pptx, jpg & png)</span>
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
                              accept=".pdf,.docx,.ppt,.pptx,.jpg,.jpeg,.png"
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
                      {currentClasswork.attachments.map((attachment) => (
                        <div
                          key={attachment.classwork_attachment_id}
                          className="relative flex h-32 w-28 border-2 border-border flex-col justify-between p-2 text-center shadow-none"
                        >
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="absolute right-1 top-1 inline-flex">
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
                                    className="flex h-6 w-6 items-center justify-center rounded-full border border-black bg-white text-black hover:bg-destructive hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                                    aria-label={`Remove ${attachment.file_name}`}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </span>
                              }
                            />
                            <TooltipContent>Remove file</TooltipContent>
                          </Tooltip>
                          <FileText className="mx-auto mt-5" size={22} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">
                              {attachment.file_name}
                            </p>
                            <p className="text-xs text-muted-foreground">Attached</p>
                          </div>
                        </div>
                      ))}

                      {editMaterials.map((material, index) => (
                        <div
                          key={`${material.name}-${material.size}`}
                          className="relative flex h-32 w-28 border-2 border-border flex-col justify-between p-2 text-center shadow-none"
                        >
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="absolute right-1 top-1 inline-flex">
                                  <button
                                    type="button"
                                    onClick={() => removeEditMaterial(index)}
                                    disabled={isSavingEdit}
                                    className="flex h-6 w-6 items-center justify-center rounded-full border border-black bg-white text-black hover:bg-destructive hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                                    aria-label={`Remove ${material.name}`}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </span>
                              }
                            />
                            <TooltipContent>Remove file</TooltipContent>
                          </Tooltip>
                          <FileText className="mx-auto mt-5" size={22} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">
                              {material.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(material.size)}
                            </p>
                          </div>
                        </div>
                      ))}

                      <label className="flex h-32 w-28 cursor-pointer items-center justify-center border-2 border-dashed border-black bg-[#F6E9B2] text-sm font-bold shadow-md hover:bg-[#7ABA78] hover:shadow-none transition-all">
                        <Plus size={20} />
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.docx,.ppt,.pptx,.jpg,.jpeg,.png"
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
                  </Field>
                </section>

                {(editDraft.classwork_type === "ACTIVITY" ||
                  editDraft.classwork_type === "ASSIGNMENT") && (
                    <section
                      aria-label="Scoring Rubric"
                      className="order-3 space-y-3 border-t-2 border-border pt-4"
                    >
                      <ActivityRubricEditor
                        levels={rubricLevels}
                        onChange={setRubricLevels}
                        disabled={isSavingEdit || Boolean(currentClasswork.has_graded_submissions)}
                        disabledReason={currentClasswork.has_graded_submissions
                          ? "This rubric is locked because a submission has already been graded. Existing scores keep their original denominator."
                          : undefined}
                        readOnly={Boolean(
                          classwork.is_graded !== false &&
                          classwork.rubric_levels?.length &&
                          classwork.assignments?.some((assignment) => assignment.source_intervention_id != null),
                        )}
                        readOnlyMessage="Inherited from the linked original classwork. Instructions and tasks can be edited, while scoring standards remain aligned with the original classwork."
                      />
                    </section>
                  )}
              </div>

              <div className="contents">
                <section
                  aria-labelledby="edit-classwork-editable-settings"
                  className="order-1 space-y-4 border-t-2 border-border pt-4"
                >
                  <h3
                    id="edit-classwork-editable-settings"
                    className="text-base font-bold"
                  >
                    Editable Settings
                  </h3>
                <div
                  className={`grid gap-4 ${isReadingType(editDraft.classwork_type)
                    ? ""
                    : isQuizType(editDraft.classwork_type)
                      ? "sm:grid-cols-2"
                      : "sm:grid-cols-2"
                    }`}
                >
                  {!isReadingType(editDraft.classwork_type) && (
                    <Field label="Due Date">
                      <DatePicker
                        includeTime
                        value={editDraft.due_date}
                        onValueChange={(value) =>
                          setEditDraft((current) => ({
                            ...current,
                            due_date: value,
                          }))
                        }
                        disabled={isSavingEdit}
                        className="w-full bg-white border-2 border-black rounded shadow-md"
                      />
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
                      className="w-full bg-white border-2 border-black rounded shadow-md"
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
                          <Select.Item value="draft">Save as Draft</Select.Item>
                          <Select.Item value="published">Publish Now</Select.Item>
                        </Select.Group>
                      </Select.Content>
                    </Select>
                    {draftOnly && (
                      <p className="mt-2 text-xs font-semibold text-muted-foreground">
                        Future-term planning remains unpublished until the term is active.
                      </p>
                    )}
                  </Field>

                  {isQuizType(editDraft.classwork_type) && (
                    <div>
                      <Field label="Allowed Attempts">
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={editDraft.max_attempts}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              max_attempts: event.target.value,
                            }))
                          }
                          disabled={isSavingEdit || !quizConfigurationDraft.loaded || quizConfigurationDraft.has_attempts}
                          className="w-full bg-white border-2 border-black rounded shadow-md"
                        />
                      </Field>
                      {quizConfigurationDraft.has_attempts && (
                        <p className="text-xs font-medium text-amber-700 mt-1">
                          Locked because students have already attempted this quiz.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {isQuizType(editDraft.classwork_type) && (
                  <div className="space-y-3">
                    {quizConfigurationDraft.has_attempts && (
                      <Alert status="warning">
                        <Alert.Description>
                          Quiz duration, attempt limits, and question behavior are locked because a student has already started an attempt. Result-release settings remain editable.
                        </Alert.Description>
                      </Alert>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Field label="Duration (minutes)">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={quizConfigurationDraft.duration_minutes}
                            onChange={(event) => setQuizConfigurationDraft((current) => ({
                              ...current,
                              duration_minutes: event.target.value,
                            }))}
                            disabled={isSavingEdit || !quizConfigurationDraft.loaded || quizConfigurationDraft.has_attempts}
                            placeholder="No time limit"
                            className="w-full bg-white border-2 border-black rounded shadow-md"
                          />
                        </Field>
                        {quizConfigurationDraft.has_attempts && (
                          <p className="text-xs font-medium text-amber-700 mt-1">
                            Locked because students have already attempted this quiz.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <ClassworkSettingRow
                        label="Shuffle questions"
                        tooltip="Shows quiz questions in a different order for each attempt."
                        checked={quizConfigurationDraft.is_shuffle_questions}
                        onCheckedChange={(checked) => setQuizConfigurationDraft((current) => ({ ...current, is_shuffle_questions: checked }))}
                        disabled={isSavingEdit || !quizConfigurationDraft.loaded || quizConfigurationDraft.has_attempts}
                        disabledReason={quizConfigurationDraft.has_attempts ? "Locked because students have already attempted this quiz." : undefined}
                      />
                      <ClassworkSettingRow
                        label="Per-question scoring"
                        tooltip="Keeps each quiz question's configured point value."
                        checked={quizConfigurationDraft.enable_per_question_scoring}
                        onCheckedChange={(checked) => setQuizConfigurationDraft((current) => ({ ...current, enable_per_question_scoring: checked }))}
                        disabled={isSavingEdit || !quizConfigurationDraft.loaded || quizConfigurationDraft.has_attempts}
                        disabledReason={quizConfigurationDraft.has_attempts ? "Locked because students have already attempted this quiz." : undefined}
                      />
                      <ClassworkSettingRow
                        label="Per-question time limits"
                        tooltip="Uses the quiz's existing per-question timing behavior."
                        checked={quizConfigurationDraft.enable_per_question_time_limits}
                        onCheckedChange={(checked) => setQuizConfigurationDraft((current) => ({ ...current, enable_per_question_time_limits: checked }))}
                        disabled={isSavingEdit || !quizConfigurationDraft.loaded || quizConfigurationDraft.has_attempts}
                        disabledReason={quizConfigurationDraft.has_attempts ? "Locked because students have already attempted this quiz." : undefined}
                      />
                    </div>
                  </div>
                )}

                {isQuizType(editDraft.classwork_type) && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Quiz Summary Availability">
                      <Select
                        value={quizResultsDraft.summary_release_mode}
                        onValueChange={(val) =>
                          setQuizResultsDraft((current) => ({
                            ...current,
                            summary_release_mode: val as QuizReleaseMode,
                            summary_release_at: val === "SCHEDULED" ? current.summary_release_at : "",
                          }))
                        }
                        disabled={isSavingEdit || !quizResultsDraft.loaded}
                      >
                        <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md">
                          <Select.Value placeholder="Select Release Mode" />
                        </Select.Trigger>
                        <Select.Content className="border-2 border-black rounded bg-white">
                          <Select.Group>
                            <Select.Item value="IMMEDIATE">Immediately after submission</Select.Item>
                            <Select.Item value="SCHEDULED">At a specific date &amp; time</Select.Item>
                            <Select.Item value="AFTER_DUE_DATE">After the quiz due date</Select.Item>
                            <Select.Item value="NEVER">Never</Select.Item>
                          </Select.Group>
                        </Select.Content>
                      </Select>
                    </Field>

                    {quizResultsDraft.summary_release_mode === "SCHEDULED" ? (
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
                          {quizResultsDraft.summary_release_mode === "AFTER_DUE_DATE"
                            ? "Summary unlocks automatically after the due date."
                            : quizResultsDraft.summary_release_mode === "NEVER"
                              ? "Students cannot view the quiz answer summary."
                              : "Students can view the summary right after submitting."}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  {isQuizType(editDraft.classwork_type) ? (
                    <div className="space-y-1.5">
                      <ClassworkSettingRow
                        label="Show quiz results to students"
                        tooltip="Controls student access to quiz scores and correct answers. When enabled, results unlock according to the configured release schedule (immediately, after due date, or scheduled time) and max attempt policies. Enabling this does not necessarily release correct answers immediately. When disabled, quiz results remain hidden."
                        checked={quizResultsDraft.show_quiz_results === true}
                        onCheckedChange={(checked) =>
                          setQuizResultsDraft((current) => ({
                            ...current,
                            show_quiz_results: checked,
                          }))
                        }
                        disabled={isSavingEdit || !quizResultsDraft.loaded}
                      />
                      {quizResultsDraft.show_quiz_results === null && (
                        <p className="text-xs font-semibold text-amber-700">
                          Current setting is mixed (scores {quizResultsDraft.legacy_show_scores ? "visible" : "hidden"}, correct answers {quizResultsDraft.legacy_show_correct_answers ? "visible" : "hidden"}). Use the switch above to unify them; leaving it untouched preserves the current split.
                        </p>
                      )}
                    </div>
                  ) : !isReadingType(editDraft.classwork_type) ? (
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
                          ? "Automatically prepares an AI feedback draft after grading when quiz result-release and attempt restrictions permit. Teachers review and approve feedback before it is posted. Correct-answer visibility remains subject to the quiz release settings."
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
                  aria-label={targetedAssignment ? "Assigned student" : "Assign to Sections"}
                  className="order-4 border-t-2 border-border pt-4"
                >
                  {targetedAssignment ? (
                    <Field label="Assigned student">
                      <Card className="flex items-center gap-3 border-2 border-primary bg-primary/10 p-3 shadow-none">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded border-2 border-black bg-primary">
                          <UserCheck className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold">
                            {targetedAssignment.recipient_student_name || "Intervention student"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Automatically assigned only to this student through Intervention #{targetedAssignment.source_intervention_id}.
                          </p>
                        </div>
                      </Card>
                    </Field>
                  ) : (
                    <Field label="Assign to Sections">
                      {selectedSubjectLoads.length > 0 && (
                        <div className="flex items-center justify-end -mt-8 mb-2">
                          <Button
                            size="sm"
                            className="shadow-none -mt-1"
                            autoIcon={false}
                            onClick={() =>
                              setSelectedClassIds(
                                selectedSubjectLoads.map((load) => load.class_id),
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
                            const isSelected = selectedClassIds.includes(load.class_id);
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
                  disabled={isSavingEdit || removingAttachmentId !== null || !changes.hasChanges}
                  className="cursor-pointer"
                >
                  <Check size={16} />
                  Save Changes
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
              This classwork already has student submissions. Rubric changes will apply when these submissions are graded.
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
              This setting enables both student scores and correct answers according to the selected release schedule. Confirm if you want students to see these quiz results.
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
