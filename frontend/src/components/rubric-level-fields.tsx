import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  activityRubricMaximum,
  validateActivityRubric,
} from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";
import { Badge } from "./retroui/Badge";

export type RubricLevelFieldsProps = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
};

export function RubricLevelFields({ levels, onChange, disabled }: RubricLevelFieldsProps) {
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const error = validateActivityRubric(levels);
  const update = (index: number, patch: Partial<ActivityRubricLevel>) =>
    onChange(levels.map((level, i) => (i === index ? { ...level, ...patch } : level)));

  return (
    <>
      <Card className="block w-full shadow-none hover:shadow-none">
        <Card.Header className="flex-row items-start justify-between gap-3">
          <div className="flex flex-row items-center justify-between w-full">
            <Card.Title className="text-xl">
              Scoring Rubric
            </Card.Title>
            <div className="flex flex-row items-center gap-2">
              <span className="text-sm">Maximum score: </span>
              <Badge variant="surface" size="sm" className="text-sm">
                {activityRubricMaximum(levels)} points
              </Badge>
            </div>
          </div>
        </Card.Header>

        <Card.Content className="mt-3">
          <div className="grid grid-cols-2 gap-3">
            {levels.map((level, index) => (
              <Card key={level.rubric_level_id ?? `new-${index}`} className="grid gap-2 border border-border p-3 hover:bg-retro">
                <div className="flex flex-row gap-2">
                  <label className="text-xs font-medium w-full">
                    Level name
                    <Input value={level.level_name} disabled={disabled} onChange={(event) => update(index, { level_name: event.target.value })} className="mt-1 w-full text-sm font-bold" />
                  </label>
                  <label className="text-xs font-medium max-w-28">
                    Points
                    <Input type="number" min="0" step="1" value={level.points} disabled={disabled} onChange={(event) => update(index, { points: Number(event.target.value) })} className="mt-1 w-full text-sm font-bold" />
                  </label>
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
            ))}
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
