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
  teacher?: string;
  badges?: BadgeItem[];
  pendingCount?: number;
  completionRate?: number;
  latestActivityTitle?: string;
  latestActivityDue?: string;
  onClick?: () => void;
  className?: string;
};

export function SubjectCard({
  title,
  teacher,
  badges,
  pendingCount,
  completionRate = 0,
  latestActivityTitle,
  latestActivityDue,
  onClick,
  className,
}: SubjectCardProps) {
  const hasPending = (pendingCount ?? 0) > 0;
  const noClasswork = !latestActivityTitle && !hasPending;

  return (
    <Card
      className={`group relative flex min-w-0 flex-col justify-between p-3.5 shadow-none hover:-translate-y-1 cursor-pointer transition-all border-black bg-white ${className || ""}`}
      onClick={onClick}
    >
      <div className="flex flex-col items-start justify-between gap-2.5">
        <div className="flex w-full min-w-0 flex-col justify-between gap-2 -mb-2 sm:flex-row item-center sm:items-start">
          <p className="min-w-0 break-words text-xl font-bold sm:text-2xl">
            {title}
          </p>
          {pendingCount !== undefined && (
            <Badge size="sm" variant={hasPending ? "surface" : "secondary"} className="shrink-0">
              {pendingCount} {pendingCount === 1 ? "Pending Classwork" : "Pending Classworks"}
            </Badge>
          )}
        </div>
        {/* <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:-mt-1">
          {teacher !== "" && (
            <p className="min-w-0 break-words text-sm font-semibold text-gray-700">
              {teacher}
            </p>
          )}
        </div> */}
        <div className="flex flex-col w-full gap-1">
          <p className="text-xs font-normal text-muted-foreground">Completion</p>
          <div className="flex flex-row items-center gap-2">
            <Progress className="w-full" value={completionRate} />
            <p className="text-xs font-bold shrink-0">{completionRate}%</p>
          </div>
        </div>
        <div className="flex flex-col w-full gap-1 mt-1">
          {noClasswork ? (
            <Card className="bg-primary w-full shadow-none py-2 px-3">
              <div className="flex flex-col w-full gap-2 items-center text-center justify-center">
                <div className="flex flex-row justify-between w-full text-center items-center justify-center">
                  <p className="text-center text-xs text-foreground font-normal">
                    Classworks Completed On-Time
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="bg-primary w-full shadow-none py-2 px-3 hover:-translate-y-0.5 hover:shadow-none transition-all">
              <div className="flex flex-col w-full gap-1.5">
                <div className="flex flex-row justify-between items-center">
                  <p className="text-sm font-semibold truncate">{latestActivityTitle || `${pendingCount} Ongoing Tasks`}</p>
                  <Button
                    variant="secondary"
                    className="shadow-none p-1 shrink-0"
                    size="sm"
                  >
                    <ArrowUpRight className="size-3" />
                  </Button>
                </div>
                <div className="flex flex-row gap-1.5 items-center flex-wrap">

                  {latestActivityDue && (
                    <Badge size="sm" variant="solid">
                      {latestActivityDue}
                    </Badge>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </Card>
  );
}
