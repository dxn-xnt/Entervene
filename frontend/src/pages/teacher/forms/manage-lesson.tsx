import { useState, type Dispatch, type SetStateAction } from "react";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { unorderedValues } from "@/lib/form-changes";
import { NoChangesMessage } from "@/components/retroui/FormMessage";
import { Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/teacher/button";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Input } from "@/components/retroui/Input";
import { Switch } from "@/components/retroui/Switch";
import Field from "@/components/admin/classes/fields/Field";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { Lesson, LessonDraft, TeacherClassLoad } from "../subject-details/types";

export interface ManageLessonModalProps {
  selectedLesson: Lesson;
  lessonDraft: LessonDraft;
  setLessonDraft: Dispatch<SetStateAction<LessonDraft | null>>;
  classesForSubject?: TeacherClassLoad[];
  classId?: string | number;
  lessonClassIds?: number[];
  setLessonClassIds?: Dispatch<SetStateAction<number[]>> | ((ids: number[]) => void);
  onSetLessonClassIds?: Dispatch<SetStateAction<number[]>> | ((ids: number[]) => void);
  isSavingLesson: boolean;
  isArchivingLesson?: boolean;
  removingLessonAttachmentId?: number | null;
  error?: string;
  showArchiveConfirm?: boolean;
  setShowArchiveConfirm?: (show: boolean) => void;
  onClose?: () => void;
  closeLessonManager?: () => void;
  onSave?: () => void;
  saveLesson?: () => void;
  onArchive?: () => void;
  archiveLesson?: () => void;
  onToggleLessonClass?: (targetClassId: number) => void;
  toggleLessonClass?: (targetClassId: number) => void;
  onRemoveAttachment?: (attachmentId: number) => void;
  removeLessonAttachment?: (attachmentId: number) => void;
}

export default function ManageLessonModal({
  selectedLesson,
  lessonDraft,
  setLessonDraft,
  classesForSubject = [],
  lessonClassIds = [],
  setLessonClassIds,
  onSetLessonClassIds,
  isSavingLesson,
  isArchivingLesson = false,
  removingLessonAttachmentId = null,
  error = "",
  showArchiveConfirm: propShowArchiveConfirm,
  setShowArchiveConfirm: propSetShowArchiveConfirm,
  onClose,
  closeLessonManager,
  onSave,
  saveLesson,
  onArchive,
  archiveLesson,
  onToggleLessonClass,
  toggleLessonClass,
}: ManageLessonModalProps) {
  const [internalShowArchiveConfirm, setInternalShowArchiveConfirm] = useState(false);
  const [classBaseline, setClassBaseline] = useState(() => ({ lessonId: selectedLesson.lesson_id, ids: unorderedValues(lessonClassIds) }));
  if (classBaseline.lessonId !== selectedLesson.lesson_id) {
    setClassBaseline({ lessonId: selectedLesson.lesson_id, ids: unorderedValues(lessonClassIds) });
  }
  const initialClasses = classBaseline.lessonId === selectedLesson.lesson_id ? classBaseline.ids : unorderedValues(lessonClassIds);
  const lessonValues = (value: LessonDraft) => ({
    title: value.title.trim(), description: value.description.trim(),
    content: value.content.trim(), order_index: Number(value.order_index),
    is_published: value.is_published,
  });
  const changes = useEditFormChanges({
    resetKey: selectedLesson.lesson_id,
    initialValues: [lessonValues({
      title: selectedLesson.title, description: selectedLesson.description ?? "",
      content: selectedLesson.content ?? "", order_index: String(selectedLesson.order_index),
      is_published: selectedLesson.is_published, show_scores: selectedLesson.show_scores,
      competency_id: selectedLesson.competency_id,
    }), initialClasses],
    values: [lessonValues(lessonDraft), unorderedValues(lessonClassIds)],
  });

  const isArchiveConfirmOpen =
    propShowArchiveConfirm !== undefined
      ? propShowArchiveConfirm
      : internalShowArchiveConfirm;

  const setArchiveConfirmOpen = (show: boolean) => {
    if (propSetShowArchiveConfirm) {
      propSetShowArchiveConfirm(show);
    } else {
      setInternalShowArchiveConfirm(show);
    }
  };

  const handleClose = () => {
    if (onClose) onClose();
    else if (closeLessonManager) closeLessonManager();
  };

  const handleSave = () => {
    if (!changes.guardChanges()) return;
    if (onSave) onSave();
    else if (saveLesson) saveLesson();
  };

  const handleArchive = () => {
    if (onArchive) onArchive();
    else if (archiveLesson) archiveLesson();
  };

  const handleToggleLessonClass = (targetClassId: number) => {
    if (onToggleLessonClass) onToggleLessonClass(targetClassId);
    else if (toggleLessonClass) toggleLessonClass(targetClassId);
  };

  const handleSelectAll = () => {
    const setter = onSetLessonClassIds || setLessonClassIds;
    if (setter) {
      setter(classesForSubject.map((load) => load.class_id));
    } else {
      classesForSubject.forEach((load) => {
        if (!lessonClassIds.includes(load.class_id)) {
          handleToggleLessonClass(load.class_id);
        }
      });
    }
  };


  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) handleClose();
        }}
      >
        <Dialog.Content className="w-full max-w-4xl p-0 transition-none">
          <Dialog.Header className="border-border">
            <Dialog.Title className="text-xl font-bold">
              Manage Lesson
            </Dialog.Title>
          </Dialog.Header>

          <div className="flex flex-col gap-3 p-4">
            {error && (
              <div className="border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
              <Field label="Lesson Title" isRequired={true}>
                <Input
                  id="manage-lesson-title"
                  value={lessonDraft.title}
                  onChange={(event) =>
                    setLessonDraft((current) =>
                      current
                        ? { ...current, title: event.target.value }
                        : current,
                    )
                  }
                  disabled={isSavingLesson}
                  className="h-10 w-full rounded-none border-border bg-background text-foreground !shadow-none"
                />
              </Field>

              <Field label="Order">
                <Input
                  id="manage-lesson-order"
                  type="number"
                  min="1"
                  step="1"
                  value={lessonDraft.order_index}
                  onChange={(event) =>
                    setLessonDraft((current) =>
                      current
                        ? {
                          ...current,
                          order_index: event.target.value,
                        }
                        : current,
                    )
                  }
                  disabled={isSavingLesson}
                  className="h-10 w-full rounded-none border-border bg-background text-foreground !shadow-none"
                />
              </Field>
            </div>

            <div className="-mt-1">
              <Field label="Lesson Content">
                <textarea
                  id="manage-lesson-content"
                  value={lessonDraft.content}
                  onChange={(event) =>
                    setLessonDraft((current) =>
                      current
                        ? { ...current, content: event.target.value }
                        : current,
                    )
                  }
                  disabled={isSavingLesson}
                  className="min-h-32 w-full rounded! border-2 border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  placeholder="Write the lesson notes or learning content students will read."
                />
              </Field>
            </div>

            <div className="-mt-2 flex items-center gap-2 w-full justify-between">
              <div>
                <label htmlFor="manage-lesson-publish" className="text-sm font-medium text-foreground cursor-pointer">
                  Publish to assigned sections
                </label>
                <p className="text-xs text-muted-foreground">
                  Draft lessons stay hidden from students.
                </p>
              </div>
              <Switch
                id="manage-lesson-publish"
                checked={lessonDraft.is_published}
                onCheckedChange={(checked) =>
                  setLessonDraft((current) =>
                    current
                      ? {
                        ...current,
                        is_published: checked,
                      }
                      : current,
                  )
                }
                disabled={isSavingLesson}
              />
            </div>

            {lessonDraft.is_published && (
              <div className="mt-2">
                <Field label="Assign to sections">
                  {classesForSubject.length > 0 && (
                    <div className="flex items-center justify-end -mt-8 mb-2">
                      <Button
                        size="sm"
                        className="shadow-none -mt-1"
                        autoIcon={false}
                        onClick={handleSelectAll}
                        disabled={isSavingLesson}
                      >
                        <CheckCheck className="size-4 mr-2" />
                        Select All
                      </Button>
                    </div>
                  )}

                  {classesForSubject.length > 0 ? (
                    <Card className="-mt-1 grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                      {classesForSubject.map((load) => {
                        const isSelected = lessonClassIds.includes(load.class_id);
                        return (
                          <button
                            key={load.subject_load_id}
                            type="button"
                            onClick={() => handleToggleLessonClass(load.class_id)}
                            disabled={isSavingLesson}
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
            )}
          </div>

          <Dialog.Footer>
            <NoChangesMessage message={changes.noChangesMessage} />

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">

              <Button
                type="button"
                onClick={handleSave}
                disabled={
                  !changes.hasChanges ||
                  isSavingLesson ||
                  isArchivingLesson ||
                  removingLessonAttachmentId !== null
                }
              >
                {lessonDraft.is_published
                  ? "Save and Publish"
                  : "Save Draft"}
              </Button>
            </div>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      <ConfirmDialog
        open={isArchiveConfirmOpen}
        onOpenChange={(open) => {
          if (!isArchivingLesson) setArchiveConfirmOpen(open);
        }}
        title="Archive Lesson"
        confirmationTitle={`Are you sure you want to archive "${selectedLesson.title}"?`}
        description="This hides the lesson from the teacher lesson list and student lesson views. You can restore it later from the backend archive flow."
        confirmLabel={isArchivingLesson ? "Archiving..." : "Archive Lesson"}
        confirmVariant="destructive"
        isLoading={isArchivingLesson}
        onConfirm={handleArchive}
      />
    </>
  );
}
