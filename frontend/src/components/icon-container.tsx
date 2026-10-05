import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const iconContainerVariants = cva(
  "inline-flex items-center justify-center shrink-0 border-2 border-black transition-all select-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-white text-black",
        primary: "bg-primary text-black",
        secondary: "bg-secondary text-secondary-foreground",
        accent: "bg-accent text-accent-foreground",
        muted: "bg-muted text-muted-foreground",
        destructive: "bg-red-100 text-red-700 border-red-600",
        surface: "bg-muted/50 text-foreground border-black/20",
        outline: "bg-transparent text-foreground border-black",
        ghost: "bg-transparent text-foreground border-transparent",
      },
      size: {
        xs: "p-1 rounded [&_svg]:size-3.5",
        sm: "p-1.5 rounded [&_svg]:size-4",
        default: "p-2 rounded [&_svg]:size-5",
        md: "p-2 rounded [&_svg]:size-5",
        lg: "p-2.5 rounded-md [&_svg]:size-6",
        xl: "p-3 rounded-lg [&_svg]:size-7",
      },
      shadow: {
        default: "shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
        none: "shadow-none",
        sm: "shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
        md: "shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]",
      },
      rounded: {
        default: "",
        none: "rounded-none",
        sm: "rounded-sm",
        md: "rounded-md",
        lg: "rounded-lg",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shadow: "none",
    },
  },
);

export interface IconContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof iconContainerVariants> {}

export const IconContainer = React.forwardRef<HTMLDivElement, IconContainerProps>(
  ({ className, variant, size, shadow, rounded, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="icon-container"
        className={cn(
          iconContainerVariants({ variant, size, shadow, rounded }),
          className,
        )}
        {...props}
      />
    );
  },
);

IconContainer.displayName = "IconContainer";

export default IconContainer;
