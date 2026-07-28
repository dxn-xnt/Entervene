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

export const WaysForwardTab: React.FC<WaysForwardTabProps> = ({
  draft,
  onNestedChange,
}) => {
  const { ways_forward: wf } = draft;
  const aiCtx = {
    title: draft.title,
    learningArea: draft.learning_area,
    gradeSection: draft.grade_section,
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Section Header */}
      <div className="space-y-1 border-b-2 border-border pb-3">
        <h2 className="text-xl font-bold">Ways Forward</h2>

        <p className="text-sm text-muted-foreground">
          Plan how you will extend learning and reflect on the lesson's
          effectiveness.
        </p>
      </div>

      {/* Side-by-Side 2 Column Desktop Layout */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        {/* Extended Learning Opportunities */}
        <div className="flex h-full w-full flex-col gap-2 border-2 border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-b-2 border-border pb-2">
            <div>
              <Label className="font-bold">
                Extended Learning Opportunities
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Enrichment activities, remediation strategies, or homework.
              </p>
            </div>
            <AIAssistButton
              field="extended_opportunities"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange(
                  "ways_forward",
                  "extended_opportunities",
                  cleanAIString(t),
                )
              }
            />
          </div>
          <textarea
            rows={8}
            placeholder="Describe enrichment or remediation activities for learners who need more support or challenge…"
            value={wf.extended_opportunities}
            onChange={(e) =>
              onNestedChange(
                "ways_forward",
                "extended_opportunities",
                e.target.value,
              )
            }
            className="w-full flex-1 resize-none border-2 border-black bg-background px-3 py-2.5 text-sm shadow-none outline-none focus:border-black"
          />
        </div>

        {/* Teacher Reflections */}
        <div className="flex h-full w-full flex-col gap-2 border-2 border-black bg-white p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex w-full flex-wrap items-center justify-between gap-2 border-b-2 border-border pb-2">
            <div>
              <Label className="font-bold">Teacher Reflections</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Post-lesson notes on what worked, what to improve, and
                observations.
              </p>
            </div>
            <AIAssistButton
              field="reflections"
              {...aiCtx}
              onSuggestion={(t) =>
                onNestedChange("ways_forward", "reflections", cleanAIString(t))
              }
              label="AI Template"
            />
          </div>
          <textarea
            rows={8}
            placeholder="What went well? What would you do differently? What did you notice about student engagement and learning?…"
            value={wf.reflections}
            onChange={(e) =>
              onNestedChange("ways_forward", "reflections", e.target.value)
            }
            className="w-full flex-1 resize-none border-2 border-black bg-background px-3 py-2.5 text-sm shadow-none outline-none focus:border-black"
          />
        </div>
      </div>

      {/* Completion Banner */}
      <div className="flex w-full items-center gap-3.5 border-2 border-black bg-blue-50 p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex size-9 shrink-0 items-center justify-center border-2 border-black bg-blue-100 font-bold text-blue-600">
          <CheckCircle className="size-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-blue-950">
            You're on the final step!
          </h3>
          <p className="mt-0.5 text-xs text-blue-700">
            Review your entries above. When ready, use the action buttons at the
            bottom of the page to <strong>Save Draft</strong>,{" "}
            <strong>Submit &amp; Export PDF</strong>,{" "}
            <strong>Submit &amp; Export Word (.docx)</strong>, or{" "}
            <strong>Submit Only</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};
