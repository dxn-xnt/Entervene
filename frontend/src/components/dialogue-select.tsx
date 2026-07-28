"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./retroui/Button";

export interface DialogueSelectProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description: string;
  icon?: LucideIcon | ReactNode;
  className?: string;
}

export function DialogueSelect({
  title,
  description,
  icon: Icon,
  className,
  ...props
}: DialogueSelectProps) {
  const renderIcon = () => {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return Icon;
    const IconComp = Icon as LucideIcon;
    return <IconComp className="size-6 shrink-0 text-foreground" />;
  };

  return (
    <Button
      className={cn(
        "group relative flex flex-col gap-2 p-4 text-left items-start",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-3 font-bold text-lg text-foreground">
        {renderIcon()}
        {title}
      </div>
      <p className="text-xs text-foreground font-normal leading-relaxed">
        {description}
      </p>
    </Button>
  );
}