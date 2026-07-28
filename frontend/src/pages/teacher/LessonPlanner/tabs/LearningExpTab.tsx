import React from "react";
import { Label } from "@/components/retroui/Label";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Plus, Trash2 } from "lucide-react";
import type { LessonPlanDraft, FlowStep } from "../useLessonPlanner";
import { AIAssistButton } from "../components/AIAssistButton";

interface LearningExpTabProps {
  draft: LessonPlanDraft;
  onNestedChange: (
    section: "learning_experience",
    key: keyof LessonPlanDraft["learning_experience"],
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

const PHASE_CONFIG: Record<
  FlowStep["phase"],
  {
    label: string;
    color: string;
    aiField: "flow_before" | "flow_during" | "flow_after";
  }
> = {
  before: {
    label: "Before",
    color: "bg-blue-100 text-blue-700 border-black",
    aiField: "flow_before",
  },
  during: {
    label: "During",
    color: "bg-emerald-100 text-emerald-700 border-black",
    aiField: "flow_during",
  },
  after: {
    label: "After",
    color: "bg-orange-100 text-orange-700 border-black",
    aiField: "flow_after",
  },
};

export const LearningExpTab: React.FC<LearningExpTabProps> = ({
  draft,
  onNestedChange,
}) => {
  const { learning_experience: le } = draft;
  const aiCtx = {
    title: draft.title,
    learningArea: draft.learning_area,
    gradeSection: draft.grade_section,
  };

  const addFlowStep = (phase: FlowStep["phase"]) => {
    onNestedChange("learning_experience", "flow", [
      ...le.flow,
      { id: crypto.randomUUID(), phase, description: "" },
    ]);
  };

  const updateFlowStep = (id: string, description: string) => {
    onNestedChange(
      "learning_experience",
      "flow",
      le.flow.map((s) => (s.id === id ? { ...s, description } : s)),
    );
  };

  const removeFlowStep = (id: string) => {
    onNestedChange(
      "learning_experience",
      "flow",
      le.flow.filter((s) => s.id !== id),
    );
  };

  const appendFlowStepsFromAI = (phase: FlowStep["phase"], text: string) => {
    const lines = text
      .split("\n")
      .map(cleanAIString)
      .filter((l) => {
        if (!l) return false;
        if (
          /^(here (is|are|are the)|below (is|are)|sure|note:|disclaimer:|flow|introduction|development|deepening|integration)/i.test(
            l,
          )
        )
          return false;
        return true;
      });

    const newSteps: FlowStep[] = lines.map((desc) => ({
      id: crypto.randomUUID(),
      phase,
      description: desc,
    }));

    onNestedChange("learning_experience", "flow", [...le.flow, ...newSteps]);
  };

  const flowByPhase = (phase: FlowStep["phase"]) =>
    le.flow.filter((s) => s.phase === phase);

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Section Header */}
      <div className="space-y-1 border-b-2 border-border pb-3">
        <h2 className="text-xl font-bold">Learning Experience</h2>

        <p className="text-sm text-muted-foreground">
          Describe how you will structure student learning activities.
        </p>
      </div>

      {/* Pre-Lesson Activity & Integration Opportunities Side-by-Side on Desktop */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="font-bold">Pre-Lesson Activity</Label>
            <AIAssistButton
              field="pre_lesson"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange(
                  "learning_experience",
                  "pre_lesson",
                  cleanAIString(t),
                )
              }
            />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Warm-up, review, or prior knowledge activation.
          </p>
          <textarea
            rows={4}
            placeholder="Describe the pre-lesson activity or review…"
            value={le.pre_lesson}
            onChange={(e) =>
              onNestedChange(
                "learning_experience",
                "pre_lesson",
                e.target.value,
              )
            }
            className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="font-bold">Opportunities for Integration</Label>
            <AIAssistButton
              field="integration"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange(
                  "learning_experience",
                  "integration",
                  cleanAIString(t),
                )
              }
            />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Cross-curricular, values, or real-world links.
          </p>
          <textarea
            rows={4}
            placeholder="Describe opportunities to integrate other subject areas or values…"
            value={le.integration}
            onChange={(e) =>
              onNestedChange(
                "learning_experience",
                "integration",
                e.target.value,
              )
            }
            className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Lesson Flow */}
      <div className="flex flex-col gap-4 border-t-2 border-border pt-6">
        <div>
          <Label className="font-bold">Lesson Flow</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organize activities for Before, During, and After the lesson.
          </p>
        </div>

        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-3">
          {(["before", "during", "after"] as const).map((phase) => {
            const steps = flowByPhase(phase);
            const cfg = PHASE_CONFIG[phase];

            return (
              <div
                key={phase}
                className="flex h-full min-h-[220px] w-full flex-col gap-3 border-2 border-black bg-gray-50/50 p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
              >
                {/* Phase Column Header */}
                <div className="flex items-center justify-between gap-2 border-b-2 border-border pb-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="default"
                      className={`border px-2.5 py-0.5 text-xs font-bold ${cfg.color}`}
                    >
                      {cfg.label}
                    </Badge>
                    <span className="text-xs font-medium text-muted-foreground">
                      ({steps.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <AIAssistButton
                      field={cfg.aiField}
                      {...aiCtx}
                      onSuggestion={(t) => appendFlowStepsFromAI(phase, t)}
                      label="AI Steps"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addFlowStep(phase)}
                      className="h-7 gap-1 border-black bg-white text-xs shadow-none hover:shadow-none"
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Steps inside column */}
                <div className="flex flex-1 flex-col gap-2.5">
                  {steps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="flex items-start gap-2 border-2 border-black bg-white p-2.5"
                    >
                      <span className="mt-1.5 w-4 shrink-0 text-center text-xs font-medium text-muted-foreground">
                        {idx + 1}.
                      </span>
                      <textarea
                        rows={2}
                        placeholder={`${cfg.label} activity ${idx + 1}…`}
                        value={step.description}
                        onChange={(e) =>
                          updateFlowStep(step.id, e.target.value)
                        }
                        className="min-h-[50px] w-full flex-1 resize-y border-0 bg-transparent p-0 text-sm outline-none focus:outline-none"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-red-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeFlowStep(step.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}

                  {steps.length === 0 && (
                    <div className="flex flex-1 items-center justify-center border-2 border-dashed border-gray-400 py-8 text-center text-xs text-muted-foreground">
                      No {cfg.label.toLowerCase()} steps yet.
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Learning Resources */}
      <div className="flex flex-col gap-1.5 border-t-2 border-border pt-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Label className="font-bold">Learning Resources</Label>
          <AIAssistButton
            field="resources"
            {...aiCtx}
            onSuggestion={(t) =>
              onNestedChange(
                "learning_experience",
                "resources",
                cleanAIString(t),
              )
            }
          />
        </div>
        <textarea
          rows={4}
          placeholder="List materials, tools, digital resources, or manipulatives…"
          value={le.resources}
          onChange={(e) =>
            onNestedChange("learning_experience", "resources", e.target.value)
          }
          className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
        />
      </div>
    </div>
  );
};
