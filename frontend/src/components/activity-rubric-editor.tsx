import { useEffect, useId, useRef, useState } from "react";
import { useState } from "react";
import { BookOpen, Lock } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { RubricTemplateDialog } from "@/components/rubric-template-dialog";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import { activityRubricMaximum, scaleRubricLevels } from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

type Props = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
  disabledReason?: string;
  readOnly?: boolean;
  readOnlyMessage?: string;
};

export function ActivityRubricEditor({ levels, onChange, disabled, disabledReason }: Props) {
export function ActivityRubricEditor({
  levels,
  onChange,
  disabled,
  readOnly = false,
  readOnlyMessage,
}: Props) {
  const [dialogMode, setDialogMode] = useState<"choose" | null>(null);
  const [chosenTitle, setChosenTitle] = useState<string>("Scoring Rubric");
  const baselineLevelsRef = useRef<ActivityRubricLevel[]>(levels);
  const lockExplanationId = useId();

  useEffect(() => {
    if (
      baselineLevelsRef.current.length !== levels.length ||
      levels.some((l, i) => l.level_name !== baselineLevelsRef.current[i]?.level_name)
    ) {
      baselineLevelsRef.current = levels;
    }
  }, [levels]);

  const handleTotalPointsChange = (nextMax: number) => {
    const base = baselineLevelsRef.current.length ? baselineLevelsRef.current : levels;
    const scaled = scaleRubricLevels(base, nextMax);
    onChange(scaled);
  };

  return (
    <>
      <div data-rubric-template-actions className="flex items-end justify-between w-full">
        <p className="text-sm text-foreground font-medium -mb-1">
          Choose Rubrics
        </p>
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          aria-describedby={disabled && disabledReason ? lockExplanationId : undefined}
          title={disabled && disabledReason ? disabledReason : undefined}
          onClick={() => setDialogMode("choose")}
        >
          <BookOpen /> Choose Template
        </Button>
      <div data-rubric-template-actions className="flex flex-wrap items-center justify-between gap-2 w-full">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground font-medium">
            {readOnly ? "Inherited Scoring Rubric" : "Choose Rubrics"}
          </p>
          {readOnly && (
            <Badge variant="surface" size="sm" className="gap-1">
              <Lock className="size-3" />
              Original Rubric
            </Badge>
          )}
        </div>
        {!readOnly && (
          <Button type="button" size="sm" disabled={disabled} onClick={() => setDialogMode("choose")}>
            <BookOpen /> Choose Template
          </Button>
        )}
      </div>
      {readOnly && readOnlyMessage && (
        <p className="text-xs text-muted-foreground">{readOnlyMessage}</p>
      )}
      <RubricsScoreBoard
        title={readOnly ? "Scoring Rubric (Inherited)" : chosenTitle}
        totalPoints={activityRubricMaximum(levels)}
        rubricLevels={levels}
        editable
        disabled={disabled}
        disabledReason={disabledReason}
        disabledReasonId={disabled && disabledReason ? lockExplanationId : undefined}
        onTotalPointsChange={handleTotalPointsChange}
      />
      {!readOnly && dialogMode && (
        <RubricTemplateDialog
          key={dialogMode}
          mode={dialogMode}
          currentLevels={levels}
          onApply={(newLevels, templateName) => {
            baselineLevelsRef.current = newLevels;
            onChange(newLevels);
            if (templateName) {
              setChosenTitle(templateName);
            }
          }}
          onClose={() => setDialogMode(null)}
        />
      )}
    </>
  );
}
