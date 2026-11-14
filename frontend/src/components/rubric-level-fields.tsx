import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  activityRubricMaximum,
  validateActivityRubric,
} from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

export type RubricLevelFieldsProps = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
};

type RangeBoundaryFieldsProps = {
  levelLabel: string;
  minimum: number;
  maximum: number;
  minimumAllowed: number;
  step: number;
  disabled?: boolean;
  onMinimumChange?: (minimum: number) => void;
};

function RangeBoundaryFields({
  levelLabel,
  minimum,
  maximum,
  minimumAllowed,
  step,
  disabled,
  onMinimumChange,
}: RangeBoundaryFieldsProps) {
  const [minimumDraft, setMinimumDraft] = useState(() => String(minimum));

  useEffect(() => {
    setMinimumDraft(String(minimum));
  }, [minimum]);

  const enteredMinimum = Number(minimumDraft);
  const minimumIsInvalid =
    Boolean(onMinimumChange) &&
    minimumDraft !== "" &&
    (!Number.isFinite(enteredMinimum) ||
      enteredMinimum < minimumAllowed ||
      enteredMinimum > maximum);

  return (
    <fieldset className="min-w-48 text-xs font-medium">
      <legend>Score range</legend>
      <div className="mt-1 flex items-center gap-1.5">
        {onMinimumChange ? (
          <Input
            aria-label={`${levelLabel} minimum score`}
            type="number"
            min={minimumAllowed}
            max={maximum}
            step={step}
            value={minimumDraft}
            aria-invalid={minimumIsInvalid}
            disabled={disabled}
            onChange={(event) => {
              const nextDraft = event.target.value;
              const nextMinimum = Number(nextDraft);
              setMinimumDraft(nextDraft);
              if (
                nextDraft !== "" &&
                Number.isFinite(nextMinimum) &&
                nextMinimum >= minimumAllowed &&
                nextMinimum <= maximum
              ) {
                onMinimumChange(nextMinimum);
              }
            }}
            onBlur={() => {
              const enteredMinimum = Number(minimumDraft);
              if (
                minimumDraft === "" ||
                !Number.isFinite(enteredMinimum) ||
                enteredMinimum < minimumAllowed ||
                enteredMinimum > maximum
              ) {
                setMinimumDraft(String(minimum));
              }
            }}
            className="w-20 text-sm font-bold"
          />
        ) : (
          <output
            aria-label={`${levelLabel} minimum score`}
            className="flex h-10 min-w-16 items-center justify-center rounded! border-2 border-border bg-muted px-2 text-sm font-bold"
            title="The lowest rubric range starts automatically"
          >
            {minimum}
          </output>
        )}
        <span aria-hidden="true" className="font-bold">–</span>
        <output
          aria-label={`${levelLabel} maximum score`}
          className="flex h-10 min-w-16 items-center justify-center rounded! border-2 border-border bg-muted px-2 text-sm font-bold"
          title="Calculated from the next performance level"
        >
          {maximum}
        </output>
      </div>
      {minimumIsInvalid && (
        <p className="mt-1 text-xs font-semibold text-destructive" role="alert">
          Use {minimumAllowed}–{maximum}.
        </p>
      )}
    </fieldset>
  );
}

