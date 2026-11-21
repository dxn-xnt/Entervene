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
import { Button } from "@/components/retroui/Button";

export interface InterventionResourceRecipientSelectorProps {
  value: ResourceRecipientScope;
  onChange: (scope: ResourceRecipientScope) => void;
  scopes?: InterventionRecipientScopes | null;
  fallbackStudentName: string;
  fallbackClassName: string;
  fallbackSubjectName: string;
  disabled?: boolean;
  label?: string;
  selectedCount?: number;
  badge?: React.ReactNode;
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
  selectedCount,
  badge,
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
    context?: string;
    disabled?: boolean;
  }> = [
      {
        scope: "THIS_STUDENT",
        title: "Just This Student",
        context: studentName,
        description: "Private to this student. No one else can see it.",
        icon: User,
      },
      {
        scope: "ENTIRE_CLASS",
        title: "Entire Class",
        context: className,
        description: "Shared with enrolled students this term. No interventions are created for classmates.",
        countLabel:
          scopes?.entire_class != null
            ? pluralizeCount(scopes.entire_class.student_count, "student", "students")
            : undefined,
        disabled: scopes?.entire_class?.student_count === 0,
        icon: Users,
      },
      {
        scope: "ALL_SUBJECT_STUDENTS",
        title: "All My Students",
        context: subjectName,
        description: "Shared across all your sections of this subject this term. No interventions are created for other students.",
        countLabel:
          scopes?.all_subject_students != null
            ? `${pluralizeCount(scopes.all_subject_students.student_count, "student", "students")} · ${pluralizeCount(scopes.all_subject_students.section_count, "section", "sections")}`
            : undefined,
        disabled: scopes?.all_subject_students?.student_count === 0,
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {label}
          <span className="ml-1 text-red-500">*</span>
        </span>
        {badge ?? (selectedCount !== undefined && (
          <Badge variant="surface" size="sm">
            {selectedCount} selected
          </Badge>
        ))}
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-3 gap-2"
      >
        {options.map((option) => {
          const isSelected = value === option.scope;
          return (
            <div key={option.scope} className="flex flex-col gap-1.5">
              <Button
                key={option.scope}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={disabled || option.disabled}
                autoIcon={false}
                onClick={() => onChange(option.scope)}
                className={`flex w-full min-h-[5rem] items-start justify-between gap-2 shadow-none border-2 border-black p-3 text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${isSelected
                  ? "bg-primary text-black"
                  : "bg-white text-black hover:bg-accent"
                  }`}
              >
                <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                  <span className="font-bold text-sm sm:text-base leading-tight">
                    {option.title}
                  </span>
                  {option.countLabel && (
                    <Badge
                      variant={isSelected ? "solid" : "outline"}
                      size="sm"
                      className="w-fit"
                    >
                      {option.countLabel}
                    </Badge>
                  )}
                </div>
                <div
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2 border-black transition-colors ${isSelected
                    ? "bg-black text-white"
                    : "bg-white text-transparent"
                    }`}
                >
                  <Check className="size-3.5 stroke-[3]" />
                </div>
              </Button>
              <p
                className={`text-xs font-normal ${isSelected ? "text-foreground" : "text-muted-foreground"
                  }`}
              >
                {option.description}
              </p>
            </div>
          );
        })}
      </div>

      <Card className="mt-2 w-full rounded! border-2 border-border bg-muted/40 p-2.5 shadow-none!">
        <p className="text-sm font-semibold text-foreground">{summary}</p>
        {value !== "THIS_STUDENT" && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Classmates will only see this material in readings and activities.
          </p>
        )}
      </Card>
    </div>
  );
}
