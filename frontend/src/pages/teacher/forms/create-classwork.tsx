"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCheck, FileText, Plus, Trash2, X } from "lucide-react";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { useToast } from "@/components/retroui/use-toast";
import { Switch } from "@/components/retroui/Switch";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ActivityRubricEditor } from "@/components/activity-rubric-editor";
import { activityRubricMaximum, defaultActivityRubric, validateActivityRubric } from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";
import type { TeacherInterventionDetail, RemediationFocus, OriginalExamination } from "@/lib/teacher-interventions-api";
import { categoryFromFocus, focusGuidance } from "@/lib/remediation-authoring";
import { Card } from "@/components/retroui/Card";

interface CreateClassworkModalProps {
  selectedType: ClassworkKind;
  subjects: Array<{ id: number; name: string }>;
  loads: TeacherClassLoad[];
  initialSubjectId?: string;
  initialTitle?: string;
  initialInstructions?: string;
  remediationDraft?: boolean;
  remediationTarget?: TeacherInterventionDetail | null;
  remediationFocus?: RemediationFocus | null;
  remediationGradeTreatment?: "PRACTICE_ONLY" | "WRITTEN_WORK" | "PERFORMANCE_TASK" | "EXAMINATION" | null;
  remediationOriginalExam?: OriginalExamination | null;
  onClose: () => void;
  onSuccess: () => void;
  onBack: () => void;
}

