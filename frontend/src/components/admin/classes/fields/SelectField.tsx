import type { ReactNode } from "react";

export default function SelectField({ value, onChange, children, disabled }: {
  value?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select disabled={disabled} value={value} onChange={(event) => onChange?.(event.target.value)} className="h-10 rounded-md border border-black bg-[#fffdf5] px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60">
      {children}
    </select>
  );
}
