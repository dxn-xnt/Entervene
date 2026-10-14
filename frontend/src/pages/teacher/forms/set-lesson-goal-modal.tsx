import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Checkbox } from "@/components/retroui/Checkbox";
import { toast } from "sonner";
import {
  apiFetch,
  setLessonGoals,
  type LessonGoalItemResponse,
  type LessonGoalResponse,
} from "@/lib/api";

export interface SetGoalLessonItem {
  lesson_id: number;
  title: string;
  is_published?: boolean;
}

export interface SetGoalClassworkItem {
  classwork_id: number;
  classwork_assignment_id?: number;
  title: string;
  classwork_type?: string | null;
  classwork_category?: string | null;
  exam_subtype?: string | null;
  total_points?: number | null;
  due_date?: string | null;
}

export interface SelectedGoalItem {
  id: string; // unique key: "lesson-12" or "cw-34"
  item_type: "LESSON" | "CLASSWORK";
  lesson_id?: number | null;
  classwork_id?: number | null;
  title: string;
  subtitle?: string;
  typeBadge?: string;
  isExam?: boolean;
}

interface SetLessonGoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: number;
  subjectId: number;
  academicPeriodId: number;
  periodName?: string;
  lessons: SetGoalLessonItem[];
  linkedClassworks: Record<number, SetGoalClassworkItem[]>;
  currentGoals: LessonGoalItemResponse[];
  onSaved: (updatedGoals: LessonGoalResponse) => void;
}

