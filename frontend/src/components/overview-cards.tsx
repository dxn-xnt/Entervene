"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";

type OverviewCardProps = {
  title: string;
  count: string;
  stat?: string;
  statDescription?: string;
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
  className,
}: OverviewCardProps) {
  const description = statDescription ?? descriptionFor(title);

  return (
    <Card className={cn("@container/card", className)}>
      <Card.Header>
        <Card.Description className="font-semibold">{title}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Card.Title className="text-4xl font-bold">{count}</Card.Title>
        {(stat || description) && (
          <p className="text-sm text-muted-foreground">
            {stat && <span className="font-semibold text-foreground">{stat} </span>}
            {description}
          </p>
        )}
      </Card.Content>
    </Card>
  );
}
