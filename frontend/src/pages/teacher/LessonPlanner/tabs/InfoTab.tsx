import React from "react";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { cn } from "@/lib/utils";
import type { LessonPlanDraft, ValidationErrors } from "../useLessonPlanner";
import { AlertCircle } from "lucide-react";

interface InfoTabProps {
  draft: LessonPlanDraft;
  errors: ValidationErrors;
  onChange: (key: keyof LessonPlanDraft, value: string) => void;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;

  return (
    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-destructive">
      <AlertCircle className="size-3" />
      {msg}
    </p>
  );
}

function FormField({
  label,
  required,
  error,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="font-semibold">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>

      {children}

      <FieldError msg={error} />
    </div>
  );
}

export const InfoTab: React.FC<InfoTabProps> = ({
  draft,
  errors,
  onChange,
}) => {
  return (
    <div className="flex w-full flex-col gap-6">
      {/* Section Header */}
      <div className="space-y-1 border-b-2 border-border pb-3">
        <h2 className="text-xl font-bold">Lesson Information</h2>

        <p className="text-sm text-muted-foreground">
          Fill in the basic details of the lesson plan.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Lesson Title */}
        <FormField label="Lesson Title" required error={errors.title}>
          <Input
            id="lesson-title"
            placeholder="e.g. Introduction to Photosynthesis"
            value={draft.title}
            onChange={(e) => onChange("title", e.target.value)}
            className={cn(
              "border-black shadow-none",
              errors.title && "border-red-500",
            )}
          />
        </FormField>

        {/* Main Fields */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <FormField
            label="Learning Area / Subject"
            required
            error={errors.learning_area}
          >
            <Input
              id="learning-area"
              placeholder="e.g. Science, Mathematics"
              value={draft.learning_area}
              onChange={(e) => onChange("learning_area", e.target.value)}
              className={cn(
                "border-black shadow-none",
                errors.learning_area && "border-red-500",
              )}
            />
          </FormField>

          <FormField
            label="Grade Level & Section"
            required
            error={errors.grade_section}
          >
            <Input
              id="grade-section"
              placeholder="e.g. Grade 7 - Rizal"
              value={draft.grade_section}
              onChange={(e) => onChange("grade_section", e.target.value)}
              className={cn(
                "border-black shadow-none",
                errors.grade_section && "border-red-500",
              )}
            />
          </FormField>

          <FormField label="Date">
            <Input
              id="lesson-date"
              type="date"
              value={draft.date}
              onChange={(e) => onChange("date", e.target.value)}
              className="border-black shadow-none"
            />
          </FormField>

          <FormField label="Number of Sessions">
            <Input
              id="sessions"
              type="number"
              min={1}
              placeholder="e.g. 2"
              value={draft.sessions}
              onChange={(e) => onChange("sessions", e.target.value)}
              className="border-black shadow-none"
            />
          </FormField>
        </div>

        {/* Divider */}
        <div className="border-t-2 border-border pt-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FormField label="References / Materials">
              <textarea
                id="references"
                rows={4}
                placeholder="List your references, books, or online materials..."
                value={draft.references}
                onChange={(e) => onChange("references", e.target.value)}
                className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
              />
            </FormField>

            <FormField label="AI Use Declaration">
              <textarea
                id="ai-declaration"
                rows={4}
                placeholder="Declare if and how AI tools were used in preparing this lesson plan..."
                value={draft.ai_declaration}
                onChange={(e) => onChange("ai_declaration", e.target.value)}
                className="min-h-[120px] w-full resize-y border-2 border-black bg-background px-3 py-2 text-sm shadow-none outline-none focus:border-black"
              />
            </FormField>
          </div>
        </div>
      </div>
    </div>
  );
};
