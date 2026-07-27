import React from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import type { LessonPlanDraft, ValidationErrors } from "../useLessonPlanner";
import { AIAssistButton } from "../components/AIAssistButton";

interface IntentionsTabProps {
  draft: LessonPlanDraft;
  errors: ValidationErrors;
  onNestedChange: (
    section: "intentions",
    key: keyof LessonPlanDraft["intentions"],
    value: unknown
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

export const IntentionsTab: React.FC<IntentionsTabProps> = ({ draft, errors, onNestedChange }) => {
  const { intentions } = draft;
  const aiCtx = { title: draft.title, learningArea: draft.learning_area, gradeSection: draft.grade_section };

  const currentChecklist = Array.isArray(intentions.context?.checklist)
    ? intentions.context.checklist
    : [];
  const currentText = typeof intentions.context?.text === "string" ? intentions.context.text : "";

  const addCompetency = () => {
    onNestedChange("intentions", "competencies", [...intentions.competencies, ""]);
  };

  const updateCompetency = (idx: number, value: string) => {
    const updated = [...intentions.competencies];
    updated[idx] = value;
    onNestedChange("intentions", "competencies", updated);
  };

  const removeCompetency = (idx: number) => {
    const updated = intentions.competencies.filter((_, i) => i !== idx);
    onNestedChange("intentions", "competencies", updated.length ? updated : [""]);
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
      .filter((l) => l && !/^(here (is|are)|below|sure|note:|disclaimer:)/i.test(l))
      .join("\n");

    onNestedChange("intentions", "objectives", intentions.objectives ? `${intentions.objectives}\n\n${cleaned}` : cleaned);
  };

  const appendCompetenciesFromAI = (text: string) => {
    const lines = text
      .split("\n")
      .map(cleanAIString)
      .filter((l) => {
        if (!l) return false;
        if (/^(here (is|are|are the)|below (is|are)|sure|note:|disclaimer:|esc refers to|shs refers to|flow|introduction|development|deepening|integration)/i.test(l)) return false;
        return true;
      });

    const existing = intentions.competencies.filter((c) => c.trim());
    onNestedChange("intentions", "competencies", lines.length ? [...existing, ...lines] : existing);
  };

  return (
    <div className="flex flex-col gap-8 w-full">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Intentions (I)</h2>
        <p className="text-sm text-muted-foreground">
          Define what students will learn and what you know about them.
        </p>
      </div>

      {/* Learning Competencies */}
      <div className="flex flex-col gap-3 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2 w-full">
          <Label className="text-sm font-semibold text-gray-700">Learning Competencies</Label>
          <div className="flex items-center gap-2">
            <AIAssistButton field="competencies" {...aiCtx} onSuggestion={appendCompetenciesFromAI} label="AI Suggest" />
            <Button type="button" variant="outline" size="sm" onClick={addCompetency} className="gap-1 h-7 text-xs">
              <Plus className="size-3" /> Add Competency
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2 w-full">
          {intentions.competencies.map((comp, idx) => (
            <div key={idx} className="flex items-center gap-2 w-full">
              <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{idx + 1}.</span>
              <input
                type="text"
                placeholder={`Competency ${idx + 1}`}
                value={comp}
                onChange={(e) => updateCompetency(idx, e.target.value)}
                className="flex-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="flex flex-col gap-1.5 w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full">
            <Label className="text-sm font-medium text-gray-700">Content Standard</Label>
            <AIAssistButton
              field="content_standard"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("intentions", "content_standard", cleanAIString(t))}
            />
          </div>
          <textarea
            rows={4}
            placeholder="The learner demonstrates understanding of…"
            value={intentions.content_standard}
            onChange={(e) => onNestedChange("intentions", "content_standard", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[90px]"
          />
        </div>
        <div className="flex flex-col gap-1.5 w-full">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full">
            <Label className="text-sm font-medium text-gray-700">Performance Standard</Label>
            <AIAssistButton
              field="performance_standard"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("intentions", "performance_standard", cleanAIString(t))}
            />
          </div>
          <textarea
            rows={4}
            placeholder="The learner is able to…"
            value={intentions.performance_standard}
            onChange={(e) => onNestedChange("intentions", "performance_standard", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[90px]"
          />
        </div>
      </div>

      {/* Learning Objectives */}
      <div className="flex flex-col gap-1.5 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2 w-full">
          <Label className="text-sm font-semibold text-gray-700">
            Learning Objectives <span className="text-red-500">*</span>
          </Label>
          <AIAssistButton field="objectives" {...aiCtx} onSuggestion={appendToObjectives} />
        </div>
        <textarea
          rows={4}
          placeholder="At the end of the lesson, students will be able to…"
          value={intentions.objectives}
          onChange={(e) => onNestedChange("intentions", "objectives", e.target.value)}
          className={[
            "w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[100px]",
            errors["objectives"] ? "border-red-400 focus-visible:ring-red-400" : "border-input",
          ].join(" ")}
        />
        <FieldError msg={errors["objectives"]} />
      </div>

      {/* Learner Context Section matching the DepEd sample app */}
      <div className="flex flex-col gap-4 w-full">
        <div>
          <Label className="text-base font-bold text-gray-900">Learner Context</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Write your observations of your learners, and how they have been performing or responding to learning experiences recently. Include strengths, interests, and possible barriers to learning.
          </p>
        </div>

        {/* Observation Checklist Box */}
        <div className="rounded-xl border border-teal-200 bg-teal-50/20 p-5 flex flex-col gap-5 w-full">
          <div className="border-b border-teal-100 pb-2">
            <h3 className="text-sm font-bold text-teal-950">
              Observation checklist — tick what is true for most of your learners, then let AI compose it (or write freely below)
            </h3>
          </div>

          <div className="flex flex-col gap-6 w-full">
            {OBSERVATION_CATEGORIES.map((cat) => (
              <div key={cat.title} className="flex flex-col gap-2.5 w-full">
                <h4 className={cat.color}>{cat.title}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 w-full">
                  {cat.items.map((item) => {
                    const isChecked = currentChecklist.includes(item);
                    return (
                      <label
                        key={item}
                        className={[
                          "flex items-start gap-2.5 p-2.5 rounded-lg border transition-all cursor-pointer select-none text-xs leading-tight",
                          isChecked
                            ? "bg-teal-50 border-teal-400 text-teal-950 font-medium shadow-2xs"
                            : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50/50",
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

        {/* Composed Narrative Textarea + AI Action Button */}
        <div className="flex flex-col gap-2 w-full">
          <textarea
            rows={4}
            placeholder="Write here or let AI compose your observed learner context based on the checklist above..."
            value={currentText}
            onChange={(e) => setContextText(e.target.value)}
            className="w-full rounded-xl border border-teal-200 bg-white px-3.5 py-3 text-sm shadow-2xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 resize-y min-h-[100px]"
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
