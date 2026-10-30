import type { HTMLAttributes } from "react";
import { Text } from "@/components/retroui/Text";
import { cn } from "@/lib/utils";

type FormMessageProps = Omit<HTMLAttributes<HTMLParagraphElement>, "children"> & {
  children?: string | null;
};

export function FormMessage({ children, className, ...props }: FormMessageProps) {
  if (!children) return null;

  return (
    <Text as="p" role="alert" className={cn("break-words text-sm font-medium leading-snug text-destructive", className)} {...props}>
      {children}
    </Text>
  );
}

export function NoChangesMessage({ message }: { message?: string | null }) {
  return <FormMessage role="status" aria-live="polite" className="w-full text-muted-foreground font-normal" >{message}</FormMessage>;
}
