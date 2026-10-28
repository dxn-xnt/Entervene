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
};

export function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
  children,
  icon,
  compact = false,
}: EmptyStateCardProps) {
  const hasAction = Boolean(actionLabel && onAction);

  return (
    <RetroCard className={cn("flex w-full flex-col items-center justify-center gap-2 px-6 text-center", compact ? "py-6 shadow-none" : "py-12")}>
        {icon ? <div className="flex size-10 items-center justify-center rounded border-2 border-border bg-primary [&>svg]:size-5">{icon}</div> : null}
        <p className="font-bold">{title}</p>
        <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
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
