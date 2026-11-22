import type { ReactNode } from "react";
import { Button } from "@/components/retroui/Button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
  compact?: boolean;
};

export function AdminEmptyState({
  icon,
  illustration,
  title,
  description,
  action,
  className,
  compact = false,
}: AdminEmptyStateProps) {
  return (
    <Empty
      className={cn(
        "shadow-md hover:shadow-none transition-shadow",
        compact && "flex-none px-4 py-6",
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia>
          {illustration ?? (
            <div
              className="flex size-10 items-center justify-center border-2 border-black bg-primary text-black [&_svg]:size-5"
              aria-hidden="true"
            >
              {icon}
            </div>
          )}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && (
          <EmptyDescription className="text-center">
            {description}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <Button
            type="button"
            size="sm"
            disabled={action.disabled}
            onClick={action.onClick}
            className="shadow-none"
          >
            {action.icon}
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
