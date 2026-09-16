import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  ListChecks,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
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
  }, [isOpen, subjectId, linkedClassworks]);

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
      <Dialog.Content size="xl" className="max-h-[90vh] p-0 flex flex-col">
        {/* Header */}
        <Dialog.Header className="flex items-center justify-between border-b-2 border-black bg-primary px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5" />
            <div>
              <Dialog.Title className="text-lg font-black text-black">
                Set Lesson Goals {periodName ? `— ${periodName}` : ""}
              </Dialog.Title>
              <p className="text-xs font-semibold text-gray-700">
                Choose and order the specific lessons and exams to highlight for your students.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-black hover:bg-black/10"
          >
            <X className="size-5" />
          </button>
        </Dialog.Header>

        {/* Modal Body - 2 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y-2 md:divide-y-0 md:divide-x-2 divide-black flex-1 overflow-hidden min-h-[420px]">
          {/* LEFT: Distinctly Grouped Source Picker */}
          <div className="flex flex-col overflow-y-auto p-4 max-h-[60vh]">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-black uppercase tracking-wider text-black">
                Available Items
              </h4>
              <span className="text-xs text-muted-foreground">Check to add</span>
            </div>

            {/* GROUP 1: Lessons & Linked Classworks */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 pb-1 border-b border-gray-300">
                <BookOpen className="size-4 text-emerald-700" />
                <span className="text-xs font-black uppercase text-emerald-900 tracking-wide">
                  Lessons & Classworks
                </span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100">
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
                      className="border-2 border-black bg-white rounded-none shadow-sm"
                    >
                      {/* Lesson Row */}
                      <div className="flex items-center justify-between p-2.5 bg-gray-50 hover:bg-gray-100">
                        <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={isLessonSelected}
                            onChange={() => toggleLesson(lesson)}
                            className="size-4 accent-black rounded-none cursor-pointer"
                          />
                          <span className="text-xs font-bold text-black truncate">
                            {lesson.title}
                          </span>
                        </label>
                        {cws.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLessons((prev) => ({
                                ...prev,
                                [lesson.lesson_id]: !prev[lesson.lesson_id],
                              }))
                            }
                            className="p-1 hover:bg-gray-200 text-gray-600 rounded"
                            title="Toggle classworks"
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-3.5" />
                            ) : (
                              <ChevronRight className="size-3.5" />
                            )}
                          </button>
                        )}
                      </div>

                      {/* Linked Classworks (Indented under parent lesson) */}
                      {isExpanded && cws.length > 0 && (
                        <div className="pl-6 pr-2 py-2 border-t border-gray-200 bg-white flex flex-col gap-1.5">
                          {cws.map((cw) => {
                            const isCwSelected = selectedKeySet.has(`cw-${cw.classwork_id}`);
                            return (
                              <label
                                key={cw.classwork_id}
                                className="flex items-center justify-between gap-2 p-1.5 text-xs hover:bg-gray-50 cursor-pointer rounded select-none"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isCwSelected}
                                    onChange={() => toggleClasswork(cw, false)}
                                    className="size-3.5 accent-black rounded-none cursor-pointer"
                                  />
                                  <span className="font-medium text-gray-800 truncate">
                                    {cw.title}
                                  </span>
                                </div>
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] px-1.5 py-0 bg-blue-100 text-blue-900 shrink-0"
                                >
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
              <div className="mt-4 flex items-center gap-2 pb-1 border-b border-gray-300">
                <GraduationCap className="size-4 text-purple-700" />
                <span className="text-xs font-black uppercase text-purple-900 tracking-wide">
                  Exams / Term Assessments
                </span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-purple-100">
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
                      className="flex items-center justify-between gap-2 p-2.5 border-2 border-black bg-purple-50/50 hover:bg-purple-100/50 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isExamSelected}
                          onChange={() => toggleClasswork(exam, true)}
                          className="size-4 accent-black rounded-none cursor-pointer"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-black truncate">{exam.title}</p>
                          {exam.due_date && (
                            <p className="text-[10px] text-gray-600">
                              Due {new Date(exam.due_date).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge className="bg-purple-700 text-white text-[10px] px-1.5 py-0.5 shrink-0">
                        Exam
                      </Badge>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT: Selected & Ordered Goals List */}
          <div className="flex flex-col overflow-y-auto p-4 max-h-[60vh] bg-gray-50/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ListChecks className="size-4" />
                <h4 className="text-sm font-black uppercase tracking-wider text-black">
                  Curated Goal Layout
                </h4>
                <Badge variant="secondary" className="text-xs font-extrabold bg-primary">
                  {selectedItems.length}
                </Badge>
              </div>
              {selectedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedItems([])}
                  className="text-xs text-red-600 font-bold hover:underline"
                >
                  Clear All
                </button>
              )}
            </div>

            {selectedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 p-8 text-center border-2 border-dashed border-gray-300 rounded-none bg-white">
                <Sparkles className="size-8 text-gray-400 mb-2" />
                <p className="text-sm font-bold text-gray-700">No goals selected yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Check items from the left panel to add them. You can reorder them to dictate the exact order shown to students.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 p-2.5 border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    {/* Index & Title */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="flex size-5 shrink-0 items-center justify-center bg-black text-[10px] font-black text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-black truncate">{item.title}</p>
                          <Badge
                            variant="secondary"
                            className={`text-[9px] px-1 py-0 ${
                              item.isExam
                                ? "bg-purple-100 text-purple-900 border-purple-400"
                                : item.item_type === "LESSON"
                                  ? "bg-emerald-100 text-emerald-900 border-emerald-400"
                                  : "bg-blue-100 text-blue-900 border-blue-400"
                            }`}
                          >
                            {item.typeBadge}
                          </Badge>
                        </div>
                        {item.subtitle && (
                          <p className="text-[10px] text-gray-500">{item.subtitle}</p>
                        )}
                      </div>
                    </div>

                    {/* Reorder & Remove Controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveItem(index, "up")}
                        className="p-1 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent rounded text-black"
                        title="Move Up"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === selectedItems.length - 1}
                        onClick={() => moveItem(index, "down")}
                        className="p-1 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent rounded text-black"
                        title="Move Down"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                        title="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t-2 border-black bg-white px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {selectedItems.length === 0
              ? "Saving will clear goals (leaving panel blank for this term)."
              : `${selectedItems.length} item(s) will be displayed in this order.`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
              className="border-black font-bold"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="border-black bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              {isSaving ? "Saving..." : "Save Lesson Goals"}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

export default SetLessonGoalModal;
