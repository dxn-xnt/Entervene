import type { ReactNode } from "react";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";

type EmptyStateCardProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
};

export function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
  children,
}: EmptyStateCardProps) {
  const hasAction = Boolean(actionLabel && onAction);

  return (
    <RetroCard className="w-full overflow-hidden p-0">
      <div className="border-b-2 border-black bg-[#fff1b8] px-4 py-3">
        <p className="font-bold">{title}</p>
      </div>
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <p className="max-w-3xl text-sm text-black/70">{description}</p>
        {hasAction || children ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {hasAction ? (
              <Button size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            ) : null}
            {children}
          </div>
        ) : null}
      </div>
    </RetroCard>
  );
}
