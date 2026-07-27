import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";

const AvatarContext = React.createContext<{ variant: "teacher" | "student" | "default" }>({
  variant: "default",
});

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> & {
    variant?: "teacher" | "student" | "default";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <AvatarContext.Provider value={{ variant }}>
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex h-14 w-14 rounded-full",
        variant === "student" ? "border-0 overflow-visible" : "border-2 overflow-hidden",
        className,
      )}
      {...props}
    />
  </AvatarContext.Provider>
));
Avatar.displayName = "Avatar";

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => {
  const { variant } = React.useContext(AvatarContext);
  return (
    <AvatarPrimitive.Image
      ref={ref}
      className={cn(
        "aspect-square h-full w-full object-cover scale-[1.75]",
        variant === "student" ? "absolute overflow-visible" : "",
        className,
      )}
      {...props}
    />
  );
});
AvatarImage.displayName = "Avatar.Image";

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted bg-primary",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = "Avatar.Fallback";

const AvatarComponent = Object.assign(Avatar, {
  Image: AvatarImage,
  Fallback: AvatarFallback,
});

export { AvatarComponent as Avatar };
