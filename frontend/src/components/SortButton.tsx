// components/SortButton.tsx
import { ChevronsUpDown } from "lucide-react";

interface SortButtonProps {
  sortAsc: boolean;
  onToggle: () => void;
  label?: string;
}

export function SortButton({ sortAsc, onToggle, label = "Sort By" }: SortButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={`Sort ${sortAsc ? "ascending" : "descending"}`}
      className="flex items-center gap-2 text-sm px-3"
    >
      <ChevronsUpDown size={14} />
      {label}
    </button>
  );
}