export function SetLessonGoalModal({
  isOpen,
  onClose,
  classId,
  subjectId,
  academicPeriodId,
  periodName,
  lessons,
  linkedClassworks,
  currentGoals,
  onSaved,
}: SetLessonGoalModalProps) {
  const [selectedItems, setSelectedItems] = useState<SelectedGoalItem[]>([]);
  const [subjectLevelExams, setSubjectLevelExams] = useState<SetGoalClassworkItem[]>([]);
  const [isLoadingExams, setIsLoadingExams] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedLessons, setExpandedLessons] = useState<Record<number, boolean>>({});

  // 1. Fetch subject-level exams & classworks on open
  useEffect(() => {
    if (!isOpen || !subjectId) return;

    let isMounted = true;
    async function loadExams() {
      setIsLoadingExams(true);
      try {
        const res = await apiFetch(
          `/api/v1/classwork-assignments/teacher/class/${classId}/subject/${subjectId}/assignments`,
        );
        if (res.ok) {
          const allSubjectCw = (await res.json()) as SetGoalClassworkItem[];
          if (isMounted) {
            // Find classworks that are Exams or not linked to any lesson
            const linkedCwIdSet = new Set(
              Object.values(linkedClassworks)
                .flat()
                .map((cw) => cw.classwork_id),
            );

            const exams = allSubjectCw.filter(
              (cw) =>
                cw.classwork_category === "QUARTERLY_ASSESSMENT" ||
                cw.classwork_category === "EXAMS" ||
                cw.classwork_type === "EXAM" ||
                !linkedCwIdSet.has(cw.classwork_id),
            );
            setSubjectLevelExams(exams);
          }
        }
      } catch {
        // Fallback gracefully
      } finally {
        if (isMounted) setIsLoadingExams(false);
      }
    }

    void loadExams();
    return () => {
      isMounted = false;
    };
  }, [isOpen, classId, subjectId, linkedClassworks]);

  // 2. Initialize selected items from current saved goals
  useEffect(() => {
    if (!isOpen) return;

    if (currentGoals && currentGoals.length > 0) {
      const initial = currentGoals.map((g) => {
        if (g.item_type === "LESSON") {
          return {
            id: `lesson-${g.lesson_id}`,
            item_type: "LESSON" as const,
            lesson_id: g.lesson_id,
            title: g.lesson?.title || `Lesson ${g.lesson_id}`,
            typeBadge: "Lesson",
            isExam: false,
          };
        } else {
          const isEx =
            g.classwork?.classwork_category === "QUARTERLY_ASSESSMENT" ||
            g.classwork?.classwork_category === "EXAMS" ||
            g.classwork?.classwork_type === "EXAM";
          return {
            id: `cw-${g.classwork_id}`,
            item_type: "CLASSWORK" as const,
            classwork_id: g.classwork_id,
            title: g.classwork?.title || `Classwork ${g.classwork_id}`,
            subtitle: g.classwork?.due_date
              ? `Due ${new Date(g.classwork.due_date).toLocaleDateString()}`
              : undefined,
            typeBadge: isEx ? "Exam" : g.classwork?.classwork_type || "Classwork",
            isExam: isEx,
          };
        }
      });
      setSelectedItems(initial);
    } else {
      setSelectedItems([]);
    }
  }, [isOpen, currentGoals]);

  // Expand all lessons by default
  useEffect(() => {
    if (lessons.length > 0) {
      const exp: Record<number, boolean> = {};
      lessons.forEach((l) => {
        exp[l.lesson_id] = true;
      });
      setExpandedLessons(exp);
    }
  }, [lessons]);

  const selectedKeySet = useMemo(
    () => new Set(selectedItems.map((it) => it.id)),
    [selectedItems],
  );

  const toggleLesson = (lesson: SetGoalLessonItem) => {
    const key = `lesson-${lesson.lesson_id}`;
    if (selectedKeySet.has(key)) {
      setSelectedItems((prev) => prev.filter((it) => it.id !== key));
    } else {
      setSelectedItems((prev) => [
        ...prev,
        {
          id: key,
          item_type: "LESSON",
          lesson_id: lesson.lesson_id,
          title: lesson.title,
          typeBadge: "Lesson",
          isExam: false,
        },
      ]);
    }
  };

  const toggleClasswork = (cw: SetGoalClassworkItem, isExam = false) => {
    const key = `cw-${cw.classwork_id}`;
    if (selectedKeySet.has(key)) {
      setSelectedItems((prev) => prev.filter((it) => it.id !== key));
    } else {
      setSelectedItems((prev) => [
        ...prev,
        {
          id: key,
          item_type: "CLASSWORK",
          classwork_id: cw.classwork_id,
          title: cw.title,
          subtitle: cw.due_date
            ? `Due ${new Date(cw.due_date).toLocaleDateString()}`
            : undefined,
          typeBadge: isExam ? "Exam" : cw.classwork_type || "Classwork",
          isExam,
        },
      ]);
    }
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= selectedItems.length) return;
    const copy = [...selectedItems];
    const [moved] = copy.splice(index, 1);
    copy.splice(newIdx, 0, moved);
    setSelectedItems(copy);
  };

  const removeItem = (id: string) => {
    setSelectedItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleSave = async () => {
    if (!academicPeriodId) {
      toast.error("Academic period is missing. Please refresh and try again.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        academic_period_id: academicPeriodId,
        items: selectedItems.map((it, idx) => ({
          item_type: it.item_type,
          lesson_id: it.lesson_id || null,
          classwork_id: it.classwork_id || null,
          order_index: idx + 1,
        })),
      };

      const result = await setLessonGoals(classId, subjectId, payload);
      toast.success(
        selectedItems.length > 0
          ? `Saved ${selectedItems.length} curated lesson goal(s).`
          : "Lesson goals cleared for this term.",
      );
      onSaved(result);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save lesson goals.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="xl">
        {/* Header */}
        <Dialog.Header>
          <div className="flex items-center gap-2">
            <div>
              <Dialog.Title className="text-lg font-black">
                Set Lesson Goals {periodName ? `— ${periodName}` : ""}
              </Dialog.Title>
            </div>
          </div>
        </Dialog.Header>

        {/* Modal Body - stacked sections */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          <Dialog.Description className="text-sm text-muted-foreground">
            Choose and order the goals students will see.
          </Dialog.Description>
          {/* Available source items */}
          <Card className="block w-full min-w-0 rounded-none! bg-card p-4 shadow-none hover:shadow-none">
            <Card.Header className="mb-4 gap-1">
              <Card.Title className="text-base font-bold">
                Available Items
              </Card.Title>
              <Card.Description className="text-sm font-normal text-muted-foreground">
                Select the lessons and classworks to include.
              </Card.Description>
            </Card.Header>
            <Card.Content className="min-w-0">

            {/* GROUP 1: Lessons & Linked Classworks */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">
                  Lessons & Classworks
                </span>
                <Badge variant="secondary" size="sm" className="rounded-none!">
                  {lessons.length}
                </Badge>
              </div>

              {lessons.length === 0 ? (
                <p className="text-xs text-muted-foreground italic pl-2 py-2">
                  No lessons found in this subject.
                </p>
              ) : (
                lessons.map((lesson) => {
                  const isLessonSelected = selectedKeySet.has(`lesson-${lesson.lesson_id}`);
                  const cws = linkedClassworks[lesson.lesson_id] || [];
                  const isExpanded = expandedLessons[lesson.lesson_id] ?? true;

                  return (
                    <div
                      key={lesson.lesson_id}
                      className="w-full overflow-hidden border-2 border-border bg-background"
                    >
                      {/* Lesson Row */}
                      <div className="flex items-center justify-between bg-muted/50 p-2.5">
                        <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                          <Checkbox
                            size="sm"
                            checked={isLessonSelected}
                            onCheckedChange={() => toggleLesson(lesson)}
                            aria-label={`Add ${lesson.title} to lesson goals`}
                            className="shrink-0 cursor-pointer"
                          />
                          <span className="truncate text-xs font-bold text-foreground">
                            {lesson.title}
                          </span>
                        </label>
                        {cws.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger render={<Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setExpandedLessons((prev) => ({
                                ...prev,
                                [lesson.lesson_id]: !prev[lesson.lesson_id],
                              }))
                            }
                            className="size-7 p-1 text-muted-foreground"
                            aria-label={isExpanded ? "Hide classworks" : "Show classworks"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </Button>} />
                            <TooltipContent>{isExpanded ? "Hide classworks" : "Show classworks"}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>

                      {/* Linked Classworks (Indented under parent lesson) */}
                      {isExpanded && cws.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-t border-border bg-background py-2 pl-6 pr-2">
                          {cws.map((cw) => {
                            const isCwSelected = selectedKeySet.has(`cw-${cw.classwork_id}`);
                            return (
                              <label
                                key={cw.classwork_id}
                                className="flex cursor-pointer select-none items-center justify-between gap-2 p-1.5 text-xs hover:bg-muted/50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Checkbox
                                    size="sm"
                                    checked={isCwSelected}
                                    onCheckedChange={() => toggleClasswork(cw, false)}
                                    aria-label={`Add ${cw.title} to lesson goals`}
                                    className="shrink-0 cursor-pointer"
                                  />
                                  <span className="truncate font-medium text-foreground">
                                    {cw.title}
                                  </span>
                                </div>
                                <Badge variant="outline" size="sm" className="shrink-0 rounded-none!">
                                  {cw.classwork_type || "Task"}
                                </Badge>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}

              {/* GROUP 2: Clearly-labeled Exams / Term Assessments */}
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">
                  Exams / Term Assessments
                </span>
                <Badge variant="secondary" size="sm" className="rounded-none!">
                  {subjectLevelExams.length}
                </Badge>
              </div>

              {isLoadingExams ? (
                <p className="text-xs text-muted-foreground animate-pulse pl-2 py-2">
                  Loading assessments...
                </p>
              ) : subjectLevelExams.length === 0 ? (
                <p className="text-xs text-muted-foreground italic pl-2 py-1">
                  No subject-level exams found.
                </p>
              ) : (
                subjectLevelExams.map((exam) => {
                  const isExamSelected = selectedKeySet.has(`cw-${exam.classwork_id}`);
                  return (
                    <label
                      key={exam.classwork_id}
                      className="flex cursor-pointer select-none items-center justify-between gap-2 border-2 border-border bg-background p-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Checkbox
                          size="sm"
                          checked={isExamSelected}
                          onCheckedChange={() => toggleClasswork(exam, true)}
                          aria-label={`Add ${exam.title} to lesson goals`}
                          className="shrink-0 cursor-pointer"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-foreground">{exam.title}</p>
                          {exam.due_date && (
                            <p className="text-[10px] text-muted-foreground">
                              Due {new Date(exam.due_date).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" size="sm" className="shrink-0 rounded-none!">
                        Exam
                      </Badge>
                    </label>
                  );
                })
              )}
            </div>
            </Card.Content>
          </Card>

          {/* Selected and ordered goals */}
          <Card className="block w-full min-w-0 rounded-none! bg-card p-4 shadow-none hover:shadow-none">
            <Card.Header className="mb-4 flex-row flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Card.Title className="text-base font-bold">
                  Curated Goal Layout
                </Card.Title>
                <Badge variant="secondary" size="sm" className="rounded-none!">
                  {selectedItems.length}
                </Badge>
              </div>
              {selectedItems.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedItems([])}
                >
                  Clear All
                </Button>
              )}
            </Card.Header>
            <Card.Content className="min-w-0">

            {selectedItems.length === 0 ? (
              <div className="border-2 border-dashed border-border bg-background px-4 py-8 text-center">
                <p className="text-sm font-bold text-foreground">No goals selected yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Check items above to add them. You can reorder them to dictate the exact order shown to students.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-2 border-border bg-background p-3 text-card-foreground"
                  >
                    {/* Index & Title */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Badge variant="solid" size="sm" className="shrink-0 rounded-none!">
                        {index + 1}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-xs font-bold text-foreground">{item.title}</p>
                          <Badge variant="outline" size="sm" className="shrink-0 rounded-none!">
                            {item.typeBadge}
                          </Badge>
                        </div>
                        {item.subtitle && (
                          <p className="text-[10px] text-muted-foreground">{item.subtitle}</p>
                        )}
                      </div>
                    </div>

                    {/* Reorder & Remove Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex"><Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => moveItem(index, "up")}
                        className="size-7 p-1 text-foreground disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ArrowUp className="size-3.5" />
                      </Button></span>} />
                        <TooltipContent>{index === 0 ? "Already first" : "Move up"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex"><Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === selectedItems.length - 1}
                        onClick={() => moveItem(index, "down")}
                        className="size-7 p-1 text-foreground disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ArrowDown className="size-3.5" />
                      </Button></span>} />
                        <TooltipContent>{index === selectedItems.length - 1 ? "Already last" : "Move down"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger render={<Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.id)}
                        className="size-7 p-1 text-destructive hover:bg-destructive/10"
                        aria-label="Remove goal item"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>} />
                        <TooltipContent>Remove item</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </Card.Content>
          </Card>
        </div>

        <Dialog.Footer className="mt-0 justify-between">
          <p className="text-xs text-muted-foreground">
            {selectedItems.length === 0
              ? "Saving will clear goals (leaving panel blank for this term)."
              : `${selectedItems.length} item(s) will be displayed in this order.`}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Lesson Goals"}
            </Button>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default SetLessonGoalModal;
