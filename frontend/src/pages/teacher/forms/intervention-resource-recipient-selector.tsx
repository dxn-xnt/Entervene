import { Check, Users, User, Layers } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import type {
  InterventionRecipientScopes,
  ResourceRecipientScope,
} from "@/lib/teacher-interventions-api";
import {
  formatRecipientScopeSummary,
  pluralizeCount,
} from "@/lib/intervention-resource-scope";

export interface InterventionResourceRecipientSelectorProps {
  value: ResourceRecipientScope;
  onChange: (scope: ResourceRecipientScope) => void;
  scopes?: InterventionRecipientScopes | null;
  fallbackStudentName: string;
  fallbackClassName: string;
  fallbackSubjectName: string;
  disabled?: boolean;
  label?: string;
}

export function InterventionResourceRecipientSelector({
  value,
  onChange,
  scopes,
  fallbackStudentName,
  fallbackClassName,
  fallbackSubjectName,
  disabled = false,
  label = "Assign resource to",
}: InterventionResourceRecipientSelectorProps) {
  const studentName = scopes?.this_student.student_name || fallbackStudentName;
  const className = scopes?.entire_class.class_name || fallbackClassName;
  const subjectName = scopes?.all_subject_students.subject_name || fallbackSubjectName;

  const options: Array<{
    scope: ResourceRecipientScope;
    title: string;
    description: string;
    countLabel?: string;
    icon: typeof User;
  }> = [
    {
      scope: "THIS_STUDENT",
      title: `This student — ${studentName} (Default)`,
      description: `Only ${studentName} can access this learning resource.`,
      countLabel: "1 student",
      icon: User,
    },
    {
      scope: "ENTIRE_CLASS",
      title: `Entire class — ${className}`,
      description: `Shares this reading with enrolled students in ${className} for this term without creating interventions for classmates.`,
      countLabel:
        scopes?.entire_class != null
          ? pluralizeCount(scopes.entire_class.student_count, "student", "students")
          : undefined,
      icon: Users,
    },
    {
      scope: "ALL_SUBJECT_STUDENTS",
      title: `All my students in this subject — ${subjectName}`,
      description: `Shares this reading across your assigned ${subjectName} sections for this term without creating interventions for other students.`,
      countLabel:
        scopes?.all_subject_students != null
          ? `${pluralizeCount(scopes.all_subject_students.student_count, "student", "students")} · ${pluralizeCount(scopes.all_subject_students.section_count, "section", "sections")}`
          : undefined,
      icon: Layers,
    },
  ];

  const summary = formatRecipientScopeSummary(
    value,
    scopes,
    fallbackStudentName,
    fallbackClassName,
    fallbackSubjectName,
  );

  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-sm font-medium text-foreground">
        {label}
        <span className="ml-1 text-red-500">*</span>
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-col gap-2"
      >
        {options.map((option) => {
          const isSelected = value === option.scope;
          const Icon = option.icon;
          return (
            <button
              key={option.scope}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onChange(option.scope)}
              className={`flex w-full items-start justify-between gap-3 rounded! border-2 border-black p-3 text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? "bg-primary text-black"
                  : "bg-white text-black hover:bg-accent"
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <Icon className="size-4 mt-1 shrink-0" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm sm:text-base">
                      {option.title}
                    </span>
                    {option.countLabel && (
                      <Badge
                        variant={isSelected ? "solid" : "outline"}
                        size="sm"
                      >
                        {option.countLabel}
                      </Badge>
                    )}
                  </div>
                  <p
                    className={`text-xs font-normal ${
                      isSelected ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {option.description}
                  </p>
                </div>
              </div>
              <div
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2 border-black transition-colors ${
                  isSelected
                    ? "bg-black text-white"
                    : "bg-white text-transparent"
                }`}
              >
                <Check className="size-3.5 stroke-[3]" />
              </div>
            </button>
          );
        })}
      </div>

      <Card className="mt-2 w-full rounded! border-2 border-border bg-muted/40 p-2.5 shadow-none!">
        <p className="text-sm font-semibold text-foreground">{summary}</p>
        {value !== "THIS_STUDENT" && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Only the learning resource is shared. Other students will not receive an intervention record or diagnosis.
          </p>
        )}
      </Card>
    </div>
  );
}
