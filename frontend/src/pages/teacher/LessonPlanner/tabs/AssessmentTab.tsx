import React from "react";
import { Card } from "@/components/retroui/Card";
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
    value: unknown,
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

export const AssessmentTab: React.FC<AssessmentTabProps> = ({
  draft,
  onNestedChange,
}) => {
  const { assessment } = draft;
  const aiCtx = {
    title: draft.title,
    learningArea: draft.learning_area,
    gradeSection: draft.grade_section,
  };

  const addTask = () => {
    onNestedChange("assessment", "tasks", [
      ...assessment.tasks,
      { id: crypto.randomUUID(), description: "" },
    ]);
  };

  const updateTask = (id: string, description: string) => {
    onNestedChange(
      "assessment",
      "tasks",
      assessment.tasks.map((t) => (t.id === id ? { ...t, description } : t)),
    );
  };

  const removeTask = (id: string) => {
    const updated = assessment.tasks.filter((t) => t.id !== id);
    onNestedChange(
      "assessment",
      "tasks",
      updated.length ? updated : [{ id: crypto.randomUUID(), description: "" }],
    );
  };

  const appendTasksFromAI = (text: string) => {
    const lines = text
      .split("\n")
      .map(cleanAIString)
      .filter((l) => {
        if (!l) return false;
        if (
          /^(here (is|are|are the)|below (is|are)|sure|note:|disclaimer:)/i.test(
            l,
          )
        )
          return false;
        return true;
      });

    const newTasks = lines.map((desc) => ({
      id: crypto.randomUUID(),
      description: desc,
    }));

    onNestedChange("assessment", "tasks", [...assessment.tasks, ...newTasks]);
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Section Header */}
      <div className="space-y-1 border-b-2 border-border pb-3">
        <h2 className="text-xl font-bold">Assessment</h2>

        <p className="text-sm text-muted-foreground">
          Describe how you will monitor and evaluate student learning.
        </p>
      </div>

      {/* Side-by-Side 2 Column Desktop Layout */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        {/* Formative Assessment Column */}
        <Card className="block h-full w-full border-black p-5 transition-none hover:shadow-md flex flex-col gap-2">
          <Card.Header className="mb-0 flex-row flex-wrap items-center justify-between gap-2 border-b-2 border-border pb-2">
            <div>
              <Label className="font-bold">Formative Assessment</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Monitoring understanding (think-pair-share, exit tickets,
                observation).
              </p>
            </div>
            <AIAssistButton
              field="formative"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange("assessment", "formative", cleanAIString(t))
              }
            />
          </Card.Header>
          <Card.Content className="flex flex-1 flex-col">
            <textarea
              rows={8}
              placeholder="Describe your formative assessment strategy…"
              value={assessment.formative}
              onChange={(e) =>
                onNestedChange("assessment", "formative", e.target.value)
              }
              className="w-full flex-1 resize-none border-2 border-black bg-background px-3 py-2.5 text-sm shadow-none outline-none focus:border-black"
            />
          </Card.Content>
        </Card>

        {/* Evaluation Tasks Column */}
        <Card className="block h-full w-full border-black p-5 transition-none hover:shadow-md flex flex-col gap-3">
          <Card.Header className="mb-0 flex-row flex-wrap items-center justify-between gap-2 border-b-2 border-border pb-2">
            <div>
              <Label className="font-bold">Evaluation Tasks</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Summative tasks or products demonstrating mastery.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <AIAssistButton
                field="evaluation_tasks"
                {...aiCtx}
                onSuggestion={appendTasksFromAI}
                label="AI Tasks"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTask}
                className="h-7 gap-1 border-black bg-white text-xs shadow-none hover:shadow-none"
              >
                <Plus className="size-3" /> Add Task
              </Button>
            </div>
          </Card.Header>
          <Card.Content className="flex w-full flex-1 flex-col gap-2.5 overflow-y-auto">
            {assessment.tasks.map((task, idx) => (
              <div key={task.id} className="flex w-full items-start gap-2">
                <span className="mt-2.5 w-5 shrink-0 text-right text-xs font-medium text-muted-foreground">
                  {idx + 1}.
                </span>
                <textarea
                  rows={2}
                  placeholder={`Evaluation task ${idx + 1}…`}
                  value={task.description}
                  onChange={(e) => updateTask(task.id, e.target.value)}
                  className="min-h-[60px] w-full flex-1 resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
                />
                {assessment.tasks.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mt-1 size-8 shrink-0 text-red-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => removeTask(task.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </Card.Content>
        </Card>
      </div>
    </div>
  );
};
