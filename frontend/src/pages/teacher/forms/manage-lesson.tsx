import { useState, type Dispatch, type SetStateAction } from "react";
import { Archive, Paperclip, Trash2, X } from "lucide-react";
import { API_URL } from "@/lib/api";
import AttachmentDisplay from "@/components/attachment-display";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import type { Lesson, LessonDraft, TeacherClassLoad } from "../subject-details/types";

export interface ManageLessonModalProps {
  selectedLesson: Lesson;
  lessonDraft: LessonDraft;
  setLessonDraft: Dispatch<SetStateAction<LessonDraft | null>>;
  classesForSubject: TeacherClassLoad[];
  classId?: string;
  lessonClassIds: number[];
  isSavingLesson: boolean;
  isArchivingLesson?: boolean;
  removingLessonAttachmentId: number | null;
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
  classesForSubject,
  classId,
  lessonClassIds,
  isSavingLesson,
  isArchivingLesson = false,
  removingLessonAttachmentId,
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
  onRemoveAttachment,
  removeLessonAttachment,
}: ManageLessonModalProps) {
  const [internalShowArchiveConfirm, setInternalShowArchiveConfirm] = useState(false);

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

  const handleRemoveAttachment = (attachmentId: number) => {
    if (onRemoveAttachment) onRemoveAttachment(attachmentId);
    else if (removeLessonAttachment) removeLessonAttachment(attachmentId);
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

          <div className="flex flex-col gap-4 p-5">
            <div className="space-y-3">
              {error && (
                <div className="border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
                <div>
                  <label
                    htmlFor="manage-lesson-title"
                    className="mb-1 block text-sm font-semibold"
                  >
                    Lesson title
                  </label>
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
                </div>

                <div>
                  <label
                    htmlFor="manage-lesson-order"
                    className="mb-1 block text-sm font-semibold"
                  >
                    Order
                  </label>
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
                </div>
              </div>

              <div>
                <label
                  htmlFor="manage-lesson-description"
                  className="mb-1 block text-sm font-semibold"
                >
                  Description
                </label>
                <textarea
                  id="manage-lesson-description"
                  value={lessonDraft.description}
                  onChange={(event) =>
                    setLessonDraft((current) =>
                      current
                        ? {
                          ...current,
                          description: event.target.value,
                        }
                        : current,
                    )
                  }
                  disabled={isSavingLesson}
                  className="min-h-20 w-full rounded-none border-2 border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/35"
                  placeholder="Short lesson summary"
                />
              </div>

              <div>
                <label
                  htmlFor="manage-lesson-content"
                  className="mb-1 block text-sm font-semibold"
                >
                  Lesson content
                </label>
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
                  className="min-h-32 w-full rounded-none border-2 border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/35"
                  placeholder="Write the lesson notes or learning content students will read."
                />
              </div>

              <Card className="block w-full shadow-none">
                <Card.Content className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Paperclip size={18} />
                    <Card.Title className="mb-0 text-base font-bold">
                      Current Materials
                    </Card.Title>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="ml-auto rounded-none"
                    >
                      {selectedLesson.attachments.length}
                    </Badge>
                  </div>
                  {selectedLesson.attachments.length > 0 ? (
                    <>
                      <AttachmentDisplay
                        attachments={selectedLesson.attachments}
                        type="lesson"
                        downloadUrl={(attachmentId) =>
                          `${API_URL}/api/v1/lessons/${selectedLesson.lesson_id}/attachments/${attachmentId}/download`
                        }
                      />
                      <div className="mt-3 space-y-2 border-t border-border pt-3">
                        {selectedLesson.attachments.map((attachment) => (
                          <div
                            key={attachment.lesson_attachment_id}
                            className="flex items-center justify-between gap-3 border border-border bg-background px-3 py-2"
                          >
                            <p className="truncate text-sm font-semibold">
                              {attachment.file_name}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveAttachment(
                                  attachment.lesson_attachment_id,
                                )
                              }
                              disabled={
                                removingLessonAttachmentId !== null ||
                                isSavingLesson
                              }
                              className="inline-flex shrink-0 items-center gap-1 border-2 border-red-600 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                              {removingLessonAttachmentId ===
                                attachment.lesson_attachment_id
                                ? "Removing..."
                                : "Remove"}
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-600">
                      No lesson materials attached.
                    </p>
                  )}
                </Card.Content>
              </Card>

              <p className="w-full px-2 shadow-none text-sm text-muted-foreground">
                Lesson file uploads now live under Reading classworks so
                materials can be scheduled, locked, and tracked like the rest of
                the classwork flow.
              </p>
            </div>

            <aside className="space-y-4">
              <Card className="block w-full shadow-none">
                <Card.Content>
                  <Card.Title className="mb-0 text-base font-bold">
                    Publication
                  </Card.Title>
                  <label className="mt-3 flex items-start gap-3 border border-border bg-background px-3 py-3 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={lessonDraft.is_published}
                      onChange={(event) =>
                        setLessonDraft((current) =>
                          current
                            ? {
                              ...current,
                              is_published: event.target.checked,
                            }
                            : current,
                        )
                      }
                      disabled={isSavingLesson}
                    />
                    <span>
                      {lessonDraft.is_published
                        ? "Published to assigned sections"
                        : "Saved as draft"}
                      <span className="mt-1 block text-xs font-normal text-gray-600">
                        Draft lessons stay hidden from students.
                      </span>
                    </span>
                  </label>
                </Card.Content>
              </Card>

              <Card className="block w-full shadow-none">
                <Card.Content>
                  <Card.Title className="mb-0 text-base font-bold">
                    Assigned Sections
                  </Card.Title>
                  <p className="mt-1 text-xs text-gray-600">
                    Select sections to keep or add. Existing assignments cannot
                    be removed by the current lesson API.
                  </p>
                  <div className="mt-3 space-y-2">
                    {classesForSubject.map((item) => (
                      <label
                        key={item.subject_load_id}
                        className="flex items-center gap-2 border border-border bg-background px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={lessonClassIds.includes(item.class_id)}
                          onChange={() =>
                            handleToggleLessonClass(item.class_id)
                          }
                          disabled={
                            isSavingLesson ||
                            item.class_id === Number(classId)
                          }
                        />
                        <span className="flex-1">{item.section_name}</span>
                        {item.class_id === Number(classId) && (
                          <span className="text-[10px] font-bold uppercase text-gray-500">
                            Current
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </Card.Content>
              </Card>

              <Card className="block w-full shadow-none">
                <Card.Content>
                  <div className="flex items-center gap-2 text-red-800">
                    <Archive size={17} />
                    <Card.Title className="mb-0 text-base font-bold text-red-800">
                      Archive Lesson
                    </Card.Title>
                  </div>
                  <p className="mt-2 text-xs text-red-700">
                    Archive hides this lesson from the routed teacher list and
                    student lesson views.
                  </p>
                  <button
                    type="button"
                    onClick={() => setArchiveConfirmOpen(true)}
                    disabled={isArchivingLesson || isSavingLesson}
                    className="mt-3 w-full rounded-none border-2 border-red-600 bg-background px-3 py-2 text-sm font-bold text-red-700 transition hover:bg-red-600 hover:text-white disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-red-700"
                  >
                    {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
                  </button>
                </Card.Content>
              </Card>
            </aside>
          </div>

          <Dialog.Footer>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={
                isSavingLesson ||
                isArchivingLesson ||
                removingLessonAttachmentId !== null
              }
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={
                isSavingLesson ||
                isArchivingLesson ||
                removingLessonAttachmentId !== null
              }
            >
              {isSavingLesson
                ? "Saving..."
                : lessonDraft.is_published
                  ? "Save and Publish"
                  : "Save Draft"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {isArchiveConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
          <Card className="block w-full max-w-md border-border bg-background text-foreground shadow-[4px_4px_0_#000] hover:shadow-[4px_4px_0_#000]">
            <div className="flex items-center justify-between border-b border-black bg-red-100 px-5 py-3">
              <div className="flex items-center gap-2 text-red-800">
                <Archive size={18} />
                <Card.Title className="mb-0 text-base font-bold text-red-800">
                  Archive Lesson?
                </Card.Title>
              </div>
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(false)}
                disabled={isArchivingLesson}
                className="rounded p-1 hover:bg-white/60 disabled:opacity-50"
                aria-label="Close archive confirmation"
              >
                <X size={16} />
              </button>
            </div>
            <Card.Content className="space-y-3">
              <p className="text-sm font-medium">
                Are you sure you want to archive{" "}
                <span className="font-bold">"{selectedLesson.title}"</span>?
              </p>
              <p className="text-xs text-gray-600">
                This hides the lesson from the teacher lesson list and student
                lesson views. You can restore it later from the backend archive
                flow.
              </p>
            </Card.Content>
            <div className="flex justify-end gap-3 border-t border-black px-5 py-4">
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(false)}
                disabled={isArchivingLesson}
                className="rounded border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchive}
                disabled={isArchivingLesson}
                className="rounded border border-black bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-red-700 disabled:opacity-50"
              >
                {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
