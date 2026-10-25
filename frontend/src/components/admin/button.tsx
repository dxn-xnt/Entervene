import { forwardRef } from "react";
import { Button as RetroButton, type IButtonProps } from "@/components/retroui/Button";
import { cn } from "@/lib/utils";

/** Keeps icon and label spacing consistent in Admin without changing other roles. */
export const Button = forwardRef<HTMLButtonElement, IButtonProps>(
  ({ className, ...props }, ref) => (
    <RetroButton
      ref={ref}
      className={cn(className, "gap-2 [&>svg]:ml-0 [&>svg]:mr-0")}
      {...props}
    />
  ),
);

Button.displayName = "AdminButton";
