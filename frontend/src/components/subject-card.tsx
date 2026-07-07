"use client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/retroui/Card";

type Badge = {
  label: string;
  count: number;
  icon?: string;
};

type SubjectCardProps = {
  title: string;
  teacher: string;
  badges: Badge[];
  onClick?: () => void;
  className?: string;
};

export function SubjectCard({
  title,
  teacher,
  badges,
  onClick,
  className,
}: SubjectCardProps) {
  return (
    <Card
      className={cn(
        "@container/card",
        onClick ? "cursor-pointer" : "",
        className,
      )}
      onClick={onClick}
    >
      <Card.Header>
        <Card.Title className="text-3xl font-semibold">{title}</Card.Title>
        <Card.Description>{teacher}</Card.Description>
      </Card.Header>
      <Card.Content>
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span
              key={badge.label}
              className="bg-yellow-400 rounded-full px-4 py-2 text-xs"
            >
              {badge.label} {badge.count}
            </span>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}
