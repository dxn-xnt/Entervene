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
    <RetroCard className="flex w-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <p className="font-bold">{title}</p>
        <p className="max-w-3xl text-sm text-gray-500">{description}</p>
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
