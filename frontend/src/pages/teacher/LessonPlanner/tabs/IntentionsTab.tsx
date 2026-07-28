import React from "react";
import { Label } from "@/components/retroui/Label";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import type { LessonPlanDraft, ValidationErrors } from "../useLessonPlanner";
import { AIAssistButton } from "../components/AIAssistButton";

interface IntentionsTabProps {
  draft: LessonPlanDraft;
  errors: ValidationErrors;
  onNestedChange: (
    section: "intentions",
    key: keyof LessonPlanDraft["intentions"],
    value: unknown,
  ) => void;
}

const OBSERVATION_CATEGORIES = [
  {
    title: "STRENGTHS",
    color: "text-emerald-700 font-bold tracking-wider text-xs",
    items: [
      "Participate actively in class discussions",
      "Work well in groups / collaborative tasks",
      "Do well in hands-on or performance tasks",
      "Show strong reading comprehension",
      "Are confident in using technology",
      "Help and tutor their classmates",
    ],
  },
  {
    title: "INTERESTS",
    color: "text-emerald-700 font-bold tracking-wider text-xs",
    items: [
      "Games and gamified activities",
      "Sports and physical activities",
      "Music, arts, and performing",
      "Stories and real-life examples",
      "Technology, gadgets, and social media",
      "Drawing, crafts, and visual projects",
    ],
  },
  {
    title: "POSSIBLE BARRIERS",
    color: "text-emerald-700 font-bold tracking-wider text-xs",
    items: [
      "Struggle with reading comprehension",
      "Limited vocabulary in the language of instruction",
      "Easily distracted / short attention span",
      "Frequent absences or tardiness",
      "Limited access to gadgets or internet at home",
      "Shy / hesitant to participate",
      "Unfinished prerequisite competencies",
      "Learners needing accommodations (disability, health, context)",
    ],
  },
];

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

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
      <AlertCircle className="size-3" />
      {msg}
    </p>
  );
}

