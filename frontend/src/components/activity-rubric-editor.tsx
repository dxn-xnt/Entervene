import { useState } from "react";
import { BookOpen, Lock } from "lucide-react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { RubricTemplateDialog } from "@/components/rubric-template-dialog";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import { activityRubricMaximum } from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

type Props = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  readOnlyMessage?: string;
};

export function ActivityRubricEditor({
  levels,
  onChange,
  disabled,
  readOnly = false,
  readOnlyMessage,
}: Props) {
  const [dialogMode, setDialogMode] = useState<"choose" | null>(null);
  const [chosenTitle, setChosenTitle] = useState<string>("Scoring Rubric");

  return (
    <>
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
      />
      {!readOnly && dialogMode && (
        <RubricTemplateDialog
          key={dialogMode}
          mode={dialogMode}
          currentLevels={levels}
          onApply={(newLevels, templateName) => {
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
