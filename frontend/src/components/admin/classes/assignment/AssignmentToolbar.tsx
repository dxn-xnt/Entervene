import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";
import type { ManualSectionDraft } from "@/types/adminClasses";

export default function AssignmentToolbar({ sections, selectedCount, canAssignEvenly, onMove, onClear, onAssignEvenly }: {
  sections: ManualSectionDraft[];
  selectedCount: number;
  canAssignEvenly: boolean;
  onMove: (target: string) => void;
  onClear: () => void;
  onAssignEvenly: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-black bg-[#fff8d7] p-2">
      <span className="text-xs font-bold">{selectedCount} selected</span>
      <SelectField disabled={!selectedCount} value="" onChange={(target) => target && onMove(target)}>
        <option value="">Move Selected To...</option>
        {sections.map((section) => <option key={section.localId} value={section.localId}>{section.sectionName}</option>)}
      </SelectField>
      <button disabled={!selectedCount} className={retroButton("disabled:cursor-not-allowed disabled:opacity-50")} onClick={onClear}>Clear</button>
      <button disabled={!canAssignEvenly} className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")} onClick={onAssignEvenly}>Assign Evenly</button>
    </div>
  );
}
