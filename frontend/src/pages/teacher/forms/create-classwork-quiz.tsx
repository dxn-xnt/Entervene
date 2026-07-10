"use client";

import { useState, useEffect, useMemo } from "react";
import { X, FileText, Pencil } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import {
    emptyClassworkDraft,
} from "@/lib/classwork-utils";
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
} from "../classworks/quiz-builder-utils";

interface CreateClassworkQuizModalProps {
    selectedType: ClassworkKind;
    subjects: Array<{ id: number; name: string }>;
    loads: TeacherClassLoad[];
    onClose: () => void;
    onSuccess: () => void;
    onBack: () => void;
}

export default function CreateClassworkQuizModal({
    selectedType,
    subjects,
    loads,
    onClose,
    onSuccess,
    onBack,
}: CreateClassworkQuizModalProps) {
    const [createStep, setCreateStep] = useState<
        "quiz-source" | "details" | "quiz" | "assign"
    >("quiz-source");

    const [draft, setDraft] = useState<CreateDraft>({
        ...emptyClassworkDraft,
        classwork_category: "PERIODICAL_EXAM",
        subject_id: subjects[0] ? String(subjects[0].id) : "",
    });

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

    const quizPointTotal = useMemo(
        () =>
            quizQuestions.reduce((total, question) => {
                const points = Number(question.points);
                return total + (Number.isFinite(points) ? points : 0);
            }, 0),
        [quizQuestions],
    );

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
                const qDraft = createEmptyQuizQuestion(index + 1, question.question_type);
                return {
                    ...qDraft,
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

            setQuizQuestions(
                importedQuestions.length > 0
                    ? importedQuestions
                    : [createEmptyQuizQuestion(1)],
            );
            setQuizImportWarnings(preview.warnings);
            setDraft((current) => ({
                ...current,
                title: current.title || preview.title || "",
                instructions: current.instructions,
                total_points: String(
                    importedQuestions.reduce(
                        (sum, q) => sum + Number(q.points || 0),
                        0,
                    ) || current.total_points,
                ),
            }));
            setCreateStep("details");
        } catch (err) {
            setCreateError(
                err instanceof Error ? err.message : "Unable to import quiz file.",
            );
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
            createEmptyQuizQuestion(current.length + 1, questionType),
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
        if (!draft.subject_id) return "Choose a subject.";
        if (!draft.title.trim()) return "Topic title is required.";
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
        if (
            quizSettings.summary_release_mode === "SCHEDULED" &&
            !quizSettings.summary_release_at
        ) {
            return "Choose when the quiz summary should be released.";
        }
        if (
            quizSettings.summary_release_mode === "AFTER_DUE_DATE" &&
            !draft.due_date
        ) {
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

    const goToAssignStep = () => {
        const detailsValError = validateDetails();
        if (detailsValError) {
            setCreateError(detailsValError);
            setCreateStep("details");
            return;
        }
        const quizValError = validateQuizBuilder();
        if (quizValError) {
            setCreateError(quizValError);
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
        if (
            createStep !== "assign" ||
            !draft.subject_id ||
            selectedClassIds.length === 0
        ) {
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

                const commonIds = lessonGroups.reduce<Set<number> | null>(
                    (current, group) => {
                        const groupIds = new Set(group.map((lesson) => lesson.lesson_id));
                        if (!current) return groupIds;
                        return new Set([...current].filter((id) => groupIds.has(id)));
                    },
                    null,
                );

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
                quizSettings.summary_release_mode === "SCHEDULED" &&
                    quizSettings.summary_release_at
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

    const handleCreateQuiz = async () => {
        const detailsValError = validateDetails();
        if (detailsValError) {
            setCreateError(detailsValError);
            setCreateStep("details");
            return;
        }
        const quizValError = validateQuizBuilder();
        if (quizValError) {
            setCreateError(quizValError);
            setCreateStep("quiz");
            return;
        }
        if (selectedClassIds.length === 0) {
            setCreateError("Select at least one section to assign this quiz.");
            return;
        }
        if (selectedLessonIds.length === 0) {
            setCreateError("Select the lesson where this quiz should appear.");
            return;
        }

        setIsCreating(true);
        setCreateError("");
        try {
            const formData = new FormData();
            formData.append("title", draft.title.trim());
            formData.append("description", draft.description.trim());
            formData.append("instructions", draft.instructions.trim());
            formData.append("classwork_type", selectedType);
            if (draft.classwork_category) {
                formData.append("classwork_category", draft.classwork_category);
            }
            formData.append("total_points", String(Number(draft.total_points)));
            formData.append("subject_id", String(draft.subject_id));
            formData.append("is_published", String(draft.is_published));
            formData.append("class_ids", JSON.stringify(selectedClassIds));
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

            const createResponse = await apiFetch(
                "/api/v1/classwork-assignments/with-assignments",
                {
                    method: "POST",
                    body: formData,
                },
            );

            if (!createResponse.ok) {
                const body = await createResponse.json().catch(() => ({}));
                throw new Error(body.detail || "Unable to create quiz.");
            }
            await createResponse.json();

            onSuccess();
        } catch (err) {
            setCreateError(
                err instanceof Error ? err.message : "Unable to create quiz.",
            );
        } finally {
            setIsCreating(false);
        }
    };

    const createStepNumber =
        createStep === "quiz-source"
            ? 1
            : createStep === "details"
                ? 2
                : createStep === "quiz"
                    ? 3
                    : 4;
    const createStepTotal = 4;

    return (
        <Dialog.Content size="3xl">
            <Dialog.Header position="fixed" asChild>
                <div className="flex items-center justify-between w-full">
                    <div>
                        <Text as="h5" className="font-sans text-xl font-bold">
                            Create Quiz
                        </Text>
                        <p className="text-xs font-semibold text-white/80">
                            Step {createStepNumber} of {createStepTotal}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isCreating}
                        className="cursor-pointer text-white hover:text-gray-200"
                    >
                        <X size={18} />
                    </button>
                </div>
            </Dialog.Header>

            <section className="flex flex-col gap-4 p-5 max-h-[70vh] overflow-y-auto">
                {createError && (
                    <Alert status="error" className="mb-2">
                        <Alert.Description>{createError}</Alert.Description>
                    </Alert>
                )}

                {createStep === "quiz-source" && (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <button
                                type="button"
                                onClick={useManualQuizBuilder}
                                disabled={isCreating || isImportingQuiz}
                                className="rounded-lg border-2 border-black bg-[#7ABA78] p-5 text-left shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 disabled:opacity-50 cursor-pointer"
                            >
                                <div className="flex items-center gap-2">
                                    <Pencil size={19} className="text-black" />
                                    <h3 className="text-lg font-bold text-black">
                                        Create manually
                                    </h3>
                                </div>
                                <p className="mt-2 text-xs font-medium text-black/80">
                                    Build multiple-choice and short-answer questions yourself.
                                </p>
                            </button>

                            <div className="rounded-lg border-2 border-black bg-[#7ABA78] p-5 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <FileText size={19} className="text-black" />
                                        <h3 className="text-lg font-bold text-black">
                                            Import from file
                                        </h3>
                                    </div>
                                    <p className="mt-2 text-xs font-medium text-black/80">
                                        Upload a structured quiz file, then review and edit the
                                        imported questions.
                                    </p>
                                </div>
                                <label className="mt-4 flex cursor-pointer items-center justify-center rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold shadow-md hover:bg-[#F6E9B2] transition">
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

                        <Alert status="info">
                            <Alert.Description>
                                Import reads numbered TXT/CSV/MD quizzes and text-based
                                PDF/DOCX files with A-D options and optional answer keys.
                                Scanned files still need OCR, which is deferred.
                            </Alert.Description>
                        </Alert>
                    </div>
                )}

                {createStep === "details" && (
                    <div className="space-y-4">
                        <div className="flex flex-col gap-1 w-full">
                            <label className="text-xs font-bold text-gray-700">Subject</label>
                            <Select
                                value={draft.subject_id}
                                onValueChange={(val) => {
                                    setDraft((current) => ({
                                        ...current,
                                        subject_id: val,
                                    }));
                                    setSelectedClassIds([]);
                                }}
                                disabled={isCreating}
                            >
                                <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm font-medium">
                                    <Select.Value placeholder="Choose subject" />
                                </Select.Trigger>
                                <Select.Content className="border-2 border-black rounded bg-white">
                                    <Select.Group>
                                        {subjects.map((subject) => (
                                            <Select.Item key={subject.id} value={String(subject.id)}>
                                                {subject.name}
                                            </Select.Item>
                                        ))}
                                    </Select.Group>
                                </Select.Content>
                            </Select>
                        </div>

                        <div className="flex flex-col gap-1 w-full">
                            <label className="text-xs font-bold text-gray-700">
                                Topic title
                            </label>
                            <Input
                                value={draft.title}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        title: event.target.value,
                                    }))
                                }
                                disabled={isCreating}
                                placeholder="Introduction to Programming Quiz"
                                className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                            />
                        </div>

                        <div className="flex flex-col gap-1 w-full">
                            <label className="text-xs font-bold text-gray-700">
                                Description
                            </label>
                            <Input
                                value={draft.description}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        description: event.target.value,
                                    }))
                                }
                                disabled={isCreating}
                                placeholder="Short context for students"
                                className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                            />
                        </div>

                        <div className="flex flex-col gap-1 w-full">
                            <label className="text-xs font-bold text-gray-700">
                                Instructions
                            </label>
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
                                className="px-4 py-2 w-full rounded border-2 border-black bg-white shadow-md transition focus:outline-hidden focus:shadow-xs min-h-20 text-sm"
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="flex flex-col gap-1 w-full">
                                <label className="text-xs font-bold text-gray-700">
                                    Grading component
                                </label>
                                <Select
                                    value={draft.classwork_category}
                                    onValueChange={(val) =>
                                        setDraft((current) => ({
                                            ...current,
                                            classwork_category: val,
                                        }))
                                    }
                                    disabled={isCreating}
                                >
                                    <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
                                        <Select.Value placeholder="Select Category" />
                                    </Select.Trigger>
                                    <Select.Content className="border-2 border-black rounded bg-white">
                                        <Select.Group>
                                            <Select.Item value="WRITTEN_WORK">
                                                Written Works
                                            </Select.Item>
                                            <Select.Item value="PERFORMANCE_TASK">
                                                Performance Task
                                            </Select.Item>
                                            <Select.Item value="PERIODICAL_EXAM">
                                                Periodical Exam
                                            </Select.Item>
                                        </Select.Group>
                                    </Select.Content>
                                </Select>
                            </div>

                            <div className="flex flex-col gap-1 w-full">
                                <label className="text-xs font-bold text-gray-700">
                                    Total points
                                </label>
                                <Input
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
                                    className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                />
                            </div>

                            <div className="flex flex-col gap-1 w-full">
                                <label className="text-xs font-bold text-gray-700">
                                    Attempts
                                </label>
                                <Input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={draft.max_attempts}
                                    onChange={(event) => {
                                        setDraft((current) => ({
                                            ...current,
                                            max_attempts: event.target.value,
                                        }));
                                        setQuizSettings((current) => ({
                                            ...current,
                                            max_attempts: event.target.value,
                                        }));
                                    }}
                                    disabled={isCreating}
                                    className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {createStep === "quiz" && (
                    <div className="space-y-4">
                        <div className="rounded-lg border-2 border-black bg-[#F8F6ED] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-lg font-bold">Manual quiz builder</h3>
                                    <p className="text-xs font-medium text-gray-600">
                                        Multiple-choice and short-answer questions only for this
                                        MVP.
                                    </p>
                                </div>
                                <span className="rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold shadow-sm">
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

                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-1 w-full">
                                    <label className="text-xs font-bold text-gray-700">
                                        Duration
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <Input
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
                                            placeholder="No time limit"
                                            className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                        />
                                        <span className="text-xs font-bold">minutes</span>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-1 w-full">
                                    <label className="text-xs font-bold text-gray-700">
                                        Attempts
                                    </label>
                                    <Input
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
                                        className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                    />
                                </div>
                            </div>

                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <div className="flex flex-col gap-1 w-full">
                                    <label className="text-xs font-bold text-gray-700">
                                        Quiz Summary Availability
                                    </label>
                                    <Select
                                        value={quizSettings.summary_release_mode}
                                        onValueChange={(val) =>
                                            setQuizSettings((current) => ({
                                                ...current,
                                                summary_release_mode:
                                                    val as QuizSettingsDraft["summary_release_mode"],
                                                summary_release_at:
                                                    val === "SCHEDULED" ? current.summary_release_at : "",
                                            }))
                                        }
                                        disabled={isCreating}
                                    >
                                        <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
                                            <Select.Value placeholder="Select Release Mode" />
                                        </Select.Trigger>
                                        <Select.Content className="border-2 border-black rounded bg-white">
                                            <Select.Group>
                                                <Select.Item value="IMMEDIATE">
                                                    Immediately after submission
                                                </Select.Item>
                                                <Select.Item value="SCHEDULED">
                                                    At a specific date & time
                                                </Select.Item>
                                                <Select.Item value="AFTER_DUE_DATE" disabled={!draft.due_date}>
                                                    After the quiz due date
                                                </Select.Item>
                                                <Select.Item value="NEVER">Never</Select.Item>
                                            </Select.Group>
                                        </Select.Content>
                                    </Select>
                                </div>

                                {quizSettings.summary_release_mode === "SCHEDULED" ? (
                                    <div className="flex flex-col gap-1 w-full">
                                        <label className="text-xs font-bold text-gray-700">
                                            Release Date & Time
                                        </label>
                                        <Input
                                            type="datetime-local"
                                            value={quizSettings.summary_release_at}
                                            onChange={(event) =>
                                                setQuizSettings((current) => ({
                                                    ...current,
                                                    summary_release_at: event.target.value,
                                                }))
                                            }
                                            disabled={isCreating}
                                            className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                        />
                                    </div>
                                ) : (
                                    <div className="rounded border-2 border-dashed border-gray-300 bg-[#FFFBEE] px-3 py-2 text-xs text-gray-600 flex items-center">
                                        {quizSettings.summary_release_mode === "AFTER_DUE_DATE"
                                            ? "Summary unlocks automatically after the due date."
                                            : quizSettings.summary_release_mode === "NEVER"
                                                ? "Students can see their score, but not the answer summary."
                                                : "Students can view the summary right after submitting."}
                                    </div>
                                )}
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
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
                                    const key = setting.key as keyof Pick<
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
                                            className="flex items-center justify-between rounded border-2 border-black bg-white px-3 py-2 text-left text-xs font-bold shadow-md cursor-pointer transition active:translate-y-0.5"
                                        >
                                            <span>{setting.label}</span>
                                            <span
                                                className={`rounded border border-black px-2 py-0.5 text-[10px] ${enabled ? "bg-[#7ABA78]" : "bg-gray-100"
                                                    }`}
                                            >
                                                {enabled ? "On" : "Off"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="space-y-4">
                            {quizQuestions.map((question, questionIndex) => (
                                <div
                                    key={question.id}
                                    className="rounded-lg border-2 border-black bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                                >
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                        <h3 className="text-base font-bold">
                                            Question {questionIndex + 1}
                                        </h3>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => removeQuizQuestion(question.id)}
                                            disabled={isCreating || quizQuestions.length === 1}
                                            className="border-red-400 text-red-600 font-bold hover:bg-red-50"
                                        >
                                            Remove
                                        </Button>
                                    </div>

                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <div className="flex flex-col gap-1 sm:col-span-2">
                                            <label className="text-xs font-bold text-gray-700">
                                                Question text
                                            </label>
                                            <textarea
                                                value={question.question_text}
                                                onChange={(event) =>
                                                    updateQuizQuestion(question.id, {
                                                        question_text: event.target.value,
                                                    })
                                                }
                                                disabled={isCreating}
                                                placeholder="Which of the following is the primary function of a CPU?"
                                                className="px-4 py-2 w-full rounded border-2 border-black bg-white shadow-md transition focus:outline-hidden focus:shadow-xs min-h-20 text-sm"
                                            />
                                        </div>
                                        <div className="grid gap-3">
                                            <div className="flex flex-col gap-1 w-full">
                                                <label className="text-xs font-bold text-gray-700">
                                                    Type
                                                </label>
                                                <Select
                                                    value={question.question_type}
                                                    onValueChange={(val) =>
                                                        updateQuizQuestion(question.id, {
                                                            question_type: val as QuizQuestionType,
                                                        })
                                                    }
                                                    disabled={isCreating}
                                                >
                                                    <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
                                                        <Select.Value />
                                                    </Select.Trigger>
                                                    <Select.Content className="border-2 border-black rounded bg-white">
                                                        <Select.Group>
                                                            <Select.Item value="MULTIPLE_CHOICE">
                                                                Multiple Choice
                                                            </Select.Item>
                                                            <Select.Item value="SHORT_ANSWER">
                                                                Short Answer
                                                            </Select.Item>
                                                        </Select.Group>
                                                    </Select.Content>
                                                </Select>
                                            </div>

                                            <div className="flex flex-col gap-1 w-full">
                                                <label className="text-xs font-bold text-gray-700">
                                                    Points
                                                </label>
                                                <Input
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
                                                    className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {question.question_type === "MULTIPLE_CHOICE" ? (
                                        <div className="mt-4 space-y-2">
                                            <p className="text-xs font-bold text-gray-700">Choices</p>
                                            {question.options.map((option, optionIndex) => (
                                                <div
                                                    key={`${question.id}-${option.option_order}`}
                                                    className="flex items-center gap-2"
                                                >
                                                    <input
                                                        type="radio"
                                                        checked={option.is_correct}
                                                        onChange={() =>
                                                            markCorrectOption(question.id, optionIndex)
                                                        }
                                                        disabled={isCreating}
                                                        className="h-4 w-4 cursor-pointer"
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
                                                        className="flex-1 bg-white border-2 border-black rounded shadow-md text-sm"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            removeQuizOption(question.id, optionIndex)
                                                        }
                                                        disabled={
                                                            isCreating || question.options.length <= 2
                                                        }
                                                        className="rounded border-2 border-black p-2 text-xs font-bold bg-white cursor-pointer hover:bg-gray-100 disabled:opacity-40 transition"
                                                        aria-label={`Remove choice ${optionIndex + 1}`}
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => addQuizOption(question.id)}
                                                disabled={isCreating}
                                                className="bg-[#F6E9B2] border-black border-2 rounded hover:bg-[#ebd88d]"
                                            >
                                                Add choice
                                            </Button>
                                        </div>
                                    ) : (
                                        <p className="mt-3 rounded border-2 border-dashed border-gray-400 px-3 py-3 text-xs font-medium text-gray-600 bg-gray-50">
                                            Short-answer questions are manually graded after students
                                            submit.
                                        </p>
                                    )}

                                    <div className="mt-3 flex flex-col gap-1 w-full">
                                        <label className="text-xs font-bold text-gray-700">
                                            Explanation or answer guide
                                        </label>
                                        <textarea
                                            value={question.explanation}
                                            onChange={(event) =>
                                                updateQuizQuestion(question.id, {
                                                    explanation: event.target.value,
                                                })
                                            }
                                            disabled={isCreating}
                                            placeholder="Optional guidance for review or grading"
                                            className="px-4 py-2 w-full rounded border-2 border-black bg-white shadow-md transition focus:outline-hidden focus:shadow-xs min-h-16 text-sm"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Button
                                type="button"
                                onClick={() => addQuizQuestion("MULTIPLE_CHOICE")}
                                disabled={isCreating}
                                className="bg-[#7ABA78] hover:bg-[#6ab368]"
                            >
                                Add multiple choice
                            </Button>
                            <Button
                                type="button"
                                onClick={() => addQuizQuestion("SHORT_ANSWER")}
                                disabled={isCreating}
                                className="bg-white hover:bg-gray-50 border-black border-2"
                            >
                                Add short answer
                            </Button>
                        </div>
                    </div>
                )}

                {createStep === "assign" && (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1 w-full">
                                <label className="text-xs font-bold text-gray-700">
                                    Due date
                                </label>
                                <Input
                                    type="datetime-local"
                                    value={draft.due_date}
                                    onChange={(event) =>
                                        setDraft((current) => ({
                                            ...current,
                                            due_date: event.target.value,
                                        }))
                                    }
                                    disabled={isCreating}
                                    className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                                />
                            </div>

                            <div className="flex flex-col gap-1 w-full">
                                <label className="text-xs font-bold text-gray-700">
                                    Publish status
                                </label>
                                <Select
                                    value={draft.is_published ? "published" : "draft"}
                                    onValueChange={(val) =>
                                        setDraft((current) => ({
                                            ...current,
                                            is_published: val === "published",
                                        }))
                                    }
                                    disabled={isCreating}
                                >
                                    <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
                                        <Select.Value />
                                    </Select.Trigger>
                                    <Select.Content className="border-2 border-black rounded bg-white">
                                        <Select.Group>
                                            <Select.Item value="published">Publish now</Select.Item>
                                            <Select.Item value="draft">
                                                Keep hidden from students
                                            </Select.Item>
                                        </Select.Group>
                                    </Select.Content>
                                </Select>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-1 w-full">
                                <label className="text-xs font-bold text-gray-700">
                                    Locked until
                                </label>
                                <Input
                                    type="datetime-local"
                                    value={draft.lock_date}
                                    onChange={(event) =>
                                        setDraft((current) => ({
                                            ...current,
                                            lock_date: event.target.value,
                                        }))
                                    }
                                    disabled={isCreating || !draft.is_published}
                                    className="w-full bg-white border-2 border-black rounded shadow-md text-sm disabled:bg-gray-100 disabled:opacity-55"
                                />
                            </div>

                            {draft.due_date && (
                                <div className="flex items-center pt-5">
                                    <label className="flex items-start gap-3 rounded border-2 border-black bg-[#F6E9B2] px-3 py-2 text-xs font-bold shadow-md cursor-pointer">
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
                                            className="mt-0.5 cursor-pointer"
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
                        </div>

                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-xs font-bold text-gray-700">
                                    Assign to sections
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setSelectedClassIds(
                                            selectedSubjectLoads.map((load) => load.class_id),
                                        )
                                    }
                                    disabled={isCreating || selectedSubjectLoads.length === 0}
                                    className="px-2 py-1 text-xs border border-black rounded shadow-xs"
                                >
                                    Select all
                                </Button>
                            </div>

                            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                                {selectedSubjectLoads.map((load) => {
                                    const isSelected = selectedClassIds.includes(load.class_id);
                                    return (
                                        <button
                                            key={load.subject_load_id}
                                            type="button"
                                            onClick={() => toggleClass(load.class_id)}
                                            disabled={isCreating}
                                            className={`rounded border-2 border-black px-3 py-2 text-xs font-bold text-center cursor-pointer transition shadow-md hover:translate-y-0.5 active:translate-y-1 ${isSelected ? "bg-[#7ABA78]" : "bg-white"
                                                }`}
                                        >
                                            {load.section_name}
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedSubjectLoads.length === 0 && (
                                <p className="rounded border-2 border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500 bg-gray-50">
                                    No active sections are assigned to this subject.
                                </p>
                            )}
                        </div>

                        <div>
                            <div className="mb-2">
                                <p className="text-xs font-bold text-gray-700">
                                    Link under lesson
                                </p>
                                <p className="text-[10px] text-gray-500">
                                    Only lessons assigned to every selected section are shown.
                                </p>
                            </div>

                            {selectedClassIds.length === 0 ? (
                                <p className="rounded border-2 border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500 bg-gray-50">
                                    Select a section first to load available lessons.
                                </p>
                            ) : isLessonLoading ? (
                                <p className="rounded border-2 border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500 bg-gray-50">
                                    Loading lessons...
                                </p>
                            ) : availableLessons.length > 0 ? (
                                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
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
                                                className={`rounded border-2 border-black px-3 py-2 text-left text-xs font-bold cursor-pointer transition shadow-md hover:translate-y-0.5 active:translate-y-1 ${isSelected ? "bg-[#7ABA78]" : "bg-white"
                                                    }`}
                                            >
                                                <span className="block truncate">{lesson.title}</span>
                                                <span className="mt-1 block text-[10px] font-medium text-gray-600">
                                                    {lesson.is_published
                                                        ? "Published lesson"
                                                        : "Draft lesson"}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="rounded border-2 border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500 bg-gray-50">
                                    No shared lesson is assigned to all selected sections.
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </section>

            <Dialog.Footer position="fixed" variant="default">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        if (createStep === "quiz-source") {
                            onBack();
                        } else if (createStep === "details") {
                            setCreateStep("quiz-source");
                        } else if (createStep === "quiz") {
                            setCreateStep("details");
                        } else {
                            setCreateStep("quiz");
                        }
                    }}
                    disabled={isCreating}
                >
                    {createStep === "quiz-source" ? "Back" : "Previous"}
                </Button>

                {createStep === "quiz-source" ? null : createStep === "details" ? (
                    <Button
                        type="button"
                        onClick={() => {
                            const validationError = validateDetails();
                            if (validationError) {
                                setCreateError(validationError);
                            } else {
                                setCreateError("");
                                setCreateStep("quiz");
                            }
                        }}
                        disabled={isCreating}
                    >
                        Next
                    </Button>
                ) : createStep === "quiz" ? (
                    <Button type="button" onClick={goToAssignStep} disabled={isCreating}>
                        Next
                    </Button>
                ) : (
                    <Button
                        type="button"
                        onClick={handleCreateQuiz}
                        disabled={isCreating}
                        className="bg-[#7ABA78] hover:bg-[#6ab368]"
                    >
                        {isCreating ? "Creating..." : "Assign"}
                    </Button>
                )}
            </Dialog.Footer>
        </Dialog.Content>
    );
}
