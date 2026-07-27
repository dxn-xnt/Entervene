"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  variant?: "default" | "circular";
  strokeWidth?: number;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, variant = "default", strokeWidth = 12, ...props }, ref) => {
  if (variant === "circular") {
    const safeValue = Math.min(100, Math.max(0, value || 0));
    const radius = 35;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (safeValue / 100) * circumference;

    const r1 = radius - strokeWidth / 2;
    const r2 = radius + strokeWidth / 2;

    const startX1 = 50 + r1;
    const startY1 = 50;
    const startX2 = 50 + r2;
    const startY2 = 50;

    const endAngleRad = (safeValue / 100) * 360 * (Math.PI / 180);
    const endX1 = 50 + r1 * Math.cos(endAngleRad);
    const endY1 = 50 + r1 * Math.sin(endAngleRad);
    const endX2 = 50 + r2 * Math.cos(endAngleRad);
    const endY2 = 50 + r2 * Math.sin(endAngleRad);

    return (
      <div
        ref={ref as React.ForwardedRef<HTMLDivElement>}
        className={cn("relative flex items-center justify-center size-20 shrink-0", className)}
        {...props}
      >
        <svg
          className="size-full -rotate-90"
          viewBox="0 0 100 100"
        >
          {/* Inner circle fill (dark background to match reference exactly) */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="fill-background"
          />
          {/* Track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="fill-none stroke-white"
            strokeWidth={strokeWidth}
          />
          {/* Progress Indicator */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            className="fill-none stroke-primary transition-all duration-300 ease-in-out"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="butt"
          />
          {/* Start and end divider lines to enclose progress block */}
          {safeValue > 0 && safeValue < 100 && (
            <>
              <line
                x1={startX1}
                y1={startY1}
                x2={startX2}
                y2={startY2}
                className="stroke-black"
                strokeWidth={1}
              />
              <line
                x1={endX1}
                y1={endY1}
                x2={endX2}
                y2={endY2}
                className="stroke-black"
                strokeWidth={1}
              />
            </>
          )}
          {/* Outer Outline */}
          <circle
            cx="50"
            cy="50"
            r={radius + strokeWidth / 2}
            className="fill-none stroke-black"
            strokeWidth={2}
          />
          {/* Inner Outline */}
          <circle
            cx="50"
            cy="50"
            r={radius - strokeWidth / 2}
            className="fill-none stroke-black"
            strokeWidth={2}
          />
        </svg>
        {/* Percentage Text in center */}
        <span className="absolute font-black text-foreground text-md select-none">
          {Math.round(safeValue)}%
        </span>
      </div>
    );
  }

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-4 w-full overflow-hidden bg-background border-2 border-black",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all border-r-2 border-black"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = "Progress";

export { Progress };
