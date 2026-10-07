import { useState } from "react";
import { BookOpen, Save } from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { RubricLevelFields } from "@/components/rubric-level-fields";
import { RubricTemplateDialog } from "@/components/rubric-template-dialog";
import type { ActivityRubricLevel } from "@/types/classwork";

type Props = {
  levels: ActivityRubricLevel[];
  onChange: (levels: ActivityRubricLevel[]) => void;
  disabled?: boolean;
};

export function ActivityRubricEditor({ levels, onChange, disabled }: Props) {
  const [dialogMode, setDialogMode] = useState<"choose" | "save" | null>(null);
  return (
    <>
      <div data-rubric-template-actions className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setDialogMode("choose")}>
          <BookOpen /> Choose Template
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setDialogMode("save")}>
          <Save /> Save as Template
        </Button>
      </div>
      <RubricLevelFields levels={levels} onChange={onChange} disabled={disabled} />
      {dialogMode && (
        <RubricTemplateDialog
          key={dialogMode}
          mode={dialogMode}
          currentLevels={levels}
          onApply={onChange}
          onClose={() => setDialogMode(null)}
        />
      )}
    </>
  );
}
