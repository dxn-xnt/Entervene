import {
  Archive,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import type { ReactNode } from "react";
import { Accordion } from "@/components/retroui/Accordion";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { ContextMenu } from "@/components/retroui/ContextMenu";
import ClassworkItemLine from "@/components/item-line/classwork";
import { LoadingPanel } from "@/components/loading-panel";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import type { LessonDeliveryRecord } from "@/lib/lesson-delivery-api";

export interface LessonAttachment {
  lesson_attachment_id?: number;
  file_name: string;
  file_type?: string;
  file_size?: number;
  uploaded_at?: string;
}

export interface LessonItem {
  lesson_id: number;
  title: string;
  description?: string | null;
  content?: string | null;
  competency_id?: number | null;
  competency_code?: string | null;
  competency_statement?: string | null;
  order_index?: number;
  created_at?: string;
  updated_at?: string;
  is_published?: boolean;
  show_scores?: boolean;
  is_draft?: boolean;
  is_archived?: boolean;
  attachments?: LessonAttachment[];
  delivery?: LessonDeliveryRecord | null;
  is_taught?: boolean;
}

export interface LinkedClassworkItem {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  due_date?: string | null;
  total_points?: number | null;
  attachment_count?: number;
  is_published?: boolean;
  is_locked?: boolean;
  created_at?: string | null;
}

export interface LessonItemLineProps<TLesson extends LessonItem = LessonItem> {
  id?: string;
  lesson: TLesson;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  isExpanded?: boolean;
  onToggle?: () => void;
  classworks?: LinkedClassworkItem[];
  isLoadingClassworks?: boolean;
  onOpenLessonDetail?: (lesson: TLesson) => void;
  onOpenClassworkDetail?: (cw: LinkedClassworkItem) => void;
  onOpenClassworkForm?: (lesson: TLesson) => void;
  onOpenLessonManager?: (lesson: TLesson) => void;
  onArchiveLesson?: (lesson: TLesson) => void;
  className?: string;
  showPublicationStatus?: boolean;
  /** Show the retro drop shadow on the lesson card. Defaults to true. */
  withShadow?: boolean;
  // Delivery status & actions
  delivery?: LessonDeliveryRecord | null;
  isDelivered?: boolean;
  isDeliveryLoading?: boolean;
  onConfirmDelivery?: (lesson: TLesson) => void | Promise<void>;
  onOpenCorrectionDialog?: (lesson: TLesson) => void;
}


export const LessonItemLine = <TLesson extends LessonItem = LessonItem>({
  id,
  lesson,
  subtitle,
  badge,
  children,
  isExpanded = false,
  onToggle,
  classworks = [],
  isLoadingClassworks = false,
  onOpenLessonDetail,
  onOpenClassworkDetail,
  onOpenClassworkForm,
  onOpenLessonManager,
  onArchiveLesson,
  className,
  showPublicationStatus = true,
  withShadow = true,
  delivery,
  isDelivered,
  isDeliveryLoading = false,
  onConfirmDelivery,
  onOpenCorrectionDialog,
}: LessonItemLineProps<TLesson>) => {
  const activeDelivery = delivery || lesson.delivery || null;
  const isTaught = Boolean(
    isDelivered ?? lesson.is_taught ?? activeDelivery?.is_active,
  );
  const hasActions = Boolean(
    onOpenLessonManager ||
      onArchiveLesson ||
      onConfirmDelivery ||
      onOpenCorrectionDialog,
  );
  const accordionId = id ?? `lesson-${lesson.lesson_id}`;

  const accordionContent = (
    <Accordion
      id={accordionId}
      value={isExpanded ? [String(lesson.lesson_id)] : []}
      onValueChange={() => onToggle?.()}
      className={cn("w-full shadow-none", className)}
    >
      <Accordion.Item
        value={String(lesson.lesson_id)}
        className={cn(
          "border-2 border-black bg-primary hover:translate-x-1 transition-all",
          withShadow ? "shadow-md!" : "shadow-none!",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            onOpenLessonDetail?.(lesson);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenLessonDetail?.(lesson);
            }
          }}
          className="group flex flex-1 cursor-pointer items-center justify-between gap-3 p-4 font-sans text-base select-none transition-all"
          aria-label={`View lesson: ${lesson.title}`}
        >
          <div className="flex flex-col w-full items-start min-w-0 text-left">
            <div className="flex items-center w-full justify-between gap-2 min-w-0 pr-2">
              <h4
                className="text-xl sm:text-2xl font-semibold text-black truncate min-w-0 flex-1"
                title={lesson.title}
              >
                {lesson.title}
              </h4>
              <div className="flex flex-row items-center gap-2 -mr-1 shrink-0">
                {showPublicationStatus && (
                  <Badge
                    variant={lesson.is_published ? "solid" : "default"}
                    size="sm"
                    className="shrink-0 text-xs font-bold"
                    data-testid={`badge-published-${lesson.lesson_id}`}
                  >
                    {lesson.is_published ? "Published" : "Draft"}
                  </Badge>
                )}
                {badge}
                <Badge
                  variant={isTaught ? "success" : "outline"}
                  size="sm"
                  className={cn(
                    "shrink-0 text-xs font-bold",
                    !isTaught && "text-muted-foreground border-border bg-background",
                  )}
                  data-testid={`badge-taught-${lesson.lesson_id}`}
                >
                  {isTaught ? "Taught" : "Not Taught"}
                </Badge>
                {!isTaught && onConfirmDelivery && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isDeliveryLoading}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onConfirmDelivery?.(lesson);
                    }}
                    className="h-6 px-2 text-[11px] font-semibold gap-1 shrink-0 hidden md:inline-flex"
                    title="Mark lesson as taught"
                    data-testid={`quick-mark-taught-${lesson.lesson_id}`}
                  >
                    {isDeliveryLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3" />
                    )}
                    <span>Mark as Taught</span>
                  </Button>
                )}
              </div>
            </div>
            {subtitle && (
              <span className="mt-1 block text-sm text-foreground">
                {subtitle}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label={isExpanded ? "Collapse classworks" : "Expand classworks"}
              onClick={(e) => {
                e.stopPropagation();
                onToggle?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  onToggle?.();
                }
              }}
              className="pr-1 transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 text-black transition-transform duration-200",
                  isExpanded && "rotate-90",
                )}
              />
            </button>
          </div>
        </div>

        <Accordion.Content className="p-3 border-t-2 border-black bg-white space-y-2">
          {children !== undefined ? (
            children
          ) : (
            <>
              {lesson.description && (
                <p className="text-xs font-normal text-muted-foreground break-words line-clamp-2 pb-1">
                  {lesson.description}
                </p>
              )}

              {isLoadingClassworks ? (
                <LoadingPanel label="Loading classworks..." />
              ) : classworks.length === 0 ? (
                <Empty className="border-2 bg-white p-6 shadow-none bg-retro">
                  <EmptyHeader>
                    <EmptyMedia>
                      <div className="flex size-9 items-center justify-center border-2 border-black bg-primary">
                        <ClipboardList className="size-4.5 text-black" />
                      </div>
                    </EmptyMedia>
                    <EmptyTitle className="text-sm font-bold">No classworks yet</EmptyTitle>
                    <EmptyDescription className="text-xs">
                      No classworks assigned to this lesson yet.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                classworks.map((cw) => (
                  <ClassworkItemLine
                    key={cw.classwork_assignment_id}
                    item={cw}
                    onOpen={onOpenClassworkDetail}
                    className="shadow-none!"
                    showCategoryBadge={false}
                    showPublicationStatus={false}
                  />
                ))
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-dashed border-gray-200 mt-2">
                <div className="flex items-center gap-2">
                  {!isTaught && onConfirmDelivery && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isDeliveryLoading}
                      onClick={() => void onConfirmDelivery(lesson)}
                      className="h-8 gap-1.5"
                      data-testid={`mark-taught-btn-${lesson.lesson_id}`}
                    >
                      {isDeliveryLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                      <span>Mark as Taught</span>
                    </Button>
                  )}
                  {isTaught && onOpenCorrectionDialog && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isDeliveryLoading}
                      onClick={() => onOpenCorrectionDialog(lesson)}
                      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      data-testid={`correct-delivery-btn-${lesson.lesson_id}`}
                    >
                      <RotateCcw size={13} />
                      <span>Correct Confirmation</span>
                    </Button>
                  )}
                  {isTaught && activeDelivery?.delivered_at && (
                    <span className="text-[11px] text-muted-foreground hidden sm:inline">
                      Confirmed taught {formatDate(activeDelivery.delivered_at)}
                    </span>
                  )}
                </div>
                {onOpenClassworkForm && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => onOpenClassworkForm(lesson)}
                      className="h-8"
                    >
                      <Plus size={14} className="mr-1.5" />
                      Add Classwork
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );

  if (!hasActions) {
    return accordionContent;
  }

  return (
    <ContextMenu>
      <ContextMenu.Trigger className="block w-full">
        {accordionContent}
      </ContextMenu.Trigger>
      <ContextMenu.Content className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] min-w-[160px] p-1 rounded font-semibold text-xs z-50">
        {onOpenLessonDetail && (
          <ContextMenu.Item
            onClick={() => onOpenLessonDetail(lesson)}
            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
          >
            <Eye size={14} />
            <span>View Lesson</span>
          </ContextMenu.Item>
        )}
        {!isTaught && onConfirmDelivery && (
          <ContextMenu.Item
            onClick={() => void onConfirmDelivery(lesson)}
            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
          >
            <CheckCircle2 size={14} />
            <span>Mark as Taught</span>
          </ContextMenu.Item>
        )}
        {isTaught && onOpenCorrectionDialog && (
          <ContextMenu.Item
            onClick={() => onOpenCorrectionDialog(lesson)}
            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
          >
            <RotateCcw size={14} />
            <span>Correct Delivery Confirmation</span>
          </ContextMenu.Item>
        )}
        {onOpenLessonManager && (
          <ContextMenu.Item
            onClick={() => onOpenLessonManager(lesson)}
            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
          >
            <Pencil size={14} />
            <span>Manage Lesson</span>
          </ContextMenu.Item>
        )}
        {onArchiveLesson && (
          <>
            <ContextMenu.Separator className="my-1 border-b border-black" />
            <ContextMenu.Item
              variant="destructive"
              onClick={() => onArchiveLesson(lesson)}
              className="flex items-center gap-2 cursor-pointer px-2.5 py-2 text-red-600 hover:bg-red-50 hover:text-red-700 rounded focus:bg-red-50 focus:text-red-700 text-xs font-bold"
            >
              <Archive size={14} />
              <span>Archive Lesson</span>
            </ContextMenu.Item>
          </>
        )}
      </ContextMenu.Content>
    </ContextMenu>
  );
};

export default LessonItemLine;
