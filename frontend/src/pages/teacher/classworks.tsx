import {
  ArrowDownAZ,
  ArrowUpDown,
  Archive,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import AttachmentDisplay from "@/components/AttachmentDisplay";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { API_URL, apiFetch } from "@/lib/api";
import ClassworkCard from "./classworks/ClassworkCard";
import type {
  QuizAnalysis,
  QuizImportPreview,
  QuizQuestionDraft,
  QuizQuestionType,
  QuizSettingsDraft,
} from "./classworks/quiz-builder-types";
import { createEmptyQuizQuestion, defaultQuizSettings } from "./classworks/quiz-builder-utils";
import {
  allowedClassworkMaterialExtensions,
  classworkToEditDraft,
  emptyClassworkDraft,
  fileExtension,
  formatFileSize,
  isQuizType,
  isReadingType,
  maxClassworkMaterialSize,
  scoreBand,
  submissionStatusLabel,
} from "@/lib/classwork-utils";
import type {
  AssignmentTracking,
  ClassworkAttachment,
  ClassworkKind,
  CreateDraft,
  CreateStep,
  EditDraft,
  SortMode,
  TabId,
  TeacherClassLoad,
  TeacherClasswork,
  TeacherLesson,
  TeacherSubmissionDetail,
  TrackingStudent,
} from "@/types/classwork";

const tabs: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "all", label: "All", icon: ClipboardList },
  { id: "readings", label: "Readings", icon: BookOpen },
  { id: "activities", label: "Activities", icon: CheckSquare },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "quizzes", label: "Quizzes", icon: ClipboardList },
];

const createOptions: Array<{
  type: ClassworkKind;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "READING",
    title: "Reading",
    description: "Create and publish class topics or resources for learners",
    icon: BookOpen,
  },
  {
    type: "QUIZ",
    title: "Quiz",
    description: "Build and assign quizzes to assess learner understanding",
    icon: ClipboardList,
  },
  {
    type: "ASSIGNMENT",
    title: "Assignment",
    description: "Post tasks or projects for students to complete and submit",
    icon: FileText,
  },
  {
    type: "ACTIVITY",
    title: "Activity",
    description: "Design interactive tasks to enhance learner engagement",
    icon: CheckSquare,
  },
];

const tabType: Partial<Record<TabId, string>> = {
  readings: "READING",
  activities: "ACTIVITY",
  assignments: "ASSIGNMENT",
  quizzes: "QUIZ",
};

