import { useState, useEffect } from "react";
import { FileText, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
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
  ClassworkAttachment,
  EditDraft,
  TeacherClasswork,
} from "@/types/classwork";

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
  const [isUploadingEditMaterials, setIsUploadingEditMaterials] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCurrentClasswork(classwork);
    setEditDraft(classworkToEditDraft(classwork));
    setEditMaterials([]);
    setError("");
  }, [classwork, isOpen]);

  const addEditMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find(
      (file) =>
        !allowedClassworkMaterialExtensions.includes(fileExtension(file.name)),
    );
    if (invalid) {
      setError(
        `${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`,
      );
      return;
    }
    const oversized = selectedFiles.find(
      (file) => file.size > maxClassworkMaterialSize,
    );
    if (oversized) {
      setError(`${oversized.name} is larger than the 4 MB limit.`);
      return;
    }
    setError("");
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

  const uploadEditMaterials = async () => {
    if (!currentClasswork || editMaterials.length === 0) return;

    setIsUploadingEditMaterials(true);
    setError("");
    try {
      const uploaded: ClassworkAttachment[] = [];
      for (const material of editMaterials) {
        const formData = new FormData();
        formData.append("file", material);
        const response = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/attachments`,
          { method: "POST", body: formData },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Unable to upload ${material.name}.`);
        }
        uploaded.push((await response.json()) as ClassworkAttachment);
      }

      const updated = {
        ...currentClasswork,
        attachments: [...currentClasswork.attachments, ...uploaded],
      };
      setCurrentClasswork(updated);
      setEditMaterials([]);
      onSuccess(updated);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to upload classwork material.",
      );
    } finally {
      setIsUploadingEditMaterials(false);
    }
  };

  const removeSelectedAttachment = async (attachmentId: number) => {
    if (!currentClasswork) return;

    setRemovingAttachmentId(attachmentId);
    setError("");
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
      setError(
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
    const totalPoints =
      !isReading && editDraft.total_points
        ? Number(editDraft.total_points)
        : null;
    if (!editDraft.title.trim()) {
      setError("Classwork title is required.");
      return;
    }
    if (
      totalPoints !== null &&
      (!Number.isFinite(totalPoints) || totalPoints <= 0)
    ) {
      setError("Total points must be greater than zero.");
      return;
    }
    const attempts = Number(editDraft.max_attempts);
    if (
      isQuizType(editDraft.classwork_type) &&
      (!Number.isInteger(attempts) || attempts <= 0)
    ) {
      setError("Allowed attempts must be a positive whole number.");
      return;
    }

    setIsSavingEdit(true);
    setError("");
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
            total_points: totalPoints,
            is_published: editDraft.is_published,
            show_scores: editDraft.show_scores,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to update classwork.");
      }

      let updated = (await response.json()) as TeacherClasswork;
      const assignedClassIds =
        currentClasswork.assignments?.map((assignment) => assignment.class_id) ?? [];
      if (assignedClassIds.length > 0) {
        const assignResponse = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}/assign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              class_ids: assignedClassIds,
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
          throw new Error(
            body.detail || "Unable to update assignment settings.",
          );
        }
        const refreshed = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${currentClasswork.classwork_id}`,
        );
        if (refreshed.ok) {
          updated = (await refreshed.json()) as TeacherClasswork;
        }
      }
      setCurrentClasswork(updated);
      onSuccess(updated);
      onClose();
    } catch (err) {
      setError(
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
        <Dialog.Content size="2xl" className="max-h-[90vh] flex flex-col bg-white border-2 border-black">
          <Dialog.Header position="fixed" asChild>
            <div className="flex items-center justify-between w-full px-4 py-3 bg-primary text-black font-bold">
              <div className="flex items-center gap-2 text-lg">
                <Pencil size={18} />
                <span>Edit Classwork</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isSavingEdit) {
                    onClose();
                  }
                }}
                className="cursor-pointer text-black hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>
          </Dialog.Header>

          <div className="p-5 overflow-y-auto space-y-4 flex-1">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold">
                Title
                <Input
                  value={editDraft.title}
                  onChange={(event) =>
                    setEditDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  disabled={isSavingEdit}
                  className="mt-1 w-full rounded-none border-black text-sm font-semibold shadow-none"
                />
              </label>
              <label className="block text-xs font-bold">
                Type
                <Select
                  value={editDraft.classwork_type}
                  onValueChange={(v) =>
                    setEditDraft((current) => ({
                      ...current,
                      classwork_type: v,
                    }))
                  }
                >
                  <Select.Trigger
                    disabled={isSavingEdit}
                    className="mt-1 w-full h-10 border-2 border-black bg-white text-sm font-semibold shadow-none"
                  >
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <Select.Item value="READING">Reading</Select.Item>
                    <Select.Item value="ACTIVITY">Activity</Select.Item>
                    <Select.Item value="ASSIGNMENT">Assignment</Select.Item>
                    <Select.Item value="QUIZ">Quiz</Select.Item>
                  </Select.Content>
                </Select>
              </label>
            </div>

            <div
              className={`grid gap-3 ${isReadingType(editDraft.classwork_type) ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
            >
              <label className="block text-xs font-bold">
                Grading component
                <Select
                  value={editDraft.classwork_category || "NONE"}
                  onValueChange={(v) =>
                    setEditDraft((current) => ({
                      ...current,
                      classwork_category: v === "NONE" ? "" : v,
                    }))
                  }
                >
                  <Select.Trigger
                    disabled={isSavingEdit}
                    className="mt-1 w-full h-10 border-2 border-black bg-white text-sm shadow-none"
                  >
                    <Select.Value placeholder="None" />
                  </Select.Trigger>
                  <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    <Select.Item value="NONE">None</Select.Item>
                    <Select.Item value="WRITTEN_WORK">Written Works</Select.Item>
                    <Select.Item value="PERFORMANCE_TASK">Performance Task</Select.Item>
                    <Select.Item value="QUARTERLY_ASSESSMENT">Quarterly Assessment</Select.Item>
                  </Select.Content>
                </Select>
              </label>
              {!isReadingType(editDraft.classwork_type) && (
                <label className="block text-xs font-bold">
                  Total points
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
                    className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                  />
                </label>
              )}
              <label className="block text-xs font-bold">
                <span className="invisible">Published</span>
                <span className="mt-1 flex h-10 w-full items-center gap-2 border-2 border-black px-3 text-sm font-normal">
                  <Input
                    type="checkbox"
                    checked={editDraft.is_published}
                    onChange={(event) =>
                      setEditDraft((current) => ({
                        ...current,
                        is_published: event.target.checked,
                      }))
                    }
                    disabled={isSavingEdit}
                    className="h-4 w-4 rounded-none border-black p-0 shadow-none accent-black"
                  />
                  Published
                </span>
              </label>
              <label className="block text-xs font-bold">
                <span className="invisible">Show Scores</span>
                <span className="mt-1 flex h-10 w-full items-center gap-2 border-2 border-black px-3 text-sm font-normal">
                  <Input
                    type="checkbox"
                    checked={editDraft.show_scores}
                    onChange={(event) =>
                      setEditDraft((current) => ({
                        ...current,
                        show_scores: event.target.checked,
                      }))
                    }
                    disabled={isSavingEdit}
                    className="h-4 w-4 rounded-none border-black p-0 shadow-none accent-black"
                  />
                  Show Scores to Students
                </span>
              </label>
            </div>

            <Card className="block w-full border-black p-3 shadow-none transition-none hover:shadow-none">
              <p className="mb-3 text-xs font-bold">Assignment settings</p>
              <div
                className={`grid gap-3 ${isQuizType(editDraft.classwork_type) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
              >
                <label className="block text-xs font-bold">
                  Due date
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
                    className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                  />
                </label>
                <label className="block text-xs font-bold">
                  Locked until
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
                    className="mt-1 w-full rounded-none border-black text-sm shadow-none disabled:bg-gray-100"
                  />
                </label>
                {isQuizType(editDraft.classwork_type) && (
                  <label className="block text-xs font-bold">
                    Attempts
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
                      className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                    />
                  </label>
                )}
              </div>
              <p className="mt-2 text-xs font-medium text-gray-600">
                Published classwork is visible to students. A future lock
                date keeps it visible but blocks access until that time;
                clear it to unlock now.
              </p>
              {editDraft.due_date &&
                !isReadingType(editDraft.classwork_type) && (
                  <label className="mt-3 flex items-start gap-3 border-2 border-black bg-primary px-3 py-2 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={editDraft.allow_late_submissions}
                      onChange={(event) =>
                        setEditDraft((current) => ({
                          ...current,
                          allow_late_submissions: event.target.checked,
                        }))
                      }
                      disabled={isSavingEdit}
                      className="mt-0.5 accent-black"
                    />
                    <span>
                      Allow submissions/resubmissions after the due date
                      <span className="block font-medium text-gray-700">
                        Accepted work will be marked late.
                      </span>
                    </span>
                  </label>
                )}
            </Card>

            <label className="block text-xs font-bold">
              Description
              <Input
                value={editDraft.description}
                onChange={(event) =>
                  setEditDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                disabled={isSavingEdit}
                className="mt-1 w-full rounded-none border-black text-sm shadow-none"
              />
            </label>

            <label className="block text-xs font-bold">
              Instructions
              <textarea
                value={editDraft.instructions}
                onChange={(event) =>
                  setEditDraft((current) => ({
                    ...current,
                    instructions: event.target.value,
                  }))
                }
                disabled={isSavingEdit}
                className="mt-1 min-h-24 w-full border-2 border-black px-3 py-2 text-sm outline-none focus:border-black"
              />
            </label>

            <Card className="block w-full border-black p-3 shadow-none transition-none hover:shadow-none">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold">Materials</h3>
                  <p className="text-xs text-gray-500">
                    Add or remove files attached to this classwork.
                  </p>
                </div>
                <Button
                  asChild
                  variant="default"
                  size="sm"
                  className="cursor-pointer gap-2 font-bold "
                >
                  <label>
                    <Plus size={14} />
                    Add files
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                      className="hidden"
                      disabled={
                        isUploadingEditMaterials ||
                        removingAttachmentId !== null
                      }
                      onChange={(event) => {
                        addEditMaterials(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </Button>
              </div>

              {currentClasswork.attachments.length > 0 ? (
                <div className="space-y-2">
                  {currentClasswork.attachments.map((attachment) => (
                    <div
                      key={attachment.classwork_attachment_id}
                      className="flex items-center gap-3 border-2 border-black px-3 py-2 text-sm"
                    >
                      <FileText size={16} />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {attachment.file_name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          removeSelectedAttachment(
                            attachment.classwork_attachment_id,
                          )
                        }
                        disabled={
                          removingAttachmentId ===
                            attachment.classwork_attachment_id ||
                          isUploadingEditMaterials
                        }
                        className="text-red-600 hover:bg-red-50 disabled:opacity-50"
                        aria-label={`Remove ${attachment.file_name}`}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="border-2 border-dashed border-black/40 px-3 py-4 text-center text-sm text-gray-500">
                  No files attached yet.
                </p>
              )}

              {editMaterials.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-bold">Pending uploads</p>
                  {editMaterials.map((material, index) => (
                    <div
                      key={`${material.name}-${material.size}`}
                      className="flex items-center gap-3 border-2 border-black px-3 py-2 text-sm"
                    >
                      <FileText size={16} />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {material.name}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatFileSize(material.size)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEditMaterial(index)}
                        disabled={isUploadingEditMaterials}
                        className="text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={uploadEditMaterials}
                    disabled={isUploadingEditMaterials}
                    className="border-black bg-[#7ABA78] font-bold disabled:opacity-50"
                  >
                    {isUploadingEditMaterials
                      ? "Uploading..."
                      : "Upload selected files"}
                  </Button>
                </div>
              )}
            </Card>
          </div>

          <Dialog.Footer position="fixed">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSavingEdit}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={saveClassworkEdit}
              disabled={isSavingEdit}
              className="border-black bg-[#7ABA78] hover:bg-[#7ABA78] font-bold"
            >
              {isSavingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      )}
    </Dialog>
  );
}
