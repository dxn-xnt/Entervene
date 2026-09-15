import { cn } from "@/lib/utils";
import type { FC, InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export const Input: FC<InputProps> = ({
  type = "text",
  placeholder = "Enter text",
  className,
  ...props
}) => {
  return (
    <input
      type={type}
      placeholder={placeholder}
      className={cn(
        "px-4 py-2 w-auto rounded-[var(--radius)] bg-background text-foreground border-2 border-border shadow-md transition focus:outline-hidden focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/35",
        props["aria-invalid"] && "border-destructive text-destructive shadow-xs shadow-destructive",
        className,
      )}
      {...props}
    />
  );
};

