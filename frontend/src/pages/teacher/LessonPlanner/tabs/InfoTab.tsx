import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
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
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      <FieldError msg={error} />
    </div>
  );
}

export const InfoTab: React.FC<InfoTabProps> = ({ draft, errors, onChange }) => {
  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Lesson Information</h2>
        <p className="text-sm text-muted-foreground">
          Fill in the basic details of the lesson plan.
        </p>
      </div>

      <div className="flex flex-col gap-5 w-full">
        {/* Lesson Title */}
        <FormField label="Lesson Title" required error={errors["title"]} className="w-full">
          <Input
            id="lesson-title"
            placeholder="e.g. Introduction to Photosynthesis"
            value={draft.title}
            onChange={(e) => onChange("title", e.target.value)}
            className={`w-full ${errors["title"] ? "border-red-400 focus-visible:ring-red-400" : ""}`}
          />
        </FormField>

        {/* Learning Area, Grade Section, Date, Sessions Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
          <FormField label="Learning Area / Subject" required error={errors["learning_area"]}>
            <Input
              id="learning-area"
              placeholder="e.g. Science, Mathematics"
              value={draft.learning_area}
              onChange={(e) => onChange("learning_area", e.target.value)}
              className={errors["learning_area"] ? "border-red-400 focus-visible:ring-red-400" : ""}
            />
          </FormField>

          <FormField label="Grade Level & Section" required error={errors["grade_section"]}>
            <Input
              id="grade-section"
              placeholder="e.g. Grade 7 - Rizal"
              value={draft.grade_section}
              onChange={(e) => onChange("grade_section", e.target.value)}
              className={errors["grade_section"] ? "border-red-400 focus-visible:ring-red-400" : ""}
            />
          </FormField>

          <FormField label="Date">
            <Input
              id="lesson-date"
              type="date"
              value={draft.date}
              onChange={(e) => onChange("date", e.target.value)}
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
            />
          </FormField>
        </div>

        {/* References and AI Declaration Side-by-Side on Desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 w-full">
          <FormField label="References / Materials">
            <textarea
              id="references"
              rows={4}
              placeholder="List your references, books, or online materials…"
              value={draft.references}
              onChange={(e) => onChange("references", e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[100px]"
            />
          </FormField>

          <FormField label="AI Use Declaration">
            <textarea
              id="ai-declaration"
              rows={4}
              placeholder="Declare if and how AI tools were used in the preparation of this lesson plan…"
              value={draft.ai_declaration}
              onChange={(e) => onChange("ai_declaration", e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[100px]"
            />
          </FormField>
        </div>
      </div>
    </div>
  );
};
