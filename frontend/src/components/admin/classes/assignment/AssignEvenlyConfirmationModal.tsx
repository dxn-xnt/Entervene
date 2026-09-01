import { useState } from "react";
import type { DistributionMode } from "@/types/adminClasses";
import { retroButton } from "../utils";

export default function AssignEvenlyConfirmationModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (mode: DistributionMode) => void;
}) {
  const [mode, setMode] = useState<DistributionMode>("alphabetical");

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4">
      <div className="grid w-full max-w-md gap-4 rounded-md border-2 border-black bg-[#fffdf5] p-5 shadow-[4px_4px_0_#000]">
        <div>
          <h3 className="font-bold text-base">Assign Students Evenly</h3>
          <p className="mt-1.5 text-xs text-black/80">
            Assign all remaining unassigned students evenly across the configured sections while preserving existing manual assignments.
          </p>
        </div>

        <div className="grid gap-2 border-y border-black/20 py-3">
          <label className="text-xs font-bold uppercase tracking-wider text-black/70">
            Distribution Mode
          </label>
          <div className="grid gap-2">
            <label
              className={`flex items-start gap-2.5 rounded border-2 p-2.5 text-xs cursor-pointer transition-colors ${
                mode === "alphabetical"
                  ? "border-black bg-[#d8efca] font-semibold"
                  : "border-black/30 bg-white hover:bg-black/5"
              }`}
            >
              <input
                type="radio"
                name="distributionMode"
                value="alphabetical"
                checked={mode === "alphabetical"}
                onChange={() => setMode("alphabetical")}
                className="mt-0.5"
              />
              <div>
                <p className="font-bold">Balance Alphabetically</p>
                <p className="text-[11px] text-black/70 font-normal">
                  Evenly distributes students across sections with balanced gender counts.
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-2.5 rounded border-2 p-2.5 text-xs cursor-pointer transition-colors ${
                mode === "gwa"
                  ? "border-black bg-[#d8efca] font-semibold"
                  : "border-black/30 bg-white hover:bg-black/5"
              }`}
            >
              <input
                type="radio"
                name="distributionMode"
                value="gwa"
                checked={mode === "gwa"}
                onChange={() => setMode("gwa")}
                className="mt-0.5"
              />
              <div>
                <p className="font-bold">Balance by Academic Performance (GWA)</p>
                <p className="text-[11px] text-black/70 font-normal">
                  Evenly spreads students by prior academic performance (GWA) while maintaining gender balance.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className={retroButton()} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={retroButton("bg-[#79bd80]")}
            onClick={() => onConfirm(mode)}
          >
            Assign Evenly
          </button>
        </div>
      </div>
    </div>
  );
}
