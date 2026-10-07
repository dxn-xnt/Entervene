import {
  Archive,
  BookOpen,
  CheckSquare,
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
} from "lucide-react";
import { Accordion } from "@/components/retroui/Accordion";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ContextMenu } from "@/components/retroui/ContextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingPanel } from "@/components/loading-panel";
import { cn } from "@/lib/utils";

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
  lesson: TLesson;
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
}

function ClassworkIcon({
  type,
  size = 16,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toLowerCase()) {
    case "quiz":
      return <ClipboardList size={size} />;
    case "assignment":
      return <BookOpen size={size} />;
    case "activity":
      return <CheckSquare size={size} />;
    default:
      return <FileText size={size} />;
  }
}

export const LessonItemLine = <TLesson extends LessonItem = LessonItem>({
  lesson,
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
}: LessonItemLineProps<TLesson>) => {
  const hasActions = Boolean(onOpenLessonManager || onArchiveLesson);

  const accordionContent = (
    <Accordion
      value={isExpanded ? [String(lesson.lesson_id)] : []}
      onValueChange={() => onToggle?.()}
      className={cn("w-full shadow-none", className)}
    >
      <Accordion.Item
        value={String(lesson.lesson_id)}
        className="border-2 border-black bg-primary shadow-md! hover:translate-x-1 transition-all"
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
          <div className="flex flex-col w-full items-start gap-1 min-w-0 text-left">
            <div className="flex flex-wrap items-center w-full justify-between gap-2 min-w-0 pr-2">
              <h4 className="text-xl sm:text-2xl font-semibold text-black break-words line-clamp-2 hover:underline">
                {lesson.title}
              </h4>
              <div className="flex flex-row items-center gap-2">
                <Badge
                  variant={lesson.is_published ? "solid" : "default"}
                  size="sm"
                  className="shrink-0 text-xs font-bold"
                >
                  {lesson.is_published ? "Published" : "Draft"}
                </Badge>
                {lesson.attachments && lesson.attachments.length > 0 && (
                  <Badge
                    size="sm"
                    variant="solid"
                  >
                    <Paperclip size={10} />
                    {lesson.attachments.length} material
                    {lesson.attachments.length === 1 ? "" : "s"}
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  size="sm"
                  className=""
                >
                  {classworks.length} classwork{classworks.length === 1 ? "" : "s"}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {hasActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    className="h-8 w-8 p-0 rounded hover:bg-black/10 shrink-0 text-black cursor-pointer shadow-none"
                    aria-label="Lesson actions"
                  >
                    <MoreVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                  className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] min-w-[150px] p-1 rounded font-semibold text-xs z-50"
                >
                  {onOpenLessonDetail && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenLessonDetail(lesson);
                      }}
                      className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                    >
                      <Eye size={14} />
                      <span>View Lesson</span>
                    </DropdownMenuItem>
                  )}
                  {onOpenLessonManager && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenLessonManager(lesson);
                      }}
                      className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                    >
                      <Pencil size={14} />
                      <span>Manage</span>
                    </DropdownMenuItem>
                  )}
                  {onArchiveLesson && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchiveLesson(lesson);
                      }}
                      className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                      <Archive size={14} />
                      <span>Archive</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

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
          {lesson.description && (
            <p className="text-xs font-normal text-muted-foreground break-words line-clamp-2 pb-1">
              {lesson.description}
            </p>
          )}

          {isLoadingClassworks ? (
            <LoadingPanel label="Loading classworks..." />
          ) : classworks.length === 0 ? (
            <div className="flex items-center justify-between rounded border-2 border-dashed border-black/40 bg-white p-3 text-xs text-gray-500 font-medium">
              <span>No classworks assigned to this lesson yet.</span>
            </div>
          ) : (
            classworks.map((cw) => (
              <Card
                key={cw.classwork_assignment_id}
                onClick={() => onOpenClassworkDetail?.(cw)}
                className="flex items-center justify-between gap-3 border-2 border-black bg-white p-3 hover:bg-retro shadow-none hover:translate-x-0.5 transition-all cursor-pointer min-w-0 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 text-black">
                    <ClassworkIcon type={cw.classwork_type} size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate text-black">
                      {cw.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cw.due_date
                        ? `Due ${new Date(cw.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                        : "No due date"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {cw.classwork_category && (
                    <Badge variant="surface" size="sm" className="capitalize">
                      {cw.classwork_category.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
              </Card>
            ))
          )}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/10">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => onOpenClassworkForm?.(lesson)}
              className="h-8 border-2 border-black bg-primary px-3 text-xs font-bold text-black shadow-none hover:opacity-90"
            >
              <Plus size={14} className="mr-1.5" />
              Add Classwork
            </Button>
          </div>
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
