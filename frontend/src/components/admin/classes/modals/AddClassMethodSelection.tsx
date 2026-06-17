import { Download, UserPlus } from "lucide-react";
import type { WizardMode } from "@/types/adminClasses";

export default function AddClassMethodSelection({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (mode: Exclude<WizardMode, "choice">) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-black bg-[#faf9f6]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black px-5 py-5 bg-[#7ABA78]">
          <h2 className="text-xl font-semibold">Add new classes</h2>
          <button aria-label="Close modal" className="text-2xl leading-none hover:text-black/70" onClick={onClose}>×</button>
        </div>
        <div className="grid gap-4 border-b border-black px-5 py-5 md:grid-cols-2">
          <button className="rounded-lg border border-black bg-[#7ABA78] p-5 text-left transition hover:opacity-90 active:scale-95" onClick={() => onSelect("import")}>
            <div className="mb-2 flex items-center gap-3 text-base font-semibold"><Download className="size-5" />Import from file</div>
            <p className="text-sm leading-snug text-black/80">Upload a CSV file to add multiple classes at once</p>
          </button>
          <button className="rounded-lg border border-black bg-[#7ABA78] p-5 text-left transition hover:opacity-90 active:scale-95" onClick={() => onSelect("manual")}>
            <div className="mb-2 flex items-center gap-3 text-base font-semibold"><UserPlus className="size-5" />Create manually</div>
            <p className="text-sm leading-snug text-black/80">Add individual class sections one at a time</p>
          </button>
        </div>
        <div className="flex justify-end px-5 py-5">
          <button className="rounded-lg border border-black bg-[#faf9f6] px-5 py-2 text-base font-medium transition hover:bg-black/5" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
