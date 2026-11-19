import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps {
  label: string;
  children: ReactNode;
  isRequired?: boolean;
  className?: string;
}

export default function Field({ label, children, isRequired, className }: FieldProps) {
  return (
    <label className={cn("grid min-w-0 gap-1 text-sm font-medium", className)}>
      <span>
        {label}
        {isRequired && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

