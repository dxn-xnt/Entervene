import { CheckCircle2, Download, Pencil } from "lucide-react";
import Field from "../fields/Field";
import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";

export default function ImportClassWizard({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Field label="Grade"><SelectField><option>7</option><option>8</option><option>9</option><option>10</option></SelectField></Field>
        {["Sapphire", "Ruby", "Gold", "Jade", "Diamond"].map((section) => (
          <div key={section} className="flex items-center justify-between rounded-md border border-black bg-[#fffdf5] p-3">
            <span><b>{section}</b><span className="block text-xs">30 Students</span></span><Pencil className="size-4" />
          </div>
        ))}
      </div>
      <div className="grid gap-2 rounded-md border border-black bg-[#fff8d7] p-3 text-sm">
        <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4" /> Validation preview</div>
        <p>Valid students: 120 | Duplicate LRN: 3 | Missing required fields: 2 | Invalid academic level: 1</p>
        <p className="text-xs">Invalid rows are skipped before import.</p>
      </div>
      <div className="flex justify-between">
        <button className={retroButton()}><Download className="size-4" /> Download Template</button>
        <button className={retroButton("bg-[#79bd80]")} onClick={onClose}>Import</button>
      </div>
    </div>
  );
}
