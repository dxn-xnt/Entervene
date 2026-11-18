import { useEffect, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { RubricTemplateDialog } from "@/components/rubric-template-dialog";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import { activityRubricMaximum, scaleRubricLevels } from "@/lib/classwork-utils";
import type { ActivityRubricLevel } from "@/types/classwork";

type Props = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
};

export function ActivityRubricEditor({ levels, onChange, disabled }: Props) {
  const [dialogMode, setDialogMode] = useState<"choose" | null>(null);
  const [chosenTitle, setChosenTitle] = useState<string>("Scoring Rubric");
  const baselineLevelsRef = useRef<ActivityRubricLevel[]>(levels);

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
        <Button type="button" size="sm" disabled={disabled} onClick={() => setDialogMode("choose")}>
          <BookOpen /> Choose Template
        </Button>
      </div>
      <RubricsScoreBoard
        title={chosenTitle}
        totalPoints={activityRubricMaximum(levels)}
        rubricLevels={levels}
        editable={!disabled}
        disabled={disabled}
        onTotalPointsChange={handleTotalPointsChange}
      />
      {dialogMode && (
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
