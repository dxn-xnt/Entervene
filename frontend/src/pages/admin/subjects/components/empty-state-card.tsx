import type { ReactNode } from "react";
import { Button } from "@/components/admin/button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { cn } from "@/lib/utils";

type EmptyStateCardProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
  inline?: boolean;
};

export function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
  children,
  icon,
  compact = false,
  inline = false,
}: EmptyStateCardProps) {
  const hasAction = Boolean(actionLabel && onAction);

  return (
    <RetroCard className={cn("flex w-full items-center justify-center gap-2", inline ? "flex-row px-3 py-2 text-left shadow-none" : compact ? "flex-col px-6 py-6 text-center shadow-none" : "flex-col px-6 py-12 text-center")}>
        {icon ? <div className={cn("flex shrink-0 items-center justify-center rounded border-2 border-border bg-primary", inline ? "size-8 [&>svg]:size-4" : "size-10 [&>svg]:size-5")}>{icon}</div> : null}
        <div className={cn(inline && "min-w-0")}>
          <p className="font-bold">{title}</p>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {hasAction || children ? (
          <div className="mt-2 flex shrink-0 flex-wrap justify-center gap-2">
            {hasAction ? (
              <Button size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            ) : null}
            {children}
          </div>
        ) : null}
    </RetroCard>
  );
}
