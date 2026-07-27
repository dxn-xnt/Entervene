import React from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import type { LessonPlanDraft } from "../useLessonPlanner";
import { AIAssistButton } from "../components/AIAssistButton";

interface AssessmentTabProps {
  draft: LessonPlanDraft;
  onNestedChange: (
    section: "assessment",
    key: keyof LessonPlanDraft["assessment"],
    value: unknown
  ) => void;
}

function cleanAIString(text: string): string {
  if (!text) return "";
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[\*\-\d\.\s]+/, "")
    .trim();
}

export const AssessmentTab: React.FC<AssessmentTabProps> = ({ draft, onNestedChange }) => {
  const { assessment } = draft;
  const aiCtx = { title: draft.title, learningArea: draft.learning_area, gradeSection: draft.grade_section };

  const addTask = () => {
    onNestedChange("assessment", "tasks", [
      ...assessment.tasks,
      { id: crypto.randomUUID(), description: "" },
    ]);
  };

  const updateTask = (id: string, description: string) => {
    onNestedChange("assessment", "tasks", assessment.tasks.map((t) => (t.id === id ? { ...t, description } : t)));
  };

  const removeTask = (id: string) => {
    const updated = assessment.tasks.filter((t) => t.id !== id);
    onNestedChange("assessment", "tasks", updated.length ? updated : [{ id: crypto.randomUUID(), description: "" }]);
  };

  const appendTasksFromAI = (text: string) => {
    const lines = text
      .split("\n")
      .map(cleanAIString)
      .filter((l) => {
        if (!l) return false;
        if (/^(here (is|are|are the)|below (is|are)|sure|note:|disclaimer:)/i.test(l)) return false;
        return true;
      });

    const newTasks = lines.map((desc) => ({
      id: crypto.randomUUID(),
      description: desc,
    }));

    onNestedChange("assessment", "tasks", [...assessment.tasks, ...newTasks]);
  };

  return (
    <div className="flex flex-col gap-8 w-full">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Assessment (A)</h2>
        <p className="text-sm text-muted-foreground">
          Describe how you will monitor and evaluate student learning.
        </p>
      </div>

      {/* Side-by-Side 2 Column Desktop Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full items-start">
        {/* Formative Assessment Column */}
        <div className="flex flex-col gap-2 w-full border rounded-xl p-5 bg-white shadow-2xs">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full pb-2 border-b">
            <div>
              <Label className="text-sm font-semibold text-gray-800">Formative Assessment</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Monitoring understanding (think-pair-share, exit tickets, observation).
              </p>
            </div>
            <AIAssistButton
              field="formative"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("assessment", "formative", cleanAIString(t))}
            />
          </div>
          <textarea
            rows={8}
            placeholder="Describe your formative assessment strategy…"
            value={assessment.formative}
            onChange={(e) => onNestedChange("assessment", "formative", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[180px]"
          />
        </div>

        {/* Evaluation Tasks Column */}
        <div className="flex flex-col gap-3 w-full border rounded-xl p-5 bg-white shadow-2xs">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full pb-2 border-b">
            <div>
              <Label className="text-sm font-semibold text-gray-800">Evaluation Tasks</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Summative tasks or products demonstrating mastery.</p>
            </div>
            <div className="flex items-center gap-2">
              <AIAssistButton field="evaluation_tasks" {...aiCtx} onSuggestion={appendTasksFromAI} label="AI Tasks" />
              <Button type="button" variant="outline" size="sm" onClick={addTask} className="gap-1 h-7 text-xs">
                <Plus className="size-3" /> Add Task
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 w-full">
            {assessment.tasks.map((task, idx) => (
              <div key={task.id} className="flex items-start gap-2 w-full">
                <span className="text-xs text-muted-foreground mt-2.5 w-5 text-right shrink-0 font-medium">{idx + 1}.</span>
                <textarea
                  rows={2}
                  placeholder={`Evaluation task ${idx + 1}…`}
                  value={task.description}
                  onChange={(e) => updateTask(task.id, e.target.value)}
                  className="flex-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[60px]"
                />
                {assessment.tasks.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 mt-1 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={() => removeTask(task.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
