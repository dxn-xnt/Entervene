import { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  BookOpen,
  HelpCircle,
  AlertCircle,
  X,
  Settings2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  FileText,
  FileDown,
  ArrowLeft,
  BookMarked,
  List,
} from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import { exportQuizPdf, exportQuizDocx } from "@/lib/quiz-export";
import type {
  QuizQuestionDraft,
  QuizQuestionType,
  QuizDifficulty,
} from "../classworks/quiz-builder-types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIQuizPartType =
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY";

export type DifficultyBreakdown = {
  EASY: number;
  MEDIUM: number;
  HARD: number;
};

export type TestPartRow = {
  id: string;
  type: AIQuizPartType;
  count: number;
  points_per_item: number;
  difficulty_breakdown: DifficultyBreakdown;
};

export interface AIQuizGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectId: number;
  subjectName?: string;
  subjects?: Array<{ id: number; name: string }>;
  quizTitle?: string; // draft title from parent — used in exported document
  onGenerated: (
    questions: QuizQuestionDraft[],
    warnings?: string[],
    chosenSubjectId?: number,
    synthesizedTitle?: string,
    associatedLessonIds?: number[],
    additionalCoverageScope?: string
  ) => void;
}

interface TeacherLessonItem {
  lesson_id: number;
  title: string;
  subject_id?: number;
}

interface ReadingClassworkItem {
  classwork_id: number;
  title: string;
  lesson_id: number;
  lesson_title: string;
}

