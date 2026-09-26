"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";

type OverviewCardProps = {
  title: string;
  count: string;
  stat?: string;
  statDescription?: string;
  trend?: "up" | "down";
  progressValue?: number;
  className?: string;
};

const metricDescriptions: Record<string, string> = {
  "total students": "Students included in this view",
  students: "Students included in this view",
  male: "Male students in this roster",
  female: "Female students in this roster",
  "male students": "Male students in this roster",
  "female students": "Female students in this roster",
  "total subjects": "Subjects included in this view",
  "active subjects": "Subjects currently marked active",
  "archived subjects": "Subjects currently archived",
  "subject groups": "Distinct subject groups represented",
  subjects: "Subjects included in this view",
  "total classes": "Classes included in this view",
  "active classes": "Classes currently marked active",
  "archived classes": "Classes currently archived",
  "students assigned": "Students assigned across these classes",
  classes: "Classes included in this view",
  "active substitutions": "Substitute assignments currently active",
  "completed handbacks": "Substitute assignments already handed back",
  "total tracked": "Substitute assignments in this view",
  "active interventions": "Intervention plans currently active",
  "high/urgent priority": "Plans marked high or urgent priority",
  "urgent / high priority": "Tasks recommended for early attention",
  "completed remediations": "Intervention plans marked completed",
  "ai scored predictions": "Predictions linked to an AI score",
  "active study tasks": "Study tasks still requiring action",
  "completed tasks": "Study tasks marked completed",
  present: "Students recorded present",
  absent: "Students recorded absent",
  late: "Students recorded late",
  excused: "Students with excused absences",
  "daily rate": "Present attendance in the current summary",
  "total lessons": "Lessons recorded for this subject",
  "classwork assigned": "Active classwork in this subject",
  "lesson mastery": "Average graded classwork performance",
  "completion percentage": "Share of assigned work completed",
  "class accuracy": "Average correct-answer rate",
  participation: "Students who submitted this quiz",
  questions: "Questions included in this quiz",
  "fully finalized": "Students with all grades finalized",
  "avg. class score": "Average recorded score for this class",
  "at-risk students": "Students currently flagged for support",
  "total hours": "Recorded hours across these subjects",
  active: "Records currently marked active",
  pending: "Records currently awaiting action",
  unassigned: "Records without a current assignment",
};

function descriptionFor(title: string) {
  return metricDescriptions[title.trim().toLocaleLowerCase()] ?? "Current summary for this view";
}

export function OverviewCard({
  title,
  count,
  stat,
  statDescription,
  trend,
  progressValue,
  className,
}: OverviewCardProps) {
  const description = statDescription ?? descriptionFor(title);

  const isPositive = trend === "up" || (stat && stat.includes("▲"));
  const isNegative = trend === "down" || (stat && stat.includes("▼"));

  return (
    <Card className={cn("@container/card transition-all duration-200", className)}>
      <Card.Header className="">
        <Card.Description className="text-xl font-bold text-foreground/90">{title}</Card.Description>
      </Card.Header>
      <Card.Content className="space-y-1.5">
        <Card.Title className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">{count}</Card.Title>
        {(stat || description) && (
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {stat && (
              <span
                className={cn(
                  "font-medium",
                  isPositive && "text-emerald-400 font-semibold",
                  isNegative && "text-rose-400 font-semibold",
                  !isPositive && !isNegative && "text-foreground font-semibold"
                )}
              >
                {stat}{" "}
              </span>
            )}
            {description}
          </p>
        )}
        {typeof progressValue === "number" && (
          <div className="pt-2">
            <div className="h-1.5 sm:h-2 w-full bg-muted/60 rounded-full overflow-hidden border border-border/40">
              <div
                className="h-full bg-amber-400 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progressValue))}%` }}
              />
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
