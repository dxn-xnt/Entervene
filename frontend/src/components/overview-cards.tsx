"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";

type OverviewCardProps = {
  title: string;
  count: string;
  stat?: string;
  className?: string;
};

export function OverviewCard({ title, count, stat, className }: OverviewCardProps) {
  return (
    <Card className={cn("@container/card", className)}>
      <Card.Header>
        <Card.Description>{title}</Card.Description>
      </Card.Header>
      <Card.Content>
        <Card.Title className="text-4xl font-bold">{count}</Card.Title>
        {stat && (
          <p className="text-sm">
            <span className="font-semibold">+{stat}</span> increase from last month
          </p>
        )}
      </Card.Content>
    </Card>
  );
}