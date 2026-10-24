import { cn } from "@/lib/utils";
import type { FC, InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
  variant?: "default" | "search";
}

export const Input: FC<InputProps> = ({
  type = "text",
  placeholder = "Enter text",
  className,
  variant = "default",
  ...props
}) => {
  return (
    <input
      type={type}
      placeholder={placeholder}
      className={cn(
        "h-10 w-auto rounded-[var(--radius)]! border-2 border-border bg-background px-4 py-2 font-sans text-base font-normal text-foreground shadow-md transition placeholder:text-muted-foreground focus:border-black focus-visible:outline-none",
        variant === "search" && "pl-9",
        props["aria-invalid"] && "border-destructive text-destructive shadow-xs shadow-destructive",
        className,
      )}
      {...props}
    />
  );
};

