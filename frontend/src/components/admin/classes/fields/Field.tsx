import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  children: ReactNode;
  isRequired?: boolean;
}

export default function Field({ label, children, isRequired }: FieldProps) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      <span>
        {label}
        {isRequired && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

