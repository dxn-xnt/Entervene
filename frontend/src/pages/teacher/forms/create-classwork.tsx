"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Plus, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import {
  emptyClassworkDraft,
  allowedClassworkMaterialExtensions,
  maxClassworkMaterialSize,
  formatFileSize,
  fileExtension,
  isReadingType,
} from "@/lib/classwork-utils";
import type {
  ClassworkKind,
  CreateDraft,
  TeacherClassLoad,
  TeacherLesson,
} from "@/types/classwork";

interface CreateClassworkModalProps {
  selectedType: ClassworkKind;
  subjects: Array<{ id: number; name: string }>;
  loads: TeacherClassLoad[];
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

export default function CreateClassworkModal({
  selectedType,
  subjects,
  loads,
  onClose,
  onSuccess,
  onBack,
}: CreateClassworkModalProps) {
  const [createStep, setCreateStep] = useState<"details" | "assign">("details");
  const [draft, setDraft] = useState<CreateDraft>({
    ...emptyClassworkDraft,
    classwork_category: "WRITTEN_WORK",
    subject_id: subjects[0] ? String(subjects[0].id) : "",
  });
  const [materials, setMaterials] = useState<File[]>([]);
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

  const addMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find(
      (file) =>
        !allowedClassworkMaterialExtensions.includes(fileExtension(file.name)),
    );
    if (invalid) {
      setCreateError(
        `${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`,
      );
      return;
    }
    const oversized = selectedFiles.find(
      (file) => file.size > maxClassworkMaterialSize,
    );
    if (oversized) {
      setCreateError(`${oversized.name} is larger than the 4 MB limit.`);
      return;
    }
    setCreateError("");
    setMaterials((current) => {
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

  const removeMaterial = (index: number) => {
    setMaterials((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
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
    if (!isReadingType(selectedType)) {
      const points = Number(draft.total_points);
      if (draft.total_points && (!Number.isFinite(points) || points <= 0)) {
        return "Total points must be greater than zero.";
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

  const handleCreateClasswork = async () => {
    const validationError = validateDetails();
    if (validationError) {
      setCreateError(validationError);
      setCreateStep("details");
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
      const isReading = isReadingType(selectedType);
      const totalPoints =
        !isReading && draft.total_points ? Number(draft.total_points) : null;
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
      formData.append(
        "allow_late_submissions",
        String(draft.allow_late_submissions),
      );
      if (draft.lock_date) {
        formData.append("lock_date", new Date(draft.lock_date).toISOString());
      }
      materials.forEach((material) => formData.append("files", material));

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

      onSuccess();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Unable to create classwork.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const createStepTitle =
    selectedType === "READING"
      ? "Create Reading"
      : selectedType === "ASSIGNMENT"
        ? "Create Assignment"
        : "Create Activity";

  const createStepNumber = createStep === "details" ? 1 : 2;
  const createStepTotal = 2;

  return (
    <Dialog.Content size="2xl">
      <Dialog.Header position="fixed" asChild>
        <div className="flex items-center justify-between w-full">
          <div>
            <Text as="h5" className="font-sans text-xl font-bold">
              {createStepTitle}
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
                placeholder="Introduction to Programming Reading Materials"
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

            <div className="grid gap-4 sm:grid-cols-2">
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

              {!isReadingType(selectedType) && (
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
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-gray-700">
                  Upload material
                </p>
                <p className="text-xs text-gray-500">
                  PDF, DOCX, PPTX, JPG, PNG | 4 MB each
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {materials.map((material, index) => (
                  <div
                    key={`${material.name}-${material.size}`}
                    className="relative flex h-28 w-24 flex-col justify-between rounded-lg border-2 border-black bg-white p-2 text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <button
                      type="button"
                      onClick={() => removeMaterial(index)}
                      disabled={isCreating}
                      className="absolute right-1 top-1 rounded-full border border-black bg-white p-0.5 cursor-pointer hover:bg-gray-100"
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
                <label className="flex h-28 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-black bg-[#F6E9B2] text-sm font-bold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#7ABA78] transition">
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

              {draft.due_date && !isReadingType(selectedType) && (
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
                      className={`rounded border-2 border-black px-3 py-2 text-xs font-bold text-center cursor-pointer transition shadow-md hover:translate-y-0.5 active:translate-y-1 ${
                        isSelected ? "bg-[#7ABA78]" : "bg-white"
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
                        className={`rounded border-2 border-black px-3 py-2 text-left text-xs font-bold cursor-pointer transition shadow-md hover:translate-y-0.5 active:translate-y-1 ${
                          isSelected ? "bg-[#7ABA78]" : "bg-white"
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
            if (createStep === "details") {
              onBack();
            } else {
              setCreateStep("details");
            }
          }}
          disabled={isCreating}
        >
          {createStep === "details" ? "Back" : "Previous"}
        </Button>

        {createStep === "details" ? (
          <Button type="button" onClick={goToAssignStep} disabled={isCreating}>
            Next
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleCreateClasswork}
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
