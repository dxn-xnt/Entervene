import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import React from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Slot } from "@radix-ui/react-slot";
import {
  Archive, ArrowLeft, ArrowRight, ArrowRightLeft, Calendar, Check,
  CheckSquare, ClipboardCheck, Copy, Download, Eye, FileUp, Filter,
  KeyRound, LogIn, Pencil, Plus, RefreshCw, RotateCcw, Save, Send,
  Sparkles, Trash2, Upload, UserPlus, X, type LucideIcon,
} from "lucide-react";

export const buttonVariants = cva(
  "font-sans transition-all rounded outline-hidden cursor-pointer duration-200 font-medium flex items-center justify-center",
  {
    variants: {
      variant: {
        default:
          "shadow-md hover:shadow active:shadow-none bg-primary text-primary-foreground border-2 border-black transition hover:translate-y-1 active:translate-y-2 active:translate-x-1 hover:bg-primary-hover",
        secondary:
          "shadow-md hover:shadow active:shadow-none bg-secondary shadow-primary text-secondary-foreground border-2 border-black transition hover:translate-y-1 active:translate-y-2 active:translate-x-1 hover:bg-secondary-hover",
        outline:
          "shadow-md hover:shadow active:shadow-none bg-background border-2 border-border transition hover:translate-y-1 active:translate-y-2 active:translate-x-1",
        link: "bg-transparent hover:underline",
        ghost: "bg-transparent hover:bg-accent"
      },
      size: {
        sm: "px-3 py-1 text-sm shadow hover:shadow-none",
        md: "px-4 py-1.5 text-base",
        lg: "px-6 lg:px-8 py-2 lg:py-3 text-md lg:text-lg",
        icon: "p-2",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "default",
    },
  },
);

export interface IButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  autoIcon?: boolean;
}

function buttonText(children: ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (React.isValidElement<{ children?: ReactNode }>(child)) {
        return buttonText(child.props.children);
      }
      return "";
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasButtonIcon(children: ReactNode): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement<{ children?: ReactNode }>(child)) return false;
    if (child.type === React.Fragment || typeof child.type === "string") {
      return hasButtonIcon(child.props.children);
    }
    return true;
  });
}

function semanticButtonIcon(label: string): LucideIcon | null {
  const text = label.toLowerCase();
  if (!/[a-z]/i.test(text)) return null;
  if (/cancel|close|discard|unmark|clear/.test(text)) return X;
  if (/delete|remove/.test(text)) return Trash2;
  if (/archive|deactivate|end .*early/.test(text)) return Archive;
  if (/back|previous|go back/.test(text)) return ArrowLeft;
  if (/retry|refresh|reload/.test(text)) return RefreshCw;
  if (/reset/.test(text)) return RotateCcw;
  if (/save|saving|draft/.test(text)) return Save;
  if (/edit|adjust/.test(text)) return Pencil;
  if (/view|details|results|classmates|review/.test(text)) return Eye;
  if (/download|export/.test(text)) return Download;
  if (/upload|replace file|select files/.test(text)) return Upload;
  if (/import|validat.*csv/.test(text)) return FileUp;
  if (/copy/.test(text)) return Copy;
  if (/transfer/.test(text)) return ArrowRightLeft;
  if (/select|mark all/.test(text)) return CheckSquare;
  if (/invite|enroll|sign up/.test(text)) return UserPlus;
  if (/sign in|login/.test(text)) return LogIn;
  if (/password/.test(text)) return KeyRound;
  if (/submit|send|post|assign|publish/.test(text)) return Send;
  if (/generate/.test(text)) return Sparkles;
  if (/add|create|new|retake/.test(text)) return Plus;
  if (/confirm|done|complete|approve|activate|full|zero/.test(text)) return Check;
  if (/next|continue|take quiz|resume|open/.test(text)) return ArrowRight;
  if (/grade|score/.test(text)) return ClipboardCheck;
  if (/term|period/.test(text)) return Calendar;
  if (/summary|all|filter/.test(text)) return Filter;
  return ArrowRight;
}

export const Button = React.forwardRef<HTMLButtonElement, IButtonProps>(
  (
    {
      children,
      size = "md",
      className = "",
      variant = "default",
      asChild = false,
      autoIcon = true,
      ...props
    }: IButtonProps,
    forwardedRef,
  ) => {
    const Comp = asChild ? Slot : "button";
    const Icon = autoIcon && !asChild && !hasButtonIcon(children)
      ? semanticButtonIcon(buttonText(children))
      : null;

    return (
      <Comp
        ref={forwardedRef}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {Icon && React.createElement(Icon, {
          "aria-hidden": true,
          className: "mr-2 size-4 shrink-0",
        })}
        {children}
      </Comp>
    );
  },
);

Button.displayName = "Button";
