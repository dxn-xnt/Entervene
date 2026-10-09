import { useMemo, useState } from "react";
import { Archive, Copy, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/retroui/ContextMenu";
import { Progress } from "@/components/retroui/Progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { useToast } from "@/components/retroui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { formatDate, isQuizType } from "@/lib/classwork-utils";
import { toTitleCase } from "@/lib/formatters";
import type { ClassworkTracking, TeacherClasswork } from "@/types/classwork";
import EditClassworkModal from "../forms/edit-classwork";

export type ClassworkCardProps = {
  item: TeacherClasswork;
  tracking?: ClassworkTracking;
  onOpen: (item: TeacherClasswork) => void;
  showClassworkType?: boolean;
  showSubject?: boolean;
  onUpdated?: (updated: TeacherClasswork) => void;
  onArchived?: (classworkId: number) => void;
  onDeleted?: (classworkId: number) => void;
  onDuplicated?: (duplicated: TeacherClasswork) => void;
  onReload?: () => void;
};

export default function ClassworkCard({
  item,
  tracking,
  onOpen,
  showClassworkType = false,
  showSubject = false,
  onUpdated,
  onArchived,
  onDeleted,
  onDuplicated,
  onReload,
}: ClassworkCardProps) {
  const toast = useToast();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const dueLabel = useMemo(() => {
    if (tracking?.due_date) {
      return `Due ${formatDate(tracking.due_date)}`;
    }
    const dueDates = Array.from(
      new Set(
        (item.assignments ?? [])
          .map((assignment) => assignment.due_date)
          .filter((date): date is string => Boolean(date)),
      ),
    );
    if (!dueDates.length) return null;
    if (dueDates.length === 1) return `Due ${formatDate(dueDates[0])}`;
    return `${dueDates.length} section due dates`;
  }, [item.assignments, tracking?.due_date]);

  const completionRate =
    tracking && tracking.total_students > 0
      ? Math.round((tracking.submitted_count / tracking.total_students) * 100)
      : null;

  const hasAssignments = (item.assignments?.length ?? 0) > 0;
  const openCard = () => onOpen(item);

  const handleDuplicate = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsDuplicating(true);
    try {
      const res = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${item.classwork_id}`,
      );
      if (!res.ok) throw new Error("Unable to fetch classwork details to duplicate.");
      const detail = (await res.json()) as TeacherClasswork;

      let quizPayload: string | undefined;
      if (isQuizType(detail.classwork_type)) {
        try {
          const quizRes = await apiFetch(
            `/api/v1/quizzes/classwork/${item.classwork_id}`,
          );
          if (quizRes.ok) {
            const quizData = await quizRes.json();
            quizPayload = JSON.stringify(quizData);
          }
        } catch {
          // Ignore quiz payload fetch errors
        }
      }

      const formData = new FormData();
      formData.append("title", `${detail.title} (Copy)`);
      formData.append("classwork_type", detail.classwork_type);
      formData.append("subject_id", String(detail.subject_id));
      if (detail.description) formData.append("description", detail.description);
      if (detail.instructions) formData.append("instructions", detail.instructions);
      if (detail.classwork_category) formData.append("classwork_category", detail.classwork_category);
      if (detail.exam_subtype) formData.append("exam_subtype", detail.exam_subtype);
      if (detail.total_points !== null && detail.total_points !== undefined) {
        formData.append("total_points", String(detail.total_points));
      }
      formData.append("is_published", "false");
      formData.append("show_scores", String(detail.show_scores ?? true));

      const classIds = detail.assignments?.map((a) => a.class_id) ?? [];
      formData.append("class_ids", JSON.stringify(classIds));

      const lessonIds = detail.linked_lessons?.map((l) => l.lesson_id) ?? [];
      formData.append("lesson_ids", JSON.stringify(lessonIds));

      if (detail.assignments?.[0]?.allow_late_submissions !== undefined) {
        formData.append(
          "allow_late_submissions",
          String(detail.assignments[0].allow_late_submissions),
        );
      }
      if (detail.assignments?.[0]?.max_attempts) {
        formData.append(
          "max_attempts",
          String(detail.assignments[0].max_attempts),
        );
      }
      if (detail.assignments?.[0]?.due_date) {
        formData.append("due_date", detail.assignments[0].due_date);
      }
      if (detail.assignments?.[0]?.lock_date) {
        formData.append("lock_date", detail.assignments[0].lock_date);
      }
      if (detail.rubric_levels?.length) {
        formData.append("rubric_payload", JSON.stringify(detail.rubric_levels));
      }
      if (quizPayload) {
        formData.append("quiz_payload", quizPayload);
      }

      const createRes = await apiFetch(
        `/api/v1/classwork-assignments/with-assignments`,
        {
          method: "POST",
          body: formData,
        },
      );
      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(errJson.detail || "Unable to duplicate classwork.");
      }
      const created = (await createRes.json()) as TeacherClasswork;
      toast.success({ title: "Classwork duplicated as draft" });
      onDuplicated?.(created);
      onReload?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to duplicate classwork.";
      toast.error({ title: "Duplication failed", description: message });
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      const res = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${item.classwork_id}/archive`,
        { method: "PUT" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to archive classwork.");
      }
      toast.success({ title: "Classwork archived" });
      setShowArchiveConfirm(false);
      onArchived?.(item.classwork_id);
      onReload?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to archive classwork.";
      toast.error({ title: "Unable to archive classwork", description: message });
    } finally {
      setIsArchiving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${item.classwork_id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to delete classwork.");
      }
      toast.success({ title: "Classwork deleted" });
      setShowDeleteConfirm(false);
      onDeleted?.(item.classwork_id);
      onReload?.();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to delete classwork.";
      toast.error({ title: "Unable to delete classwork", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div>
            <Tooltip>
              <TooltipTrigger render={
                <Card
                  className="flex h-full w-full cursor-pointer flex-col"
                  tabIndex={0}
                  onClick={openCard}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openCard();
                    }
                  }}
                  aria-label={`Open ${item.title}`}
                >
                  <Card.Header className="flex-col items-stretch gap-2">
                    <div className="w-full flex flex-row justify-between items-start gap-2">
                      <Card.Title className="line-clamp-2 break-words text-lg font-bold [overflow-wrap:anywhere] flex-1">
                        {item.title}
                      </Card.Title>

                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex shrink-0">
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="p-1 shadow-none"
                                aria-label="Classwork actions"
                                onClick={(e) => {
                                  e.stopPropagation();
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                }}
                              >
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                          </span>} />
                          <TooltipContent>Classwork options</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent
                          align="end"
                          className="border-2 border-black bg-white min-w-[160px] p-1 rounded font-semibold text-xs z-50 shadow-md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowEditModal(true);
                            }}
                            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                          >
                            <Pencil className="size-4" />
                            <span>Edit</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={handleDuplicate}
                            disabled={isDuplicating}
                            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                          >
                            <Copy className="size-4" />
                            <span>{isDuplicating ? "Duplicating..." : "Duplicate"}</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowArchiveConfirm(true);
                            }}
                            disabled={item.is_archived}
                            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                          >
                            <Archive className="size-4" />
                            <span>Archive</span>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowDeleteConfirm(true);
                            }}
                            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="size-4" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {showSubject && item.subject_name && (
                        <Badge variant="outline" size="sm">
                          {item.subject_name}
                        </Badge>
                      )}
                      {showClassworkType && item.classwork_type && (
                        <Badge variant="secondary" size="sm">
                          {toTitleCase(item.classwork_type)}
                        </Badge>
                      )}
                      <Badge variant={item.is_published ? "solid" : "default"} size="sm">
                        {item.is_published ? "Published" : "Draft"}
                      </Badge>
                    </div>
                  </Card.Header>

                  <Card.Content className="mt-auto flex flex-col gap-3 mt-1">
                    {tracking && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-foreground">Submitted</span>
                          <span className="font-bold text-foreground">
                            {tracking.submitted_count}/{tracking.total_students}
                          </span>
                        </div>
                        <Progress value={completionRate ?? 0} className="h-3" />
                      </div>
                    )}

                    {!tracking && hasAssignments && (
                      <p className="text-xs text-muted-foreground">
                        Loading submission summary…
                      </p>
                    )}
                    {!hasAssignments && (
                      <p className="text-xs text-muted-foreground">
                        Not assigned to a section
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {dueLabel ? (
                        <span className="text-sm text-muted-foreground">{dueLabel}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">Created {formatDate(item.created_at)}</span>
                      )}
                    </div>
                  </Card.Content>
                </Card>} />
              <TooltipContent>View classwork</TooltipContent>
            </Tooltip>
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent className="border-2 border-black bg-white min-w-[160px] p-1 rounded font-semibold text-xs z-50 shadow-md">
          <ContextMenuItem
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
          >
            <Pencil className="size-4" />
            <span>Edit</span>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={handleDuplicate}
            disabled={isDuplicating}
            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
          >
            <Copy className="size-4" />
            <span>{isDuplicating ? "Duplicating..." : "Duplicate"}</span>
          </ContextMenuItem>

          <ContextMenuItem
            onClick={() => setShowArchiveConfirm(true)}
            disabled={item.is_archived}
            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
          >
            <Archive className="size-4" />
            <span>Archive</span>
          </ContextMenuItem>

          <ContextMenuSeparator className="my-1 border-t border-black/10" />

          <ContextMenuItem
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="size-4" />
            <span>Delete</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Edit Modal */}
      {showEditModal && (
        <EditClassworkModal
          classwork={item}
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSuccess={(updated) => {
            setShowEditModal(false);
            onUpdated?.(updated);
            onReload?.();
          }}
        />
      )}

      {/* Archive Confirmation Dialog */}
      <ConfirmDialog
        open={showArchiveConfirm}
        onOpenChange={setShowArchiveConfirm}
        title="Archive Classwork"
        confirmationTitle={`Are you sure you want to archive "${item.title}"?`}
        description={`Archiving the classwork will move it to the archive and it can be restored later.`}
        confirmLabel={isArchiving ? "Archiving..." : "Archive"}
        confirmVariant="default"
        isLoading={isArchiving}
        onCancel={() => setShowArchiveConfirm(false)}
        onConfirm={handleArchive}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Classwork"
        confirmationTitle={`Are you sure you want to delete "${item.title}"?`}
        description={`Deleting classwork will permanently remove it from the system and all associated data. This action cannot be undone.`}
        confirmLabel={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="destructive"
        isLoading={isDeleting}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