export default function CreateClassworkModal({
  selectedType,
  subjects,
  loads,
  initialSubjectId,
  initialTitle,
  initialInstructions,
  remediationDraft = false,
  remediationTarget,
  remediationFocus = null,
  remediationGradeTreatment = null,
  remediationOriginalExam = null,
  onClose,
  onSuccess,
  onBack,
}: CreateClassworkModalProps) {
  const [createStep, setCreateStep] = useState<"details" | "assign">("details");
  const [draft, setDraft] = useState<CreateDraft>(() => {
    const preferredId =
      initialSubjectId && subjects.some((s) => String(s.id) === String(initialSubjectId))
        ? String(initialSubjectId)
        : subjects[0]
          ? String(subjects[0].id)
          : "";
    return {
      ...emptyClassworkDraft,
      title: initialTitle || "",
      instructions: initialInstructions || "",
      is_published: remediationDraft ? false : emptyClassworkDraft.is_published,
      classwork_category: remediationDraft ? (remediationGradeTreatment === "PRACTICE_ONLY" ? "" : remediationGradeTreatment === "EXAMINATION" ? "QUARTERLY_ASSESSMENT" : remediationGradeTreatment || "") : categoryFromFocus(null),
      exam_subtype: remediationOriginalExam?.subtype ?? "",
      total_points: remediationOriginalExam ? String(remediationOriginalExam.total_points) : emptyClassworkDraft.total_points,
      subject_id: preferredId,
    };
  });
  useEffect(() => {
    if (initialSubjectId && subjects.some((subject) => String(subject.id) === String(initialSubjectId))) {
      setDraft((current) => current.subject_id ? current : { ...current, subject_id: String(initialSubjectId) });
    }
  }, [initialSubjectId, subjects]);
  const [materials, setMaterials] = useState<File[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>(remediationTarget ? [remediationTarget.class_id] : []);
  const [remediationRequestId] = useState(() => crypto.randomUUID());
  const [availableLessons, setAvailableLessons] = useState<TeacherLesson[]>([]);
  const toast = useToast();
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>([]);
  const [isLessonLoading, setIsLessonLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [rubricLevels, setRubricLevels] = useState<ActivityRubricLevel[]>(() =>
    defaultActivityRubric.map((level) => ({ ...level })),
  );

  const setFormError = (msg: string) => {
    toast.error({ title: msg });
  };

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

  const addMaterials = (files: FileList | null) => {
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
    if (remediationTarget) return;
    setSelectedClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const validateDetails = () => {
    if (!draft.subject_id) return "Choose a subject.";
    if (!draft.title.trim()) return "Topic title is required.";
    if (remediationDraft && (draft.classwork_category === "QUARTERLY_ASSESSMENT" || draft.classwork_category === "EXAMS") && !draft.exam_subtype) return "Choose an Examination sub-type explicitly.";
    if (remediationGradeTreatment === "EXAMINATION" && (!remediationOriginalExam || draft.exam_subtype !== remediationOriginalExam.subtype || Number(draft.total_points) !== remediationOriginalExam.total_points)) return "Remedial Examination must match the original subtype and maximum points.";
    if (!isReadingType(selectedType)) {
      const hasRubric = selectedType === "ACTIVITY" || selectedType === "ASSIGNMENT";
      if (hasRubric) {
        const rubricError = validateActivityRubric(rubricLevels);
        if (rubricError) return rubricError;
      }
      const points = Number(draft.total_points);
      if (!hasRubric && draft.total_points && (!Number.isFinite(points) || points <= 0)) {
        return "Total points must be greater than zero.";
      }
    }
    return "";
  };

  const goToAssignStep = () => {
    const validationError = validateDetails();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSelectedClassIds((current) => {
      const validIds = new Set(
        selectedSubjectLoads.map((load) => load.class_id),
      );
      return current.filter((id) => validIds.has(id));
    });
    setCreateStep("assign");
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
                (l) =>
                  Number(l.subject_id) === subjectIdNum && !l.is_archived,
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
        setSelectedLessonIds((current) =>
          remediationFocus
            ? remediationFocus.lesson_ids.filter((id) => uniqueLessons.has(id))
            : current.filter((id) => uniqueLessons.has(id)),
        );
      } catch (err) {
        if (!isActive) return;
        setAvailableLessons([]);
        setSelectedLessonIds([]);
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
  }, [draft.subject_id, loads, remediationFocus]);

  const handleCreateClasswork = async () => {
    const validationError = validateDetails();
    if (validationError) {
      setFormError(validationError);
      setCreateStep("details");
      return;
    }
    if (selectedClassIds.length === 0) {
      setFormError("Select at least one section to assign this classwork.");
      return;
    }
    if (selectedLessonIds.length === 0) {
      setFormError("Select the lesson where this classwork should appear.");
      return;
    }

    setIsCreating(true);
    try {
      const isReading = isReadingType(selectedType);
      const totalPoints = selectedType === "ACTIVITY" || selectedType === "ASSIGNMENT"
        ? activityRubricMaximum(rubricLevels)
        : !isReading && draft.total_points ? Number(draft.total_points) : null;
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
      if (totalPoints !== null) {
        formData.append("total_points", String(totalPoints));
      }
      if (selectedType === "ACTIVITY" || selectedType === "ASSIGNMENT") {
        formData.append("rubric_payload", JSON.stringify(rubricLevels));
      }
      formData.append("subject_id", String(draft.subject_id));
      formData.append("is_published", String(draft.is_published));
      formData.append("show_scores", String(draft.show_scores));
      formData.append("class_ids", JSON.stringify(selectedClassIds));
      if (remediationTarget) {
        formData.append("intervention_id", String(remediationTarget.intervention_id));
        formData.append("remediation_request_id", remediationRequestId);
        if (remediationOriginalExam && remediationGradeTreatment === "EXAMINATION") formData.append("original_exam_assignment_id", String(remediationOriginalExam.assignment_id));
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
      const selectedLoad = loads.find(
        (l) =>
          l.subject_id === Number(draft.subject_id) &&
          selectedClassIds.includes(l.class_id),
      );
      if (selectedLoad?.academic_period_id) {
        formData.append("academic_period_id", String(selectedLoad.academic_period_id));
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
        throw new Error(typeof detail === "string" ? detail : "Unable to create classwork.");
      }
      await createResponse.json();

      toast.success({ title: "Classwork created successfully." });
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create classwork.";
      setFormError(message);
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
    <>
      <Dialog.Content size="lg">
        <Dialog.Header position="fixed" asChild>
          <div className="flex items-center justify-between w-full">
            <div className="flex flex-row w-full justify-between items-center">
              <Text as="h5" className="font-sans text-xl font-bold">
                {createStepTitle}
              </Text>
              <p className="text-base font-semibold">
                Step {createStepNumber} of {createStepTotal}
              </p>
            </div>
            {/* <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              className="cursor-pointer text-white hover:text-gray-200"
            >
              <X size={18} />
            </button> */}
          </div>
        </Dialog.Header>

        <section className="flex flex-col gap-4 p-5">
          {createStep === "details" && (
            <div className="grid gap-3">
              <Field label="Subject">
                <Select
                  value={draft.subject_id}
                  onValueChange={(val) => {
                    setDraft((current) => ({
                      ...current,
                      subject_id: val,
                    }));
                    setSelectedClassIds([]);
                    setSelectedLessonIds([]);
                  }}
                  disabled={isCreating || Boolean(remediationTarget)}
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
              </Field>

              <Field label="Link Lesson">
                <Select
                  value={selectedLessonIds[0] ? String(selectedLessonIds[0]) : ""}
                  onValueChange={(val) => {
                    setSelectedLessonIds(val ? [Number(val)] : []);
                  }}
                  disabled={
                    isCreating ||
                    !draft.subject_id ||
                    isLessonLoading ||
                    availableLessons.length === 0
                  }
                >
                  <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm font-medium">
                    <Select.Value
                      className="text-muted-foreground"
                      placeholder={
                        !draft.subject_id
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
              </Field>

              <Field label="Instructions">
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
              </Field>

              {!isReadingType(selectedType) && (
                <div className={`grid gap-4 ${(draft.classwork_category === "QUARTERLY_ASSESSMENT" || draft.classwork_category === "EXAMS") || (selectedType !== "ACTIVITY" && selectedType !== "ASSIGNMENT") ? "sm:grid-cols-2" : ""}`}>
                  {remediationDraft && remediationGradeTreatment === "PRACTICE_ONLY" ?
                    <p className="rounded border border-green-700 bg-green-50 p-3 text-sm font-semibold">
                      Practice only · No official grading component. Score and completion remain visible in Intervention progress.
                    </p>
                    : <Field label="Grading Component">
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
                            {(!remediationDraft || remediationGradeTreatment === "EXAMINATION") && <Select.Item value="QUARTERLY_ASSESSMENT">
                              Exams
                            </Select.Item>}
                          </Select.Group>
                        </Select.Content>
                      </Select>
                    </Field>}

                  {(draft.classwork_category === "QUARTERLY_ASSESSMENT" || draft.classwork_category === "EXAMS") && (
                    <Field label="Exam Sub-type">
                      <Select
                        value={remediationDraft ? draft.exam_subtype : (draft.exam_subtype || "SUMMATIVE_1")}
                        onValueChange={(val) =>
                          setDraft((current) => ({
                            ...current,
                            exam_subtype: val,
                          }))
                        }
                        disabled={isCreating || remediationGradeTreatment === "EXAMINATION"}
                      >
                        <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
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

                  {selectedType !== "ACTIVITY" && selectedType !== "ASSIGNMENT" && <Field label="Total points">
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
                      disabled={isCreating || remediationGradeTreatment === "EXAMINATION"}
                      className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                    />
                  </Field>}
                </div>
              )}

              {remediationFocus && !isReadingType(selectedType) && (
                <p className="rounded border p-3 text-sm">
                  Evidence focus: {focusGuidance(remediationFocus)}
                  {remediationGradeTreatment === "EXAMINATION" && remediationOriginalExam ? ` Original ${remediationOriginalExam.title}: ${remediationOriginalExam.score}/${remediationOriginalExam.total_points}. The higher result will count.` : ""}
                  {remediationDraft && remediationGradeTreatment === "PRACTICE_ONLY" && " Practice only: completion and score do not affect official grades or predictions."}
                </p>
              )}

              <Field label="Upload Material">
                {materials.length === 0 ? (
                  <Empty className="shadow-md hover:shadow-none transition-shadow">
                    <EmptyHeader>
                      <EmptyTitle>No Materials Added</EmptyTitle>
                      <EmptyDescription className="flex flex-col -gap-3 text-center whitespace-nowrap">
                        <span className="font-semibold">
                          Max 10mb
                        </span>
                        <span>
                          (pdf, docx, pptx, jpg & png)
                        </span>
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button
                        asChild
                        size="sm"
                        variant="default"
                        className="cursor-pointer rounded!"
                        disabled={isCreating}
                      >
                        <label>
                          <Plus size={14} className="mr-1" />
                          Add Materials
                          <input
                            type="file"
                            multiple
                            accept=".pdf,.docx,.ppt,.pptx,.jpg,.jpeg,.png"
                            onChange={(event) => {
                              addMaterials(event.target.files);
                              event.target.value = "";
                            }}
                            disabled={isCreating}
                            className="hidden"
                          />
                        </label>
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <div className="w-full flex flex-wrap gap-3">
                    {materials.map((material, index) => (
                      <div
                        key={`${material.name}-${material.size}`}
                        className="relative flex h-32 w-28 border-2 border-border flex-col justify-between p-2 text-center shadow-none"
                      >
                        <Tooltip>
                          <TooltipTrigger render={<span className="absolute right-1 top-1 inline-flex"><button
                            type="button"
                            onClick={() => removeMaterial(index)}
                            disabled={isCreating}
                            className="flex h-6 w-6 items-center justify-center rounded-full border border-black bg-white text-black hover:bg-destructive hover:text-white transition-colors cursor-pointer disabled:cursor-not-allowed"
                            aria-label={`Remove ${material.name}`}
                          >
                            <Trash2 size={13} />
                          </button></span>} />
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
                          addMaterials(event.target.files);
                          event.target.value = "";
                        }}
                        disabled={isCreating}
                        className="hidden"
                      />
                    </label>
                  </div>
                )}
              </Field>

              {(selectedType === "ACTIVITY" || selectedType === "ASSIGNMENT") && (
                <ActivityRubricEditor
                  levels={rubricLevels}
                  onChange={setRubricLevels}
                  disabled={isCreating}
                />
              )}
            </div>
          )}

          {createStep === "assign" && (
            <div className="space-y-4">
              <div className={`grid gap-4 ${isReadingType(selectedType) ? "" : "sm:grid-cols-2"}`}>
                {!isReadingType(selectedType) && (
                  <Field label="Due Date">
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
                  </Field>
                )}

                <Field label="Publish Status">
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
                </Field>
              </div>

              <Field label="Locked Until">
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
              </Field>

              <div className="flex flex-col gap-3">
                {!isReadingType(selectedType) && (
                  <div className="flex items-center gap-2 w-full justify-between">
                    <label className="text-sm font-medium text-foreground">
                      Show scores to students
                    </label>
                    <Switch
                      checked={draft.show_scores}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          show_scores: checked,
                        }))
                      }
                      disabled={isCreating}
                    />
                  </div>
                )}

                {draft.due_date && !isReadingType(selectedType) && (
                  <div className="flex items-center gap-2 w-full justify-between">
                    <label className="text-sm font-medium text-foreground">
                      Allow late submissions
                    </label>
                    <Switch
                      checked={draft.allow_late_submissions}
                      onCheckedChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          allow_late_submissions: checked,
                        }))
                      }
                      disabled={isCreating}
                    />
                  </div>
                )}
              </div>

              <div className="mt-4">
                <Field label="Assign to sections">
                  {remediationTarget && <p className="mb-3 rounded border p-3 text-sm">Remedial assignment for <strong>{remediationTarget.student_name}</strong> in {remediationTarget.class_name}. Only this student will receive this activity.</p>}
                  {remediationFocus && <p className="mb-3 rounded border p-3 text-sm">Evidence focus: {focusGuidance(remediationFocus)}{remediationFocus.component === "EXAMINATION" ? " Remedial Examination publication is blocked; choose another grading component for a graded activity." : ""}</p>}
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
                        disabled={isCreating || Boolean(remediationTarget)}
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
                            disabled={isCreating || Boolean(remediationTarget)}
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
              </div>

            </div>
          )}
        </section>

        <Dialog.Footer position="fixed" variant="default">
          <div className="flex flex-row w-full justify-between">
            <Button
              variant="outline"
              onClick={onClose}
              className="gap-2"
            >
              <X className="size-4" />
              Close
            </Button>
            <div className="flex flex-row gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  if (createStep === "details") {
                    onBack();
                  } else {
                    setCreateStep("details");
                  }
                }}
                disabled={isCreating}
                className="gap-2"
              >
                <ArrowLeft className="size-4" />
                {createStep === "details" ? "Back" : "Previous"}
              </Button>

              {createStep === "details" ? (
                <Button onClick={goToAssignStep} disabled={isCreating} className="gap-2">
                  Next
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  autoIcon={false}
                  onClick={handleCreateClasswork}
                  disabled={isCreating}
                  className="gap-2"
                >
                  <Plus className="size-4" />
                  Assign
                </Button>
              )}
            </div>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </>
  );
}
