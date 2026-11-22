import type { ReactNode } from "react";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { cn } from "@/lib/utils";

type AdminEmptyStateProps = {
  icon?: ReactNode;
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    disabled?: boolean;
  };
  className?: string;
  embedded?: boolean;
  cardless?: boolean;
  compact?: boolean;
};

export function AdminEmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  className,
  embedded = false,
  cardless = false,
  compact = false,
}: AdminEmptyStateProps) {
  const content = (
    <Card.Content
      className={cn(
        "mx-auto flex w-full max-w-sm items-center gap-2 text-balance",
        compact ? "flex-row justify-start text-left" : "flex-col text-center",
      )}
    >
      {illustration ?? (
        <div
          className={cn(
            "grid size-10 shrink-0 place-items-center border-2 border-border bg-primary text-foreground [&_svg]:size-5 [&_svg]:stroke-2",
            compact && "rounded-lg",
            !compact && "mb-2",
          )}
        >
          {icon}
        </div>
      )}
      <div className={cn("min-w-0", !compact && "contents")}>
        <Card.Title className="text-base font-bold tracking-tight">
          {title}
        </Card.Title>
        {description && (
          <p className="text-sm/relaxed font-normal text-muted-foreground">
            {description}
          </p>
        )}
        {action && (
          <Button
            size="sm"
            className="mt-2"
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </Button>
        )}
      </div>
    </Card.Content>
  );

  if (cardless) {
    return (
      <div className={cn("w-full min-w-0 py-4 text-center", className)}>
        {content}
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "block w-full min-w-0 rounded! border-border bg-card px-6 py-12 text-center text-balance shadow-md",
        embedded && "p-4 shadow-none hover:shadow-none",
        compact && "flex items-center",
        className,
      )}
    >
      {content}
    </Card>
  );
}
