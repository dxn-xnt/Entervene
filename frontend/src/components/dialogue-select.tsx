"use client";

import React from "react";
import { Check, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./retroui/Button";

export interface DialogueSelectProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description: string;
  icon?: LucideIcon | ReactNode;
  className?: string;
  selected?: boolean;
  availabilityMessage?: string;
}

export function DialogueSelect({
  title,
  description,
  icon: Icon,
  className,
  selected,
  availabilityMessage,
  disabled,
  ...props
}: DialogueSelectProps) {
  const renderIcon = () => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return Icon;
    const IconComp = Icon as LucideIcon;
    return <IconComp aria-hidden="true" className="size-5 shrink-0" />;
  };

  return (
    <Button
      type="button"
      disabled={disabled}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cn(
        "group relative h-auto min-h-28 w-full flex-col items-start gap-2 p-5 text-left hover:bg-primary focus-visible:bg-primary active:bg-primary",
        selected && "outline-2 outline-offset-2 outline-ring",
        className
      )}
      {...props}
    >
      <span className="flex w-full items-center gap-3 text-lg font-bold text-primary-foreground">
        {renderIcon()}
        <span className="flex-1">{title}</span>
        {selected && <Check aria-hidden="true" className="size-5 shrink-0" />}
      </span>
      <span className="text-xs font-medium leading-relaxed text-primary-foreground/80">
        {description}
      </span>
      {availabilityMessage && (
        <span className="text-xs font-semibold text-primary-foreground">
          {availabilityMessage}
        </span>
      )}
    </Button>
  );
}
