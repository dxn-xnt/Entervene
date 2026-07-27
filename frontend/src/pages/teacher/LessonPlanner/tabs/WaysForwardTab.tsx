import React from "react";
import { Label } from "@/components/ui/label";
import type { LessonPlanDraft } from "../useLessonPlanner";
import { AIAssistButton } from "../components/AIAssistButton";
import { CheckCircle } from "lucide-react";

interface WaysForwardTabProps {
  draft: LessonPlanDraft;
  onNestedChange: (
    section: "ways_forward",
    key: keyof LessonPlanDraft["ways_forward"],
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

export const WaysForwardTab: React.FC<WaysForwardTabProps> = ({
  draft,
  onNestedChange,
}) => {
  const { ways_forward: wf } = draft;
  const aiCtx = { title: draft.title, learningArea: draft.learning_area, gradeSection: draft.grade_section };

  return (
    <div className="flex flex-col gap-8 w-full">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Ways Forward (W)</h2>
        <p className="text-sm text-muted-foreground">
          Plan how you will extend learning and reflect on the lesson's effectiveness.
        </p>
      </div>

      {/* Side-by-Side 2 Column Desktop Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full items-start">
        {/* Extended Learning Opportunities */}
        <div className="flex flex-col gap-2 w-full border rounded-xl p-5 bg-white shadow-2xs">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full pb-2 border-b">
            <div>
              <Label className="text-sm font-semibold text-gray-800">Extended Learning Opportunities</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enrichment activities, remediation strategies, or homework.
              </p>
            </div>
            <AIAssistButton
              field="extended_opportunities"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("ways_forward", "extended_opportunities", cleanAIString(t))}
            />
          </div>
          <textarea
            rows={8}
            placeholder="Describe enrichment or remediation activities for learners who need more support or challenge…"
            value={wf.extended_opportunities}
            onChange={(e) => onNestedChange("ways_forward", "extended_opportunities", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[180px]"
          />
        </div>

        {/* Teacher Reflections */}
        <div className="flex flex-col gap-2 w-full border rounded-xl p-5 bg-white shadow-2xs">
          <div className="flex items-center justify-between flex-wrap gap-2 w-full pb-2 border-b">
            <div>
              <Label className="text-sm font-semibold text-gray-800">Teacher Reflections</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Post-lesson notes on what worked, what to improve, and observations.
              </p>
            </div>
            <AIAssistButton
              field="reflections"
              {...aiCtx}
              onSuggestion={(t) => onNestedChange("ways_forward", "reflections", cleanAIString(t))}
              label="AI Template"
            />
          </div>
          <textarea
            rows={8}
            placeholder="What went well? What would you do differently? What did you notice about student engagement and learning?…"
            value={wf.reflections}
            onChange={(e) => onNestedChange("ways_forward", "reflections", e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[180px]"
          />
        </div>
      </div>

      {/* Completion Banner */}
      <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50/50 p-5 flex items-center gap-3.5 w-full">
        <div className="size-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 text-blue-600 font-bold">
          <CheckCircle className="size-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-blue-950">You're on the final step!</h3>
          <p className="text-xs text-blue-700 mt-0.5">
            Review your entries above. When ready, use the action buttons at the bottom of the page to <strong>Save Draft</strong>, <strong>Submit &amp; Export PDF</strong>, <strong>Submit &amp; Export Word (.docx)</strong>, or <strong>Submit Only</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};
