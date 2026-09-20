import type { ReactNode } from "react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { scoreBand } from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

interface RubricsScoreBoardProps {
  totalPoints?: number | null;
  title?: string;
  className?: string;
  selectedScore?: number | null;
  onSelectScore?: (points: number) => void;
  rightSlot?: ReactNode;
  rubricLevels?: ActivityRubricLevel[];
}

export default function RubricsScoreBoard({
  totalPoints = 0,
  title = "Scoring Rubric",
  className = "",
  selectedScore = null,
  onSelectScore,
  rightSlot,
  rubricLevels,
}: RubricsScoreBoardProps) {
  const fallbackBands = [
    {
      label: "Excellent",
      points: scoreBand(totalPoints, 1),
      description: "Displays all required components clearly and accurately.",
    },
    {
      label: "Good",
      points: scoreBand(totalPoints, 0.8),
      description: "Most components are present with minor errors.",
    },
    {
      label: "Fair",
      points: scoreBand(totalPoints, 0.6),
      description: "Some required parts are missing or unclear.",
    },
    {
      label: "Needs Improvement",
      points: scoreBand(totalPoints, 0.4),
      description: "Many required elements are missing.",
    },
    {
      label: "Poor",
      points: scoreBand(totalPoints, 0.2),
      description: "Work is incomplete or not submitted.",
    },
  ];
  const bands = rubricLevels?.length
    ? [...rubricLevels]
        .sort((a, b) => b.points - a.points)
        .map((level) => ({ label: level.level_name, points: `${level.points} pts`, description: level.description }))
    : fallbackBands;

  return (
    <Card className={`block ${className} shadow-none`}>
      <Card.Content className="space-y-3">
        <div className="flex items-center justify-between">
          <Card.Title className="mb-0 text-xl">{title}</Card.Title>

          {rightSlot ? (
            rightSlot
          ) : (
            <Badge variant="secondary" size="sm">
              Total: {totalPoints ?? 0} pts
            </Badge>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {bands.map(({ label, points, description }) => {
            const ptsNum = Number(points.replace(" pts", ""));
            const isSelected =
              selectedScore !== null &&
              selectedScore !== undefined &&
              !isNaN(selectedScore) &&
              selectedScore === ptsNum;

            return (
              <Card
                key={label}
                onClick={() => onSelectScore?.(ptsNum)}
                className={`shadow-none transition-all ${onSelectScore ? "cursor-pointer" : ""
                  } ${isSelected
                    ? "!bg-primary !text-foreground"
                    : "hover:bg-accent"
                  }`}
                title={onSelectScore ? `Click to set score to ${points}` : undefined}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-bold">{label}</p>
                  <p className="text-sm font-bold">{points}</p>
                </div>
                <p className={`text-xs
                  ${isSelected
                    ? " text-foreground"
                    : "text-muted-foreground"
                  }`}>{description}</p>
              </Card>
            );
          })}
        </div>
      </Card.Content>
    </Card>
  );
}
