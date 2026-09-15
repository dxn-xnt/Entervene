import type { FC, InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export const Input: FC<InputProps> = ({
  type = "text",
  placeholder = "Enter text",
  className = "",
  ...props
}) => {
  return (
    <input
      type={type}
      placeholder={placeholder}
      className={cn(
        "h-10 w-auto rounded-none border-2 border-border bg-background px-4 py-2 text-foreground shadow-md transition placeholder:text-muted-foreground focus:border-ring focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 read-only:cursor-default read-only:shadow-none",
        props["aria-invalid"] && "border-destructive text-destructive shadow-xs shadow-destructive focus:border-destructive focus-visible:ring-destructive/35",
        className,
      )}
      {...props}
    />
  );
};