interface GeneratedQuizApiQuestion {
  question_text: string;
  question_type: QuizQuestionType;
  points: number;
  display_order: number;
  difficulty_level?: QuizDifficulty;
  explanation?: string | null;
  options?: Array<{
    option_text: string;
    is_correct: boolean;
    option_order: number;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BREAKDOWN = (count: number): DifficultyBreakdown => ({
  EASY: count,
  MEDIUM: 0,
  HARD: 0,
});

const isDefaultBreakdown = (part: TestPartRow): boolean =>
  part.difficulty_breakdown.MEDIUM === 0 &&
  part.difficulty_breakdown.HARD === 0 &&
  part.difficulty_breakdown.EASY === part.count;

const breakdownSum = (part: TestPartRow): number =>
  part.difficulty_breakdown.EASY +
  part.difficulty_breakdown.MEDIUM +
  part.difficulty_breakdown.HARD;

const breakdownSummary = (part: TestPartRow): string => {
  if (isDefaultBreakdown(part)) return "All Easy";
  const { EASY, MEDIUM, HARD } = part.difficulty_breakdown;
  const parts: string[] = [];
  if (EASY > 0) parts.push(`${EASY}E`);
  if (MEDIUM > 0) parts.push(`${MEDIUM}M`);
  if (HARD > 0) parts.push(`${HARD}H`);
  return parts.join(" · ");
};

const hasBreakdownError = (part: TestPartRow, isExpanded: boolean): boolean => {
  if (!isExpanded || isDefaultBreakdown(part)) return false;
  return breakdownSum(part) !== part.count;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIQuizGeneratorModal({
  isOpen,
  onClose,
  subjectId,
  subjectName,
  subjects,
  quizTitle,
  onGenerated,
}: AIQuizGeneratorModalProps) {
  // Active subject selection
  const [currentSubjectId, setCurrentSubjectId] = useState<number>(subjectId);

  useEffect(() => {
    if (subjectId) {
      setCurrentSubjectId(subjectId);
    }
  }, [subjectId, isOpen]);

  const currentSubjectName = useMemo(() => {
    return (
      subjects?.find((s) => s.id === currentSubjectId)?.name ||
      subjectName ||
      `Subject #${currentSubjectId}`
    );
  }, [subjects, currentSubjectId, subjectName]);

  // Source
  const [sourceMode, setSourceMode] = useState<"lesson" | "specific">("lesson");
  const [lessons, setLessons] = useState<TeacherLessonItem[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>([]);
  const [readingClassworks, setReadingClassworks] = useState<ReadingClassworkItem[]>([]);
  const [selectedReadingIds, setSelectedReadingIds] = useState<number[]>([]);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [additionalCoverage, setAdditionalCoverage] = useState("");

  // Smart Synthesized Title based on subject, selected lessons/readings, and coverage
  const synthesizedQuizTitle = useMemo(() => {
    if (quizTitle && quizTitle.trim()) {
      return quizTitle.trim();
    }

    const sName = currentSubjectName || "Subject";

    if (sourceMode === "specific" && selectedReadingIds.length > 0) {
      const selectedItems = readingClassworks.filter((r) =>
        selectedReadingIds.includes(r.classwork_id)
      );
      if (selectedItems.length === 1) {
        return `${sName}: ${selectedItems[0].title} Quiz`;
      }
      if (selectedItems.length === 2) {
        return `${sName}: ${selectedItems[0].title} & ${selectedItems[1].title} Quiz`;
      }
      if (selectedItems.length > 2) {
        return `${sName}: ${selectedItems[0].title} + ${selectedItems.length - 1} Topics Quiz`;
      }
    }

    if (sourceMode === "lesson" && selectedLessonIds.length > 0) {
      const selectedItems = lessons.filter((l) =>
        selectedLessonIds.includes(l.lesson_id)
      );
      if (selectedItems.length === 1) {
        return `${sName}: ${selectedItems[0].title} Quiz`;
      }
      if (selectedItems.length === 2) {
        return `${sName}: ${selectedItems[0].title} & ${selectedItems[1].title} Quiz`;
      }
      if (selectedItems.length > 2) {
        return `${sName}: ${selectedItems[0].title} + ${selectedItems.length - 1} Lessons Quiz`;
      }
    }

    if (additionalCoverage.trim()) {
      const truncated =
        additionalCoverage.trim().length > 35
          ? `${additionalCoverage.trim().slice(0, 32)}...`
          : additionalCoverage.trim();
      return `${sName}: ${truncated} Quiz`;
    }

    return `${sName} Quiz`;
  }, [
    quizTitle,
    currentSubjectName,
    sourceMode,
    selectedReadingIds,
    readingClassworks,
    selectedLessonIds,
    lessons,
    additionalCoverage,
  ]);

  // Test parts
  const [testParts, setTestParts] = useState<TestPartRow[]>([
    { id: "part-1", type: "MULTIPLE_CHOICE", count: 5, points_per_item: 1, difficulty_breakdown: DEFAULT_BREAKDOWN(5) },
    { id: "part-2", type: "TRUE_FALSE", count: 5, points_per_item: 1, difficulty_breakdown: DEFAULT_BREAKDOWN(5) },
  ]);
  const [expandedPartIds, setExpandedPartIds] = useState<Set<string>>(new Set());

  // Generation
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [generatedDrafts, setGeneratedDrafts] = useState<QuizQuestionDraft[] | null>(null);
  const [generatedWarnings, setGeneratedWarnings] = useState<string[]>([]);

  // Export
  const [includeAnswerKey, setIncludeAnswerKey] = useState(false);
  const [isExporting, setIsExporting] = useState<"pdf" | "docx" | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !currentSubjectId) return;
    let active = true;
    setIsLoadingSource(true);

    apiFetch("/api/v1/lessons/my-lessons")
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return (await res.json()) as TeacherLessonItem[];
      })
      .then((data) => {
        if (!active) return;
        setLessons(data.filter((l) => Number(l.subject_id) === Number(currentSubjectId)));
      })
      .catch(() => { if (active) setLessons([]); })
      .finally(() => { if (active) setIsLoadingSource(false); });

    return () => { active = false; };
  }, [isOpen, currentSubjectId]);

  useEffect(() => {
    if (!isOpen || !currentSubjectId || sourceMode !== "specific") return;

    let active = true;
    setIsLoadingSource(true);

    apiFetch(`/api/v1/ai/reading-classworks?subject_id=${currentSubjectId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return (await res.json()) as ReadingClassworkItem[];
      })
      .then((data) => { if (active) setReadingClassworks(data); })
      .catch(() => { if (active) setReadingClassworks([]); })
      .finally(() => { if (active) setIsLoadingSource(false); });

    return () => { active = false; };
  }, [isOpen, currentSubjectId, sourceMode]);

  // Reset generated state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setGeneratedDrafts(null);
      setGeneratedWarnings([]);
      setError("");
      setIsExporting(null);
    }
  }, [isOpen]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const totalItemCount = useMemo(
    () => testParts.reduce((s, p) => s + (Number(p.count) || 0), 0),
    [testParts]
  );
  const totalPointsCount = useMemo(
    () => testParts.reduce((s, p) => s + (Number(p.count) || 0) * (Number(p.points_per_item) || 1), 0),
    [testParts]
  );
  const hasAnyBreakdownError = useMemo(
    () => testParts.some((p) => hasBreakdownError(p, expandedPartIds.has(p.id))),
    [testParts, expandedPartIds]
  );

  // ── Test part mutations ──────────────────────────────────────────────────

  const addTestPart = () => {
    const used = new Set(testParts.map((p) => p.type));
    const next =
      (["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"] as AIQuizPartType[]).find(
        (t) => !used.has(t)
      ) ?? "MULTIPLE_CHOICE";
    setTestParts((prev) => [
      ...prev,
      {
        id: `part-${Date.now()}`,
        type: next,
        count: 5,
        points_per_item: next === "ESSAY" ? 5 : 1,
        difficulty_breakdown: DEFAULT_BREAKDOWN(5),
      },
    ]);
  };

  const removeTestPart = (id: string) => {
    if (testParts.length <= 1) return;
    setTestParts((prev) => prev.filter((p) => p.id !== id));
    setExpandedPartIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  };

  const updateTestPart = (id: string, patch: Partial<TestPartRow>) => {
    setTestParts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        let updated = { ...p, ...patch };

        // Auto-adjust points when type changes
        if (patch.type && patch.type !== p.type) {
          if (patch.type === "ESSAY" && p.points_per_item === 1) updated.points_per_item = 5;
          else if (p.type === "ESSAY" && updated.points_per_item === 5) updated.points_per_item = 1;
        }

        // When count changes and breakdown is still default, sync EASY to new count
        if (patch.count !== undefined && isDefaultBreakdown(p)) {
          updated.difficulty_breakdown = DEFAULT_BREAKDOWN(patch.count);
        }

        return updated;
      })
    );
  };

  const togglePartExpanded = (id: string) => {
    setExpandedPartIds((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const updateBreakdown = (
    id: string,
    diff: keyof DifficultyBreakdown,
    value: number
  ) => {
    setTestParts((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, difficulty_breakdown: { ...p.difficulty_breakdown, [diff]: Math.max(0, value) } }
          : p
      )
    );
  };

  // ── Generate ─────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (totalItemCount <= 0) {
      setError("Configure at least one test part with 1 or more items.");
      return;
    }
    if (hasAnyBreakdownError) {
      setError("Difficulty breakdown totals must equal the item count for each part.");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      const response = await apiFetch("/api/v1/ai/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: currentSubjectId,
          lesson_ids: sourceMode === "lesson" ? selectedLessonIds : [],
          reading_classwork_ids: sourceMode === "specific" ? selectedReadingIds : [],
          additional_coverage: additionalCoverage.trim() || null,
          test_parts: testParts.map((p) => ({
            type: p.type,
            count: Math.max(1, Math.min(50, Number(p.count) || 1)),
            points_per_item: Math.max(0.5, Math.min(100, Number(p.points_per_item) || 1)),
            // Send actual breakdown; backend normalizes empty → all-Easy
            difficulty_breakdown: isDefaultBreakdown(p)
              ? { EASY: p.count }
              : Object.fromEntries(
                  Object.entries(p.difficulty_breakdown).filter(([, v]) => v > 0)
                ),
          })),
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => null);
        const detail = err?.detail;
        const msg = Array.isArray(detail)
          ? detail.map((e: { loc?: string[]; msg?: string }) => e.msg).join("; ")
          : typeof detail === "string"
          ? detail
          : `AI generation failed (${response.status})`;
        throw new Error(msg);
      }

      const data = await response.json() as { questions: GeneratedQuizApiQuestion[]; warnings?: string[] };

      if (!data.questions?.length) {
        throw new Error("AI returned an empty question list. Please try again.");
      }

      const drafts: QuizQuestionDraft[] = data.questions.map((q, idx) => ({
        id: `ai-q-${Date.now()}-${idx + 1}`,
        question_text: q.question_text || `Question ${idx + 1}`,
        question_type: q.question_type || "MULTIPLE_CHOICE",
        points: String(q.points ?? 1),
        display_order: idx + 1,
        difficulty_level: q.difficulty_level || "EASY",
        explanation: q.explanation || "",
        options:
          q.question_type === "MULTIPLE_CHOICE"
            ? (q.options ?? []).map((opt, oIdx) => ({
                option_text: opt.option_text || `Option ${oIdx + 1}`,
                is_correct: Boolean(opt.is_correct),
                option_order: opt.option_order ?? oIdx + 1,
              }))
            : [],
      }));

      setGeneratedDrafts(drafts);
      setGeneratedWarnings(data.warnings ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to generate quiz. Please try again."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExport = async (format: "pdf" | "docx") => {
    if (!generatedDrafts) return;
    setIsExporting(format);
    try {
      if (format === "pdf") {
        await exportQuizPdf(generatedDrafts, synthesizedQuizTitle, currentSubjectName, includeAnswerKey);
      } else {
        await exportQuizDocx(generatedDrafts, synthesizedQuizTitle, currentSubjectName, includeAnswerKey);
      }
    } catch (e) {
      console.error("Export error:", e);
    } finally {
      setIsExporting(null);
    }
  };

  const handleUseInBuilder = () => {
    if (!generatedDrafts) return;
    onGenerated(
      generatedDrafts,
      generatedWarnings,
      currentSubjectId,
      synthesizedQuizTitle,
      selectedLessonIds,
      additionalCoverage.trim() || undefined
    );
    onClose();
  };

  // ── Reading classworks grouped by lesson ─────────────────────────────────

  const readingsByLesson = useMemo(() => {
    const map = new Map<string, ReadingClassworkItem[]>();
    for (const cw of readingClassworks) {
      const key = cw.lesson_title;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(cw);
    }
    return [...map.entries()];
  }, [readingClassworks]);

  // ── Render ───────────────────────────────────────────────────────────────

  const isGenerated = generatedDrafts !== null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => { if (!open && !isGenerating) onClose(); }}
    >
      <Dialog.Content
        size="2xl"
        className="border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-0"
        overlay={{ className: "bg-black/60 backdrop-blur-xs" }}
      >
        {/* ── Fixed Header ── */}
        <Dialog.Header
          position="fixed"
          asChild
          className="border-b-2 border-black bg-[#F6E9B2] px-5 py-3.5"
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <div className="p-1.5 border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                {isGenerated
                  ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                  : <Sparkles className="w-5 h-5 text-amber-600" />}
              </div>
              <div>
                <h2 className="text-lg font-bold text-black">
                  {isGenerated ? "Questions Generated" : "AI Quiz Generator"}
                </h2>
                <p className="text-xs text-black/70">
                  {isGenerated
                    ? `${generatedDrafts.length} questions ready — export or proceed to builder`
                    : "Generate curriculum-aligned quiz questions automatically"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="cursor-pointer p-1 border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-neutral-100 disabled:opacity-50 text-black"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </Dialog.Header>

        {/* ── Scrollable Body ── */}
        <section className="flex flex-col gap-4 p-5 max-h-[66vh] overflow-y-auto">

          {error && (
            <Alert status="error" className="border-2 border-red-500">
              <AlertCircle className="h-4 w-4" />
              <Alert.Description className="text-xs font-semibold">{error}</Alert.Description>
            </Alert>
          )}

          {/* ════════════════════════════════════════════════════════════
              STATE A: Configuration form
          ════════════════════════════════════════════════════════════ */}
          {!isGenerated && (
            <>
              {/* Subject Selection */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-black">
                    Subject / Learning Area
                  </label>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    Change subject to source different lessons
                  </span>
                </div>
                {subjects && subjects.length > 1 ? (
                  <div className="relative">
                    <select
                      value={currentSubjectId}
                      onChange={(e) => {
                        const newId = Number(e.target.value);
                        setCurrentSubjectId(newId);
                        setSelectedLessonIds([]);
                        setSelectedReadingIds([]);
                      }}
                      disabled={isGenerating}
                      className="w-full h-10 border-2 border-black bg-white px-3 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] outline-none cursor-pointer focus:shadow-none"
                    >
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border-2 border-black bg-neutral-100 px-3 py-2 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <BookOpen className="w-4 h-4 text-black/70" />
                    <span>{currentSubjectName}</span>
                    <Badge variant="surface" className="ml-auto text-[10px] uppercase font-bold">
                      Pre-selected
                    </Badge>
                  </div>
                )}
              </div>

              {/* Source Mode Toggle */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-black">
                  Question Source
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { mode: "lesson", icon: <List className="w-3.5 h-3.5" />, label: "By Lesson" },
                      { mode: "specific", icon: <BookMarked className="w-3.5 h-3.5" />, label: "By Specific Readings" },
                    ] as const
                  ).map(({ mode, icon, label }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setSourceMode(mode)}
                      className={`flex items-center justify-center gap-2 py-2 px-3 border-2 border-black text-xs font-extrabold transition-all cursor-pointer ${
                        sourceMode === mode
                          ? "bg-black text-white shadow-none"
                          : "bg-white text-black hover:bg-neutral-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Lesson Mode ── */}
                {sourceMode === "lesson" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        Select lessons — all attached readings will be used as source material.
                      </span>
                      {lessons.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedLessonIds(
                              selectedLessonIds.length === lessons.length
                                ? []
                                : lessons.map((l) => l.lesson_id)
                            )
                          }
                          className="text-xs font-bold text-blue-600 hover:underline cursor-pointer shrink-0 ml-2"
                        >
                          {selectedLessonIds.length === lessons.length ? "Deselect All" : "Select All"}
                        </button>
                      )}
                    </div>

                    {isLoadingSource ? (
                      <div className="flex items-center gap-2 p-4 border-2 border-dashed border-black/30 bg-neutral-50 text-xs text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading lessons…
                      </div>
                    ) : lessons.length === 0 ? (
                      <div className="p-3 border-2 border-dashed border-black/30 bg-neutral-50 text-xs text-muted-foreground">
                        No lessons found. AI will generate based on general curriculum for{" "}
                        <strong>{currentSubjectName}</strong>.
                      </div>
                    ) : (
                      <div className="max-h-32 overflow-y-auto border-2 border-black p-2 space-y-1.5 bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        {lessons.map((lesson) => {
                          const sel = selectedLessonIds.includes(lesson.lesson_id);
                          return (
                            <label
                              key={lesson.lesson_id}
                              className={`flex items-center gap-2 p-2 border border-black/20 text-xs font-medium cursor-pointer transition-colors ${
                                sel ? "bg-amber-50 border-black font-bold" : "hover:bg-neutral-50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={sel}
                                onChange={() =>
                                  setSelectedLessonIds((prev) =>
                                    prev.includes(lesson.lesson_id)
                                      ? prev.filter((id) => id !== lesson.lesson_id)
                                      : [...prev, lesson.lesson_id]
                                  )
                                }
                                className="rounded-none border-2 border-black accent-black w-4 h-4 cursor-pointer"
                              />
                              <span className="flex-1 truncate">{lesson.title}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {selectedLessonIds.length} lesson(s) selected.
                    </p>
                  </div>
                )}

                {/* ── Specific Readings Mode ── */}
                {sourceMode === "specific" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">
                        Hand-pick individual reading classworks across lessons.
                      </span>
                      {readingClassworks.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedReadingIds(
                              selectedReadingIds.length === readingClassworks.length
                                ? []
                                : readingClassworks.map((r) => r.classwork_id)
                            )
                          }
                          className="text-xs font-bold text-blue-600 hover:underline cursor-pointer shrink-0 ml-2"
                        >
                          {selectedReadingIds.length === readingClassworks.length
                            ? "Deselect All"
                            : "Select All"}
                        </button>
                      )}
                    </div>

                    {isLoadingSource ? (
                      <div className="flex items-center gap-2 p-4 border-2 border-dashed border-black/30 bg-neutral-50 text-xs text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading reading classworks…
                      </div>
                    ) : readingClassworks.length === 0 ? (
                      <div className="p-3 border-2 border-dashed border-black/30 bg-neutral-50 text-xs text-muted-foreground">
                        No reading classworks found for this subject. Try "By Lesson" mode or add
                        reading classworks first.
                      </div>
                    ) : (
                      <div className="max-h-40 overflow-y-auto border-2 border-black p-2 space-y-3 bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                        {readingsByLesson.map(([lessonTitle, items]) => (
                          <div key={lessonTitle}>
                            <p className="text-[10px] font-black uppercase tracking-wider text-black/50 mb-1">
                              {lessonTitle}
                            </p>
                            <div className="space-y-1">
                              {items.map((cw) => {
                                const sel = selectedReadingIds.includes(cw.classwork_id);
                                return (
                                  <label
                                    key={cw.classwork_id}
                                    className={`flex items-center gap-2 p-1.5 border border-black/20 text-xs font-medium cursor-pointer transition-colors ${
                                      sel
                                        ? "bg-blue-50 border-blue-400 font-bold"
                                        : "hover:bg-neutral-50"
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={sel}
                                      onChange={() =>
                                        setSelectedReadingIds((prev) =>
                                          prev.includes(cw.classwork_id)
                                            ? prev.filter((id) => id !== cw.classwork_id)
                                            : [...prev, cw.classwork_id]
                                        )
                                      }
                                      className="rounded-none border-2 border-black accent-black w-4 h-4 cursor-pointer"
                                    />
                                    <BookMarked className="w-3 h-3 text-blue-500 shrink-0" />
                                    <span className="flex-1 truncate">{cw.title}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {selectedReadingIds.length} reading(s) selected.
                    </p>
                  </div>
                )}

                {/* Additional Coverage — always visible */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-black/70">
                    Additional Coverage / Instructions (Optional)
                  </label>
                  <textarea
                    value={additionalCoverage}
                    onChange={(e) => setAdditionalCoverage(e.target.value)}
                    placeholder="e.g. Focus on Chapter 3 only — pangungusap na may paksa at panaguri..."
                    rows={2}
                    className="w-full border-2 border-black px-3 py-1.5 text-xs font-medium bg-white resize-none focus:outline-none focus:ring-1 focus:ring-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  />
                </div>
              </div>

              {/* Test Parts Builder */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-black">
                    Test Parts, Items &amp; Scores
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="surface" className="border-black font-extrabold text-xs bg-amber-100">
                      {totalItemCount} Items
                    </Badge>
                    <Badge variant="surface" className="border-black font-extrabold text-xs bg-[#7ABA78] text-black">
                      {totalPointsCount} Total Pts
                    </Badge>
                  </div>
                </div>

                <div className="space-y-2 border-2 border-black p-3 bg-neutral-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                  {testParts.map((part, index) => {
                    const rowPts = (Number(part.count) || 0) * (Number(part.points_per_item) || 1);
                    const isExpanded = expandedPartIds.has(part.id);
                    const bError = hasBreakdownError(part, isExpanded);

                    return (
                      <div
                        key={part.id}
                        className="p-2.5 border-2 border-black bg-white shadow-xs"
                      >
                        {/* ── Row top ── */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-black w-5 text-center text-muted-foreground shrink-0">
                            #{index + 1}
                          </span>

                          <select
                            value={part.type}
                            onChange={(e) =>
                              updateTestPart(part.id, { type: e.target.value as AIQuizPartType })
                            }
                            className="flex-1 min-w-[160px] border-2 border-black bg-white px-2 py-1.5 text-xs font-bold cursor-pointer focus:outline-none"
                          >
                            <option value="MULTIPLE_CHOICE">Multiple Choice (4 Options)</option>
                            <option value="TRUE_FALSE">True or False (2 Options)</option>
                            <option value="SHORT_ANSWER">Short Answer / Identification</option>
                            <option value="ESSAY">Essay / Open-ended Response</option>
                          </select>

                          <div className="flex items-center gap-1 shrink-0">
                            <Input
                              type="number"
                              min={1}
                              max={50}
                              value={part.count}
                              onChange={(e) =>
                                updateTestPart(part.id, {
                                  count: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                                })
                              }
                              className="w-14 h-8 text-center text-xs font-bold border-2 border-black rounded-none shadow-none"
                              title="Number of questions"
                            />
                            <span className="text-[11px] font-semibold text-muted-foreground">items</span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs font-black text-black">@</span>
                            <Input
                              type="number"
                              min={0.5}
                              max={100}
                              step={0.5}
                              value={part.points_per_item}
                              onChange={(e) =>
                                updateTestPart(part.id, {
                                  points_per_item: Math.max(
                                    0.5,
                                    Math.min(100, Number(e.target.value) || 1)
                                  ),
                                })
                              }
                              className="w-14 h-8 text-center text-xs font-bold border-2 border-black rounded-none shadow-none bg-amber-50"
                              title="Points per question"
                            />
                            <span className="text-[11px] font-semibold text-muted-foreground">pt(s)</span>
                          </div>

                          <Badge variant="surface" className="border-black font-bold text-[10px] bg-neutral-100 shrink-0">
                            = {rowPts} pts
                          </Badge>

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={testParts.length <= 1}
                            onClick={() => removeTestPart(part.id)}
                            className="h-8 w-8 p-0 border-2 border-black text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer ml-auto shrink-0"
                            title="Remove part"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>

                        {/* ── Prominent Difficulty Customizer Toggle ── */}
                        <div className="mt-2.5 pt-2 border-t-2 border-black/10 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => togglePartExpanded(part.id)}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold border-2 border-black transition-all cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${
                              isExpanded
                                ? "bg-black text-white"
                                : isDefaultBreakdown(part)
                                ? "bg-white text-black hover:bg-neutral-100"
                                : "bg-[#F6E9B2] text-black hover:bg-[#ebdca0]"
                            }`}
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                            <span>Customize Difficulty</span>
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${
                                isExpanded
                                  ? "bg-white/20 text-white"
                                  : bError
                                  ? "bg-red-500 text-white"
                                  : isDefaultBreakdown(part)
                                  ? "bg-neutral-200 text-black/80"
                                  : "bg-black text-white"
                              }`}
                            >
                              {bError
                                ? `⚠ ${breakdownSum(part)}/${part.count}`
                                : breakdownSummary(part)}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5 ml-0.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
                            )}
                          </button>

                          <span className="text-[11px] font-semibold text-muted-foreground hidden sm:inline-block">
                            {isDefaultBreakdown(part)
                              ? "Default: 100% Easy"
                              : "Custom Easy/Med/Hard split"}
                          </span>
                        </div>

                          {isExpanded && (
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                              {(["EASY", "MEDIUM", "HARD"] as const).map((diff) => (
                                <div key={diff} className="flex items-center gap-1">
                                  <span
                                    className={`text-[10px] font-black ${
                                      diff === "EASY"
                                        ? "text-green-700"
                                        : diff === "MEDIUM"
                                        ? "text-amber-600"
                                        : "text-red-600"
                                    }`}
                                  >
                                    {diff[0] + diff.slice(1).toLowerCase()}
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={part.count}
                                    value={part.difficulty_breakdown[diff]}
                                    onChange={(e) =>
                                      updateBreakdown(
                                        part.id,
                                        diff,
                                        Math.max(0, Math.min(part.count, Number(e.target.value) || 0))
                                      )
                                    }
                                    className="w-12 h-7 text-center text-xs font-bold border-2 border-black rounded-none focus:outline-none focus:ring-1 focus:ring-black"
                                  />
                                </div>
                              ))}
                              {bError && (
                                <span className="text-[10px] text-red-600 font-bold">
                                  ← must sum to {part.count}
                                </span>
                              )}
                              {!bError && !isDefaultBreakdown(part) && (
                                <span className="text-[10px] text-green-600 font-bold">✓</span>
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addTestPart}
                    className="w-full gap-1 border-2 border-dashed border-black font-bold text-xs hover:bg-neutral-100 cursor-pointer bg-white"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Another Test Part
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════
              STATE B: Generated results + export
          ════════════════════════════════════════════════════════════ */}
          {isGenerated && generatedDrafts && (
            <div className="space-y-4">
              {/* Warnings */}
              {generatedWarnings.length > 0 && (
                <Alert status="warning" className="border-2 border-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  <Alert.Description className="text-xs">
                    {generatedWarnings.join("; ")}
                  </Alert.Description>
                </Alert>
              )}

              {/* Summary card */}
              <div className="border-2 border-black bg-amber-50 p-4 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <p className="font-black text-sm">
                    {generatedDrafts.length} Questions Generated
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["EASY", "MEDIUM", "HARD"] as const).map((d) => {
                    const n = generatedDrafts.filter((q) => q.difficulty_level === d).length;
                    return n > 0 ? (
                      <Badge
                        key={d}
                        variant="surface"
                        className={`text-[10px] font-bold border ${
                          d === "EASY"
                            ? "border-green-500 bg-green-50 text-green-700"
                            : d === "MEDIUM"
                            ? "border-amber-500 bg-amber-50 text-amber-700"
                            : "border-red-500 bg-red-50 text-red-700"
                        }`}
                      >
                        {n} {d[0] + d.slice(1).toLowerCase()}
                      </Badge>
                    ) : null;
                  })}
                  {(
                    [
                      { label: "MC", check: (q: QuizQuestionDraft) => q.question_type === "MULTIPLE_CHOICE" && (q.options?.length ?? 0) > 2 },
                      { label: "T/F", check: (q: QuizQuestionDraft) => q.question_type === "MULTIPLE_CHOICE" && (q.options?.length ?? 0) === 2 },
                      { label: "SA/Essay", check: (q: QuizQuestionDraft) => q.question_type === "SHORT_ANSWER" },
                    ]
                  ).map(({ label, check }) => {
                    const n = generatedDrafts.filter(check).length;
                    return n > 0 ? (
                      <Badge key={label} variant="surface" className="text-[10px] font-bold border border-black/30 bg-white">
                        {n} {label}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </div>

              {/* Export section */}
              <div className="border-2 border-black p-4 space-y-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-xs font-bold uppercase tracking-wider text-black">
                  Export Questionnaire
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Export a formatted questionnaire for offline use. Questions are grouped by type on
                  legal-size paper.
                </p>

                {/* Answer key toggle */}
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeAnswerKey}
                    onChange={(e) => setIncludeAnswerKey(e.target.checked)}
                    className="w-4 h-4 border-2 border-black accent-black cursor-pointer"
                  />
                  <span className="text-xs font-semibold">Include Answer Key at the bottom</span>
                </label>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport("pdf")}
                    disabled={isExporting !== null}
                    className="gap-1.5 border-2 border-black font-bold text-xs cursor-pointer"
                  >
                    {isExporting === "pdf"
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <FileDown className="w-3.5 h-3.5" />}
                    Download PDF
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport("docx")}
                    disabled={isExporting !== null}
                    className="gap-1.5 border-2 border-black font-bold text-xs cursor-pointer"
                  >
                    {isExporting === "docx"
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <FileText className="w-3.5 h-3.5" />}
                    Download Word (.docx)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Fixed Footer ── */}
        <Dialog.Footer
          position="fixed"
          variant="default"
          className="border-t-2 border-black bg-neutral-100 px-5 py-3 flex items-center justify-between"
        >
          {/* Left side */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isGenerated ? (
              <button
                type="button"
                onClick={() => { setGeneratedDrafts(null); setError(""); }}
                className="flex items-center gap-1.5 font-bold text-xs text-black border-2 border-black px-2.5 py-1.5 hover:bg-neutral-200 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Reconfigure
              </button>
            ) : (
              <>
                <HelpCircle className="w-3.5 h-3.5 text-black/60" />
                <span>AI generates questions, choices, answers, and rubrics.</span>
              </>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isGenerating}
              onClick={onClose}
              className="border-2 border-black font-bold cursor-pointer"
            >
              Cancel
            </Button>

            {isGenerated ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleUseInBuilder}
                className="gap-2 border-2 border-black bg-amber-400 text-black hover:bg-amber-500 font-extrabold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              >
                Use in Quiz Builder →
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isGenerating || totalItemCount <= 0 || hasAnyBreakdownError}
                onClick={handleGenerate}
                className="gap-2 border-2 border-black bg-amber-400 text-black hover:bg-amber-500 font-extrabold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate {totalItemCount} Questions ({totalPointsCount} Pts)
                  </>
                )}
              </Button>
            )}
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
