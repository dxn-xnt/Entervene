import { useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import type { ManualSectionDraft } from "@/types/adminClasses";

export default function AssignmentToolbar({
  sections,
  selectedCount,
  canAssignEvenly,
  onMove,
  onClear,
  onAssignEvenly,
}: {
  sections: ManualSectionDraft[];
  selectedCount: number;
  canAssignEvenly: boolean;
  onMove: (target: string) => void;
  onClear: () => void;
  onAssignEvenly: () => void;
}) {
  const [moveTarget, setMoveTarget] = useState("");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black bg-[#fff8d7] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold">{selectedCount} selected</span>
        <Select
          disabled={!selectedCount}
          value={moveTarget}
          onValueChange={(value) => {
            if (!value) return;
            setMoveTarget(value);
            onMove(value);
            setMoveTarget("");
          }}
        >
          <Select.Trigger className="w-auto shadow-none">
            <Select.Value placeholder="Move Selected To..." />
          </Select.Trigger>
          <Select.Content
            position="item-aligned"
            className="max-h-72 overflow-y-auto"
          >
            <Select.Group>
              {sections.map((section) => (
                <Select.Item key={section.localId} value={section.localId}>
                  {section.sectionName}
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Content>
        </Select>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedCount}
          onClick={onClear}
          className="disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear
        </Button>
        <Button
          size="sm"
          disabled={!canAssignEvenly}
          onClick={onAssignEvenly}
          className="gap-1.5 bg-[#79bd80] hover:bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Assign Evenly
        </Button>
      </div>
    </div>
  );
}
