import React from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import type { LessonPlanDraft, FlowStep } from "../useLessonPlanner";
import { AIAssistButton } from "../components/AIAssistButton";

interface LearningExpTabProps {
  draft: LessonPlanDraft;
  onNestedChange: (
    section: "learning_experience",
    key: keyof LessonPlanDraft["learning_experience"],
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

const PHASE_CONFIG: Record<FlowStep["phase"], { label: string; color: string; aiField: "flow_before" | "flow_during" | "flow_after" }> = {
  before: { label: "Before", color: "bg-blue-100 text-blue-700 border-blue-200", aiField: "flow_before" },
  during: { label: "During", color: "bg-emerald-100 text-emerald-700 border-emerald-200", aiField: "flow_during" },
  after:  { label: "After",  color: "bg-orange-100 text-orange-700 border-orange-200", aiField: "flow_after"  },
};

export const LearningExpTab: React.FC<LearningExpTabProps> = ({ draft, onNestedChange }) => {
  const { learning_experience: le } = draft;
  const aiCtx = { title: draft.title, learningArea: draft.learning_area, gradeSection: draft.grade_section };

  const addFlowStep = (phase: FlowStep["phase"]) => {
    onNestedChange("learning_experience", "flow", [
      ...le.flow,
      { id: crypto.randomUUID(), phase, description: "" },
    ]);
  };

  const updateFlowStep = (id: string, description: string) => {
    onNestedChange("learning_experience", "flow", le.flow.map((s) => (s.id === id ? { ...s, description } : s)));
  };

  const removeFlowStep = (id: string) => {
    onNestedChange("learning_experience", "flow", le.flow.filter((s) => s.id !== id));
  };

  const appendFlowStepsFromAI = (phase: FlowStep["phase"], text: string) => {
    const lines = text
      .split("\n")
      .map(cleanAIString)
      .filter((l) => {
        if (!l) return false;
        if (/^(here (is|are|are the)|below (is|are)|sure|note:|disclaimer:|flow|introduction|development|deepening|integration)/i.test(l)) return false;
        return true;
      });

    const newSteps: FlowStep[] = lines.map((desc) => ({
      id: crypto.randomUUID(),
      phase,
      description: desc,
    }));

    onNestedChange("learning_experience", "flow", [...le.flow, ...newSteps]);
  };

  const flowByPhase = (phase: FlowStep["phase"]) => le.flow.filter((s) => s.phase === phase);

  return (
    <div className="flex flex-col gap-8 w-full">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Learning Experience (L)</h2>
        <p className="text-sm text-muted-foreground">
          Describe how you will structure student learning activities.
        </p>
      </div>

      {/* Pre-Lesson Activity & Integration Opportunities Side-by-Side on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        <div className="flex flex-col gap-1.5 w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full">
            <div>
              <Label className="text-sm font-semibold text-gray-700">Pre-Lesson Activity</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Warm-up, review, or prior knowledge activation.</p>
            </div>
            <AIAssistButton
              field="pre_lesson"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("learning_experience", "pre_lesson", cleanAIString(t))}
            />
          </div>
          <textarea
            rows={4}
            placeholder="Describe the pre-lesson activity or review…"
            value={le.pre_lesson}
            onChange={(e) => onNestedChange("learning_experience", "pre_lesson", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[90px]"
          />
        </div>

        <div className="flex flex-col gap-1.5 w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full">
            <div>
              <Label className="text-sm font-semibold text-gray-700">Opportunities for Integration</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Cross-curricular, values, or real-world links.</p>
            </div>
            <AIAssistButton
              field="integration"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("learning_experience", "integration", cleanAIString(t))}
            />
          </div>
          <textarea
            rows={4}
            placeholder="Describe opportunities to integrate other subject areas or values…"
            value={le.integration}
            onChange={(e) => onNestedChange("learning_experience", "integration", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[90px]"
          />
        </div>
      </div>

      {/* Lesson Flow (3-Column Desktop Kanban Layout) */}
      <div className="flex flex-col gap-4 w-full">
        <div>
          <Label className="text-sm font-semibold text-gray-700">Lesson Flow</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Organize activities for Before, During, and After the lesson.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 w-full">
          {(["before", "during", "after"] as const).map((phase) => {
            const steps = flowByPhase(phase);
            const cfg = PHASE_CONFIG[phase];

            return (
              <div
                key={phase}
                className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50/50 p-4 w-full min-h-[220px]"
              >
                {/* Phase Column Header */}
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-xs font-semibold px-2.5 py-0.5 ${cfg.color}`}>
                      {cfg.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-medium">({steps.length})</span>
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
                      className="gap-1 h-7 text-xs bg-white"
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>

                {/* Steps inside column */}
                <div className="flex flex-col gap-2.5 flex-1">
                  {steps.map((step, idx) => (
                    <div key={step.id} className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                      <span className="text-xs text-muted-foreground mt-1.5 w-4 text-center shrink-0 font-medium">
                        {idx + 1}.
                      </span>
                      <textarea
                        rows={2}
                        placeholder={`${cfg.label} activity ${idx + 1}…`}
                        value={step.description}
                        onChange={(e) => updateFlowStep(step.id, e.target.value)}
                        className="flex-1 w-full border-0 bg-transparent text-sm p-0 focus-visible:ring-0 focus-visible:outline-none resize-y min-h-[50px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                        onClick={() => removeFlowStep(step.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}

                  {steps.length === 0 && (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 py-8 text-center text-xs text-muted-foreground">
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
      <div className="flex flex-col gap-1.5 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2 w-full">
          <Label className="text-sm font-semibold text-gray-700">Learning Resources</Label>
          <AIAssistButton
            field="resources"
            {...aiCtx}
            onSuggestion={(t) => onNestedChange("learning_experience", "resources", cleanAIString(t))}
          />
        </div>
        <textarea
          rows={4}
          placeholder="List materials, tools, digital resources, or manipulatives…"
          value={le.resources}
          onChange={(e) => onNestedChange("learning_experience", "resources", e.target.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[90px]"
        />
      </div>
    </div>
  );
};
