import { X } from "lucide-react";
import type { ReactNode } from "react";

export default function ModalShell({ title, onClose, children, wide = false, fullScreen = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; fullScreen?: boolean }) {
  return (
    <div className={`fixed inset-0 z-50 grid place-items-center bg-black/10 ${fullScreen ? "p-0" : "px-4"}`}>
      <div className={`w-full border border-black bg-[#fffdf5] shadow-[4px_4px_0_#000] ${fullScreen ? "flex h-screen max-w-none flex-col overflow-hidden rounded-none" : `max-h-[95vh] overflow-y-auto rounded-lg ${wide ? "max-w-6xl" : "max-w-3xl"}`}`}>
        <div className={`flex shrink-0 items-center justify-between border-b border-black bg-[#79bd80] px-4 py-3 ${fullScreen ? "" : "rounded-t-lg"}`}>
          <h2 className="font-bold">{title}</h2>
          <button aria-label="Close modal" className="rounded p-1 hover:bg-white/30" onClick={onClose}><X className="size-4" /></button>
        </div>
        <div className={fullScreen ? "min-h-0 flex-1 overflow-hidden p-3" : "p-4"}>{children}</div>
      </div>
    </div>
  );
}
