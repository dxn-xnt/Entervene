"use client";

import { Progress } from "@/components/retroui/Progress";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { ArrowUpRight } from "lucide-react";

type BadgeItem = {
  label: string;
  count?: number;
  icon?: string;
  variant?: "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
};

type SubjectCardProps = {
  title: string;
  teacher: string;
  badges: BadgeItem[];
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
  const noClasswork = true;

  return (
    <Card
      className={`group relative flex min-w-0 flex-col justify-between p-3 shadow-none hover:-translate-y-1 cursor-pointer ${className || ""}`}
      onClick={onClick}
    >
      <div className="flex flex-col items-start justify-between gap-2">
        <div className="flex w-full min-w-0 flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <p className="min-w-0 break-words text-xl font-bold sm:text-2xl">
            {title}
          </p>
          <Badge size="sm" variant="surface" className="shrink-0">
            2 Pending Classworks
          </Badge>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:-mt-2">
          <p className="min-w-0 break-words text-sm font-semibold">
            {teacher}
          </p>
          {badges?.map((b, idx) => (
            <Badge key={idx} size="sm" variant={b.variant || "secondary"}>
              {b.label}
            </Badge>
          ))}
        </div>
        <div className="flex flex-col w-full gap-1">
          <p className="text-xs font-normal">Completion</p>
          <div className="flex flex-row gap-1">
            <Progress className="w-full" value={12} />
            <p className="text-xs font-bold">12%</p>
          </div>
        </div>
        <div className="flex flex-col w-full gap-1 mt-1">

          {noClasswork === true ? (
            <Card className="bg-background w-full shadow-xs py-2 px-3">
              <div className="flex flex-col w-full gap-2 items-center text-center justify-center">
                <div className="flex flex-row justify-between w-full text-center items-center justify-center">
                  <p className="text-center text-sm text-muted-foreground font-normal">Classworks Completed On-Time</p>
                </div>

              </div>
            </Card>
          ) : (
            <Card className="bg-primary w-full shadow-xs py-2 px-3 hover:-translate-y-1 hover:shadow-none transition-all">
              <div className="flex flex-col w-full gap-2">
                <div className="flex flex-row justify-between ">
                  <p className="text-md font-semibold">Assignments 2</p>
                  <Button
                    variant="secondary"
                    className="shadow-none p-1"
                    size="sm">
                    <ArrowUpRight className="size-3" />
                  </Button>
                </div>
                <div className="flex flex-row gap-2 items-center">
                  <Badge size="sm" variant="outline">
                    Ongoing
                  </Badge>
                  <Badge size="sm" variant="solid">
                    Due in 2 days
                  </Badge>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Card>
  );
}
