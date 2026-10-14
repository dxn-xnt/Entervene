"use client";

import { useState, useEffect, useMemo } from "react";
import { Check, CheckCheck, FileText, Plus, Trash2 } from "lucide-react";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Switch } from "@/components/retroui/Switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { useToast } from "@/components/retroui/use-toast";
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

export interface EditClassworkModalProps {
  classwork: TeacherClasswork;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: TeacherClasswork) => void;
}

export default function EditClassworkModal({
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
  const [editMaterials, setEditMaterials] = useState<File[]>([]);
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
  const toast = useToast();

  const setFormError = (msg: string) => {
    toast.error({ title: msg });
  };

  useEffect(() => {
    if (!isOpen) return;
    apiFetch("/api/v1/classwork-assignments/teacher/classes")
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as TeacherClassLoad[];
          setLoads(data);
        }
      })
      .catch(() => { });
  }, [isOpen]);

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
    setRubricLevels(
      classwork.rubric_levels?.length
        ? classwork.rubric_levels.map((level) => ({ ...level }))
        : defaultActivityRubric.map((level) => ({ ...level })),
    );
  }, [classwork, isOpen]);

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

  const saveClassworkEdit = async () => {
    if (!currentClasswork || !editDraft) return;

    const isReading = isReadingType(editDraft.classwork_type);
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
      isQuizType(editDraft.classwork_type) &&
      (!Number.isInteger(attempts) || attempts <= 0)
    ) {
      setFormError("Allowed attempts must be a positive whole number.");
      return;
    }
    if (selectedClassIds.length === 0) {
      setFormError("Select at least one section to assign.");
      return;
    }

    const originalRubric = classwork.rubric_levels ?? [];
    const rubricChanged =
      hasRubric && JSON.stringify(rubricLevels) !== JSON.stringify(originalRubric);
    if (
      rubricChanged &&
      (currentClasswork.has_submissions || currentClasswork.has_graded_submissions)
    ) {
      const message = currentClasswork.has_graded_submissions
        ? "This classwork already has graded submissions. Updating the rubric will not change previously recorded grades. Continue?"
        : "This classwork already has student submissions. Rubric changes will apply when these submissions are graded. Continue?";
      if (!window.confirm(message)) return;
    }

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
            is_published: editDraft.is_published,
            show_scores: editDraft.show_scores,
            lesson_ids: selectedLessonIds,
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
          typeof detail === "string" ? detail : "Unable to update classwork.",
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
              max_attempts: isQuizType(editDraft.classwork_type)
                ? attempts
                : null,
              is_published: editDraft.is_published,
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

          <section className="flex flex-col gap-4 p-5">
            <div className="grid gap-3">
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
                  <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm font-medium">
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
                  className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
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
                  <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm font-medium">
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
                      <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
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
                          className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                        />
                      </Field>
                    )}
                </div>
              )}

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

              {(editDraft.classwork_type === "ACTIVITY" ||
                editDraft.classwork_type === "ASSIGNMENT") && (
                  <ActivityRubricEditor
                    levels={rubricLevels}
                    onChange={setRubricLevels}
                    disabled={isSavingEdit}
                  />
                )}
            </div>

            <div className="space-y-4">
              <div
                className={`grid gap-4 ${isReadingType(editDraft.classwork_type)
                  ? ""
                  : isQuizType(editDraft.classwork_type)
                    ? "sm:grid-cols-3"
                    : "sm:grid-cols-2"
                  }`}
              >
                {!isReadingType(editDraft.classwork_type) && (
                  <Field label="Due Date">
                    <Input
                      type="datetime-local"
                      value={editDraft.due_date}
                      onChange={(event) =>
                        setEditDraft((current) => ({
                          ...current,
                          due_date: event.target.value,
                        }))
                      }
                      disabled={isSavingEdit}
                      className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                    />
                  </Field>
                )}

                <Field label="Publish Status">
                  <Select
                    value={editDraft.is_published ? "published" : "draft"}
                    onValueChange={(val) =>
                      setEditDraft((current) => ({
                        ...current,
                        is_published: val === "published",
                      }))
                    }
                    disabled={isSavingEdit}
                  >
                    <Select.Trigger className="w-full bg-white border-2 border-black rounded shadow-md text-sm">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black rounded bg-white">
                      <Select.Group>
                        <Select.Item value="draft">Save as Draft</Select.Item>
                        <Select.Item value="published">Publish Now</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </Field>

                <Field label="Locked Until">
                  <Input
                    type="datetime-local"
                    value={editDraft.lock_date}
                    onChange={(event) =>
                      setEditDraft((current) => ({
                        ...current,
                        lock_date: event.target.value,
                      }))
                    }
                    disabled={isSavingEdit || !editDraft.is_published}
                    className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                  />
                </Field>

                {isQuizType(editDraft.classwork_type) && (
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
                      disabled={isSavingEdit}
                      className="w-full bg-white border-2 border-black rounded shadow-md text-sm"
                    />
                  </Field>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {!isReadingType(editDraft.classwork_type) && (
                  <div className="flex items-center gap-2 w-full justify-between">
                    <label className="text-sm font-medium text-foreground">
                      Show scores to students
                    </label>
                    <Switch
                      checked={editDraft.show_scores}
                      onCheckedChange={(checked) =>
                        setEditDraft((current) => ({
                          ...current,
                          show_scores: checked,
                        }))
                      }
                      disabled={isSavingEdit}
                    />
                  </div>
                )}

                {editDraft.due_date &&
                  !isReadingType(editDraft.classwork_type) && (
                    <div className="flex items-center gap-2 w-full justify-between">
                      <label className="text-sm font-medium text-foreground">
                        Allow late submissions
                      </label>
                      <Switch
                        checked={editDraft.allow_late_submissions}
                        onCheckedChange={(checked) =>
                          setEditDraft((current) => ({
                            ...current,
                            allow_late_submissions: checked,
                          }))
                        }
                        disabled={isSavingEdit}
                      />
                    </div>
                  )}
              </div>

              <div className="mt-4">
                <Field label="Assign to sections">
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
              </div>
            </div>
          </section>

          <Dialog.Footer position="fixed">
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
                onClick={saveClassworkEdit}
                disabled={isSavingEdit || removingAttachmentId !== null}
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
  );
}
