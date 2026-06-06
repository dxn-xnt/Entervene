import { retroButton } from "../utils";

export default function AssignEvenlyConfirmationModal({ onCancel, onConfirm }: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4">
      <div className="grid w-full max-w-md gap-4 rounded-md border-2 border-black bg-[#fffdf5] p-5 shadow-[4px_4px_0_#000]">
        <div>
          <h3 className="font-bold">Assign Students Evenly?</h3>
          <p className="mt-2 text-sm">Assign all remaining unassigned students evenly across the configured sections?</p>
          <p className="mt-1 text-xs text-black/70">Existing manual assignments will remain unchanged.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button className={retroButton()} onClick={onCancel}>Cancel</button>
          <button className={retroButton("bg-[#79bd80]")} onClick={onConfirm}>Assign Evenly</button>
        </div>
      </div>
    </div>
  );
}