export function RubricLevelFields({ levels, onChange, disabled }: RubricLevelFieldsProps) {
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const error = validateActivityRubric(levels);
  const maximum = activityRubricMaximum(levels);
  const [maximumDraft, setMaximumDraft] = useState(() => String(maximum));
  const update = (index: number, patch: Partial<ActivityRubricLevel>) =>
    onChange(levels.map((level, i) => (i === index ? { ...level, ...patch } : level)));
  const maximumLevelIndex = levels.findIndex((level) => Number(level.points) === maximum);

  useEffect(() => {
    setMaximumDraft(String(maximum));
  }, [maximum]);

  return (
    <>
      <Card className="block w-full shadow-none hover:shadow-none">
        <Card.Header className="flex-row items-start justify-between gap-3">
          <div className="flex flex-row items-center justify-between w-full">
            <Card.Title className="text-xl">
              Scoring Rubric
            </Card.Title>
            <label className="flex flex-row items-center gap-2 text-sm font-medium">
              Maximum score
              <Input
                aria-label="Maximum score"
                type="number"
                min="0.01"
                step="1"
                value={maximumDraft}
                disabled={disabled || maximumLevelIndex < 0}
                onChange={(event) => {
                  const nextDraft = event.target.value;
                  const nextMaximum = Number(nextDraft);
                  setMaximumDraft(nextDraft);
                  if (maximumLevelIndex >= 0 && maximum > 0 && nextDraft !== "" && Number.isFinite(nextMaximum) && nextMaximum > 0) {
                    onChange(levels.map((level, index) => ({
                      ...level,
                      points: index === maximumLevelIndex
                        ? nextMaximum
                        : Number((Number(level.points) * nextMaximum / maximum).toFixed(2)),
                    })));
                  }
                }}
                onBlur={() => {
                  const enteredMaximum = Number(maximumDraft);
                  if (maximumDraft === "" || !Number.isFinite(enteredMaximum) || enteredMaximum <= 0) {
                    setMaximumDraft(String(maximum));
                  }
                }}
                className="h-9 w-24 text-sm font-bold"
              />
              <span>points</span>
            </label>
          </div>
        </Card.Header>

        <Card.Content className="mt-3">
          <div className="grid grid-cols-2 gap-3">
            {levels.map((level, index) => {
              const levelPoints = levels.map((item) => Number(item.points));
              const levelLabel = level.level_name.trim() || `Level ${index + 1}`;
              const increment = levelPoints.every(Number.isInteger) ? 1 : 0.01;
              const hasLowerLevel = index < levels.length - 1;
              const minimum = hasLowerLevel
                ? Number((Number(levels[index + 1].points) + increment).toFixed(2))
                : increment;
              const followingRangeMinimum = index + 2 < levels.length
                ? Number((Number(levels[index + 2].points) + increment).toFixed(2))
                : increment;
              const minimumAllowed = Number((followingRangeMinimum + increment).toFixed(2));

              return (
              <Card key={level.rubric_level_id ?? `new-${index}`} className="grid gap-2 border border-border p-3 hover:bg-retro">
                <div className="flex flex-row gap-2">
                  <label className="text-xs font-medium w-full">
                    Level name
                    <Input value={level.level_name} disabled={disabled} onChange={(event) => update(index, { level_name: event.target.value })} className="mt-1 w-full text-sm font-bold" />
                  </label>
                  <RangeBoundaryFields
                    levelLabel={levelLabel}
                    minimum={minimum}
                    maximum={Number(level.points)}
                    minimumAllowed={minimumAllowed}
                    step={increment}
                    disabled={disabled}
                    onMinimumChange={!hasLowerLevel ? undefined : (nextMinimum) => {
                      update(index + 1, {
                        points: Number((nextMinimum - increment).toFixed(2)),
                      });
                    }}
                  />
                </div>

                <label className="text-xs font-medium">
                  Description
                  <textarea value={level.description} disabled={disabled} onChange={(event) => update(index, { description: event.target.value })} className="mt-1 min-h-10 w-full border-2 border-border rounded! bg-background px-3 py-2 text-sm font-semibold" />
                </label>

                <div className="flex gap-1">
                  <Tooltip>
                    <TooltipTrigger render={
                      <span className="inline-flex justify-end w-full">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          aria-label={`Remove ${level.level_name || "level"}`}
                          disabled={disabled || levels.length === 1}
                          className={disabled || levels.length === 1 ? "pointer-events-none" : "shadow-none"}
                          onClick={() => setDeleteIndex(index)}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </span>}
                    />
                    <TooltipContent>
                      {disabled ? "Editing unavailable" : levels.length === 1 ? "Keep one level" : "Remove level"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </Card>
              );
            })}
          </div>
          {error && <p className="text-sm font-semibold text-destructive" role="alert">{error}</p>}

          <Button type="button" size="sm" disabled={disabled} className="mt-3 w-full shadow-none hover:bg-retro" onClick={() => onChange([...levels, { level_name: `Level ${levels.length + 1}`, points: 0, description: "Describe the performance demonstrated at this level.", display_order: levels.length }])}>
            <Plus /> Add performance level
          </Button>
        </Card.Content>
      </Card>

      <ConfirmDialog
        open={deleteIndex !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteIndex(null);
        }}
        title="Remove Performance Level"
        confirmationTitle={
          <span>
            Are you sure you want to remove{" "}
            <span className="font-bold">
              {deleteIndex !== null ? levels[deleteIndex]?.level_name : "this performance level"}
            </span>{" "}
            from the rubric?
          </span>
        }
        description="Removing this level will adjust the rubric points and level order."
        confirmLabel="Remove Level"
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleteIndex !== null) {
            onChange(levels.filter((_, i) => i !== deleteIndex).map((item, display_order) => ({ ...item, display_order })));
            setDeleteIndex(null);
          }
        }}
        onCancel={() => setDeleteIndex(null)}
      />
    </>
  );
}
