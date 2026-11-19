import { useEffect, useRef, useState, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { rubricPointRange, scoreBand } from "@/lib/classwork-utils";
import { cn } from "@/lib/utils";
import type { ActivityRubricLevel } from "@/types/classwork";

interface RubricsScoreBoardProps {
  totalPoints?: number | null;
  title?: string;
  className?: string;
  gridClassName?: string;
  selectedScore?: number | null;
  onSelectScore?: (points: number) => void;
  rightSlot?: ReactNode;
  rubricLevels?: ActivityRubricLevel[];
  editable?: boolean;
  onTotalPointsChange?: (points: number) => void;
  disabled?: boolean;
  disabledReason?: string;
  disabledReasonId?: string;
}

function EditableScoreBadge({
  totalPoints,
  onTotalPointsChange,
  disabled,
  disabledReason,
  disabledReasonId,
}: {
  totalPoints?: number | null;
  onTotalPointsChange: (points: number) => void;
  disabled?: boolean;
  disabledReason?: string;
  disabledReasonId?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => String(totalPoints ?? 0));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commit = () => {
    const next = Number(draft);
    if (draft === "" || !Number.isFinite(next) || next <= 0) {
      setDraft(String(totalPoints ?? 0));
    } else if (next !== totalPoints) {
      onTotalPointsChange(next);
    }
    setIsEditing(false);
  };

  if (isEditing && !disabled) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="number"
          aria-label="Maximum score"
          min="1"
          step="1"
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            const nextDraft = e.target.value;
            setDraft(nextDraft);
            const next = Number(nextDraft);
            if (nextDraft !== "" && Number.isFinite(next) && next > 0) {
              onTotalPointsChange(next);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(String(totalPoints ?? 0));
              setIsEditing(false);
            }
          }}
          onBlur={commit}
          className="h-8 w-20 px-2 py-0.5 text-xs font-bold text-center border-2 border-black rounded! bg-primary text-foreground focus:outline-none focus:ring-1 focus:ring-black"
        />
        <span className="text-xs font-bold text-foreground">pts</span>
      </div>
    );
  }

  if (disabled) {
    return (
      <Badge
        variant="solid"
        className="outline-2 rounded! h-fit font-semibold px-2.5 py-1 text-xs select-none opacity-80"
        aria-describedby={disabledReasonId}
        title={disabledReason || "Score locked"}
      >
        {totalPoints ?? 0} pts
      </Badge>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="outline-2 bg-primary text-foreground inline-flex items-center rounded! h-fit font-semibold px-2.5 py-1 text-xs select-none transition-all cursor-pointer hover:opacity-90 hover:-translate-y-0.5"
      aria-label="Maximum score"
      title="Click to edit maximum score"
    >
      {totalPoints ?? 0} pts
    </button>
  );
}

export default function RubricsScoreBoard({
  totalPoints = 0,
  title = "Scoring Rubric",
  className = "",
  gridClassName = "",
  selectedScore = null,
  onSelectScore,
  rightSlot,
  rubricLevels,
  editable = false,
  onTotalPointsChange,
  disabled = false,
  disabledReason,
  disabledReasonId,
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
    <Card className={cn("@container block shadow-none border-2 border-black", className)}>
      <Card.Content className="space-y-3">
        <div className="flex items-center justify-between">
          <Card.Title className="mb-0 text-xl">{title}</Card.Title>

          {rightSlot ? (
            rightSlot
          ) : editable && onTotalPointsChange ? (
            <EditableScoreBadge
              key={totalPoints ?? 0}
              totalPoints={totalPoints}
              onTotalPointsChange={onTotalPointsChange}
              disabled={disabled}
              disabledReason={disabledReason}
              disabledReasonId={disabledReasonId}
            />
          ) : (
            <Badge variant="secondary" size="sm" className="py-1">
              {totalPoints ?? 0} pts
            </Badge>
          )}
        </div>

        {disabled && disabledReason && (
          <div
            id={disabledReasonId}
            role="status"
            className="flex items-start gap-2 rounded border border-border bg-muted/50 px-3 py-2 text-foreground"
          >
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs font-semibold">Rubric editing locked</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{disabledReason}</p>
            </div>
          </div>
        )}

        <div className={cn("flex flex-wrap gap-3", gridClassName)}>
          {bands.map(({ label, points, description }) => {
            const ptsNum = Number(points.replace(" pts", ""));
            const isSelected =
              selectedScore !== null &&
              selectedScore !== undefined &&
              !isNaN(selectedScore) &&
              selectedScore === ptsNum;

            return (
              <div
                key={label}
                onClick={() => onSelectScore?.(ptsNum)}
                className={`flex min-w-0 flex-1 basis-56 flex-col justify-between rounded! border-2 border-black p-3.5 shadow-none transition-all hover:-translate-y-1 ${onSelectScore ? "cursor-pointer" : ""
                  } ${isSelected
                    ? "bg-primary text-foreground"
                    : "bg-white text-foreground hover:bg-retro"
                  }`}
                title={onSelectScore ? `Click to set score to ${points}` : undefined}
              >
                <div>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="font-bold">{label}</p>
                    <p className="text-sm font-bold whitespace-nowrap">
                      {rubricPointRange(ptsNum, bands.map((band) => Number(band.points.replace(" pts", ""))))} pts
                    </p>
                  </div>
                  <p
                    className={`text-sm ${isSelected ? "text-foreground" : "text-muted-foreground"
                      }`}
                  >
                    {description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </Card.Content>
    </Card>
  );
}
