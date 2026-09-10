import React, { useState } from "react";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

export type AIAssistField =
  | "objectives"
  | "competencies"
  | "content_standard"
  | "performance_standard"
  | "learner_context"
  | "pre_lesson"
  | "flow_before"
  | "flow_during"
  | "flow_after"
  | "resources"
  | "integration"
  | "formative"
  | "evaluation_tasks"
  | "extended_opportunities"
  | "reflections";

interface AIAssistButtonProps {
  /** Which field to generate content for */
  field: AIAssistField;
  /** Current lesson context values */
  title: string;
  learningArea: string;
  gradeSection: string;
  /** Called with the AI suggestion text when generated */
  onSuggestion: (text: string) => void;
  /** Optional label override */
  label?: string;
  disabled?: boolean;
}

export const AIAssistButton: React.FC<AIAssistButtonProps> = ({
  field,
  title,
  learningArea,
  gradeSection,
  onSuggestion,
  label = "AI Suggest",
  disabled,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const handleClick = async () => {
    // Prerequisite check: Ensure Lesson Title and Learning Area are filled first
    if (!title.trim() || !learningArea.trim()) {
      const msg = "Please enter the Lesson Title and Learning Area in the Info tab first so AI Suggest has context.";
      setError(msg);
      toast.error(msg, { duration: 5000 });
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/v1/ai/lesson-plan-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          title: title.trim(),
          learning_area: learningArea.trim(),
          grade_section: gradeSection.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          res.status === 503
            ? "AI Assist is not configured. Please check your GROQ_API_KEY in backend/.env."
            : (data as { detail?: string }).detail ?? "AI suggestion failed. Please try again.";
        setError(msg);
        toast.error(msg);
        return;
      }

      const data = (await res.json()) as { suggestion: string };
      onSuggestion(data.suggestion);
    } catch {
      const msg = "Could not reach AI service. Check your connection.";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={isLoading || disabled}
        className={[
          "gap-1.5 h-7 text-xs border-violet-300 text-violet-700 hover:bg-violet-50 hover:border-violet-400",
          "transition-all duration-200",
          isLoading ? "opacity-70" : "",
        ].join(" ")}
      >
        {isLoading ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Sparkles className="size-3" />
        )}
        {isLoading ? "Generating…" : label}
      </Button>
      {error && (
        <p className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};