export const IntentionsTab: React.FC<IntentionsTabProps> = ({
  draft,
  errors,
  onNestedChange,
}) => {
  const { intentions } = draft;
  const aiCtx = {
    title: draft.title,
    learningArea: draft.learning_area,
    gradeSection: draft.grade_section,
  };

  const currentChecklist = Array.isArray(intentions.context?.checklist)
    ? intentions.context.checklist
    : [];
  const currentText =
    typeof intentions.context?.text === "string" ? intentions.context.text : "";

  const addCompetency = () => {
    onNestedChange("intentions", "competencies", [
      ...intentions.competencies,
      "",
    ]);
  };

  const updateCompetency = (idx: number, value: string) => {
    const updated = [...intentions.competencies];
    updated[idx] = value;
    onNestedChange("intentions", "competencies", updated);
  };

  const removeCompetency = (idx: number) => {
    const updated = intentions.competencies.filter((_, i) => i !== idx);
    onNestedChange(
      "intentions",
      "competencies",
      updated.length ? updated : [""],
    );
  };

  const toggleChecklistItem = (item: string) => {
    const exists = currentChecklist.includes(item);
    const updated = exists
      ? currentChecklist.filter((i) => i !== item)
      : [...currentChecklist, item];

    onNestedChange("intentions", "context", {
      ...intentions.context,
      checklist: updated,
      text: currentText,
    });
  };

  const setContextText = (text: string) => {
    onNestedChange("intentions", "context", {
      ...intentions.context,
      checklist: currentChecklist,
      text,
    });
  };

  const appendToObjectives = (text: string) => {
    const cleaned = text
      .split("\n")
      .map(cleanAIString)
      .filter(
        (l) => l && !/^(here (is|are)|below|sure|note:|disclaimer:)/i.test(l),
      )
      .join("\n");

    onNestedChange(
      "intentions",
      "objectives",
      intentions.objectives
        ? `${intentions.objectives}\n\n${cleaned}`
        : cleaned,
    );
  };

  const appendCompetenciesFromAI = (text: string) => {
    const lines = text
      .split("\n")
      .map(cleanAIString)
      .filter((l) => {
        if (!l) return false;
        if (
          /^(here (is|are|are the)|below (is|are)|sure|note:|disclaimer:|esc refers to|shs refers to|flow|introduction|development|deepening|integration)/i.test(
            l,
          )
        )
          return false;
        return true;
      });

    const existing = intentions.competencies.filter((c) => c.trim());
    onNestedChange(
      "intentions",
      "competencies",
      lines.length ? [...existing, ...lines] : existing,
    );
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Section Header */}
      <div className="space-y-1 border-b-2 border-border pb-3">
        <h2 className="text-xl font-bold">Intentions</h2>

        <p className="text-sm text-muted-foreground">
          Define what students will learn and what you know about them.
        </p>
      </div>

      {/* Learning Competencies */}
      <div className="flex flex-col gap-3 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2 w-full">
          <Label className="font-bold">Learning Competencies</Label>
          <div className="flex items-center gap-2">
            <AIAssistButton
              field="competencies"
              {...aiCtx}
              onSuggestion={appendCompetenciesFromAI}
              label="AI Suggest"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addCompetency}
              className="gap-1 h-7 text-xs"
            >
              <Plus className="size-3" /> Add Competency
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 w-full">
          {intentions.competencies.map((comp, idx) => (
            <div key={idx} className="flex items-center gap-2 w-full">
              <Input
                placeholder={`Competency ${idx + 1}`}
                value={comp}
                onChange={(e) => updateCompetency(idx, e.target.value)}
                className="flex-1"
              />
              {intentions.competencies.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => removeCompetency(idx)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Standards Side-by-Side on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="font-semibold">Content Standard</Label>

            <AIAssistButton
              field="content_standard"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange(
                  "intentions",
                  "content_standard",
                  cleanAIString(t),
                )
              }
            />
          </div>

          <textarea
            rows={4}
            placeholder="The learner demonstrates understanding of..."
            value={intentions.content_standard}
            onChange={(e) =>
              onNestedChange("intentions", "content_standard", e.target.value)
            }
            className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="font-semibold">Performance Standard</Label>

            <AIAssistButton
              field="performance_standard"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange(
                  "intentions",
                  "performance_standard",
                  cleanAIString(t),
                )
              }
            />
          </div>

          <textarea
            rows={4}
            placeholder="The learner is able to..."
            value={intentions.performance_standard}
            onChange={(e) =>
              onNestedChange(
                "intentions",
                "performance_standard",
                e.target.value,
              )
            }
            className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Learning Objectives */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="font-semibold">
            Learning Objectives <span className="text-destructive">*</span>
          </Label>

          <AIAssistButton
            field="objectives"
            {...aiCtx}
            onSuggestion={appendToObjectives}
          />
        </div>

        <textarea
          rows={4}
          placeholder="At the end of the lesson, students will be able to..."
          value={intentions.objectives}
          onChange={(e) =>
            onNestedChange("intentions", "objectives", e.target.value)
          }
          className={[
            "min-h-[120px] w-full resize-y border-2 bg-background px-3 py-2 text-sm shadow-none outline-none",
            errors["objectives"]
              ? "border-red-400 focus:border-red-400"
              : "border-black focus:border-black",
          ].join(" ")}
        />

        <FieldError msg={errors["objectives"]} />
      </div>

      {/* Learner Context */}
      <div className="flex flex-col gap-6 border-t-2 border-border pt-6">
        <div className="space-y-1">
          <Label className="text-lg font-bold">Learner Context</Label>

          <p className="text-sm text-muted-foreground">
            Write your observations of your learners, and how they have been
            performing or responding to learning experiences recently. Include
            strengths, interests, and possible barriers to learning.
          </p>
        </div>

        {/* Observation Checklist */}
        <div className="border-2 border-black bg-background p-5 shadow-none">
          <div className="border-b-2 border-border pb-3">
            <h3 className="text-base font-bold">Observation Checklist</h3>

            <p className="mt-1 text-sm text-muted-foreground">
              Tick what is true for most of your learners, then let AI compose
              the learner context, or write your own below.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-6">
            {OBSERVATION_CATEGORIES.map((cat) => (
              <div key={cat.title} className="space-y-3">
                <h4 className="text-sm font-bold uppercase tracking-wide">
                  {cat.title}
                </h4>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {cat.items.map((item) => {
                    const isChecked = currentChecklist.includes(item);

                    return (
                      <label
                        key={item}
                        className={[
                          "flex cursor-pointer items-start gap-3 border-2 p-3 text-sm transition-all",
                          isChecked
                            ? "border-black bg-primary/10"
                            : "border-black bg-background hover:bg-muted",
                        ].join(" ")}
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleChecklistItem(item)}
                          className="mt-0.5 shrink-0"
                        />

                        <span>{item}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Learner Context Narrative */}
        <div className="flex flex-col gap-2">
          <Label className="font-semibold">Learner Context Narrative</Label>

          <textarea
            rows={4}
            placeholder="Write here or let AI compose your observed learner context based on the checklist above..."
            value={currentText}
            onChange={(e) => setContextText(e.target.value)}
            className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
          />

          <div className="flex justify-start">
            <AIAssistButton
              field="learner_context"
              {...aiCtx}
              label="Compose with AI"
              onSuggestion={(t) => setContextText(cleanAIString(t))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
