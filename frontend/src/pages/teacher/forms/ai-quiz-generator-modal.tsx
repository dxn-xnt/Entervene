"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  BookOpen,
  HelpCircle,
  AlertCircle,
  X,
} from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { apiFetch } from "@/lib/api";
import type {
  QuizDifficulty,
  QuizQuestionDraft,
  QuizQuestionType,
} from "../classworks/quiz-builder-types";

export type TestPartRow = {
  id: string;
  type: QuizQuestionType;
  count: number;
};

export interface AIQuizGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  subjectId: number;
  subjectName: string;
  onGenerated: (questions: QuizQuestionDraft[], warnings?: string[]) => void;
}

interface TeacherLessonItem {
  lesson_id: number;
  title: string;
  subject_id?: number;
  description?: string | null;
}

interface GeneratedQuizApiQuestion {
  question_text: string;
  question_type: QuizQuestionType;
  points: number;
  display_order: number;
  difficulty_level?: QuizDifficulty;
  explanation?: string | null;
  lesson_id?: number | null;
  options?: Array<{
    option_text: string;
    is_correct: boolean;
    option_order: number;
  }>;
}

interface AIQuizGenerateResponse {
  questions: GeneratedQuizApiQuestion[];
  warnings?: string[];
}

export default function AIQuizGeneratorModal({
  isOpen,
  onClose,
  subjectId,
  subjectName,
  onGenerated,
}: AIQuizGeneratorModalProps) {
  const [lessons, setLessons] = useState<TeacherLessonItem[]>([]);
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>([]);
  const [isLoadingLessons, setIsLoadingLessons] = useState(false);

  const [testParts, setTestParts] = useState<TestPartRow[]>([
    { id: "part-1", type: "MULTIPLE_CHOICE", count: 5 },
  ]);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("MEDIUM");

  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  // Fetch teacher's lessons for this subject
  useEffect(() => {
    if (!isOpen || !subjectId) return;

    let isActive = true;
    setIsLoadingLessons(true);
    setError("");

    apiFetch("/api/v1/lessons/my-lessons")
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to load lessons");
        return (await res.json()) as TeacherLessonItem[];
      })
      .then((data) => {
        if (!isActive) return;
        const filtered = data.filter((l) => Number(l.subject_id) === Number(subjectId));
        setLessons(filtered);
      })
      .catch(() => {
        if (!isActive) return;
        setLessons([]);
      })
      .finally(() => {
        if (isActive) setIsLoadingLessons(false);
      });

    return () => {
      isActive = false;
    };
  }, [isOpen, subjectId]);

  const totalItemCount = useMemo(
    () => testParts.reduce((sum, p) => sum + (Number(p.count) || 0), 0),
    [testParts]
  );

  const toggleLesson = (lessonId: number) => {
    setSelectedLessonIds((prev) =>
      prev.includes(lessonId)
        ? prev.filter((id) => id !== lessonId)
        : [...prev, lessonId]
    );
  };

  const addTestPart = () => {
    const nextType: QuizQuestionType = testParts.some((p) => p.type === "MULTIPLE_CHOICE")
      ? "SHORT_ANSWER"
      : "MULTIPLE_CHOICE";
    setTestParts((prev) => [
      ...prev,
      { id: `part-${Date.now()}`, type: nextType, count: 5 },
    ]);
  };

  const removeTestPart = (id: string) => {
    if (testParts.length <= 1) return;
    setTestParts((prev) => prev.filter((p) => p.id !== id));
  };

  const updateTestPart = (id: string, patch: Partial<TestPartRow>) => {
    setTestParts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  };

  const handleGenerate = async () => {
    if (testParts.length === 0 || totalItemCount <= 0) {
      setError("Please configure at least one test part with 1 or more items.");
      return;
    }

    setIsGenerating(true);
    setError("");

    try {
      const response = await apiFetch("/api/v1/ai/generate-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: subjectId,
          lesson_ids: selectedLessonIds,
          test_parts: testParts.map((p) => ({
            type: p.type,
            count: Math.max(1, Math.min(50, Number(p.count) || 1)),
          })),
          difficulty: difficulty,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.detail || `AI Quiz generation failed (${response.status})`
        );
      }

      const data = (await response.json()) as AIQuizGenerateResponse;

      if (!data.questions || data.questions.length === 0) {
        throw new Error("AI returned an empty question list. Please try again.");
      }

      const drafts: QuizQuestionDraft[] = data.questions.map((q, idx) => ({
        id: `ai-q-${Date.now()}-${idx + 1}`,
        question_text: q.question_text || `Question ${idx + 1}`,
        question_type: q.question_type || "MULTIPLE_CHOICE",
        points: String(q.points || 1),
        display_order: idx + 1,
        difficulty_level: q.difficulty_level || difficulty,
        explanation: q.explanation || "",
        options:
          q.question_type === "MULTIPLE_CHOICE"
            ? (q.options || []).map((opt, oIdx) => ({
                option_text: opt.option_text || `Option ${oIdx + 1}`,
                is_correct: Boolean(opt.is_correct),
                option_order: opt.option_order || oIdx + 1,
              }))
            : [],
      }));

      onGenerated(drafts, data.warnings);
      onClose();
    } catch (err) {
      console.error("AI Quiz generation error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to generate quiz questions with AI. Please try again."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isGenerating) onClose();
      }}
    >
      <Dialog.Content
        size="lg"
        className="border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] max-h-[90vh] flex flex-col"
        overlay={{ className: "bg-black/60 backdrop-blur-xs" }}
      >
        {/* Header */}
        <Dialog.Header
          asChild
          className="border-b-2 border-black bg-[#F6E9B2] px-5 py-4 flex items-center justify-between"
        >
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <div className="p-1.5 border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <Sparkles className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold">AI Quiz Generator</h2>
                <p className="text-xs text-muted-foreground">
                  Generate curriculum-aligned quiz questions automatically
                </p>
              </div>
            </div>

            <Dialog.Close
              title="Close"
              disabled={isGenerating}
              className="cursor-pointer p-1 border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-neutral-100 disabled:opacity-50"
            >
              <X size={16} />
            </Dialog.Close>
          </div>
        </Dialog.Header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <Alert variant="destructive" className="border-2 border-red-500">
              <AlertCircle className="h-4 w-4" />
              <div className="text-xs font-semibold">{error}</div>
            </Alert>
          )}

          {/* 1. Subject Display (Pre-filled & Read-only) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-black">
              Subject / Learning Area
            </label>
            <div className="flex items-center gap-2 border-2 border-black bg-neutral-100 px-3 py-2 text-sm font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <BookOpen className="w-4 h-4 text-black/70" />
              <span>{subjectName || `Subject #${subjectId}`}</span>
              <Badge variant="surface" className="ml-auto text-[10px] uppercase font-bold">
                Pre-selected
              </Badge>
            </div>
          </div>

          {/* 2. Connected Lessons Multi-Select */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-black">
                Connected Lessons & Readings (Optional)
              </label>
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
                  className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  {selectedLessonIds.length === lessons.length
                    ? "Deselect All"
                    : "Select All"}
                </button>
              )}
            </div>

            {isLoadingLessons ? (
              <div className="flex items-center justify-center p-4 border-2 border-dashed border-black/30 bg-neutral-50 text-xs text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading subject lessons...</span>
              </div>
            ) : lessons.length === 0 ? (
              <div className="p-3 border-2 border-dashed border-black/30 bg-neutral-50 text-xs text-muted-foreground">
                No lessons found for this subject. The AI will generate items based on the general curriculum for <strong>{subjectName}</strong>.
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto border-2 border-black p-2 space-y-1.5 bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                {lessons.map((lesson) => {
                  const isSelected = selectedLessonIds.includes(lesson.lesson_id);
                  return (
                    <label
                      key={lesson.lesson_id}
                      className={`flex items-center gap-2 p-2 border border-black/20 text-xs font-medium cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-amber-50 border-black font-bold"
                          : "hover:bg-neutral-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleLesson(lesson.lesson_id)}
                        className="rounded-none border-2 border-black accent-black w-4 h-4 cursor-pointer"
                      />
                      <span className="flex-1 truncate">{lesson.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              {selectedLessonIds.length} lesson(s) selected as AI source material.
            </p>
          </div>

          {/* 3. Test Parts Builder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-black">
                Test Parts & Item Breakdown
              </label>
              <Badge variant="surface" className="border-black font-extrabold text-xs">
                {totalItemCount} Items Total
              </Badge>
            </div>

            <div className="space-y-2 border-2 border-black p-3 bg-neutral-50 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              {testParts.map((part, index) => (
                <div
                  key={part.id}
                  className="flex items-center gap-2 p-2 border-2 border-black bg-white shadow-xs"
                >
                  <span className="text-xs font-black w-5 text-center text-muted-foreground">
                    #{index + 1}
                  </span>

                  <select
                    value={part.type}
                    onChange={(e) =>
                      updateTestPart(part.id, {
                        type: e.target.value as QuizQuestionType,
                      })
                    }
                    className="flex-1 border-2 border-black bg-white px-2 py-1 text-xs font-bold cursor-pointer focus:outline-none"
                  >
                    <option value="MULTIPLE_CHOICE">Multiple Choice (4 Options)</option>
                    <option value="SHORT_ANSWER">Short Answer (Identification)</option>
                  </select>

                  <div className="flex items-center gap-1">
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
                      className="w-16 h-8 text-center text-xs font-bold border-2 border-black rounded-none shadow-none"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">
                      items
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testParts.length <= 1}
                    onClick={() => removeTestPart(part.id)}
                    className="h-8 w-8 p-0 border-2 border-black text-red-600 hover:bg-red-50 disabled:opacity-30 cursor-pointer"
                    title="Remove part"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTestPart}
                className="w-full gap-1 border-2 border-dashed border-black font-bold text-xs hover:bg-neutral-100 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add Another Test Part
              </Button>
            </div>
          </div>

          {/* 4. Difficulty Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-black">
              Target Difficulty Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["EASY", "MEDIUM", "HARD"] as QuizDifficulty[]).map((level) => {
                const isSelected = difficulty === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={`py-2 px-3 border-2 border-black text-xs font-extrabold transition-all cursor-pointer ${
                      isSelected
                        ? "bg-black text-white shadow-none"
                        : "bg-white text-black hover:bg-neutral-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    }`}
                  >
                    {level === "EASY" && "🟢 Easy"}
                    {level === "MEDIUM" && "🟡 Medium"}
                    {level === "HARD" && "🔴 Hard"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t-2 border-black p-4 bg-neutral-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HelpCircle className="w-3.5 h-3.5 text-black/60" />
            <span>AI generates questions, options, and explanations.</span>
          </div>

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

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isGenerating || totalItemCount <= 0}
              onClick={handleGenerate}
              className="gap-2 border-2 border-black bg-amber-400 text-black hover:bg-amber-500 font-extrabold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] cursor-pointer"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Questions...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate {totalItemCount} Questions
                </>
              )}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
