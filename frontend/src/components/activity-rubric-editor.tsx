import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import {
  activityRubricMaximum,
  defaultActivityRubric,
  validateActivityRubric,
} from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

type Props = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
};

export function ActivityRubricEditor({ levels, onChange, disabled }: Props) {
  const error = validateActivityRubric(levels);
  const update = (index: number, patch: Partial<ActivityRubricLevel>) =>
    onChange(levels.map((level, i) => (i === index ? { ...level, ...patch } : level)));
  return (
    <Card className="block w-full shadow-none hover:shadow-none">
      <Card.Header className="flex-row items-start justify-between gap-3">
        <div>
          <Card.Title className="text-xl">Scoring Rubric</Card.Title>
          <Card.Description className="text-sm text-muted-foreground">
            {levels.length} performance levels · Maximum score: {activityRubricMaximum(levels)} points
          </Card.Description>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange(defaultActivityRubric.map((level) => ({ ...level })))}>
          <RotateCcw /> Reset
        </Button>
      </Card.Header>
      <Card.Content className="space-y-3">
        {levels.map((level, index) => (
          <div key={level.rubric_level_id ?? `new-${index}`} className="grid gap-2 border border-border p-3 md:grid-cols-[1fr_8rem_2fr_auto] md:items-start">
            <label className="text-xs font-bold">Level name
              <Input value={level.level_name} disabled={disabled} onChange={(event) => update(index, { level_name: event.target.value })} className="mt-1 w-full" />
            </label>
            <label className="text-xs font-bold">Points
              <Input type="number" min="0" step="1" value={level.points} disabled={disabled} onChange={(event) => update(index, { points: Number(event.target.value) })} className="mt-1 w-full" />
            </label>
            <label className="text-xs font-bold">Description
              <textarea value={level.description} disabled={disabled} onChange={(event) => update(index, { description: event.target.value })} className="mt-1 min-h-10 w-full border-2 border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring" />
            </label>
            <div className="flex gap-1 md:pt-5">
              <Button
                type="button"
                size="icon"
                variant="destructive"
                aria-label={`Remove ${level.level_name || "level"}`}
                disabled={disabled || levels.length === 1}
                onClick={() => {
                  if (!window.confirm(`Remove ${level.level_name || "this performance level"}?`)) return;
                  onChange(
                    levels
                      .filter((_, i) => i !== index)
                      .map((item, display_order) => ({ ...item, display_order })),
                  );
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
        {error && <p className="text-sm font-semibold text-destructive" role="alert">{error}</p>}
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...levels, { level_name: `Level ${levels.length + 1}`, points: 0, description: "Describe the performance demonstrated at this level.", display_order: levels.length }])}>
          <Plus /> Add performance level
        </Button>
      </Card.Content>
    </Card>
  );
}
