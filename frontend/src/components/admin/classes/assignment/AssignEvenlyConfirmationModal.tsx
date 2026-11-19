import { useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import type { DistributionMode } from "@/types/adminClasses";

export default function AssignEvenlyConfirmationModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (mode: DistributionMode) => void;
}) {
  const [mode, setMode] = useState<DistributionMode>("alphabetical");

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Content size="md">
        <Dialog.Header position="static">
          <Dialog.Title className="font-sans text-xl font-bold">
            Assign Students Evenly
          </Dialog.Title>
        </Dialog.Header>

        <div className="grid gap-4 p-5">
          <p className="text-sm text-muted-foreground">
            Assign all remaining unassigned students evenly across the
            configured sections while preserving existing manual assignments.
          </p>

          <div className="grid gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-black/70">
              Distribution Mode
            </label>
            <div className="grid gap-2">
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border-2 p-3 text-xs transition-colors ${
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
                    Evenly distributes students across sections with balanced
                    gender counts.
                  </p>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border-2 p-3 text-xs transition-colors ${
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
                  <p className="font-bold">
                    Balance by Academic Performance (GWA)
                  </p>
                  <p className="text-[11px] text-black/70 font-normal">
                    Evenly spreads students by prior academic performance (GWA)
                    while maintaining gender balance.
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <Dialog.Footer position="static">
          <Button
            type="button"
            variant="outline"
            autoIcon={false}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(mode)}>
            Assign Evenly
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