export default function Classworks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const suppressAutoOpenRef = useRef(false);
  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("type");
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [draft, setDraft] = useState<CreateDraft>(emptyClassworkDraft);
  const [materials, setMaterials] = useState<File[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionDraft[]>([
    createEmptyQuizQuestion(1),
  ]);
  const [quizSettings, setQuizSettings] =
    useState<QuizSettingsDraft>(defaultQuizSettings);
  const [quizImportWarnings, setQuizImportWarnings] = useState<string[]>([]);
  const [isImportingQuiz, setIsImportingQuiz] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [availableLessons, setAvailableLessons] = useState<TeacherLesson[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>([]);
  const [isLessonLoading, setIsLessonLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
  const [tracking, setTracking] = useState<AssignmentTracking | null>(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
  const [quizAnalysis, setQuizAnalysis] = useState<QuizAnalysis | null>(null);
  const [isQuizAnalysisLoading, setIsQuizAnalysisLoading] = useState(false);
  const [quizAnalysisError, setQuizAnalysisError] = useState("");
  const [isArchiving, setIsArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editMaterials, setEditMaterials] = useState<File[]>([]);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<number | null>(null);
  const [isUploadingEditMaterials, setIsUploadingEditMaterials] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [submissionSort, setSubmissionSort] = useState<"name" | "score">(
    "name",
  );
  const [selectedStudent, setSelectedStudent] =
    useState<TrackingStudent | null>(null);
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] =
    useState<TeacherSubmissionDetail | null>(null);
  const [isSubmissionLoading, setIsSubmissionLoading] = useState(false);
  const [submissionDetailError, setSubmissionDetailError] = useState("");
  const [gradeError, setGradeError] = useState("");
  const [gradeDraft, setGradeDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [isPostingGrade, setIsPostingGrade] = useState(false);
  const [gradeSuccess, setGradeSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClassworks = useCallback(async () => {
    // Load real teacher-owned classworks plus active class targets for filters and creation.
    setIsLoading(true);
    setError("");
    try {
      const [classworksResponse, loadsResponse] = await Promise.all([
        apiFetch("/api/v1/classwork-assignments/my-classworks"),
        apiFetch("/api/v1/classwork-assignments/teacher/classes"),
      ]);
      if (!classworksResponse.ok || !loadsResponse.ok) {
        throw new Error("Unable to load your classworks.");
      }
      const loadData = (await loadsResponse.json()) as TeacherClassLoad[];
      setItems((await classworksResponse.json()) as TeacherClasswork[]);
      setLoads(loadData);
      setDraft((current) =>
        current.subject_id || !loadData[0]
          ? current
          : { ...current, subject_id: String(loadData[0].subject_id) },
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load your classworks.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClassworks();
  }, [loadClassworks]);

  const subjects = useMemo(
    () =>
      Array.from(
        new Map(
          loads.map((load) => [
            load.subject_id,
            { id: load.subject_id, name: load.subject_name },
          ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [loads],
  );

  const selectedSubjectLoads = useMemo(
    () =>
      loads
        .filter(
          (load) =>
            draft.subject_id && load.subject_id === Number(draft.subject_id),
        )
        .sort((a, b) => a.section_name.localeCompare(b.section_name)),
    [draft.subject_id, loads],
  );

  const filteredItems = useMemo(() => {
    const targetType = tabType[activeTab];
    const normalizedSearch = search.trim().toLowerCase();
    const result = items.filter((item) => {
      const matchesType =
        !targetType || item.classwork_type.toUpperCase() === targetType;
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.subject_name?.toLowerCase().includes(normalizedSearch);
      const matchesSubject =
        subjectFilter === "all" || item.subject_id === Number(subjectFilter);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "published" ? item.is_published : !item.is_published);
      return matchesType && matchesSearch && matchesSubject && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const first = new Date(a.created_at ?? 0).getTime();
      const second = new Date(b.created_at ?? 0).getTime();
      return sortMode === "oldest" ? first - second : second - first;
    });
  }, [activeTab, items, search, sortMode, statusFilter, subjectFilter]);

  const openCreateWizard = () => {
    const preferredType = tabType[activeTab] as ClassworkKind | undefined;
    setSelectedType(preferredType ?? null);
    setCreateStep(
      preferredType === "QUIZ" ? "quiz-source" : preferredType ? "details" : "type",
    );
    setDraft({
      ...emptyClassworkDraft,
      classwork_category:
        preferredType === "QUIZ" ? "PERIODICAL_EXAM" : "WRITTEN_WORK",
      subject_id: subjects[0] ? String(subjects[0].id) : "",
    });
    setMaterials([]);
    setQuizQuestions([createEmptyQuizQuestion(1)]);
    setQuizSettings({
      ...defaultQuizSettings,
      max_attempts: emptyClassworkDraft.max_attempts || "1",
    });
    setQuizImportWarnings([]);
    setSelectedClassIds([]);
    setAvailableLessons([]);
    setSelectedLessonIds([]);
    setCreateError("");
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    if (isCreating) return;
    setShowCreateWizard(false);
    setCreateStep("type");
    setSelectedType(null);
    setDraft(emptyClassworkDraft);
    setMaterials([]);
    setQuizQuestions([createEmptyQuizQuestion(1)]);
    setQuizSettings(defaultQuizSettings);
    setQuizImportWarnings([]);
    setIsImportingQuiz(false);
    setSelectedClassIds([]);
    setAvailableLessons([]);
    setSelectedLessonIds([]);
    setCreateError("");
  };

  const chooseType = (type: ClassworkKind) => {
    setSelectedType(type);
    setDraft((current) => ({
      ...current,
      classwork_category: type === "QUIZ" ? "PERIODICAL_EXAM" : "WRITTEN_WORK",
    }));
    if (type === "QUIZ") {
      setMaterials([]);
      setQuizQuestions([createEmptyQuizQuestion(1)]);
      setQuizSettings({
        ...defaultQuizSettings,
        max_attempts: draft.max_attempts || "1",
      });
    }
    setCreateStep(type === "QUIZ" ? "quiz-source" : "details");
    setCreateError("");
  };

  const addMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find(
      (file) => !allowedClassworkMaterialExtensions.includes(fileExtension(file.name)),
    );
    if (invalid) {
      setCreateError(
        `${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`,
      );
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > maxClassworkMaterialSize);
    if (oversized) {
      setCreateError(`${oversized.name} is larger than the 4 MB limit.`);
      return;
    }
    setCreateError("");
    setMaterials((current) => {
      const existing = new Set(current.map((file) => `${file.name}-${file.size}`));
      return [
        ...current,
        ...selectedFiles.filter((file) => !existing.has(`${file.name}-${file.size}`)),
      ];
    });
  };

  const removeMaterial = (index: number) => {
    setMaterials((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const quizPointTotal = useMemo(
    () =>
      quizQuestions.reduce((total, question) => {
        const points = Number(question.points);
        return total + (Number.isFinite(points) ? points : 0);
      }, 0),
    [quizQuestions],
  );

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
      createEmptyQuizQuestion(current.length + 1, questionType),
    ]);
  };

  const useManualQuizBuilder = () => {
    setQuizImportWarnings([]);
    setCreateStep("details");
  };

  const importQuizFile = async (file: File | null) => {
    if (!file) return;
    setIsImportingQuiz(true);
    setCreateError("");
    setQuizImportWarnings([]);
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
      const importedQuestions = preview.questions.map((question, index) => {
        const draft = createEmptyQuizQuestion(index + 1, question.question_type);

        return {
          ...draft,
          question_text: question.question_text,
          question_type: question.question_type,
          points: String(question.points || 1),
          display_order: index + 1,
          difficulty_level: question.difficulty_level || "MEDIUM",
          explanation: question.explanation || "",
          options:
            question.question_type === "MULTIPLE_CHOICE"
              ? question.options.map((option, optionIndex) => ({
                  option_text: option.option_text,
                  is_correct: option.is_correct,
                  option_order: optionIndex + 1,
                }))
              : [],
        };
      });
      setQuizQuestions(importedQuestions.length > 0 ? importedQuestions : [createEmptyQuizQuestion(1)]);
      setQuizImportWarnings(preview.warnings);
      setDraft((current) => ({
        ...current,
        title: current.title || preview.title || "",
        instructions: current.instructions,
        total_points: String(importedQuestions.reduce((sum, question) => sum + Number(question.points || 0), 0) || current.total_points),
      }));
      setCreateStep("details");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unable to import quiz file.");
    } finally {
      setIsImportingQuiz(false);
    }
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

  const addQuizOption = (questionId: string) => {
    setQuizQuestions((current) =>
      current.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: [
                ...question.options,
                {
                  option_text: "",
                  is_correct: false,
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
        if (question.id !== questionId || question.options.length <= 2) {
          return question;
        }
        const nextOptions = question.options
          .filter((_, index) => index !== optionIndex)
          .map((option, index) => ({ ...option, option_order: index + 1 }));
        if (!nextOptions.some((option) => option.is_correct)) {
          nextOptions[0] = { ...nextOptions[0], is_correct: true };
        }
        return { ...question, options: nextOptions };
      }),
    );
  };

  const validateQuizBuilder = () => {
    if (!isQuizType(selectedType)) return "";
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
    if (quizSettings.summary_release_mode === "SCHEDULED" && !quizSettings.summary_release_at) {
      return "Choose when the quiz summary should be released.";
    }
    if (quizSettings.summary_release_mode === "AFTER_DUE_DATE" && !draft.due_date) {
      return "Set a quiz due date before releasing the summary after the due date.";
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

    return "";
  };

  const buildQuizPayload = () => ({
    duration_minutes: quizSettings.duration_minutes
      ? Number(quizSettings.duration_minutes)
      : null,
    status: "READY",
    settings: {
      is_shuffle_questions: quizSettings.is_shuffle_questions,
      enable_per_question_scoring: quizSettings.enable_per_question_scoring,
      enable_per_question_time_limits:
        quizSettings.enable_per_question_time_limits,
      max_attempts: Number(quizSettings.max_attempts || draft.max_attempts),
      show_correct_answers: quizSettings.show_correct_answers,
      summary_release_mode: quizSettings.summary_release_mode,
      summary_release_at:
        quizSettings.summary_release_mode === "SCHEDULED" && quizSettings.summary_release_at
          ? new Date(quizSettings.summary_release_at).toISOString()
          : null,
    },
    questions: quizQuestions.map((question, index) => ({
      question_text: question.question_text.trim(),
      question_type: question.question_type,
      points: Number(question.points),
      display_order: index + 1,
      difficulty_level: question.difficulty_level,
      explanation: question.explanation.trim() || null,
      lesson_id: null,
      options:
        question.question_type === "MULTIPLE_CHOICE"
          ? question.options.map((option, optionIndex) => ({
              option_text: option.option_text.trim(),
              is_correct: option.is_correct,
              option_order: optionIndex + 1,
            }))
          : [],
    })),
  });

  const addEditMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find((file) => !allowedClassworkMaterialExtensions.includes(fileExtension(file.name)));
    if (invalid) {
      setDetailError(`${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`);
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > maxClassworkMaterialSize);
    if (oversized) {
      setDetailError(`${oversized.name} is larger than the 4 MB limit.`);
      return;
    }
    setDetailError("");
    setEditMaterials((current) => {
      const existing = new Set(current.map((file) => `${file.name}-${file.size}`));
      return [
        ...current,
        ...selectedFiles.filter((file) => !existing.has(`${file.name}-${file.size}`)),
      ];
    });
  };

  const removeEditMaterial = (index: number) => {
    setEditMaterials((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const toggleClass = (classId: number) => {
    setSelectedClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const toggleLesson = (lessonId: number) => {
    setSelectedLessonIds((current) =>
      current.includes(lessonId)
        ? current.filter((id) => id !== lessonId)
        : [...current, lessonId],
    );
  };

  const validateDetails = () => {
    if (!selectedType) return "Choose a classwork type.";
    if (!draft.subject_id) return "Choose a subject.";
    if (!draft.title.trim()) return "Topic title is required.";
    if (!isReadingType(selectedType)) {
      const points = Number(draft.total_points);
      if (draft.total_points && (!Number.isFinite(points) || points <= 0)) {
        return "Total points must be greater than zero.";
      }
    }
    if (isQuizType(selectedType)) {
      const attempts = Number(draft.max_attempts);
      if (!Number.isInteger(attempts) || attempts <= 0) {
        return "Allowed attempts must be a positive whole number.";
      }
    }
    return "";
  };

  const goToAssignStep = () => {
    const validationError = validateDetails();
    if (validationError) {
      setCreateError(validationError);
      return;
    }
    if (isQuizType(selectedType) && createStep === "details") {
      setCreateError("");
      setCreateStep("quiz");
      return;
    }
    const quizValidationError = validateQuizBuilder();
    if (quizValidationError) {
      setCreateError(quizValidationError);
      setCreateStep("quiz");
      return;
    }
    setSelectedClassIds((current) => {
      const validIds = new Set(
        selectedSubjectLoads.map((load) => load.class_id),
      );
      return current.filter((id) => validIds.has(id));
    });
    setCreateError("");
    setCreateStep("assign");
  };

  useEffect(() => {
    if (createStep !== "assign" || !draft.subject_id || selectedClassIds.length === 0) {
      setAvailableLessons([]);
      setSelectedLessonIds([]);
      return;
    }

    let isActive = true;
    setIsLessonLoading(true);

    const loadEligibleLessons = async () => {
      try {
        const lessonGroups = await Promise.all(
          selectedClassIds.map(async (classId) => {
            const response = await apiFetch(
              `/api/v1/lessons/my-class/${classId}/subject/${draft.subject_id}`,
            );
            if (!response.ok) {
              throw new Error("Unable to load lessons for selected sections.");
            }
            return (await response.json()) as TeacherLesson[];
          }),
        );

        if (!isActive) return;

        const commonIds = lessonGroups.reduce<Set<number> | null>((current, group) => {
          const groupIds = new Set(group.map((lesson) => lesson.lesson_id));
          if (!current) return groupIds;
          return new Set([...current].filter((id) => groupIds.has(id)));
        }, null);
        const uniqueLessons = new Map<number, TeacherLesson>();
        lessonGroups.flat().forEach((lesson) => {
          if (commonIds?.has(lesson.lesson_id)) {
            uniqueLessons.set(lesson.lesson_id, lesson);
          }
        });
        const lessons = [...uniqueLessons.values()].sort(
          (a, b) =>
            (a.order_index ?? 0) - (b.order_index ?? 0) ||
            a.title.localeCompare(b.title),
        );

        setAvailableLessons(lessons);
        setSelectedLessonIds((current) =>
          current.filter((id) => uniqueLessons.has(id)),
        );
        setCreateError("");
      } catch (err) {
        if (!isActive) return;
        setAvailableLessons([]);
        setSelectedLessonIds([]);
        setCreateError(
          err instanceof Error
            ? err.message
            : "Unable to load lessons for selected sections.",
        );
      } finally {
        if (isActive) {
          setIsLessonLoading(false);
        }
      }
    };

    void loadEligibleLessons();
    return () => {
      isActive = false;
    };
  }, [createStep, draft.subject_id, selectedClassIds]);

  const createClasswork = async () => {
    // Use the atomic backend endpoint so create/upload/assign cannot partially succeed.
    const validationError = validateDetails();
    if (validationError) {
      setCreateError(validationError);
      setCreateStep("details");
      return;
    }
    const quizValidationError = validateQuizBuilder();
    if (quizValidationError) {
      setCreateError(quizValidationError);
      setCreateStep("quiz");
      return;
    }
    if (selectedClassIds.length === 0) {
      setCreateError("Select at least one section to assign this classwork.");
      return;
    }
    if (selectedLessonIds.length === 0) {
      setCreateError("Select the lesson where this classwork should appear.");
      return;
    }

    setIsCreating(true);
    setCreateError("");
    try {
      if (!selectedType) {
        throw new Error("Select a classwork type first.");
      }
      const isReading = isReadingType(selectedType);
      const totalPoints = !isReading && draft.total_points
        ? Number(draft.total_points)
        : null;
      const formData = new FormData();
      formData.append("title", draft.title.trim());
      formData.append("description", draft.description.trim());
      formData.append("instructions", draft.instructions.trim());
      formData.append("classwork_type", selectedType);
      if (draft.classwork_category) {
        formData.append("classwork_category", draft.classwork_category);
      }
      if (totalPoints !== null) {
        formData.append("total_points", String(totalPoints));
      }
      formData.append("subject_id", String(draft.subject_id));
      formData.append("is_published", String(draft.is_published));
      formData.append("class_ids", JSON.stringify(selectedClassIds));
      formData.append("lesson_ids", JSON.stringify(selectedLessonIds));
      if (draft.due_date) {
        formData.append("due_date", new Date(draft.due_date).toISOString());
      }
      formData.append("allow_late_submissions", String(draft.allow_late_submissions));
      if (draft.lock_date) {
        formData.append("lock_date", new Date(draft.lock_date).toISOString());
      }
      if (isQuizType(selectedType)) {
        formData.append("max_attempts", String(Number(draft.max_attempts)));
        formData.append("quiz_payload", JSON.stringify(buildQuizPayload()));
      }
      // Quiz imports are parsed into questions, so generic attachments are skipped for quizzes.
      if (!isQuizType(selectedType)) {
        materials.forEach((material) => formData.append("files", material));
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
        throw new Error(body.detail || "Unable to create classwork.");
      }
      await createResponse.json();

      await loadClassworks();
      closeCreateWizard();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Unable to create classwork.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const openClassworkDetail = useCallback(async (item: TeacherClasswork) => {
    suppressAutoOpenRef.current = false;
    setSelected(item);
    setTracking(null);
    setQuizAnalysis(null);
    setQuizAnalysisError("");
    setDetailError("");
    setIsEditing(false);
    setEditDraft(classworkToEditDraft(item));
    setEditMaterials([]);
    setSearchParams({ classworkId: String(item.classwork_id) });

    const assignmentId = item.assignments?.[0]?.classwork_assignment_id;
    if (!assignmentId) return;

    setIsTrackingLoading(true);
    if (isQuizType(item.classwork_type)) {
      setIsQuizAnalysisLoading(true);
    }
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/tracking`,
      );
      if (!response.ok) {
        throw new Error("Unable to load student submissions.");
      }
      setTracking((await response.json()) as AssignmentTracking);
      if (isQuizType(item.classwork_type)) {
        const analysisResponse = await apiFetch(
          `/api/v1/quizzes/classwork/${item.classwork_id}/analysis`,
        );
        if (!analysisResponse.ok) {
          const body = await analysisResponse.json().catch(() => ({}));
          throw new Error(body.detail || "Unable to load quiz analysis.");
        }
        setQuizAnalysis((await analysisResponse.json()) as QuizAnalysis);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load student submissions.";
      if (isQuizType(item.classwork_type)) {
        setQuizAnalysisError(message);
      } else {
        setDetailError(message);
      }
    } finally {
      setIsTrackingLoading(false);
      setIsQuizAnalysisLoading(false);
    }
  }, [setSearchParams]);

  useEffect(() => {
    const classworkId = Number(searchParams.get("classworkId"));
    if (!classworkId) {
      suppressAutoOpenRef.current = false;
      return;
    }
    if (suppressAutoOpenRef.current || selected?.classwork_id === classworkId) return;
    const target = items.find((item) => item.classwork_id === classworkId);
    if (target) {
      void openClassworkDetail(target);
    }
  }, [items, openClassworkDetail, searchParams, selected?.classwork_id]);

  const closeClassworkDetail = () => {
    if (isArchiving || isSavingEdit) return;
    // Prevent the URL sync effect from reopening the detail during close.
    suppressAutoOpenRef.current = true;
    setSelected(null);
    setTracking(null);
    setQuizAnalysis(null);
    setQuizAnalysisError("");
    setIsQuizAnalysisLoading(false);
    setShowArchiveConfirm(false);
    setIsEditing(false);
    setEditDraft(null);
    setEditMaterials([]);
    setSearchParams({}, { replace: true });
    setDetailError("");
    setSelectedStudent(null);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
  };

  const saveClassworkEdit = async () => {
    if (!selected || !editDraft) return;

    const isReading = isReadingType(editDraft.classwork_type);
    const totalPoints = !isReading && editDraft.total_points ? Number(editDraft.total_points) : null;
    if (!editDraft.title.trim()) {
      setDetailError("Classwork title is required.");
      return;
    }
    if (totalPoints !== null && (!Number.isFinite(totalPoints) || totalPoints <= 0)) {
      setDetailError("Total points must be greater than zero.");
      return;
    }
    const attempts = Number(editDraft.max_attempts);
    if (isQuizType(editDraft.classwork_type) && (!Number.isInteger(attempts) || attempts <= 0)) {
      setDetailError("Allowed attempts must be a positive whole number.");
      return;
    }

    setIsSavingEdit(true);
    setDetailError("");
    try {
      const response = await apiFetch(`/api/v1/classwork-assignments/classwork/${selected.classwork_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editDraft.title.trim(),
          description: editDraft.description.trim() || null,
          instructions: editDraft.instructions.trim() || null,
          classwork_type: editDraft.classwork_type,
          classwork_category: editDraft.classwork_category || null,
          total_points: totalPoints,
          is_published: editDraft.is_published,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to update classwork.");
      }

      let updated = (await response.json()) as TeacherClasswork;
      const assignedClassIds = selected.assignments?.map((assignment) => assignment.class_id) ?? [];
      if (assignedClassIds.length > 0) {
        const assignResponse = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/assign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              class_ids: assignedClassIds,
              due_date: editDraft.due_date ? new Date(editDraft.due_date).toISOString() : null,
              lock_date: editDraft.lock_date ? new Date(editDraft.lock_date).toISOString() : null,
              allow_late_submissions: editDraft.allow_late_submissions,
              max_attempts: isQuizType(editDraft.classwork_type) ? attempts : null,
              is_published: editDraft.is_published,
            }),
          },
        );
        if (!assignResponse.ok) {
          const body = await assignResponse.json().catch(() => ({}));
          throw new Error(body.detail || "Unable to update assignment settings.");
        }
        const refreshed = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${selected.classwork_id}`,
        );
        if (refreshed.ok) {
          updated = (await refreshed.json()) as TeacherClasswork;
        }
      }
      setItems((current) =>
        current.map((item) => item.classwork_id === updated.classwork_id ? updated : item)
      );
      setSelected(updated);
      setEditDraft(classworkToEditDraft(updated));
      setIsEditing(false);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to update classwork.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const uploadEditMaterials = async () => {
    if (!selected || editMaterials.length === 0) return;

    setIsUploadingEditMaterials(true);
    setDetailError("");
    try {
      const uploaded: ClassworkAttachment[] = [];
      for (const material of editMaterials) {
        const formData = new FormData();
        formData.append("file", material);
        const response = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/attachments`,
          { method: "POST", body: formData }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Unable to upload ${material.name}.`);
        }
        uploaded.push((await response.json()) as ClassworkAttachment);
      }

      const updated = { ...selected, attachments: [...selected.attachments, ...uploaded] };
      setSelected(updated);
      setItems((current) =>
        current.map((item) => item.classwork_id === updated.classwork_id ? updated : item)
      );
      setEditMaterials([]);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to upload classwork material.");
    } finally {
      setIsUploadingEditMaterials(false);
    }
  };

  const removeSelectedAttachment = async (attachmentId: number) => {
    if (!selected) return;

    setRemovingAttachmentId(attachmentId);
    setDetailError("");
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to remove classwork material.");
      }

      const updated = {
        ...selected,
        attachments: selected.attachments.filter(
          (attachment) => attachment.classwork_attachment_id !== attachmentId
        ),
      };
      setSelected(updated);
      setItems((current) =>
        current.map((item) => item.classwork_id === updated.classwork_id ? updated : item)
      );
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to remove classwork material.");
    } finally {
      setRemovingAttachmentId(null);
    }
  };

  const archiveSelectedClasswork = async () => {
    if (!selected) return;

    setIsArchiving(true);
    setDetailError("");
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/archive`,
        { method: "PUT" }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to archive classwork.");
      }

      setItems((current) => current.filter((item) => item.classwork_id !== selected.classwork_id));
      setShowArchiveConfirm(false);
      setSelected(null);
      setTracking(null);
      setSelectedStudent(null);
      setSelectedSubmissionDetail(null);
      setSearchParams({});
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Unable to archive classwork.");
    } finally {
      setIsArchiving(false);
    }
  };

  const openStudentSubmission = async (student: TrackingStudent) => {
    // Opens the teacher review view for a single student's submission.
    setSelectedStudent(student);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
    setGradeDraft(
      student.grade !== null && student.grade !== undefined
        ? String(student.grade)
        : "",
    );
    setFeedbackDraft("");

    if (!student.submission_id) return;

    setIsSubmissionLoading(true);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/${student.submission_id}/detail`,
      );
      if (!response.ok) {
        throw new Error("Unable to load submission detail.");
      }
      const detail = (await response.json()) as TeacherSubmissionDetail;
      setSelectedSubmissionDetail(detail);
      setGradeDraft(
        detail.grade !== null && detail.grade !== undefined
          ? String(detail.grade)
          : "",
      );
      setFeedbackDraft(detail.feedback ?? "");
    } catch (err) {
      setSubmissionDetailError(
        err instanceof Error
          ? err.message
          : "Unable to load submission detail.",
      );
    } finally {
      setIsSubmissionLoading(false);
    }
  };

  const closeStudentSubmission = () => {
    setSelectedStudent(null);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
  };

  const postGrade = async () => {
    // Grade endpoint doubles as update, so teachers can correct scores/feedback.
    if (!selectedSubmissionDetail || !selected) return;
    const grade = Number(gradeDraft);
    if (!Number.isFinite(grade) || grade < 0) {
      setGradeError("Enter a valid score.");
      return;
    }
    if (
      selected.total_points !== null &&
      selected.total_points !== undefined &&
      grade > selected.total_points
    ) {
      setGradeError(`Score cannot be greater than ${selected.total_points}.`);
      return;
    }

    setIsPostingGrade(true);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
    try {
      const response = await apiFetch(
        `/api/v1/submissions/${selectedSubmissionDetail.submission_id}/grade`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grade,
            feedback: feedbackDraft.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to post grade.");
      }
      const updated = (await response.json()) as TeacherSubmissionDetail;
      setSelectedSubmissionDetail(updated);
      setSelectedStudent((current) =>
        current
          ? { ...current, status: updated.status, grade: updated.grade ?? null }
          : current,
      );
      setTracking((current) => {
        if (!current) return current;
        const updateRow = (row: TrackingStudent) =>
          row.submission_id === updated.submission_id
            ? { ...row, status: updated.status, grade: updated.grade ?? null }
            : row;
        return {
          ...current,
          submitted: current.submitted.map(updateRow),
          missing: current.missing.map(updateRow),
        };
      });
      setGradeSuccess("Grade and feedback saved.");
    } catch (err) {
      setGradeError(
        err instanceof Error ? err.message : "Unable to post grade.",
      );
    } finally {
      setIsPostingGrade(false);
    }
  };

  const cycleSort = () => {
    setSortMode((current) =>
      current === "newest"
        ? "oldest"
        : current === "oldest"
          ? "title"
          : "newest",
    );
  };

  const selectedTypeOption = createOptions.find(
    (option) => option.type === selectedType,
  );
  const createStepTotal = isQuizType(selectedType) ? 5 : 3;
  const createStepNumber =
    createStep === "type"
      ? 1
      : createStep === "quiz-source"
        ? 2
      : createStep === "details"
        ? isQuizType(selectedType)
          ? 3
          : 2
        : createStep === "quiz"
          ? 4
          : createStepTotal;
  const createStepTitle =
    createStep === "type"
      ? "Create new classwork"
      : createStep === "quiz-source"
        ? "Create quiz"
      : createStep === "details"
        ? `Create ${selectedTypeOption?.title.toLowerCase() || "classwork"}`
        : createStep === "quiz"
          ? "Build quiz questions"
          : `Assign ${selectedTypeOption?.title.toLowerCase() || "classwork"}`;
  const selectedAssignment = selected?.assignments?.[0] ?? null;
  const trackingRows = useMemo(() => {
    const rows = [...(tracking?.submitted ?? []), ...(tracking?.missing ?? [])];
    return rows.sort((a, b) => {
      if (submissionSort === "score") {
        return (b.grade ?? -1) - (a.grade ?? -1);
      }
      return a.student_name.localeCompare(b.student_name);
    });
  }, [submissionSort, tracking]);

  return (
    <AppLayout>
      {selected ? (
        <main className="min-h-screen bg-[#F8F6ED] px-5 py-5">
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-black/30 pb-4 text-lg font-bold">
            <button
              type="button"
              onClick={closeClassworkDetail}
              className="rounded-full p-1 hover:bg-black/10"
              aria-label="Back to classworks"
            >
              <X size={20} />
            </button>
            <span>
              {selectedAssignment?.title ||
                selected.subject_name ||
                "Classwork"}
            </span>
            <span className="text-black/50">›</span>
            <span>...</span>
            <span className="text-black/50">›</span>
            <span>{selectedStudent?.student_name || selected.title}</span>
          </div>

          <section className="mx-auto max-w-5xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={
                  selectedStudent
                    ? closeStudentSubmission
                    : closeClassworkDetail
                }
                className="rounded-full border border-transparent p-1 hover:border-black"
                aria-label="Back"
              >
                ‹
              </button>
              <FileText size={24} />
              <h1 className="text-3xl font-bold">{selected.title}</h1>
              </div>
              {!selectedStudent && (
                <div className="flex flex-wrap gap-2">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        setEditDraft(classworkToEditDraft(selected));
                        setDetailError("");
                      }}
                      disabled={isSavingEdit}
                      className="rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm font-bold hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveClassworkEdit}
                      disabled={isSavingEdit}
                      className="rounded-lg border border-black bg-[#7ABA78] px-3 py-2 text-sm font-bold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
                    >
                      {isSavingEdit ? "Saving..." : "Save Changes"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditDraft(classworkToEditDraft(selected));
                      setIsEditing(true);
                      setDetailError("");
                    }}
                    disabled={isArchiving}
                    className="inline-flex items-center gap-2 rounded-lg border border-black bg-white px-3 py-2 text-sm font-bold hover:bg-[#F6E9B2] disabled:opacity-50"
                  >
                    <Pencil size={16} />
                    Edit Classwork
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(true)}
                  disabled={isArchiving || isEditing}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-400 bg-white px-3 py-2 text-sm font-bold text-red-700 transition hover:border-red-700 hover:bg-red-600 hover:text-white disabled:opacity-50 disabled:hover:border-red-400 disabled:hover:bg-white disabled:hover:text-red-700"
                >
                  <Archive size={16} />
                  {isArchiving ? "Archiving..." : "Archive Classwork"}
                </button>
                </div>
              )}
            </div>

            {selectedStudent ? (
              // Student-level review view shown after clicking a name.
              <>
                <div className="overflow-hidden rounded-lg border border-black bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between gap-3 border-b border-black bg-[#F6E9B2] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-bold">
                        {selectedStudent.student_name} Submission
                      </h2>
                      <span className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium">
                        {submissionStatusLabel(selectedStudent.status)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={closeStudentSubmission}
                      className="rounded border border-black px-2 py-1 text-xs font-bold"
                    >
                      Back
                    </button>
                  </div>
                  <div className="min-h-48 p-5">
                    {isSubmissionLoading ? (
                      <p className="text-center text-sm font-semibold text-gray-500">
                        Loading submission...
                      </p>
                    ) : submissionDetailError ? (
                      <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {submissionDetailError}
                      </p>
                    ) : selectedSubmissionDetail ? (
                      selectedSubmissionDetail.attachments.length > 0 ? (
                        <AttachmentDisplay
                          attachments={selectedSubmissionDetail.attachments.map(
                            (attachment) => ({
                              ...attachment,
                              file_type: attachment.file_type ?? undefined,
                            }),
                          )}
                          type="submission"
                          downloadUrl={(attachmentId) =>
                            `${API_URL}/api/v1/submissions/${selectedSubmissionDetail.submission_id}/attachments/${attachmentId}/download`
                          }
                        />
                      ) : (
                        <p className="text-sm font-medium text-gray-500">
                          No submitted files attached.
                        </p>
                      )
                    ) : (
                      <p className="text-sm font-medium text-gray-500">
                        This student has not submitted work yet.
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-xl font-bold">Score & Feedback</h2>
                    <div className="flex items-center gap-1 rounded border border-black px-2 py-1">
                      <input
                        type="number"
                        min="0"
                        max={selected.total_points ?? undefined}
                        value={gradeDraft}
                        onChange={(event) => {
                          setGradeDraft(event.target.value);
                          setGradeError("");
                          setGradeSuccess("");
                        }}
                        disabled={!selectedSubmissionDetail || isPostingGrade}
                        className="w-12 bg-transparent text-right text-lg font-bold outline-none"
                        placeholder="0"
                      />
                      <span className="text-sm">
                        /{selected.total_points ?? 0}
                      </span>
                    </div>
                  </div>
                  <div className="mb-4 grid gap-3 md:grid-cols-5">
                    {[
                      [
                        "Excellent",
                        scoreBand(selected.total_points, 1),
                        "Displays all required components clearly and accurately.",
                      ],
                      [
                        "Good",
                        scoreBand(selected.total_points, 0.8),
                        "Most components are present with minor errors.",
                      ],
                      [
                        "Fair",
                        scoreBand(selected.total_points, 0.6),
                        "Some required parts are missing or unclear.",
                      ],
                      [
                        "Needs Improvement",
                        scoreBand(selected.total_points, 0.4),
                        "Many required elements are missing.",
                      ],
                      [
                        "Poor",
                        scoreBand(selected.total_points, 0.2),
                        "Work is incomplete or not submitted.",
                      ],
                    ].map(([label, points, description], index) => (
                      <div
                        key={label}
                        className={`rounded-lg border border-black p-3 ${index === 0 ? "bg-[#8BCB88]" : ""}`}
                      >
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <p className="font-bold">{label}</p>
                          <p className="text-sm font-bold">{points}</p>
                        </div>
                        <p className="text-xs">{description}</p>
                      </div>
                    ))}
                  </div>
                  <label className="block text-sm font-bold">
                    Comments
                    <textarea
                      value={feedbackDraft}
                      onChange={(event) => {
                        setFeedbackDraft(event.target.value);
                        setGradeError("");
                        setGradeSuccess("");
                      }}
                      disabled={!selectedSubmissionDetail || isPostingGrade}
                      className="mt-2 min-h-20 w-full rounded-lg border border-black px-3 py-2 text-sm outline-none"
                      placeholder="Write feedback for the student."
                    />
                  </label>
                  {gradeSuccess && (
                    <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                      {gradeSuccess}
                    </p>
                  )}
                  {gradeError && (
                    <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                      {gradeError}
                    </p>
                  )}
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={postGrade}
                      disabled={!selectedSubmissionDetail || isPostingGrade}
                      className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
                    >
                      {isPostingGrade
                        ? "Saving..."
                        : selectedSubmissionDetail?.status === "graded"
                          ? "Update"
                          : "Post"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
            {isEditing && editDraft ? (
              <div className="space-y-4 rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-bold">
                    Title
                    <input
                      value={editDraft.title}
                      onChange={(event) =>
                        setEditDraft((current) => current ? { ...current, title: event.target.value } : current)
                      }
                      disabled={isSavingEdit}
                      className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold"
                    />
                  </label>
                  <label className="block text-xs font-bold">
                    Type
                    <select
                      value={editDraft.classwork_type}
                      onChange={(event) =>
                        setEditDraft((current) => current ? { ...current, classwork_type: event.target.value } : current)
                      }
                      disabled={isSavingEdit}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm font-semibold"
                    >
                      <option value="READING">Reading</option>
                      <option value="ACTIVITY">Activity</option>
                      <option value="ASSIGNMENT">Assignment</option>
                      <option value="QUIZ">Quiz</option>
                    </select>
                  </label>
                </div>

                <div className={`grid gap-3 ${isReadingType(editDraft.classwork_type) ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                  <label className="block text-xs font-bold">
                    Grading component
                    <select
                      value={editDraft.classwork_category}
                      onChange={(event) =>
                        setEditDraft((current) => current ? { ...current, classwork_category: event.target.value } : current)
                      }
                      disabled={isSavingEdit}
                      className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">None</option>
                      <option value="WRITTEN_WORK">Written Works</option>
                      <option value="PERFORMANCE_TASK">Performance Task</option>
                      <option value="PERIODICAL_EXAM">Periodical Exam</option>
                    </select>
                  </label>
                  {!isReadingType(editDraft.classwork_type) && (
                    <label className="block text-xs font-bold">
                      Total points
                      <input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="decimal"
                        value={editDraft.total_points}
                        onChange={(event) =>
                          setEditDraft((current) => current ? { ...current, total_points: event.target.value } : current)
                        }
                        disabled={isSavingEdit}
                        className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={editDraft.is_published}
                      onChange={(event) =>
                        setEditDraft((current) => current ? { ...current, is_published: event.target.checked } : current)
                      }
                      disabled={isSavingEdit}
                    />
                    Published
                  </label>
                </div>

                <div className="rounded-lg border border-gray-300 p-3">
                  <p className="mb-3 text-xs font-bold">
                    Assignment settings
                  </p>
                  <div className={`grid gap-3 ${isQuizType(editDraft.classwork_type) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                    <label className="block text-xs font-bold">
                      Due date
                      <input
                        type="datetime-local"
                        value={editDraft.due_date}
                        onChange={(event) =>
                          setEditDraft((current) => current ? { ...current, due_date: event.target.value } : current)
                        }
                        disabled={isSavingEdit}
                        className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block text-xs font-bold">
                      Locked until
                      <input
                        type="datetime-local"
                        value={editDraft.lock_date}
                        onChange={(event) =>
                          setEditDraft((current) => current ? { ...current, lock_date: event.target.value } : current)
                        }
                        disabled={isSavingEdit || !editDraft.is_published}
                        className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:bg-gray-100"
                      />
                    </label>
                    {isQuizType(editDraft.classwork_type) && (
                      <label className="block text-xs font-bold">
                        Attempts
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={editDraft.max_attempts}
                          onChange={(event) =>
                            setEditDraft((current) => current ? { ...current, max_attempts: event.target.value } : current)
                          }
                          disabled={isSavingEdit}
                          className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                        />
                      </label>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-medium text-gray-600">
                    Published classwork is visible to students. A future lock date keeps it visible but blocks access until that time; clear it to unlock now.
                  </p>
                  {editDraft.due_date && !isReadingType(editDraft.classwork_type) && (
                    <label className="mt-3 flex items-start gap-3 rounded-lg border border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold">
                      <input
                        type="checkbox"
                        checked={editDraft.allow_late_submissions}
                        onChange={(event) =>
                          setEditDraft((current) =>
                            current ? { ...current, allow_late_submissions: event.target.checked } : current,
                          )
                        }
                        disabled={isSavingEdit}
                        className="mt-0.5"
                      />
                      <span>
                        Allow submissions/resubmissions after the due date
                        <span className="block font-medium text-gray-700">
                          Accepted work will be marked late.
                        </span>
                      </span>
                    </label>
                  )}
                </div>

                <label className="block text-xs font-bold">
                  Description
                  <input
                    value={editDraft.description}
                    onChange={(event) =>
                      setEditDraft((current) => current ? { ...current, description: event.target.value } : current)
                    }
                    disabled={isSavingEdit}
                    className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                  />
                </label>

                <label className="block text-xs font-bold">
                  Instructions
                  <textarea
                    value={editDraft.instructions}
                    onChange={(event) =>
                      setEditDraft((current) => current ? { ...current, instructions: event.target.value } : current)
                    }
                    disabled={isSavingEdit}
                    className="mt-1 min-h-24 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                  />
                </label>

                <div className="rounded-lg border border-gray-300 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold">Materials</h3>
                      <p className="text-xs text-gray-500">Add or remove files attached to this classwork.</p>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold hover:bg-[#7ABA78]">
                      <Plus size={14} />
                      Add files
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                        className="hidden"
                        disabled={isUploadingEditMaterials || removingAttachmentId !== null}
                        onChange={(event) => {
                          addEditMaterials(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  {selected.attachments.length > 0 ? (
                    <div className="space-y-2">
                      {selected.attachments.map((attachment) => (
                        <div
                          key={attachment.classwork_attachment_id}
                          className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                        >
                          <FileText size={16} />
                          <span className="min-w-0 flex-1 truncate font-semibold">{attachment.file_name}</span>
                          <button
                            type="button"
                            onClick={() => removeSelectedAttachment(attachment.classwork_attachment_id)}
                            disabled={removingAttachmentId === attachment.classwork_attachment_id || isUploadingEditMaterials}
                            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                            aria-label={`Remove ${attachment.file_name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-gray-500">
                      No files attached yet.
                    </p>
                  )}

                  {editMaterials.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-bold">Pending uploads</p>
                      {editMaterials.map((material, index) => (
                        <div key={`${material.name}-${material.size}`} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                          <FileText size={16} />
                          <span className="min-w-0 flex-1 truncate font-semibold">{material.name}</span>
                          <span className="text-xs text-gray-500">{formatFileSize(material.size)}</span>
                          <button
                            type="button"
                            onClick={() => removeEditMaterial(index)}
                            disabled={isUploadingEditMaterials}
                            className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={uploadEditMaterials}
                        disabled={isUploadingEditMaterials}
                        className="rounded-lg border border-black bg-[#7ABA78] px-3 py-2 text-xs font-bold disabled:opacity-50"
                      >
                        {isUploadingEditMaterials ? "Uploading..." : "Upload selected files"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-black bg-white p-4 text-sm font-semibold shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                {selected.instructions || selected.description || "No instructions provided."}
              </div>
            )}

                <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-bold">Attached Files</h2>
                    <span className="rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-bold">
                      File {selected.attachments.length}
                    </span>
                  </div>
                  {selected.attachments.length > 0 ? (
                    <AttachmentDisplay
                      attachments={selected.attachments}
                      type="classwork"
                      downloadUrl={(attachmentId) =>
                        `${API_URL}/api/v1/classwork-assignments/classwork/${selected.classwork_id}/attachments/${attachmentId}/download`
                      }
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-500">
                      No files attached.
                    </p>
                  )}
                </div>

                {isReadingType(selected.classwork_type) ? (
                  <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 text-sm font-semibold shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                    This is a reading material, so scores, attempts, and student submissions are not required.
                  </div>
                ) : (
                  <>
                    {isQuizType(selected.classwork_type) && (
                      <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-bold">Quiz Analysis</h2>
                            <p className="text-xs font-medium text-gray-600">
                              Participation, accuracy, and question performance.
                            </p>
                          </div>
                          {quizAnalysis?.class_accuracy_percent !== null &&
                            quizAnalysis?.class_accuracy_percent !== undefined && (
                              <span className="rounded-full border border-black bg-[#7ABA78] px-3 py-1 text-xs font-bold">
                                Class accuracy {quizAnalysis.class_accuracy_percent}%
                              </span>
                            )}
                        </div>

                        {isQuizAnalysisLoading ? (
                          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
                            Loading quiz analysis...
                          </p>
                        ) : quizAnalysisError ? (
                          <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {quizAnalysisError}
                          </p>
                        ) : quizAnalysis ? (
                          <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-5">
                              {[
                                ["Students", quizAnalysis.total_students],
                                ["Submitted", quizAnalysis.submitted_count],
                                ["Missing", quizAnalysis.missing_count],
                                ["Needs grading", quizAnalysis.needs_grading_count],
                                [
                                  "Average",
                                  quizAnalysis.average_score !== null &&
                                  quizAnalysis.average_score !== undefined
                                    ? `${quizAnalysis.average_score}/${quizAnalysis.total_points ?? selected.total_points ?? 0}`
                                    : "N/A",
                                ],
                              ].map(([label, value]) => (
                                <div
                                  key={label}
                                  className="rounded-lg border border-black bg-[#F8F6ED] p-3"
                                >
                                  <p className="text-xs font-semibold text-gray-600">
                                    {label}
                                  </p>
                                  <p className="mt-1 text-xl font-bold">{value}</p>
                                </div>
                              ))}
                            </div>

                            <div className="grid gap-3 lg:grid-cols-2">
                              {quizAnalysis.questions.map((question, index) => (
                                <div
                                  key={question.quiz_question_id}
                                  className="rounded-lg border border-black p-3"
                                >
                                  <div className="mb-2 flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-bold">
                                        {index + 1}. {question.question_text}
                                      </p>
                                      <p className="text-xs font-medium text-gray-600">
                                        {question.answered_count} answered | {question.points} pts
                                      </p>
                                    </div>
                                    <span className="rounded-full border border-gray-300 px-2 py-1 text-xs font-bold">
                                      {question.question_type === "MULTIPLE_CHOICE"
                                        ? `${question.accuracy_percent ?? 0}%`
                                        : `${question.needs_grading_count} to grade`}
                                    </span>
                                  </div>
                                  {question.option_distribution.length > 0 ? (
                                    <div className="space-y-2">
                                      {question.option_distribution.map((option) => (
                                        <div
                                          key={option.option_id}
                                          className={`flex items-center justify-between rounded border px-2 py-1 text-xs ${
                                            option.is_correct
                                              ? "border-green-400 bg-green-50"
                                              : "border-gray-200"
                                          }`}
                                        >
                                          <span className="font-semibold">
                                            {option.option_text}
                                          </span>
                                          <span>{option.selected_count}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-xs font-medium text-gray-600">
                                      Short-answer responses are counted for manual grading.
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className="overflow-hidden rounded-lg border border-black">
                              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold">
                                <span>Student</span>
                                <span>Attempts</span>
                                <span>Score</span>
                              </div>
                              {quizAnalysis.students.map((student) => (
                                <div
                                  key={student.student_id}
                                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-black px-3 py-2 text-sm last:border-b-0"
                                >
                                  <div>
                                    <p className="font-bold">{student.student_name}</p>
                                    <p className="text-xs capitalize text-gray-600">
                                      {submissionStatusLabel(student.status)}
                                      {student.needs_grading ? " | Needs grading" : ""}
                                    </p>
                                  </div>
                                  <span className="text-xs font-bold">
                                    {student.attempt_count}
                                  </span>
                                  <span className="text-right text-xs font-bold">
                                    {student.grade !== null &&
                                    student.grade !== undefined
                                      ? `${student.grade}/${quizAnalysis.total_points ?? selected.total_points ?? 0}`
                                      : `0/${quizAnalysis.total_points ?? selected.total_points ?? 0}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
                            Quiz analysis is not available yet.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="font-bold">Activity Score</h2>
                        <p className="text-sm font-bold">
                          Total: {selected.total_points ?? 0} pts
                        </p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-5">
                        {[
                          [
                            "Excellent",
                            scoreBand(selected.total_points, 1),
                            "Displays all required components clearly and accurately.",
                          ],
                          [
                            "Good",
                            scoreBand(selected.total_points, 0.8),
                            "Most components are present with minor errors.",
                          ],
                          [
                            "Fair",
                            scoreBand(selected.total_points, 0.6),
                            "Some required parts are missing or unclear.",
                          ],
                          [
                            "Needs Improvement",
                            scoreBand(selected.total_points, 0.4),
                            "Many required elements are missing.",
                          ],
                          [
                            "Poor",
                            scoreBand(selected.total_points, 0.2),
                            "Work is incomplete or not submitted.",
                          ],
                        ].map(([label, points, description]) => (
                          <div
                            key={label}
                            className="rounded-lg border border-black p-3"
                          >
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <p className="font-bold">{label}</p>
                              <p className="text-sm font-bold">{points}</p>
                            </div>
                            <p className="text-xs">{description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-2xl font-bold">
                          Student's Submissions
                        </h2>
                        <button
                          type="button"
                          onClick={() =>
                            setSubmissionSort((current) =>
                              current === "name" ? "score" : "name",
                            )
                          }
                          className="inline-flex items-center gap-2 text-sm font-medium"
                        >
                          <ArrowUpDown size={16} />
                          Sort By {submissionSort === "name" ? "Name" : "Score"}
                        </button>
                      </div>

                      <div className="overflow-hidden rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                        {detailError && (
                          <div className="border-b border-black bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {detailError}
                          </div>
                        )}
                        {isTrackingLoading ? (
                          <p className="px-4 py-6 text-center text-sm font-semibold text-gray-500">
                            Loading submissions...
                          </p>
                        ) : trackingRows.length > 0 ? (
                          trackingRows.map((student) => {
                            const isGraded =
                              student.status === "graded" ||
                              (student.grade !== null &&
                                student.grade !== undefined);
                            const scoreLabel = isGraded
                              ? `${student.grade ?? 0}/${selected.total_points ?? 0}`
                              : `0/${selected.total_points ?? 0}`;
                            return (
                              <div
                                key={student.student_id}
                                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-black px-4 py-3 last:border-b-0"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="grid h-8 w-8 place-items-center rounded-full bg-[#FFD08A] text-xs font-bold">
                                    {student.student_name.slice(0, 1)}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openStudentSubmission(student)}
                                    className="font-bold hover:underline"
                                  >
                                    {student.student_name}
                                  </button>
                                </div>
                                <span className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium">
                                  {submissionStatusLabel(
                                    isGraded ? "graded" : student.status,
                                  )}
                                </span>
                                <p className="min-w-20 text-right text-sm font-semibold text-gray-700">
                                  {scoreLabel}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="px-4 py-6 text-center text-sm font-semibold text-gray-500">
                            No submissions found for this classwork yet.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {showArchiveConfirm && !selectedStudent && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                <section className="w-full max-w-md rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between border-b border-black bg-red-100 px-5 py-3">
                    <div className="flex items-center gap-2 text-red-800">
                      <Archive size={18} />
                      <h2 className="font-bold">Archive Classwork?</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowArchiveConfirm(false)}
                      disabled={isArchiving}
                      className="rounded p-1 hover:bg-white/60 disabled:opacity-50"
                      aria-label="Close archive confirmation"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-3 p-5">
                    <p className="text-sm font-medium">
                      Are you sure you want to archive <span className="font-bold">"{selected.title}"</span>?
                    </p>
                    <p className="text-xs text-gray-600">
                      This only works while no student work is turned in. If there are submissions, ask students to unsubmit first.
                      Linked lessons stay intact.
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 border-t border-black px-5 py-4">
                    <button
                      type="button"
                      onClick={() => setShowArchiveConfirm(false)}
                      disabled={isArchiving}
                      className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={archiveSelectedClasswork}
                      disabled={isArchiving}
                      className="rounded-lg border border-black bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-red-700 disabled:opacity-50"
                    >
                      {isArchiving ? "Archiving..." : "Archive Classwork"}
                    </button>
                  </div>
                </section>
              </div>
            )}
          </section>
        </main>
      ) : (
        <>
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold">Classwork</h1>
              </div>

              <button
                type="button"
                onClick={openCreateWizard}
                className="inline-flex items-center gap-2 rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
              >
                <Plus size={17} />
                <span className="hidden sm:inline">New Classwork</span>
                <span className="sm:hidden">New</span>
              </button>
            </header>
          </div>

          <nav className="flex overflow-x-auto border-b border-gray-400 bg-white px-5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "-mb-px rounded-t-lg border border-b-0 border-black bg-white"
                      : ""
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <main className="flex flex-col gap-4 px-5 py-4">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <section className="flex flex-col gap-3 border-b border-gray-300 pb-3 md:flex-row md:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-600 bg-white px-3 py-2 md:max-w-sm">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search classwork"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {subjectFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setSubjectFilter("all")}
                    className="inline-flex items-center gap-2 rounded-full bg-[#F6E9B2] px-3 py-1.5 text-xs font-semibold"
                  >
                    {
                      subjects.find(
                        (subject) => subject.id === Number(subjectFilter),
                      )?.name
                    }
                    <X size={13} />
                  </button>
                )}
                {statusFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="inline-flex items-center gap-2 rounded-full bg-[#F6E9B2] px-3 py-1.5 text-xs font-semibold capitalize"
                  >
                    {statusFilter}
                    <X size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowFilters((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium hover:bg-gray-100"
                >
                  <Filter size={15} />
                  Add Filter
                </button>
                <button
                  type="button"
                  onClick={cycleSort}
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium hover:bg-gray-100"
                  title={`Current sort: ${sortMode}`}
                >
                  {sortMode === "title" ? (
                    <ArrowDownAZ size={15} />
                  ) : (
                    <ArrowUpDown size={15} />
                  )}
                  Sort By
                </button>
              </div>
            </section>

            {showFilters && (
              <section className="grid gap-3 rounded-lg border border-black bg-[#F6E9B2] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:grid-cols-2">
                <label className="text-xs font-bold">
                  Subject
                  <select
                    value={subjectFilter}
                    onChange={(event) => setSubjectFilter(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
                  >
                    <option value="all">All subjects</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold">
                  Publication status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
                  >
                    <option value="all">All statuses</option>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
              </section>
            )}

            {isLoading ? (
              <p className="py-12 text-center text-sm font-semibold text-gray-500">
                Loading classworks...
              </p>
            ) : filteredItems.length > 0 ? (
              <section className="space-y-3">
                {filteredItems.map((item) => (
                  <ClassworkCard
                    key={item.classwork_id}
                    item={item}
                    onOpen={openClassworkDetail}
                  />
                ))}
              </section>
            ) : (
              <section className="rounded-lg border border-dashed border-gray-400 bg-white px-5 py-14 text-center">
                <ClipboardList
                  className="mx-auto mb-2 text-gray-400"
                  size={36}
                />
                <p className="font-bold">No classworks found</p>
                <p className="mt-1 text-sm text-gray-500">
                  Try another tab, search term, or filter.
                </p>
              </section>
            )}
          </main>

          {showCreateWizard && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
              <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-black bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black bg-[#7ABA78] px-5 py-4">
                  <div>
                    <h2 className="text-lg font-bold">
                      {createStepTitle}
                    </h2>
                    <p className="text-xs font-medium">
                      Step {createStepNumber} of {createStepTotal}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCreateWizard}
                    disabled={isCreating}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-4 p-5">
                  {createError && (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      {createError}
                    </div>
                  )}

                  {createStep === "type" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {createOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.type}
                            type="button"
                            onClick={() => chooseType(option.type)}
                            className="rounded-lg border border-black bg-[#7ABA78] p-4 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5"
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={20} />
                              <h3 className="text-lg font-bold">
                                {option.title}
                              </h3>
                            </div>
                            <p className="mt-2 text-xs font-medium">
                              {option.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {createStep === "quiz-source" && (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={useManualQuizBuilder}
                          disabled={isCreating || isImportingQuiz}
                          className="rounded-lg border border-black bg-[#7ABA78] p-4 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 disabled:opacity-50"
                        >
                          <div className="flex items-center gap-2">
                            <Pencil size={19} />
                            <h3 className="text-lg font-bold">Create manually</h3>
                          </div>
                          <p className="mt-2 text-xs font-medium">
                            Build multiple-choice and short-answer questions yourself.
                          </p>
                        </button>

                        <div className="rounded-lg border border-black bg-[#7ABA78] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                          <div className="flex items-center gap-2">
                            <FileText size={19} />
                            <h3 className="text-lg font-bold">Import from file</h3>
                          </div>
                          <p className="mt-2 text-xs font-medium">
                            Upload a structured quiz file, then review and edit the imported questions.
                          </p>
                          <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border border-black bg-white px-3 py-2 text-sm font-bold hover:bg-[#F6E9B2]">
                            {isImportingQuiz ? "Importing..." : "Choose quiz file"}
                            <input
                              type="file"
                              accept=".txt,.md,.csv,.pdf,.doc,.docx"
                              disabled={isCreating || isImportingQuiz}
                              className="hidden"
                              onChange={(event) => {
                                void importQuizFile(event.target.files?.[0] ?? null);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-lg border border-gray-300 bg-[#F8F6ED] px-4 py-3 text-xs font-medium text-gray-700">
                        Import reads numbered TXT/CSV/MD quizzes and text-based PDF/DOCX files with A-D options and optional answer keys.
                        Scanned files still need OCR, which is deferred.
                      </div>
                    </div>
                  )}

                  {createStep === "details" && (
                    <div className="space-y-4">
                      <label className="block text-xs font-bold">
                        Subject
                        <select
                          value={draft.subject_id}
                          onChange={(event) => {
                            setDraft((current) => ({
                              ...current,
                              subject_id: event.target.value,
                            }));
                            setSelectedClassIds([]);
                          }}
                          disabled={isCreating}
                          className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm font-semibold"
                        >
                          <option value="">Choose subject</option>
                          {subjects.map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs font-bold">
                        Topic title
                        <input
                          value={draft.title}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          disabled={isCreating}
                          className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold"
                          placeholder="Introduction to Programming Reading Materials"
                        />
                      </label>

                      <label className="block text-xs font-bold">
                        Description
                        <input
                          value={draft.description}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          disabled={isCreating}
                          className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          placeholder="Short context for students"
                        />
                      </label>

                      <label className="block text-xs font-bold">
                        Instructions
                        <textarea
                          value={draft.instructions}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              instructions: event.target.value,
                            }))
                          }
                          disabled={isCreating}
                          className="mt-1 min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          placeholder="What students need to read, answer, or submit"
                        />
                      </label>

                      <div className={`grid gap-3 ${isQuizType(selectedType) ? "sm:grid-cols-3" : isReadingType(selectedType) ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>
                        <label className="block text-xs font-bold">
                          Grading component
                          <select
                            value={draft.classwork_category}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                classwork_category: event.target.value,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm"
                          >
                            <option value="WRITTEN_WORK">Written Works</option>
                            <option value="PERFORMANCE_TASK">
                              Performance Task
                            </option>
                            <option value="PERIODICAL_EXAM">
                              Periodical Exam
                            </option>
                          </select>
                        </label>
                        {!isReadingType(selectedType) && (
                          <>
                            <label className="block text-xs font-bold">
                              Total points
                              <input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="decimal"
                                value={draft.total_points}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    total_points: event.target.value,
                                  }))
                                }
                                disabled={isCreating}
                                className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                              />
                            </label>
                            {isQuizType(selectedType) && (
                              <label className="block text-xs font-bold">
                                Attempts
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={draft.max_attempts}
                                  onChange={(event) =>
                                    setDraft((current) => ({
                                      ...current,
                                      max_attempts: event.target.value,
                                    }))
                                  }
                                  disabled={isCreating}
                                  className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                                />
                              </label>
                            )}
                          </>
                        )}
                      </div>

                      {!isQuizType(selectedType) && (
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs font-bold">Upload material</p>
                            <p className="text-xs text-gray-500">
                              PDF, DOCX, PPTX, JPG, PNG | 4 MB each
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {materials.map((material, index) => (
                              <div
                                key={`${material.name}-${material.size}`}
                                className="relative flex h-28 w-24 flex-col justify-between rounded-lg border border-black bg-white p-2 text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              >
                                <button
                                  type="button"
                                  onClick={() => removeMaterial(index)}
                                  disabled={isCreating}
                                  className="absolute right-1 top-1 rounded-full border border-black bg-white p-0.5"
                                >
                                  <Trash2 size={12} />
                                </button>
                                <FileText className="mx-auto mt-5" size={22} />
                                <div className="min-w-0">
                                  <p className="truncate text-[10px] font-semibold">
                                    {material.name}
                                  </p>
                                  <p className="text-[10px] text-gray-500">
                                    {formatFileSize(material.size)}
                                  </p>
                                </div>
                              </div>
                            ))}
                            <label className="flex h-28 w-24 cursor-pointer items-center justify-center rounded-lg border border-dashed border-black bg-[#F6E9B2] text-sm font-bold hover:bg-[#7ABA78]">
                              <Plus size={20} />
                              <input
                                type="file"
                                multiple
                                accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                                onChange={(event) => {
                                  addMaterials(event.target.files);
                                  event.target.value = "";
                                }}
                                disabled={isCreating}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {createStep === "quiz" && (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-black bg-[#F8F6ED] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-bold">
                              Manual quiz builder
                            </h3>
                            <p className="text-xs font-medium text-gray-600">
                              Multiple-choice and short-answer questions only for this MVP.
                            </p>
                          </div>
                          <span className="rounded-full border border-black bg-white px-3 py-1 text-xs font-bold">
                            {quizPointTotal}/{draft.total_points || 0} pts
                          </span>
                        </div>
                        {quizImportWarnings.length > 0 && (
                          <div className="mt-3 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs font-semibold text-yellow-800">
                            <p className="font-bold">Import notes</p>
                            <ul className="mt-1 list-disc pl-4">
                              {quizImportWarnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="block text-xs font-bold">
                            Duration
                            <div className="mt-1 flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={quizSettings.duration_minutes}
                                onChange={(event) =>
                                  setQuizSettings((current) => ({
                                    ...current,
                                    duration_minutes: event.target.value,
                                  }))
                                }
                                disabled={isCreating}
                                className="w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                                placeholder="No time limit"
                              />
                              <span className="text-xs font-semibold">
                                minutes
                              </span>
                            </div>
                          </label>
                          <label className="block text-xs font-bold">
                            Attempts
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={quizSettings.max_attempts}
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
                              disabled={isCreating}
                              className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                            />
                          </label>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="block text-xs font-bold">
                            Quiz Summary Availability
                            <select
                              value={quizSettings.summary_release_mode}
                              onChange={(event) =>
                                setQuizSettings((current) => ({
                                  ...current,
                                  summary_release_mode: event.target.value as QuizSettingsDraft["summary_release_mode"],
                                  summary_release_at:
                                    event.target.value === "SCHEDULED"
                                      ? current.summary_release_at
                                      : "",
                                }))
                              }
                              disabled={isCreating}
                              className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                            >
                              <option value="IMMEDIATE">Immediately after submission</option>
                              <option value="SCHEDULED">At a specific date & time</option>
                              <option value="AFTER_DUE_DATE" disabled={!draft.due_date}>
                                After the quiz due date
                              </option>
                              <option value="NEVER">Never</option>
                            </select>
                          </label>
                          {quizSettings.summary_release_mode === "SCHEDULED" ? (
                            <label className="block text-xs font-bold">
                              Release Date & Time
                              <input
                                type="datetime-local"
                                value={quizSettings.summary_release_at}
                                onChange={(event) =>
                                  setQuizSettings((current) => ({
                                    ...current,
                                    summary_release_at: event.target.value,
                                  }))
                                }
                                disabled={isCreating}
                                className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                              />
                            </label>
                          ) : (
                            <div className="rounded-lg border border-dashed border-gray-300 bg-[#FFFBEE] px-3 py-2 text-xs text-gray-600">
                              {quizSettings.summary_release_mode === "AFTER_DUE_DATE"
                                ? "Summary unlocks automatically after the due date."
                                : quizSettings.summary_release_mode === "NEVER"
                                  ? "Students can see their score, but not the answer summary."
                                  : "Students can view the summary right after submitting."}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {[
                            {
                              key: "is_shuffle_questions",
                              label: "Shuffle questions",
                            },
                            {
                              key: "enable_per_question_scoring",
                              label: "Enable per-question scoring",
                            },
                            {
                              key: "enable_per_question_time_limits",
                              label: "Enable individual question time limits",
                            },
                            {
                              key: "show_correct_answers",
                              label: "Show correct answers after submission",
                            },
                          ].map((setting) => {
                            const key =
                              setting.key as keyof Pick<
                                QuizSettingsDraft,
                                | "is_shuffle_questions"
                                | "enable_per_question_scoring"
                                | "enable_per_question_time_limits"
                                | "show_correct_answers"
                              >;
                            const enabled = quizSettings[key];
                            return (
                              <button
                                key={setting.key}
                                type="button"
                                onClick={() =>
                                  setQuizSettings((current) => ({
                                    ...current,
                                    [key]: !current[key],
                                  }))
                                }
                                disabled={isCreating}
                                className="flex items-center justify-between rounded-lg border border-black bg-white px-3 py-2 text-left text-xs font-bold disabled:opacity-50"
                              >
                                <span>{setting.label}</span>
                                <span
                                  className={`rounded-full border border-black px-3 py-1 ${
                                    enabled ? "bg-[#7ABA78]" : "bg-gray-100"
                                  }`}
                                >
                                  {enabled ? "On" : "Off"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {quizQuestions.map((question, questionIndex) => (
                          <div
                            key={question.id}
                            className="rounded-lg border border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                          >
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                              <h3 className="text-base font-bold">
                                Question {questionIndex + 1}
                              </h3>
                              <button
                                type="button"
                                onClick={() => removeQuizQuestion(question.id)}
                                disabled={isCreating || quizQuestions.length === 1}
                                className="rounded-lg border border-red-400 px-3 py-1 text-xs font-bold text-red-600 disabled:opacity-40"
                              >
                                Remove
                              </button>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                              <label className="block text-xs font-bold sm:col-span-2">
                                Question text
                                <textarea
                                  value={question.question_text}
                                  onChange={(event) =>
                                    updateQuizQuestion(question.id, {
                                      question_text: event.target.value,
                                    })
                                  }
                                  disabled={isCreating}
                                  className="mt-1 min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                                  placeholder="Which of the following is the primary function of a CPU?"
                                />
                              </label>
                              <div className="grid gap-3">
                                <label className="block text-xs font-bold">
                                  Type
                                  <select
                                    value={question.question_type}
                                    onChange={(event) =>
                                      updateQuizQuestion(question.id, {
                                        question_type: event.target
                                          .value as QuizQuestionType,
                                      })
                                    }
                                    disabled={isCreating}
                                    className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm"
                                  >
                                    <option value="MULTIPLE_CHOICE">
                                      Multiple Choice
                                    </option>
                                    <option value="SHORT_ANSWER">
                                      Short Answer
                                    </option>
                                  </select>
                                </label>
                                <label className="block text-xs font-bold">
                                  Points
                                  <input
                                    type="number"
                                    min="0.01"
                                    step="1"
                                    inputMode="decimal"
                                    value={question.points}
                                    onChange={(event) =>
                                      updateQuizQuestion(question.id, {
                                        points: event.target.value,
                                      })
                                    }
                                    disabled={isCreating}
                                    className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                                  />
                                </label>
                              </div>
                            </div>

                            {question.question_type === "MULTIPLE_CHOICE" ? (
                              <div className="mt-3 space-y-2">
                                <p className="text-xs font-bold">
                                  Choices
                                </p>
                                {question.options.map((option, optionIndex) => (
                                  <div
                                    key={`${question.id}-${option.option_order}`}
                                    className="flex items-center gap-2"
                                  >
                                    <input
                                      type="radio"
                                      checked={option.is_correct}
                                      onChange={() =>
                                        markCorrectOption(
                                          question.id,
                                          optionIndex,
                                        )
                                      }
                                      disabled={isCreating}
                                      className="h-4 w-4"
                                      aria-label={`Mark choice ${optionIndex + 1} correct`}
                                    />
                                    <input
                                      value={option.option_text}
                                      onChange={(event) =>
                                        updateQuizOption(
                                          question.id,
                                          optionIndex,
                                          event.target.value,
                                        )
                                      }
                                      disabled={isCreating}
                                      className="flex-1 rounded-lg border border-gray-700 px-3 py-2 text-sm"
                                      placeholder={`Choice ${optionIndex + 1}`}
                                    />
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
                                      className="rounded-lg border border-black px-2 py-2 text-xs font-bold disabled:opacity-40"
                                      aria-label={`Remove choice ${optionIndex + 1}`}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => addQuizOption(question.id)}
                                  disabled={isCreating}
                                  className="rounded-lg border border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold"
                                >
                                  Add choice
                                </button>
                              </div>
                            ) : (
                              <p className="mt-3 rounded-lg border border-dashed border-gray-400 px-3 py-3 text-xs font-medium text-gray-600">
                                Short-answer questions are manually graded after students submit.
                              </p>
                            )}

                            <label className="mt-3 block text-xs font-bold">
                              Explanation or answer guide
                              <textarea
                                value={question.explanation}
                                onChange={(event) =>
                                  updateQuizQuestion(question.id, {
                                    explanation: event.target.value,
                                  })
                                }
                                disabled={isCreating}
                                className="mt-1 min-h-16 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                                placeholder="Optional guidance for review or grading"
                              />
                            </label>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => addQuizQuestion("MULTIPLE_CHOICE")}
                          disabled={isCreating}
                          className="rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold"
                        >
                          Add multiple choice
                        </button>
                        <button
                          type="button"
                          onClick={() => addQuizQuestion("SHORT_ANSWER")}
                          disabled={isCreating}
                          className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold"
                        >
                          Add short answer
                        </button>
                      </div>
                    </div>
                  )}

                  {createStep === "assign" && (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block text-xs font-bold">
                          Due date
                          <input
                            type="datetime-local"
                            value={draft.due_date}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                due_date: event.target.value,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-bold">
                          Publish status
                          <select
                            value={draft.is_published ? "published" : "draft"}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                is_published:
                                  event.target.value === "published",
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm"
                          >
                            <option value="published">Publish now</option>
                            <option value="draft">
                              Keep hidden from students
                            </option>
                          </select>
                        </label>
                        <label className="block text-xs font-bold">
                          Locked until
                          <input
                            type="datetime-local"
                            value={draft.lock_date}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                lock_date: event.target.value,
                              }))
                            }
                            disabled={isCreating || !draft.is_published}
                            className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm disabled:bg-gray-100"
                          />
                        </label>
                      </div>
                      <p className="text-xs font-medium text-gray-600">
                        Published work appears to students. Add a future lock date if they should see it but wait before opening, downloading, or submitting.
                      </p>
                      {draft.due_date && !isReadingType(selectedType) && (
                        <label className="flex items-start gap-3 rounded-lg border border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold">
                          <input
                            type="checkbox"
                            checked={draft.allow_late_submissions}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                allow_late_submissions: event.target.checked,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-0.5"
                          />
                          <span>
                            Allow submissions/resubmissions after the due date
                            <span className="block font-medium text-gray-700">
                              Accepted work will be marked late.
                            </span>
                          </span>
                        </label>
                      )}

                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-bold">
                            Assign to sections
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedClassIds(
                                selectedSubjectLoads.map(
                                  (load) => load.class_id,
                                ),
                              )
                            }
                            disabled={
                              isCreating || selectedSubjectLoads.length === 0
                            }
                            className="rounded border border-black px-2 py-1 text-xs font-semibold disabled:opacity-50"
                          >
                            Select all
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {selectedSubjectLoads.map((load) => {
                            const isSelected = selectedClassIds.includes(
                              load.class_id,
                            );
                            return (
                              <button
                                key={load.subject_load_id}
                                type="button"
                                onClick={() => toggleClass(load.class_id)}
                                disabled={isCreating}
                                className={`rounded-lg border border-black px-3 py-3 text-sm font-bold ${
                                  isSelected ? "bg-[#7ABA78]" : "bg-white"
                                }`}
                              >
                                {load.section_name}
                              </button>
                            );
                          })}
                        </div>
                        {selectedSubjectLoads.length === 0 && (
                          <p className="rounded-lg border border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500">
                            No active sections are assigned to this subject.
                          </p>
                        )}
                      </div>

                      <div>
                        <div className="mb-2">
                          <p className="text-xs font-bold">
                            Link under lesson
                          </p>
                          <p className="text-xs text-gray-500">
                            Only lessons assigned to every selected section are shown.
                          </p>
                        </div>
                        {selectedClassIds.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500">
                            Select a section first to load available lessons.
                          </p>
                        ) : isLessonLoading ? (
                          <p className="rounded-lg border border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500">
                            Loading lessons...
                          </p>
                        ) : availableLessons.length > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {availableLessons.map((lesson) => {
                              const isSelected = selectedLessonIds.includes(
                                lesson.lesson_id,
                              );
                              return (
                                <button
                                  key={lesson.lesson_id}
                                  type="button"
                                  onClick={() => toggleLesson(lesson.lesson_id)}
                                  disabled={isCreating}
                                  className={`rounded-lg border border-black px-3 py-3 text-left text-sm font-bold ${
                                    isSelected ? "bg-[#7ABA78]" : "bg-white"
                                  }`}
                                >
                                  <span className="block truncate">
                                    {lesson.title}
                                  </span>
                                  <span className="mt-1 block text-xs font-medium text-gray-600">
                                    {lesson.is_published ? "Published lesson" : "Draft lesson"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="rounded-lg border border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500">
                            No shared lesson is assigned to all selected sections.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-black px-5 py-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (createStep === "type") {
                        closeCreateWizard();
                        return;
                      }
                      if (createStep === "assign") {
                        setCreateStep(isQuizType(selectedType) ? "quiz" : "details");
                        return;
                      }
                      if (createStep === "quiz") {
                        setCreateStep("details");
                        return;
                      }
                      if (createStep === "details" && isQuizType(selectedType)) {
                        setCreateStep("quiz-source");
                        return;
                      }
                      setCreateStep("type");
                    }}
                    disabled={isCreating}
                    className="rounded-lg border border-black px-4 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    {createStep === "type" ? "Cancel" : "Back"}
                  </button>
                  {createStep === "type" || createStep === "quiz-source" ? null : createStep === "details" ||
                    createStep === "quiz" ? (
                    <button
                      type="button"
                      onClick={goToAssignStep}
                      disabled={isCreating}
                      className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={createClasswork}
                      disabled={isCreating}
                      className="rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold disabled:opacity-50"
                    >
                      {isCreating ? "Creating..." : "Assign"}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
